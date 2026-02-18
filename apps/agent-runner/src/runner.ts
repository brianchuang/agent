import { uuidv7 } from "uuidv7";
import type {
  ClaimWorkflowJobsInput,
  JsonValue,
  ObservabilityStore,
  WorkflowQueueJob
} from "@agent/observability";

export type QueueRunnerDependencies = {
  store: Pick<
    ObservabilityStore,
    | "claimWorkflowJobs"
    | "completeWorkflowJob"
    | "failWorkflowJob"
    | "getWorkflowJob"
    | "getRun"
    | "upsertRun"
    | "appendRunEvent"
  >;
  execute: (job: WorkflowQueueJob) => Promise<Record<string, JsonValue>>;
  executeTimeoutMs?: number;
  notifier?: WaitingSignalNotifier;
};

export type QueueRunnerInput = ClaimWorkflowJobsInput;

export type QueueRunnerResult = {
  claimed: number;
  completed: number;
  failed: number;
};

export type WaitingSignalNotification = {
  runId: string;
  jobId: string;
  workflowId: string;
  threadId: string;
  tenantId: string;
  workspaceId: string;
  waitingQuestion: string;
};

export type WaitingSignalNotifier = {
  notifyWaitingSignal(
    input: WaitingSignalNotification
  ): Promise<{ channel: string; target: string } | void>;
};

function getOutputStatus(output: Record<string, JsonValue>): string | undefined {
  const raw = output.status;
  return typeof raw === "string" ? raw : undefined;
}

function getWaitingQuestion(output: Record<string, JsonValue>): string | undefined {
  const direct = output.waitingQuestion;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }

  const result = output.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }
  const nested = (result as Record<string, JsonValue>).waitingQuestion;
  return typeof nested === "string" && nested.trim().length > 0 ? nested.trim() : undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function assertScope(input: QueueRunnerInput) {
  const hasTenant = typeof input.tenantId === "string" && input.tenantId.length > 0;
  const hasWorkspace = typeof input.workspaceId === "string" && input.workspaceId.length > 0;
  if (hasTenant !== hasWorkspace) {
    throw new Error("tenantId and workspaceId must be provided together");
  }
}

