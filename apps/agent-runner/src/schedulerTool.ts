import type { ToolExecutionInput, ToolRegistration, ToolValidationIssue } from "@agent/core";
import type { JsonValue, ObservabilityStore, RunEvent } from "@agent/observability";
import { uuidv7 } from "uuidv7";
import { buildDeterministicRequestId, resolveScheduleTimeUtc } from "./scheduling";

type ScheduleToolDefaults = {
  agentId: string;
  objectivePrompt: string;
  threadId: string;
};

type CreateScheduleToolInput = {
  store: ObservabilityStore;
  defaults: ScheduleToolDefaults;
};

export function createPlannerScheduleWorkflowTool(input: CreateScheduleToolInput): ToolRegistration {
  return {
    name: "planner_schedule_workflow",
    description:
      "Schedule a new workflow run in the future. Supports one-shot runAt/delaySeconds, or cron recurrence in UTC.",
    validateArgs(args) {
      return validateArgs(args);
    },
    async execute(toolInput: ToolExecutionInput) {
      const args = toolInput.args;
      const availableAt = resolveScheduleTimeUtc({
        runAt: asOptionalString(args.runAt),
        delaySeconds: asOptionalNumber(args.delaySeconds),
        cron: asOptionalString(args.cron)
      }).toISOString();

      const maxAttemptsRaw = asOptionalNumber(args.maxAttempts);
      const maxAttempts = maxAttemptsRaw === undefined ? 3 : Math.max(1, Math.floor(maxAttemptsRaw));
      const objectivePrompt = asOptionalString(args.objectivePrompt) ?? input.defaults.objectivePrompt;
      const threadId = asOptionalString(args.threadId) ?? input.defaults.threadId;
      const workflowId = `wf_${uuidv7()}`;
      const requestId = buildDeterministicRequestId({
        namespace: "reqs",
        workflowId: toolInput.workflowId,
        stepNumber: toolInput.stepNumber,
        scheduleAtIso: availableAt,
        objectivePrompt
      });
      const runId = `run_${uuidv7()}`;
      const runStartedAt = new Date().toISOString();
      const traceId = `trace_${uuidv7()}`;

      await input.store.upsertRun({
        id: runId,
        agentId: input.defaults.agentId,
        status: "queued",
        startedAt: runStartedAt,
        traceId,
        retries: 0
      });

      const event: RunEvent = {
        id: uuidv7(),
        runId,
        ts: runStartedAt,
        type: "state",
        level: "info",
        message: "Run queued by planner schedule tool",
        payload: {
          objective_prompt: objectivePrompt,
          request_id: requestId,
          workflow_id: workflowId,
          thread_id: threadId,
          available_at: availableAt,
          cron: asOptionalString(args.cron) ?? null,
          scheduled_from_workflow_id: toolInput.workflowId,
          scheduled_from_step: (toolInput.stepNumber ?? -1) as JsonValue
        },
        tenantId: toolInput.tenantId,
        workspaceId: toolInput.workspaceId,
        correlationId: runId,
        causationId: toolInput.requestId
      };
      await input.store.appendRunEvent(event);

      const queued = await input.store.enqueueWorkflowJob({
        id: `job_${uuidv7()}`,
        runId,
        agentId: input.defaults.agentId,
        tenantId: toolInput.tenantId,
        workspaceId: toolInput.workspaceId,
        workflowId,
        requestId,
        threadId,
        objectivePrompt,
        maxAttempts,
        availableAt
      });

      return {
        ok: true,
        scheduledWorkflowId: queued.workflowId,
        scheduledRequestId: queued.requestId,
        availableAt: queued.availableAt,
        recurrence: asOptionalString(args.cron)
          ? {
              cron: asOptionalString(args.cron),
              mode: "self-perpetuating",
              note: "Include this tool call in each run to keep recurrence active."
            }
          : null
      };
    }
  };
}

function validateArgs(args: Record<string, unknown>): ToolValidationIssue[] {
  const issues: ToolValidationIssue[] = [];
  const hasRunAt = args.runAt !== undefined;
  const hasDelay = args.delaySeconds !== undefined;
  const hasCron = args.cron !== undefined;
  const configured = [hasRunAt, hasDelay, hasCron].filter(Boolean).length;
  if (configured !== 1) {
    issues.push({
      field: "schedule",
      message: "Exactly one of runAt, delaySeconds, or cron must be provided"
    });
  }

  if (hasRunAt && typeof args.runAt !== "string") {
    issues.push({ field: "runAt", message: "runAt must be a string ISO datetime" });
  }
  if (hasDelay && (typeof args.delaySeconds !== "number" || !Number.isFinite(args.delaySeconds))) {
    issues.push({ field: "delaySeconds", message: "delaySeconds must be a finite number" });
  }
  if (hasCron && typeof args.cron !== "string") {
    issues.push({ field: "cron", message: "cron must be a string in minute hour dom month dow format" });
  }
  if (args.maxAttempts !== undefined && (typeof args.maxAttempts !== "number" || !Number.isFinite(args.maxAttempts))) {
    issues.push({ field: "maxAttempts", message: "maxAttempts must be a finite number" });
  }
  if (args.objectivePrompt !== undefined && typeof args.objectivePrompt !== "string") {
    issues.push({ field: "objectivePrompt", message: "objectivePrompt must be a string" });
  }
  if (args.threadId !== undefined && typeof args.threadId !== "string") {
    issues.push({ field: "threadId", message: "threadId must be a string" });
  }
  return issues;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  return undefined;
}
