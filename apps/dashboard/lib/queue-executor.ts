import type { JsonValue, WorkflowQueueJob } from "@agent/observability";

export type QueueExecutionAdapter = {
  execute(job: WorkflowQueueJob): Promise<Record<string, JsonValue>>;
};

export function createInlineExecutionAdapter(): QueueExecutionAdapter {
  return {
    async execute(job) {
      return {
        workflowId: job.workflowId,
        requestId: job.requestId,
        handledBy: "inline-adapter",
        objectivePrompt: job.objectivePrompt
      };
    }
  };
}
