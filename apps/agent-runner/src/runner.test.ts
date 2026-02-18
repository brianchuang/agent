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
      async getWorkflowJob(jobId) {
        return state.queueJobs.find((item) => item.id === jobId);
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
      async getWorkflowJob(jobId) {
        return state.queueJobs.find((item) => item.id === jobId);
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

test("queue runner keeps run queued for retryable engine failures", async () => {
  const state = createMemoryStore();
  const runner = createQueueRunner({
    store: {
      async claimWorkflowJobs() {
        const job = state.queueJobs[0];
        job.status = "claimed";
        job.leaseToken = "lease-1";
        job.attemptCount = 1;
        return [{ ...job }];
      },
      async completeWorkflowJob() {
        throw new Error("unexpected complete");
      },
      async failWorkflowJob({ jobId, leaseToken, error, retryAt }) {
        const job = state.queueJobs.find((item) => item.id === jobId);
        assert.ok(job);
        assert.equal(job.leaseToken, leaseToken);
        job.status = "queued";
        job.lastError = error;
        assert.ok(retryAt);
      },
      async getWorkflowJob(jobId) {
        return state.queueJobs.find((item) => item.id === jobId);
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
    execute: async () => {
      throw new Error("temporary provider outage");
    }
  });

  const result = await runner.runOnce({ workerId: "worker-a", limit: 10, leaseMs: 30_000 });
  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  assert.equal(state.queueJobs[0].status, "queued");
  assert.equal(state.runs[0].status, "queued");
  assert.equal(state.runs[0].retries, 1);
});

test("queue runner marks run failed only when queue marks job terminal failed", async () => {
  const state = createMemoryStore();
  state.queueJobs[0].maxAttempts = 1;
  const runner = createQueueRunner({
    store: {
      async claimWorkflowJobs() {
        const job = state.queueJobs[0];
        job.status = "claimed";
        job.leaseToken = "lease-terminal";
        job.attemptCount = 1;
        return [{ ...job }];
      },
      async completeWorkflowJob() {
        throw new Error("unexpected complete");
      },
      async failWorkflowJob({ jobId, leaseToken, error }) {
        const job = state.queueJobs.find((item) => item.id === jobId);
        assert.ok(job);
        assert.equal(job.leaseToken, leaseToken);
        job.status = "failed";
        job.lastError = error;
      },
      async getWorkflowJob(jobId) {
        return state.queueJobs.find((item) => item.id === jobId);
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
    execute: async () => {
      throw new Error("permanent validation error");
    }
  });

  const result = await runner.runOnce({ workerId: "worker-a", limit: 10, leaseMs: 30_000 });
  assert.equal(result.failed, 1);
  assert.equal(state.queueJobs[0].status, "failed");
  assert.equal(state.runs[0].status, "failed");
  assert.equal(state.runs[0].errorSummary, "permanent validation error");
});

test("queue runner does not mark run success when completion is not acknowledged by lease", async () => {
  const state = createMemoryStore();
  const runner = createQueueRunner({
    store: {
      async claimWorkflowJobs() {
        const job = state.queueJobs[0];
        job.status = "claimed";
        job.leaseToken = "lease-mismatch";
        return [{ ...job }];
      },
      async completeWorkflowJob() {
        // Simulate stale lease/no-op update.
        return;
      },
      async failWorkflowJob({ jobId, leaseToken, error }) {
        const job = state.queueJobs.find((item) => item.id === jobId);
        assert.ok(job);
        assert.equal(job.leaseToken, leaseToken);
        job.status = "queued";
        job.lastError = error;
      },
      async getWorkflowJob(jobId) {
        return state.queueJobs.find((item) => item.id === jobId);
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
    execute: async () => ({ ok: true })
  });

  const result = await runner.runOnce({ workerId: "worker-a", limit: 10, leaseMs: 30_000 });
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  assert.equal(state.runs[0].status, "queued");
  assert.equal(state.runs[0].retries, 1);
});

test("queue runner keeps run queued when workflow returns waiting_signal", async () => {
  const state = createMemoryStore();
  const runner = createQueueRunner({
    store: {
      async claimWorkflowJobs({ workerId, limit }) {
        const available = state.queueJobs.filter((job) => job.status === "queued").slice(0, limit);
        return available.map((job, index) => {
          const leaseToken = `${workerId}-lease-${index + 1}`;
          job.status = "claimed";
          job.leaseToken = leaseToken;
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
      async getWorkflowJob(jobId) {
        return state.queueJobs.find((item) => item.id === jobId);
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
    execute: async () => ({
      status: "waiting_signal",
      workflowId: "wf-1",
      result: "No completion output"
    })
  });

  const result = await runner.runOnce({ workerId: "worker-a", limit: 10, leaseMs: 30_000 });
  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  assert.equal(state.queueJobs[0].status, "completed");
  assert.equal(state.runs[0].status, "queued");
});

test("queue runner notifies waiting signal through configured notifier", async () => {
  const state = createMemoryStore();
  const notifications: Array<{ workflowId: string; waitingQuestion: string }> = [];
  const runner = createQueueRunner({
    store: {
      async claimWorkflowJobs({ workerId, limit }) {
        const available = state.queueJobs.filter((job) => job.status === "queued").slice(0, limit);
        return available.map((job, index) => {
          const leaseToken = `${workerId}-lease-${index + 1}`;
          job.status = "claimed";
          job.leaseToken = leaseToken;
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
      async getWorkflowJob(jobId) {
        return state.queueJobs.find((item) => item.id === jobId);
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
    execute: async () => ({
      status: "waiting_signal",
      workflowId: "wf-1",
      waitingQuestion: "Which inbox label should I monitor?"
    }),
    notifier: {
      async notifyWaitingSignal(input) {
        notifications.push({
          workflowId: input.workflowId,
          waitingQuestion: input.waitingQuestion
        });
        return { channel: "slack", target: "C123" };
      }
    }
  });

  const result = await runner.runOnce({ workerId: "worker-a", limit: 10, leaseMs: 30_000 });
  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.workflowId, "wf-1");
  assert.equal(notifications[0]?.waitingQuestion, "Which inbox label should I monitor?");
  assert.ok(state.runEvents.some((event) => event.message === "Waiting question delivered"));
});
