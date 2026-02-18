import { MemoryEngine } from "../memory";
import { RetrievalResult } from "../types";
import { uuidv7 } from "uuidv7";
import {
  ApprovalRequirement,
  EventEnvelopeV1,
  ObjectiveRequestV1,
  PlannerExecuteStageInput,
  PlannerInputV1,
  PlannerApprovalStageInput,
  PlannerPolicyStageInput,
  PlannerPolicyStageResult,
  PlannerLoopDeps,
  PlannerLoopContext,
  PlannerLoopResult,
  PlannerIntent,
  PlannerLoopStages,
  PlannerStepResult,
  StepMetadata,
  ToolRegistryPort,
  WorkflowStatus,
  WorkflowSignalV1
} from "./contracts";
import {
  ApprovalRequiredError,
  InternalRuntimeError,
  PolicyBlockedError,
  RuntimeError,
  SignalValidationError,
  ToolExecutionError,
  ValidationRuntimeError
} from "./errors";
import {
  ObjectiveEvent,
  ObjectiveExecutionContext,
  ObjectivePlugin,
  ObjectiveResult
} from "./objective";
import { RuntimeTelemetry, RuntimeTelemetryConfig } from "./observability";
import {
  AuditQuery,
  AuditRecord,
  AgentPersistencePort,
  InMemoryAgentPersistence,
  PersistedWorkflow
} from "./persistence/repositories";
import { PayloadValidationError } from "./validation";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PlannerIntentStepDeps {
  stepNumber?: number;
  executeTool?: (input: {
    tenantId: string;
    workspaceId: string;
    workflowId: string;
    requestId?: string;
    stepNumber?: number;
    toolName: string;
    args: Record<string, unknown>;
  }) => unknown | Promise<unknown>;
  toolRegistry?: ToolRegistryPort;
}

interface SignalResumeResult {
  workflowId: string;
  status: "resumed";
  signalType: WorkflowSignalV1["type"];
}

export interface ProviderCallbackV1 {
  callbackId: string;
  schemaVersion: "v1";
  tenantId: string;
  workspaceId: string;
  workflowId: string;
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export class EnvelopeValidationError extends Error {
  readonly code = "ENVELOPE_VALIDATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "EnvelopeValidationError";
  }
}

export type RuntimeRequest = EventEnvelopeV1;

export interface RuntimeResponse {
  objectiveId: string;
  eventType: string;
  result: ObjectiveResult;
  retrieved: RetrievalResult;
}

export class AgentRuntime {
  private readonly objectives = new Map<string, ObjectivePlugin>();
  private readonly telemetry: RuntimeTelemetry;
  private readonly persistence: AgentPersistencePort;

  constructor(
    private readonly workspace: string,
    private readonly memory: MemoryEngine | null,
    telemetryConfig?: RuntimeTelemetryConfig,
    persistence?: AgentPersistencePort
  ) {
    this.telemetry = new RuntimeTelemetry(workspace, telemetryConfig);
    this.persistence = persistence ?? new InMemoryAgentPersistence();
  }

  registerObjective(objective: ObjectivePlugin): void {
    this.objectives.set(objective.id, objective);
  }

