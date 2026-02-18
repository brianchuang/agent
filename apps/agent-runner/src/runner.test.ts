import test from "node:test";
import assert from "node:assert/strict";
import type { Run, RunEvent, WorkflowQueueJob } from "@agent/observability";
import { createQueueRunner } from "./runner";

type MemoryStore = {
  queueJobs: WorkflowQueueJob[];
  runs: Run[];
  runEvents: RunEvent[];
};

function createMemoryStore(): MemoryStore {
  const now = new Date().toISOString();
  return {
    queueJobs: [
      {
        id: "job-1",
        runId: "run-1",
        agentId: "agent-1",
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        workflowId: "wf-1",
        requestId: "req-1",
        threadId: "thread-1",
        objectivePrompt: "Send follow-up",
        status: "queued",
        attemptCount: 0,
        maxAttempts: 3,
        availableAt: now,
        createdAt: now,
        updatedAt: now
      }
    ],
    runs: [
      {
        id: "run-1",
        agentId: "agent-1",
        status: "queued",
        startedAt: now,
        traceId: "trace-1",
        retries: 0
      }
    ],
    runEvents: []
  };
}

test("queue runner claims queued jobs and marks run success", async () => {
  const state = createMemoryStore();
  const runner = createQueueRunner({
    store: {
      async claimWorkflowJobs({ workerId, limit }) {
        const available = state.queueJobs.filter((job) => job.status === "queued").slice(0, limit);
        return available.map((job, index) => {
          const leaseToken = `${workerId}-lease-${index + 1}`;
          job.status = "claimed";
          job.leaseToken = leaseToken;
          job.leaseExpiresAt = new Date(Date.now() + 30_000).toISOString();
          job.attemptCount += 1;
          return { ...job };
        });
      },
      async completeWorkflowJob({ jobId, leaseToken }) {
        const job = state.queueJobs.find((item) => item.id === jobId);
        assert.ok(job);
        assert.equal(job.leaseToken, leaseToken);
        job.status = "completed";
      },
      async failWorkflowJob() {
        throw new Error("unexpected fail");
      },
      async upsertRun(run) {
        const existing = state.runs.find((item) => item.id === run.id);
        if (existing) {
          Object.assign(existing, run);
        }
      },
      async getRun(runId: string) {
        return state.runs.find((run) => run.id === runId);
      },
      async appendRunEvent(event) {
        state.runEvents.push(event);
      }
    },
    execute: async () => ({})
  });

  const result = await runner.runOnce({ workerId: "worker-a", limit: 10, leaseMs: 30_000 });
  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 1);
  assert.equal(state.queueJobs[0].status, "completed");
  assert.equal(state.runs[0].status, "success");
});

test("queue runner isolates claim scope per tenant/workspace", async () => {
  const state = createMemoryStore();
  state.queueJobs.push({
    ...state.queueJobs[0],
    id: "job-2",
    runId: "run-2",
    tenantId: "tenant-b",
    workspaceId: "workspace-b"
  });
  const runner = createQueueRunner({
    store: {
      async claimWorkflowJobs({ tenantId, workspaceId }) {
        return state.queueJobs
          .filter(
            (job) =>
              job.status === "queued" &&
              job.tenantId === tenantId &&
              job.workspaceId === workspaceId
          )
          .map((job) => {
            job.status = "claimed";
            job.leaseToken = "lease";
            return { ...job };
          });
      },
      async completeWorkflowJob() {
        return;
      },
      async failWorkflowJob() {
        return;
      },
      async upsertRun() {
        return;
      },
      async getRun() {
        return undefined;
      },
      async appendRunEvent() {
        return;
      }
    },
    execute: async () => ({})
  });

  const result = await runner.runOnce({
    workerId: "worker-a",
    limit: 10,
    leaseMs: 30_000,
    tenantId: "tenant-a",
    workspaceId: "workspace-a"
  });
  assert.equal(result.claimed, 1);
  assert.equal(state.queueJobs.find((job) => job.id === "job-1")?.status, "claimed");
  assert.equal(state.queueJobs.find((job) => job.id === "job-2")?.status, "queued");
});