export function createQueueRunner(deps: QueueRunnerDependencies) {
  return {
    async runOnce(input: QueueRunnerInput): Promise<QueueRunnerResult> {
      assertScope(input);
      const executeTimeoutMs = deps.executeTimeoutMs ?? 120_000;
      const claimed = await deps.store.claimWorkflowJobs(input);
      let completed = 0;
      let failed = 0;

      for (const job of claimed) {
        try {
          const run = await deps.store.getRun(job.runId);
          if (run) {
            await deps.store.upsertRun({ ...run, status: "running" });
          }

          await deps.store.appendRunEvent({
            id: uuidv7(),
            runId: job.runId,
            ts: new Date().toISOString(),
            type: "state",
            level: "info",
            message: "Run claimed by worker",
            payload: {
              worker_id: input.workerId,
              workflow_id: job.workflowId,
              request_id: job.requestId
            },
            tenantId: job.tenantId,
            workspaceId: job.workspaceId,
            correlationId: job.runId,
            causationId: job.id
          });

          const output = await withTimeout(
            deps.execute(job),
            executeTimeoutMs,
            `Workflow execution (${job.workflowId})`
          );
          await deps.store.completeWorkflowJob({
            jobId: job.id,
            leaseToken: job.leaseToken ?? ""
          });
          const completedJob = await deps.store.getWorkflowJob(job.id);
          if (!completedJob || completedJob.status !== "completed") {
            throw new Error(
              `Workflow queue completion not acknowledged for ${job.workflowId} (jobId=${job.id})`
            );
          }

          const finishedRun = await deps.store.getRun(job.runId);
          const outputStatus = getOutputStatus(output);
          if (finishedRun) {
            if (outputStatus === "waiting_signal") {
              await deps.store.upsertRun({
                ...finishedRun,
                status: "queued",
                endedAt: undefined,
                latencyMs: undefined
              });
              if (deps.notifier) {
                const waitingQuestion =
                  getWaitingQuestion(output) ?? "Waiting for additional input or signal.";
                try {
                  const notifyResult = await deps.notifier.notifyWaitingSignal({
                    runId: job.runId,
                    jobId: job.id,
                    workflowId: job.workflowId,
                    threadId: job.threadId,
                    tenantId: job.tenantId,
                    workspaceId: job.workspaceId,
                    waitingQuestion
                  });
                  if (notifyResult) {
                    await deps.store.appendRunEvent({
                      id: uuidv7(),
                      runId: job.runId,
                      ts: new Date().toISOString(),
                      type: "state",
                      level: "info",
                      message: "Waiting question delivered",
                      payload: {
                        channel: notifyResult.channel,
                        target: notifyResult.target,
                        waitingQuestion
                      },
                      tenantId: job.tenantId,
                      workspaceId: job.workspaceId,
                      correlationId: job.runId,
                      causationId: job.id
                    });
                  }
                } catch (error) {
                  const notifyError = error instanceof Error ? error.message : String(error);
                  await deps.store.appendRunEvent({
                    id: uuidv7(),
                    runId: job.runId,
                    ts: new Date().toISOString(),
                    type: "state",
                    level: "error",
                    message: "Waiting question delivery failed",
                    payload: {
                      error: notifyError,
                      waitingQuestion
                    },
                    tenantId: job.tenantId,
                    workspaceId: job.workspaceId,
                    correlationId: job.runId,
                    causationId: job.id
                  });
                }
              }
            } else {
              const endedAt = new Date().toISOString();
              await deps.store.upsertRun({
                ...finishedRun,
                status: "success",
                endedAt,
                errorSummary: undefined,
                latencyMs: Math.max(
                  0,
                  new Date(endedAt).getTime() - new Date(finishedRun.startedAt).getTime()
                )
              });
            }
          }

          await deps.store.appendRunEvent({
            id: uuidv7(),
            runId: job.runId,
            ts: new Date().toISOString(),
            type: "state",
            level: "info",
            message: outputStatus === "waiting_signal" ? "Run waiting for signal" : "Run completed",
            payload: {
              output
            },
            tenantId: job.tenantId,
            workspaceId: job.workspaceId,
            correlationId: job.runId,
            causationId: job.id
          });
          completed += 1;
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : String(error);

          await deps.store.failWorkflowJob({
            jobId: job.id,
            leaseToken: job.leaseToken ?? "",
            error: message,
            retryAt: new Date(Date.now() + 5_000).toISOString()
          });
          const failedJob = await deps.store.getWorkflowJob(job.id);

          const failedRun = await deps.store.getRun(job.runId);
          if (failedRun && failedJob) {
            const endedAt = new Date().toISOString();
            if (failedJob.status === "failed") {
              await deps.store.upsertRun({
                ...failedRun,
                status: "failed",
                endedAt,
                errorSummary: message,
                latencyMs: Math.max(
                  0,
                  new Date(endedAt).getTime() - new Date(failedRun.startedAt).getTime()
                )
              });
            } else if (failedJob.status === "queued") {
              await deps.store.upsertRun({
                ...failedRun,
                status: "queued",
                retries: failedRun.retries + 1
              });
            }
          }
          await deps.store.appendRunEvent({
            id: uuidv7(),
            runId: job.runId,
            ts: new Date().toISOString(),
            type: "state",
            level: "error",
            message: "Run execution failed",
            payload: {
              error: message
            },
            tenantId: job.tenantId,
            workspaceId: job.workspaceId,
            correlationId: job.runId,
            causationId: job.id
          });
        }
      }

      return {
        claimed: claimed.length,
        completed,
        failed
      };
    }
  };
}