  async run(req: RuntimeRequest): Promise<RuntimeResponse> {
    if (!this.memory) {
      throw new InternalRuntimeError("Memory engine is required for objective runtime execution");
    }

    const envelope = this.normalizeRequest(req);
    const objective = this.objectives.get(envelope.objectiveId);
    if (!objective) {
      throw new Error(`Objective not registered: ${envelope.objectiveId}`);
    }

    const runId = `run_${uuidv7()}`;
    const traceId = `tr_${uuidv7()}`;
    const startedAt = envelope.occurredAt;
    await this.telemetry.onRunQueued({ runId, traceId, startedAt });

    try {
      const event: ObjectiveEvent = {
        type: envelope.type,
        threadId: envelope.threadId,
        payload: envelope.payload
      };
      const validationIssues = objective.validator?.validate(event.type, event.payload) ?? [];
      if (validationIssues.length > 0) {
        throw new PayloadValidationError(objective.id, event.type, validationIssues);
      }

      const plan = objective.planRetrieval(event);
      const retrieved = plan
        ? this.memory.retrieve(
            {
              text: plan.queryText,
              workspace: this.workspace,
              objective: objective.id,
              channel: plan.channel,
              tags: plan.tags,
              accountTier: plan.accountTier,
              language: plan.language,
              withinDays: plan.withinDays
            },
            plan.budget
          )
        : { policies: [], items: [] };

      const context: ObjectiveExecutionContext = {
        workspace: this.workspace,
        objectiveId: objective.id,
        event,
        memory: this.memory,
        retrieved,
        workingMemory: this.memory.getWorkingMemory(event.threadId)
      };

      const result = objective.handle(context);

      for (const line of result.workingMemoryLines ?? []) {
        this.memory.updateWorkingMemory(event.threadId, line);
      }
      for (const item of result.memoryWrites ?? []) {
        this.memory.addMemory(item);
      }

      await this.telemetry.onRunFinished({
        runId,
        traceId,
        startedAt,
        status: "success"
      });

      return {
        objectiveId: objective.id,
        eventType: event.type,
        result,
        retrieved
      };
    } catch (err) {
      await this.telemetry.onRunFinished({
        runId,
        traceId,
        startedAt,
        status: "failed",
        errorSummary: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  async runPlannerIntentStep(
    request: ObjectiveRequestV1,
    intent: PlannerIntent,
    deps?: PlannerIntentStepDeps
  ): Promise<PlannerStepResult> {
    this.validateObjectiveRequest(request);
    this.validatePlannerIntent(intent);

    const step: StepMetadata = {
      workflowId: request.workflowId,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      threadId: request.threadId,
      intentType: intent.type,
      status: "failed"
    };

    if (intent.type === "ask_user") {
      step.status = "waiting_signal";
      await this.persistence.withTransaction((tx) => {
        const workflow = tx.getOrCreateWorkflow({
          workflowId: request.workflowId,
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          threadId: request.threadId
        });
        this.assertWorkflowScope(request, workflow);
        workflow.status = "waiting_signal";
        workflow.waitingQuestion = intent.question;
        workflow.steps.push(step);
        tx.saveWorkflow(workflow);
        tx.putWaitingCheckpoint({
          workflowId: request.workflowId,
          tenantId: request.tenantId,
          workspaceId: request.workspaceId
        });
      });
      return { step };
    }

    if (intent.type === "complete") {
      step.status = "completed";
      return { step, completion: intent.output ?? {} };
    }

    try {
      const toolInput = {
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        workflowId: request.workflowId,
        requestId: request.requestId,
        stepNumber: deps?.stepNumber,
        toolName: intent.toolName,
        args: intent.args
      };
      // Explicit executors take precedence; otherwise use the typed tool registry.
      const toolResult = deps?.toolRegistry
        ? await deps.toolRegistry.execute(toolInput)
        : deps?.executeTool
          ? await deps.executeTool(toolInput)
          : (() => {
              throw new ValidationRuntimeError(
                `No tool executor configured for planner tool_call: ${intent.toolName}`
              );
            })();
      step.status = "tool_executed";
      return { step, toolResult };
    } catch (err) {
      this.rethrowTypedError(err);
    }
  }

  async runPlannerLoop(request: ObjectiveRequestV1, deps: PlannerLoopDeps): Promise<PlannerLoopResult> {
    this.validateObjectiveRequest(request);
    if (!deps) {
      throw new ValidationRuntimeError("Invalid planner loop dependency: deps are required");
    }
    if (!deps.stages?.plan && typeof deps.planner !== "function") {
      throw new ValidationRuntimeError(
        "Invalid planner loop dependency: planner is required when plan stage is not provided"
      );
    }

    const maxSteps = deps.maxSteps ?? 32;
    if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
      throw new ValidationRuntimeError("Invalid max step guard: maxSteps must be a positive integer");
    }

    const existingWorkflow = this.persistence.findWorkflowById(request.workflowId);
    if (existingWorkflow) {
      this.assertWorkflowScope(request, existingWorkflow);
    }

    let workflow = await this.persistence.withTransaction((tx) => {
      tx.recordObjectiveRequest(request);
      return tx.getOrCreateWorkflow({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        workflowId: request.workflowId,
        threadId: request.threadId
      });
    });
    this.assertWorkflowScope(request, workflow);

    await this.telemetry.onPlannerRequestReceived({
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      workflowId: request.workflowId,
      requestId: request.requestId,
      occurredAt: request.occurredAt,
      objectivePrompt: request.objective_prompt
    });

    if (workflow.status === "completed") {
      await this.telemetry.onWorkflowTerminal({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        workflowId: request.workflowId,
        requestId: request.requestId,
        occurredAt: request.occurredAt,
        status: "completed"
      });
      return this.toPlannerLoopResult(workflow);
    }

    if (workflow.status === "failed") {
      await this.telemetry.onWorkflowTerminal({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        workflowId: request.workflowId,
        requestId: request.requestId,
        occurredAt: request.occurredAt,
        status: "failed"
      });
      return this.toPlannerLoopResult(workflow);
    }

    if (workflow.status === "waiting_signal") {
      throw new SignalValidationError(
        `Workflow is waiting for signal before next step: ${workflow.workflowId}`
      );
    }

    workflow.status = "running";
    const stages = this.getPlannerLoopStages(deps);

    while (true) {
      this.assertWorkflowScope(request, workflow);

      if (workflow.pendingApproval?.status === "pending") {
        workflow.status = "waiting_signal";
        return this.toPlannerLoopResult(workflow);
      }

      if (workflow.pendingApproval?.status === "rejected") {
        workflow.status = "failed";
        return this.toPlannerLoopResult(workflow);
      }

      if (workflow.pendingApproval?.status === "approved") {
        const pendingApproval = workflow.pendingApproval;
        const approvalStepIndex = pendingApproval.stepNumber;
        try {
          const transition = await this.persistence.withTransaction(async (tx) => {
            const currentWorkflow =
              tx.getWorkflow({
                tenantId: request.tenantId,
                workspaceId: request.workspaceId,
                workflowId: request.workflowId
              }) ??
              tx.getOrCreateWorkflow({
                tenantId: request.tenantId,
                workspaceId: request.workspaceId,
                workflowId: request.workflowId,
                threadId: request.threadId
              });
            this.assertWorkflowScope(request, currentWorkflow);

            if (currentWorkflow.pendingApproval?.status !== "approved") {
              return {
                workflow: currentWorkflow
              };
            }

            const approvedStepResult = await stages.executeIntent({
              request,
              stepIndex: approvalStepIndex,
              intent: currentWorkflow.pendingApproval.intent,
              executeTool: deps.executeTool,
              toolRegistry: deps.toolRegistry
            });
            currentWorkflow.steps.push(approvedStepResult.step);
            currentWorkflow.pendingApproval = undefined;
            currentWorkflow.status = "running";
            currentWorkflow.waitingQuestion = undefined;
            tx.appendPlannerStep({
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              workflowId: request.workflowId,
              stepNumber: approvalStepIndex,
              step: approvedStepResult.step,
              plannerInput: {
                contract_version: "planner-input-v1",
                objective_prompt: request.objective_prompt,
                memory_context: {},
                prior_step_summaries: currentWorkflow.steps.map((step) => ({ ...step })),
                policy_constraints: [],
                available_tools: [],
                step_index: approvalStepIndex,
                stepIndex: approvalStepIndex,
                tenant_id: request.tenantId,
                workspace_id: request.workspaceId,
                workflow_id: request.workflowId,
                thread_id: request.threadId,
                priorSteps: currentWorkflow.steps.map((step) => ({ ...step }))
              },
              plannerIntent: pendingApproval.intent,
              toolResult: approvedStepResult.toolResult,
              createdAt: request.occurredAt
            });
            tx.saveWorkflow(currentWorkflow);
            return {
              workflow: currentWorkflow
            };
          });
          workflow = transition.workflow;
          if (workflow.status === "waiting_signal" || workflow.status === "completed") {
            return this.toPlannerLoopResult(workflow);
          }
          if (workflow.status === "failed") {
            return this.toPlannerLoopResult(workflow);
          }
          continue;
        } catch (err) {
          await this.persistence.withTransaction((tx) => {
            const failedWorkflow = tx.getWorkflow({
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              workflowId: request.workflowId
            });
            if (failedWorkflow) {
              failedWorkflow.status = "failed";
              tx.saveWorkflow(failedWorkflow);
            }
          });
          this.rethrowTypedError(err);
        }
      }

      if (workflow.steps.length >= maxSteps) {
        workflow.status = "failed";
        throw new ValidationRuntimeError(`Workflow exceeded max step guard (${maxSteps})`);
      }

      const stepIndex = workflow.steps.length;
      const stepStartedAt = Date.now();
      const priorSteps = workflow.steps.map((step) => ({ ...step }));

      let plannerInput: PlannerInputV1;
      try {
        plannerInput = await stages.buildPlanningContext({
          request,
          stepIndex,
          priorSteps,
          toolRegistry: deps.toolRegistry,
          contextProvider: deps.contextProvider
        });
      } catch (err) {
        workflow.status = "failed";
        await this.telemetry.onPlannerValidationFailure({
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          workflowId: request.workflowId,
          requestId: request.requestId,
          occurredAt: request.occurredAt,
          stepIndex,
          phase: "planning_context",
          errorMessage: err instanceof Error ? err.message : String(err)
        });
        this.rethrowTypedError(err);
      }

      let intent: PlannerIntent;
      try {
        intent = await stages.plan(plannerInput, deps);
      } catch (err) {
        workflow.status = "failed";
        await this.telemetry.onPlannerValidationFailure({
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          workflowId: request.workflowId,
          requestId: request.requestId,
          occurredAt: request.occurredAt,
          stepIndex,
          phase: "planner_stage",
          errorMessage: err instanceof Error ? err.message : String(err)
        });
        this.rethrowTypedError(err);
      }

      let blockedError: PolicyBlockedError | undefined;
      let policyTelemetry:
        | {
            outcome: "allow" | "rewrite" | "block";
            policyId: string;
            reasonCode: string;
            rewritten: boolean;
          }
        | undefined;
      let stepTelemetry:
        | {
            status: StepMetadata["status"];
            intentType: PlannerIntent["type"];
          }
        | undefined;
      try {
        const transition = await this.persistence.withTransaction(async (tx) => {
          const currentWorkflow =
            tx.getWorkflow({
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              workflowId: request.workflowId
            }) ??
            tx.getOrCreateWorkflow({
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              workflowId: request.workflowId,
              threadId: request.threadId
            });
          this.assertWorkflowScope(request, currentWorkflow);

          await stages.validateIntent(intent);
          const policyDecision = await stages.evaluatePolicy({
            request,
            stepIndex,
            intent,
            plannerInput,
            policyEngine: deps.policyEngine,
            policyPackResolver: deps.policyPackResolver
          });
          policyTelemetry = {
            outcome: policyDecision.outcome,
            policyId: policyDecision.policyId,
            reasonCode: policyDecision.reasonCode,
            rewritten: Boolean(policyDecision.rewrittenIntent)
          };

          const effectiveIntent = policyDecision.rewrittenIntent ?? intent;
          if (policyDecision.rewrittenIntent) {
            await stages.validateIntent(effectiveIntent);
          }

          const approvalRequirement = await stages.evaluateApproval({
            request,
            stepIndex,
            intent: effectiveIntent,
            plannerInput,
            approvalPolicy: deps.approvalPolicy
          });

          tx.recordPolicyDecision({
            decisionId: `${request.workflowId}:${stepIndex}:${policyDecision.policyId}`,
            tenantId: request.tenantId,
            workspaceId: request.workspaceId,
            workflowId: request.workflowId,
            requestId: request.requestId,
            stepNumber: stepIndex,
            policyId: policyDecision.policyId,
            policyPackId: policyDecision.policyPack.policyPackId,
            policyPackVersion: policyDecision.policyPack.policyPackVersion,
            outcome: policyDecision.outcome,
            reasonCode: policyDecision.reasonCode,
            originalIntent: intent,
            rewrittenIntent: policyDecision.rewrittenIntent,
            evaluatedAt: request.occurredAt
          });
          tx.appendAuditRecord({
            auditId: `${request.workflowId}:${stepIndex}:${request.requestId}:policy`,
            tenantId: request.tenantId,
            workspaceId: request.workspaceId,
            workflowId: request.workflowId,
            requestId: request.requestId,
            stepNumber: stepIndex,
            eventType:
              policyDecision.outcome === "allow"
                ? "policy_allow"
                : policyDecision.outcome === "rewrite"
                  ? "policy_rewrite"
                  : "policy_block",
            occurredAt: request.occurredAt,
            signalCorrelationId: null,
            detail: {
              policyId: policyDecision.policyId,
              policyPackId: policyDecision.policyPack.policyPackId,
              policyPackVersion: policyDecision.policyPack.policyPackVersion,
              reasonCode: policyDecision.reasonCode
            }
          });

          if (approvalRequirement.requiresApproval) {
            const approvalId = `${request.workflowId}:${stepIndex}:approval`;
            const waitingStep: StepMetadata = {
              workflowId: request.workflowId,
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              threadId: request.threadId,
              intentType: effectiveIntent.type,
              status: "waiting_signal"
            };
            currentWorkflow.steps.push(waitingStep);
            stepTelemetry = {
              status: waitingStep.status,
              intentType: waitingStep.intentType
            };
            currentWorkflow.status = "waiting_signal";
            currentWorkflow.waitingQuestion = `Approval required for ${approvalRequirement.reasonCode}`;
            currentWorkflow.pendingApproval = {
              approvalId,
              requestId: request.requestId,
              stepNumber: stepIndex,
              intent: effectiveIntent,
              riskClass: approvalRequirement.riskClass,
              reasonCode: approvalRequirement.reasonCode,
              requestedAt: request.occurredAt,
              status: "pending"
            };
            tx.appendPlannerStep({
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              workflowId: request.workflowId,
              stepNumber: stepIndex,
              step: waitingStep,
              plannerInput,
              plannerIntent: effectiveIntent,
              createdAt: request.occurredAt
            });
            tx.putWaitingCheckpoint({
              workflowId: request.workflowId,
              tenantId: request.tenantId,
              workspaceId: request.workspaceId
            });
            tx.recordApprovalDecision({
              approvalId,
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              workflowId: request.workflowId,
              requestId: request.requestId,
              stepNumber: stepIndex,
              status: "pending",
              riskClass: approvalRequirement.riskClass,
              reasonCode: approvalRequirement.reasonCode,
              intent: effectiveIntent,
              requestedAt: request.occurredAt
            });
            tx.appendAuditRecord({
              auditId: `${request.workflowId}:${stepIndex}:${request.requestId}:approval_pending`,
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              workflowId: request.workflowId,
              requestId: request.requestId,
              stepNumber: stepIndex,
              eventType: "approval_pending",
              occurredAt: request.occurredAt,
              signalCorrelationId: null,
              detail: {
                approvalId,
                riskClass: approvalRequirement.riskClass,
                reasonCode: approvalRequirement.reasonCode
              }
            });
            tx.saveWorkflow(currentWorkflow);
            return {
              workflow: currentWorkflow
            };
          }

          if (policyDecision.outcome === "block") {
            const blockedStep: StepMetadata = {
              workflowId: request.workflowId,
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              threadId: request.threadId,
              intentType: intent.type,
              status: "failed"
            };
            currentWorkflow.steps.push(blockedStep);
            stepTelemetry = {
              status: blockedStep.status,
              intentType: blockedStep.intentType
            };
            tx.appendPlannerStep({
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              workflowId: request.workflowId,
              stepNumber: stepIndex,
              step: blockedStep,
              plannerInput,
              plannerIntent: intent,
              createdAt: request.occurredAt
            });
            currentWorkflow.status = "failed";
            currentWorkflow.waitingQuestion = undefined;
            tx.appendAuditRecord({
              auditId: `${request.workflowId}:${stepIndex}:${request.requestId}:terminal_failed`,
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              workflowId: request.workflowId,
              requestId: request.requestId,
              stepNumber: stepIndex,
              eventType: "workflow_terminal_failed",
              occurredAt: request.occurredAt,
              signalCorrelationId: null,
              detail: {
                reasonCode: policyDecision.reasonCode
              }
            });
            tx.saveWorkflow(currentWorkflow);
            return {
              workflow: currentWorkflow,
              blockedError: new PolicyBlockedError(
                policyDecision.policyId,
                `Policy blocked action (${policyDecision.reasonCode})`
              )
            };
          }

          const stepResult = await stages.executeIntent({
            request,
            stepIndex,
            intent: effectiveIntent,
            executeTool: deps.executeTool,
            toolRegistry: deps.toolRegistry
          });
          currentWorkflow.steps.push(stepResult.step);
          stepTelemetry = {
            status: stepResult.step.status,
            intentType: stepResult.step.intentType
          };
          tx.appendPlannerStep({
            tenantId: request.tenantId,
            workspaceId: request.workspaceId,
            workflowId: request.workflowId,
            stepNumber: stepIndex,
            step: stepResult.step,
            plannerInput,
            plannerIntent: effectiveIntent,
            toolResult: stepResult.toolResult,
            createdAt: request.occurredAt
          });

          if (stepResult.step.status === "waiting_signal") {
            currentWorkflow.status = "waiting_signal";
            currentWorkflow.waitingQuestion =
              intent.type === "ask_user" ? intent.question : undefined;
            tx.putWaitingCheckpoint({
              workflowId: request.workflowId,
              tenantId: request.tenantId,
              workspaceId: request.workspaceId
            });
            tx.saveWorkflow(currentWorkflow);
            return {
              workflow: currentWorkflow
            };
          }

          if (stepResult.step.status === "completed") {
            currentWorkflow.status = "completed";
            currentWorkflow.waitingQuestion = undefined;
            currentWorkflow.completion = stepResult.completion ?? {};
            tx.appendAuditRecord({
              auditId: `${request.workflowId}:${stepIndex}:${request.requestId}:terminal_completed`,
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              workflowId: request.workflowId,
              requestId: request.requestId,
              stepNumber: stepIndex,
              eventType: "workflow_terminal_completed",
              occurredAt: request.occurredAt,
              signalCorrelationId: null,
              detail: {
                completion: stepResult.completion ?? {}
              }
            });
            tx.saveWorkflow(currentWorkflow);
            return {
              workflow: currentWorkflow
            };
          }

          currentWorkflow.status = "running";
          currentWorkflow.waitingQuestion = undefined;
          tx.saveWorkflow(currentWorkflow);
          return {
            workflow: currentWorkflow
          };
        });
        workflow = transition.workflow;
        blockedError = transition.blockedError;
      } catch (err) {
        await this.persistence.withTransaction((tx) => {
          const failedWorkflow = tx.getWorkflow({
            tenantId: request.tenantId,
            workspaceId: request.workspaceId,
            workflowId: request.workflowId
          });
          if (failedWorkflow) {
            failedWorkflow.status = "failed";
            tx.saveWorkflow(failedWorkflow);
          }
        });
        await this.telemetry.onPlannerValidationFailure({
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          workflowId: request.workflowId,
          requestId: request.requestId,
          occurredAt: request.occurredAt,
          stepIndex,
          phase:
            err instanceof ValidationRuntimeError &&
            err.message.toLowerCase().includes("planner intent")
              ? "intent_validation"
              : "execution_transaction",
          errorMessage: err instanceof Error ? err.message : String(err)
        });
        await this.telemetry.onWorkflowTerminal({
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          workflowId: request.workflowId,
          requestId: request.requestId,
          occurredAt: request.occurredAt,
          status: "failed",
          errorSummary: err instanceof Error ? err.message : String(err)
        });
        this.rethrowTypedError(err);
      }

      if (policyTelemetry) {
        await this.telemetry.onPolicyDecision({
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          workflowId: request.workflowId,
          requestId: request.requestId,
          occurredAt: request.occurredAt,
          stepIndex,
          outcome: policyTelemetry.outcome,
          policyId: policyTelemetry.policyId,
          reasonCode: policyTelemetry.reasonCode,
          rewritten: policyTelemetry.rewritten
        });
      }

      if (stepTelemetry) {
        await this.telemetry.onPlannerStepLatency({
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          workflowId: request.workflowId,
          requestId: request.requestId,
          occurredAt: request.occurredAt,
          stepIndex,
          latencyMs: Math.max(1, Date.now() - stepStartedAt),
          status: stepTelemetry.status,
          intentType: stepTelemetry.intentType
        });
      }

      if (blockedError) {
        await this.telemetry.onWorkflowTerminal({
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          workflowId: request.workflowId,
          requestId: request.requestId,
          occurredAt: request.occurredAt,
          status: "failed",
          errorSummary: blockedError.message
        });
        throw blockedError;
      }

      if (workflow.status === "waiting_signal" || workflow.status === "completed") {
        if (workflow.status === "completed") {
          await this.telemetry.onWorkflowTerminal({
            tenantId: request.tenantId,
            workspaceId: request.workspaceId,
            workflowId: request.workflowId,
            requestId: request.requestId,
            occurredAt: request.occurredAt,
            status: "completed"
          });
        }
        return this.toPlannerLoopResult(workflow);
      }
    }
  }

  private getPlannerLoopStages(deps: PlannerLoopDeps): PlannerLoopStages {
    return {
      buildPlanningContext: deps.stages?.buildPlanningContext ?? this.defaultBuildPlanningContext,
      plan: deps.stages?.plan ?? this.defaultPlanStage,
      validateIntent: deps.stages?.validateIntent ?? (async (intent) => this.validatePlannerIntent(intent)),
      evaluatePolicy: deps.stages?.evaluatePolicy ?? this.defaultEvaluatePolicyStage,
      evaluateApproval: deps.stages?.evaluateApproval ?? this.defaultEvaluateApprovalStage,
      executeIntent: deps.stages?.executeIntent ?? this.defaultExecuteIntentStage
    };
  }

  async resumeWithSignal(signal: WorkflowSignalV1): Promise<SignalResumeResult> {
    await this.telemetry.onSignalLifecycle({
      tenantId: signal.tenantId,
      workspaceId: signal.workspaceId,
      workflowId: signal.workflowId,
      signalId: signal.signalId,
      signalType: signal.type,
      occurredAt: signal.occurredAt,
      stage: "queued"
    });
    this.validateSignal(signal);

    let resumeRequestId: string | undefined;

    try {
      await this.persistence.withTransaction((tx) => {
        const checkpoint = tx.consumeWaitingCheckpoint({
          workflowId: signal.workflowId,
          tenantId: signal.tenantId,
          workspaceId: signal.workspaceId
        });
        if (!checkpoint) {
          throw new SignalValidationError(`Workflow not found for resume: ${signal.workflowId}`);
        }

        const workflow = tx.getWorkflow({
          workflowId: signal.workflowId,
          tenantId: signal.tenantId,
          workspaceId: signal.workspaceId
        });
        if (!workflow) {
          throw new SignalValidationError(`Workflow not found for tenant/workspace: ${signal.workflowId}`);
        }

        tx.recordSignal(signal);
        tx.acknowledgeSignal({
          workflowId: signal.workflowId,
          tenantId: signal.tenantId,
          workspaceId: signal.workspaceId,
          signalId: signal.signalId,
          acknowledgedAt: signal.occurredAt
        });

        if (signal.type === "approval_signal") {
          const approvalPayload = signal.payload as { approved: boolean; approverId: string };
          const pendingApproval = workflow.pendingApproval;
          if (pendingApproval?.status === "pending") {
            resumeRequestId = pendingApproval.requestId;
            const status = approvalPayload.approved ? "approved" : "rejected";
            tx.resolveApprovalDecision({
              workflowId: signal.workflowId,
              tenantId: signal.tenantId,
              workspaceId: signal.workspaceId,
              approvalId: pendingApproval.approvalId,
              status,
              approverId: approvalPayload.approverId,
              resolvedAt: signal.occurredAt,
              signalId: signal.signalId
            });
            tx.appendAuditRecord({
              auditId: `${signal.workflowId}:${pendingApproval.stepNumber}:${pendingApproval.requestId}:approval_${status}`,
              tenantId: signal.tenantId,
              workspaceId: signal.workspaceId,
              workflowId: signal.workflowId,
              requestId: pendingApproval.requestId,
              stepNumber: pendingApproval.stepNumber,
              eventType: status === "approved" ? "approval_approved" : "approval_rejected",
              occurredAt: signal.occurredAt,
              signalCorrelationId: signal.signalId,
              detail: {
                approvalId: pendingApproval.approvalId,
                approverId: approvalPayload.approverId
              }
            });
            workflow.pendingApproval = {
              ...pendingApproval,
              status,
              approverId: approvalPayload.approverId,
              resolvedAt: signal.occurredAt,
              signalId: signal.signalId
            };
            workflow.status = status === "approved" ? "running" : "failed";
            workflow.waitingQuestion = undefined;
            if (status === "rejected") {
              tx.appendAuditRecord({
                auditId: `${signal.workflowId}:${pendingApproval.stepNumber}:${pendingApproval.requestId}:terminal_failed`,
                tenantId: signal.tenantId,
                workspaceId: signal.workspaceId,
                workflowId: signal.workflowId,
                requestId: pendingApproval.requestId,
                stepNumber: pendingApproval.stepNumber,
                eventType: "workflow_terminal_failed",
                occurredAt: signal.occurredAt,
                signalCorrelationId: signal.signalId,
                detail: {
                  reasonCode: "approval_rejected"
                }
              });
            }
            tx.saveWorkflow(workflow);
            return;
          }
        }

        workflow.status = "running";
        workflow.waitingQuestion = undefined;
        tx.saveWorkflow(workflow);
      });
    } catch (err) {
      await this.telemetry.onSignalLifecycle({
        tenantId: signal.tenantId,
        workspaceId: signal.workspaceId,
        workflowId: signal.workflowId,
        signalId: signal.signalId,
        signalType: signal.type,
        occurredAt: signal.occurredAt,
        requestId: resumeRequestId,
        stage: "dropped",
        reason: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }

    await this.telemetry.onSignalLifecycle({
      tenantId: signal.tenantId,
      workspaceId: signal.workspaceId,
      workflowId: signal.workflowId,
      signalId: signal.signalId,
      signalType: signal.type,
      occurredAt: signal.occurredAt,
      requestId: resumeRequestId,
      stage: "delivered"
    });
    await this.telemetry.onSignalLifecycle({
      tenantId: signal.tenantId,
      workspaceId: signal.workspaceId,
      workflowId: signal.workflowId,
      signalId: signal.signalId,
      signalType: signal.type,
      occurredAt: signal.occurredAt,
      requestId: resumeRequestId,
      stage: "resumed"
    });

    return {
      workflowId: signal.workflowId,
      status: "resumed",
      signalType: signal.type
    };
  }

  async resumeWithProviderCallback(callback: ProviderCallbackV1): Promise<SignalResumeResult> {
    this.validateProviderCallback(callback);
    return await this.resumeWithSignal({
      signalId: callback.callbackId,
      schemaVersion: callback.schemaVersion,
      tenantId: callback.tenantId,
      workspaceId: callback.workspaceId,
      workflowId: callback.workflowId,
      type: "external_event_signal",
      occurredAt: callback.occurredAt,
      payload: {
        eventType: callback.eventType,
        ...callback.payload
      }
    });
  }

  listAuditRecords(query: AuditQuery): AuditRecord[] {
    if (!query.tenantId) {
      throw new ValidationRuntimeError("Invalid audit query: tenantId is required");
    }
    if (!query.workspaceId) {
      throw new ValidationRuntimeError("Invalid audit query: workspaceId is required");
    }
    if (query.workspaceId !== this.workspace) {
      throw new ValidationRuntimeError(
        `Workspace mismatch: runtime=${this.workspace} query=${query.workspaceId}`
      );
    }
    return this.persistence.listAuditRecords(query);
  }

  private validateObjectiveRequest(request: ObjectiveRequestV1): void {
    if (request.schemaVersion !== "v1") {
      throw new ValidationRuntimeError(
        `Unsupported objective request schemaVersion: ${String(request.schemaVersion)}`
      );
    }
    if (!UUID_V7_RE.test(request.requestId)) {
      throw new ValidationRuntimeError("Invalid requestId: expected UUID v7");
    }
    if (!request.tenantId) {
      throw new ValidationRuntimeError("Invalid tenantId: value is required");
    }
    if (!request.workspaceId) {
      throw new ValidationRuntimeError("Invalid workspaceId: value is required");
    }
    if (request.workspaceId !== this.workspace) {
      throw new ValidationRuntimeError(
        `Workspace mismatch: runtime=${this.workspace} request=${request.workspaceId}`
      );
    }
    if (!request.workflowId || !request.threadId) {
      throw new ValidationRuntimeError("Invalid workflow identity: workflowId and threadId are required");
    }
    if (!request.objective_prompt || typeof request.objective_prompt !== "string") {
      throw new ValidationRuntimeError("Invalid objective_prompt: non-empty string required");
    }
    this.assertIsoDatetime(request.occurredAt, "occurredAt");
  }

  private validatePlannerIntent(intent: PlannerIntent): void {
    if (intent.type === "tool_call") {
      if (!intent.toolName || typeof intent.toolName !== "string") {
        throw new ValidationRuntimeError("Invalid planner intent: toolName is required for tool_call");
      }
      if (!this.isRecord(intent.args)) {
        throw new ValidationRuntimeError("Invalid planner intent: args must be an object");
      }
      return;
    }

    if (intent.type === "ask_user") {
      if (!intent.question || typeof intent.question !== "string") {
        throw new ValidationRuntimeError("Invalid planner intent: question is required for ask_user");
      }
      return;
    }

    if (intent.type === "complete") {
      if (intent.output !== undefined && !this.isRecord(intent.output)) {
        throw new ValidationRuntimeError("Invalid planner intent: output must be an object when provided");
      }
      return;
    }

    throw new ValidationRuntimeError(`Invalid planner intent type: ${(intent as { type?: unknown }).type}`);
  }

  private validatePolicyDecision(
    decision: { policyId: string; outcome: string; reasonCode: string; rewrittenIntent?: PlannerIntent },
    intent: PlannerIntent
  ): void {
    if (!decision.policyId || typeof decision.policyId !== "string") {
      throw new ValidationRuntimeError("Invalid policy decision: policyId is required");
    }

    if (
      decision.outcome !== "allow" &&
      decision.outcome !== "block" &&
      decision.outcome !== "rewrite"
    ) {
      throw new ValidationRuntimeError(
        `Invalid policy decision outcome: ${String(decision.outcome)}`
      );
    }

    if (!decision.reasonCode || typeof decision.reasonCode !== "string") {
      throw new ValidationRuntimeError("Invalid policy decision: reasonCode is required");
    }

    if (decision.outcome === "rewrite") {
      if (!decision.rewrittenIntent) {
        throw new ValidationRuntimeError(
          "Invalid policy decision: rewrittenIntent is required for rewrite outcome"
        );
      }
      this.validatePlannerIntent(decision.rewrittenIntent);
      return;
    }

    if (decision.rewrittenIntent) {
      throw new ValidationRuntimeError(
        "Invalid policy decision: rewrittenIntent is only allowed for rewrite outcome"
      );
    }

    this.validatePlannerIntent(intent);
  }

  private validateApprovalRequirement(requirement: ApprovalRequirement): void {
    if (!requirement.riskClass || typeof requirement.riskClass !== "string") {
      throw new ValidationRuntimeError("Invalid approval requirement: riskClass is required");
    }
    if (typeof requirement.requiresApproval !== "boolean") {
      throw new ValidationRuntimeError(
        "Invalid approval requirement: requiresApproval must be boolean"
      );
    }
    if (!requirement.reasonCode || typeof requirement.reasonCode !== "string") {
      throw new ValidationRuntimeError("Invalid approval requirement: reasonCode is required");
    }
  }

  private defaultBuildPlanningContext = ({
    request,
    stepIndex,
    priorSteps,
    toolRegistry,
    contextProvider
  }: {
    request: ObjectiveRequestV1;
    stepIndex: number;
    priorSteps: StepMetadata[];
    toolRegistry?: ToolRegistryPort;
    contextProvider?: PlannerLoopDeps["contextProvider"];
  }): PlannerInputV1 => {
    const memoryContext = contextProvider?.memory?.({ request, stepIndex }) ?? {};
    const policyConstraints = contextProvider?.policyConstraints?.({ request, stepIndex }) ?? [];
    const availableTools = toolRegistry
      ? toolRegistry.listTools({
          tenantId: request.tenantId,
          workspaceId: request.workspaceId
        })
      : [];

    return {
      contract_version: "planner-input-v1",
      objective_prompt: request.objective_prompt,
      memory_context: memoryContext,
      prior_step_summaries: priorSteps,
      policy_constraints: policyConstraints,
      available_tools: availableTools,
      step_index: stepIndex,
      stepIndex,
      tenant_id: request.tenantId,
      workspace_id: request.workspaceId,
      workflow_id: request.workflowId,
      thread_id: request.threadId,
      priorSteps
    };
  };

  private defaultPlanStage = async (
    input: PlannerInputV1,
    deps: PlannerLoopDeps
  ): Promise<PlannerIntent> => {
    if (typeof deps.planner !== "function") {
      throw new ValidationRuntimeError("Invalid planner loop dependency: planner is required");
    }
    return await deps.planner(input as PlannerLoopContext & PlannerInputV1);
  };

  private defaultEvaluatePolicyStage = async ({
    request,
    stepIndex,
    intent,
    plannerInput,
    policyEngine,
    policyPackResolver
  }: PlannerPolicyStageInput): Promise<PlannerPolicyStageResult> => {
    const policyPack =
      (await policyPackResolver?.({ request, stepIndex })) ?? {
        policyPackId: `${request.tenantId}-default-policy-pack`,
        policyPackVersion: "v1"
      };

    if (!policyPack.policyPackId || !policyPack.policyPackVersion) {
      throw new ValidationRuntimeError(
        "Invalid policy pack scope: policyPackId and policyPackVersion are required"
      );
    }

    if (!policyEngine) {
      return {
        policyId: "POLICY_DEFAULT_ALLOW",
        outcome: "allow",
        reasonCode: "no_policy_engine_configured",
        policyPack
      };
    }

    const decision = await policyEngine.evaluate({
      request,
      stepIndex,
      intent,
      plannerInput,
      policyPack
    });
    this.validatePolicyDecision(decision, intent);

    return {
      ...decision,
      policyPack
    };
  };

  private defaultEvaluateApprovalStage = async ({
    request,
    stepIndex,
    intent,
    plannerInput,
    approvalPolicy
  }: PlannerApprovalStageInput): Promise<ApprovalRequirement> => {
    if (intent.type !== "tool_call") {
      return {
        riskClass: "low",
        requiresApproval: false,
        reasonCode: "non_tool_intent"
      };
    }

    if (!approvalPolicy) {
      return {
        riskClass: "low",
        requiresApproval: false,
        reasonCode: "no_approval_policy_configured"
      };
    }

    const requirement = await approvalPolicy.classify({
      request,
      stepIndex,
      intent,
      plannerInput
    });
    this.validateApprovalRequirement(requirement);
    return requirement;
  };

  private defaultExecuteIntentStage = async ({
    request,
    stepIndex,
    intent,
    executeTool,
    toolRegistry
  }: PlannerExecuteStageInput): Promise<PlannerStepResult> => {
    return await this.runPlannerIntentStep(request, intent, {
      stepNumber: stepIndex,
      executeTool,
      toolRegistry
    });
  };

  private validateSignal(signal: WorkflowSignalV1): void {
    if (signal.schemaVersion !== "v1") {
      throw new SignalValidationError(
        `Unsupported signal schemaVersion: ${String(signal.schemaVersion)}`
      );
    }
    if (!UUID_V7_RE.test(signal.signalId)) {
      throw new SignalValidationError("Invalid signalId: expected UUID v7");
    }
    if (!signal.tenantId || !signal.workspaceId || !signal.workflowId) {
      throw new SignalValidationError(
        "Invalid signal identity: tenantId, workspaceId, and workflowId are required"
      );
    }
    this.assertIsoDatetime(signal.occurredAt, "occurredAt");

    if (signal.type === "approval_signal") {
      if (!this.isRecord(signal.payload)) {
        throw new SignalValidationError("Invalid approval_signal payload: payload must be an object");
      }
      const approved = signal.payload.approved;
      const approverId = signal.payload.approverId;
      if (typeof approved !== "boolean") {
        throw new SignalValidationError("Invalid approval_signal payload: approved must be boolean");
      }
      if (!approverId || typeof approverId !== "string") {
        throw new SignalValidationError("Invalid approval_signal payload: approverId is required");
      }
      return;
    }

    if (signal.type === "external_event_signal") {
      if (!this.isRecord(signal.payload) || typeof signal.payload.eventType !== "string") {
        throw new SignalValidationError(
          "Invalid external_event_signal payload: eventType is required"
        );
      }
      return;
    }

    if (signal.type === "timer_signal") {
      if (!this.isRecord(signal.payload) || typeof signal.payload.firedAt !== "string") {
        throw new SignalValidationError("Invalid timer_signal payload: firedAt is required");
      }
      this.assertIsoDatetime(signal.payload.firedAt, "payload.firedAt");
      return;
    }

    if (signal.type === "user_input_signal") {
      if (!this.isRecord(signal.payload) || typeof signal.payload.message !== "string") {
        throw new SignalValidationError("Invalid user_input_signal payload: message is required");
      }
      return;
    }

    throw new SignalValidationError(`Unsupported signal type: ${(signal as { type?: unknown }).type}`);
  }

  private validateProviderCallback(callback: ProviderCallbackV1): void {
    if (callback.schemaVersion !== "v1") {
      throw new SignalValidationError(
        `Unsupported callback schemaVersion: ${String(callback.schemaVersion)}`
      );
    }
    if (!UUID_V7_RE.test(callback.callbackId)) {
      throw new SignalValidationError("Invalid callbackId: expected UUID v7");
    }
    if (!callback.tenantId || !callback.workspaceId || !callback.workflowId) {
      throw new SignalValidationError(
        "Invalid callback identity: tenantId, workspaceId, and workflowId are required"
      );
    }
    if (!callback.eventType || typeof callback.eventType !== "string") {
      throw new SignalValidationError("Invalid callback payload: eventType is required");
    }
    if (!this.isRecord(callback.payload)) {
      throw new SignalValidationError("Invalid callback payload: payload must be an object");
    }
    this.assertIsoDatetime(callback.occurredAt, "occurredAt");
  }

  private rethrowTypedError(err: unknown): never {
    if (err instanceof ValidationRuntimeError) {
      throw err;
    }
    if (err instanceof PolicyBlockedError) {
      throw err;
    }
    if (err instanceof ApprovalRequiredError) {
      throw err;
    }
    if (err instanceof ToolExecutionError) {
      throw err;
    }
    if (err instanceof RuntimeError) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    throw new InternalRuntimeError(`Unhandled runtime error: ${message}`);
  }

  private assertWorkflowScope(request: ObjectiveRequestV1, workflow: PersistedWorkflow): void {
    if (
      workflow.tenantId !== request.tenantId ||
      workflow.workspaceId !== request.workspaceId ||
      workflow.threadId !== request.threadId
    ) {
      throw new SignalValidationError(
        `Workflow not found for tenant/workspace/thread: ${workflow.workflowId}`
      );
    }
  }

  private toPlannerLoopResult(workflow: PersistedWorkflow): PlannerLoopResult {
    return {
      workflowId: workflow.workflowId,
      status: workflow.status,
      steps: workflow.steps.map((step) => ({ ...step })),
      waitingQuestion: workflow.waitingQuestion,
      completion: workflow.completion
    };
  }

  private assertIsoDatetime(value: string, field: string): void {
    const occurred = new Date(value);
    if (Number.isNaN(occurred.getTime()) || occurred.toISOString() !== value) {
      throw new ValidationRuntimeError(`Invalid ${field}: expected ISO datetime`);
    }
  }

  private isRecord(input: unknown): input is Record<string, unknown> {
    return !!input && typeof input === "object" && !Array.isArray(input);
  }

  private normalizeRequest(req: RuntimeRequest): EventEnvelopeV1 {
    if (req.schemaVersion !== "v1") {
      if (req.schemaVersion === undefined) {
        throw new EnvelopeValidationError("Missing required field: schemaVersion");
      }
      throw new EnvelopeValidationError(`Unsupported schemaVersion: ${String(req.schemaVersion)}`);
    }
    if (!UUID_V7_RE.test(req.eventId)) {
      throw new EnvelopeValidationError("Invalid eventId: expected UUID v7");
    }
    if (!req.objectiveId || !req.type || !req.threadId) {
      throw new EnvelopeValidationError("Envelope requires objectiveId, type, and threadId");
    }
    const occurred = new Date(req.occurredAt);
    if (Number.isNaN(occurred.getTime()) || occurred.toISOString() !== req.occurredAt) {
      throw new EnvelopeValidationError("Invalid occurredAt: expected ISO datetime");
    }

    return req;
  }
}
