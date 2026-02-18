import { MemoryEngine } from "../memory";
import { RetrievalResult } from "../types";
import { EventEnvelopeV1, ObjectiveRequestV1, PlannerLoopDeps, PlannerLoopResult, PlannerIntent, PlannerStepResult, ToolRegistryPort, WorkflowSignalV1 } from "./contracts";
import { ObjectivePlugin, ObjectiveResult } from "./objective";
import { RuntimeTelemetryConfig } from "./observability";
import { AuditQuery, AuditRecord, AgentPersistencePort } from "./persistence/repositories";
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
export declare class EnvelopeValidationError extends Error {
    readonly code = "ENVELOPE_VALIDATION_FAILED";
    constructor(message: string);
}
export type RuntimeRequest = EventEnvelopeV1;
export interface RuntimeResponse {
    objectiveId: string;
    eventType: string;
    result: ObjectiveResult;
    retrieved: RetrievalResult;
}
export declare class AgentRuntime {
    private readonly workspace;
    private readonly memory;
    private readonly objectives;
    private readonly telemetry;
    private readonly persistence;
    constructor(workspace: string, memory: MemoryEngine | null, telemetryConfig?: RuntimeTelemetryConfig, persistence?: AgentPersistencePort);
    registerObjective(objective: ObjectivePlugin): void;
    run(req: RuntimeRequest): Promise<RuntimeResponse>;
    runPlannerIntentStep(request: ObjectiveRequestV1, intent: PlannerIntent, deps?: PlannerIntentStepDeps): Promise<PlannerStepResult>;
    runPlannerLoop(request: ObjectiveRequestV1, deps: PlannerLoopDeps): Promise<PlannerLoopResult>;
    private getPlannerLoopStages;
    resumeWithSignal(signal: WorkflowSignalV1): Promise<SignalResumeResult>;
    resumeWithProviderCallback(callback: ProviderCallbackV1): Promise<SignalResumeResult>;
    listAuditRecords(query: AuditQuery): AuditRecord[];
    private validateObjectiveRequest;
    private validatePlannerIntent;
    private validatePolicyDecision;
    private validateApprovalRequirement;
    private defaultBuildPlanningContext;
    private defaultPlanStage;
    private defaultEvaluatePolicyStage;
    private defaultEvaluateApprovalStage;
    private defaultExecuteIntentStage;
    private validateSignal;
    private validateProviderCallback;
    private rethrowTypedError;
    private assertWorkflowScope;
    private toPlannerLoopResult;
    private assertIsoDatetime;
    private isRecord;
    private normalizeRequest;
}
export {};
