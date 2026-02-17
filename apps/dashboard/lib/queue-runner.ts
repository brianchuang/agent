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
    | "getRun"
    | "upsertRun"
    | "appendRunEvent"
  >;
  execute: (job: WorkflowQueueJob) => Promise<Record<string, JsonValue>>;
};

export type QueueRunnerInput = ClaimWorkflowJobsInput;

export type QueueRunnerResult = {
  claimed: number;
  completed: number;
  failed: number;
};

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

          const output = await deps.execute(job);
          await deps.store.completeWorkflowJob({
            jobId: job.id,
            leaseToken: job.leaseToken ?? ""
          });

          const finishedRun = await deps.store.getRun(job.runId);
          if (finishedRun) {
            const endedAt = new Date().toISOString();
            await deps.store.upsertRun({
              ...finishedRun,
              status: "success",
              endedAt,
              latencyMs: Math.max(
                0,
                new Date(endedAt).getTime() - new Date(finishedRun.startedAt).getTime()
              )
            });
          }

          await deps.store.appendRunEvent({
            id: uuidv7(),
            runId: job.runId,
            ts: new Date().toISOString(),
            type: "state",
            level: "info",
            message: "Run completed",
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
