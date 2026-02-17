import test from "node:test";
import assert from "node:assert/strict";
import type {
  Agent,
  ObservabilityStore,
  Run,
  RunEvent,
  WorkflowQueueJob,
  WorkflowQueueJobCreateInput
} from "@agent/observability";
import { createDashboardService } from "./dashboard-service.ts";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-a",
    name: "Agent A",
    owner: "owner@example.com",
    env: "staging",
    version: "1.0.0",
    status: "healthy",
    lastHeartbeatAt: "2026-02-17T00:00:00.000Z",
    errorRate: 0,
    avgLatencyMs: 10,
    ...overrides
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-a",
    agentId: "agent-a",
    status: "running",
    startedAt: "2026-02-17T00:00:00.000Z",
    traceId: "trace-a",
    retries: 0,
    ...overrides
  };
}

function makeEvent(overrides: Partial<RunEvent> = {}): RunEvent {
  return {
    id: "018f3f10-64df-7c8a-a7dd-53f4f2f6ff1a",
    runId: "run-a",
    ts: "2026-02-17T00:00:00.000Z",
    type: "state",
    level: "info",
    message: "Planner request received",
    payload: {},
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    ...overrides
  };
}

function createStoreFixture(input?: {
  agents?: Agent[];
  runs?: Run[];
  runEvents?: RunEvent[];
}): ObservabilityStore {
  const agents = input?.agents ?? [makeAgent()];
  const runs = input?.runs ?? [makeRun()];
  const runEvents = input?.runEvents ?? [makeEvent()];
  const queueJobs: WorkflowQueueJob[] = [];

  function toQueueJob(input: WorkflowQueueJobCreateInput): WorkflowQueueJob {
    const now = new Date().toISOString();
    return {
      id: `job-${queueJobs.length + 1}`,
      runId: input.runId,
      agentId: input.agentId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      requestId: input.requestId,
      threadId: input.threadId,
      objectivePrompt: input.objectivePrompt,
      status: "queued",
      attemptCount: 0,
      maxAttempts: input.maxAttempts,
      availableAt: input.availableAt,
      createdAt: now,
      updatedAt: now
    };
  }

  return {
    async read() {
      return { agents, runs, runEvents };
    },
    async listAgents() {
      return agents.slice();
    },
    async getAgent(id: string) {
      return agents.find((agent) => agent.id === id);
    },
    async upsertAgent(agent: Agent) {
      const idx = agents.findIndex((item) => item.id === agent.id);
      if (idx >= 0) {
        agents[idx] = agent;
      } else {
        agents.push(agent);
      }
    },
    async listRuns(filter) {
      return runs
        .filter((run) => (filter?.agentId ? run.agentId === filter.agentId : true))
        .filter((run) => (filter?.status ? run.status === filter.status : true))
        .slice();
    },
    async getRun(id: string) {
      return runs.find((run) => run.id === id);
    },
    async upsertRun(run: Run) {
      const idx = runs.findIndex((item) => item.id === run.id);
      if (idx >= 0) {
        runs[idx] = run;
      } else {
        runs.push(run);
      }
    },
    async listRunEvents(runId: string) {
      return runEvents.filter((event) => event.runId === runId).slice();
    },
    async appendRunEvent(runEvent: RunEvent) {
      runEvents.push(runEvent);
    },
    async enqueueWorkflowJob(input: WorkflowQueueJobCreateInput) {
      const created = toQueueJob(input);
      queueJobs.push(created);
      return created;
    },
    async claimWorkflowJobs() {
      return [];
    },
    async completeWorkflowJob() {
      return;
    },
    async failWorkflowJob() {
      return;
    },
    async getWorkflowJob(jobId: string) {
      return queueJobs.find((job) => job.id === jobId);
    }
  };
}

test("getRun enforces tenant/workspace scope on detail reads", async () => {
  const store = createStoreFixture({
    runEvents: [makeEvent({ tenantId: "tenant-b", workspaceId: "workspace-b" })]
  });
  const service = createDashboardService(store);
  const run = await service.getRun("run-a", { tenantId: "tenant-a", workspaceId: "workspace-a" });
  assert.equal(run, undefined);
});

test("getAgent enforces tenant/workspace scope on detail reads", async () => {
  const store = createStoreFixture({
    runEvents: [makeEvent({ tenantId: "tenant-b", workspaceId: "workspace-b" })]
  });
  const service = createDashboardService(store);
  const agent = await service.getAgent("agent-a", {
    tenantId: "tenant-a",
    workspaceId: "workspace-a"
  });
  assert.equal(agent, undefined);
});

test("createAgent upserts agent records", async () => {
  const store = createStoreFixture({ agents: [] });
  const service = createDashboardService(store);

  const created = await service.createAgent({
    id: "agent-new",
    name: "New Agent",
    owner: "new.owner@example.com",
    env: "prod",
    version: "1.2.3"
  });

  assert.equal(created.id, "agent-new");
  assert.equal(created.status, "healthy");
  const fetched = await service.getAgent("agent-new");
  assert.equal(fetched?.name, "New Agent");
});

test("dispatchObjectiveRun creates run with scoped progress events", async () => {
  const store = createStoreFixture();
  const service = createDashboardService(store);

  const created = await service.dispatchObjectiveRun({
    agentId: "agent-a",
    objectivePrompt: "Draft weekly summary",
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    threadId: "thread-a"
  });

  assert.equal(created.run.agentId, "agent-a");
  assert.equal(created.run.status, "queued");
  assert.equal(created.events.length, 1);
  assert.equal(created.events[0].message, "Run queued");
  assert.equal(created.events[0].tenantId, "tenant-a");
  assert.equal(created.job.status, "queued");
  assert.equal(created.job.tenantId, "tenant-a");
});
