import test from "node:test";
import assert from "node:assert/strict";
import type {
  Agent,
  EnqueueWorkflowSignalInput,
  ObservabilityStore,
  Run,
  RunEvent,
  WorkflowMessageThread,
  WorkflowSignalInboxRecord,
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
  queueJobs?: WorkflowQueueJob[];
}): ObservabilityStore {
  const agents = input?.agents ?? [makeAgent()];
  const runs = input?.runs ?? [makeRun()];
  const runEvents = input?.runEvents ?? [makeEvent()];
  const queueJobs: WorkflowQueueJob[] = input?.queueJobs ?? [];
  const messageThreads: WorkflowMessageThread[] = [];
  const receipts = new Set<string>();
  const signalInbox: WorkflowSignalInboxRecord[] = [];
  const runtimeSnapshots = new Map<string, { payload: unknown; updatedAt: string }>();

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
    async listWorkflowJobs(filter) {
      return queueJobs
        .filter((job) => (filter?.statuses?.length ? filter.statuses.includes(job.status) : true))
        .filter((job) =>
          filter?.availableAfter ? new Date(job.availableAt).getTime() >= new Date(filter.availableAfter).getTime() : true
        )
        .filter((job) =>
          filter?.availableBefore ? new Date(job.availableAt).getTime() <= new Date(filter.availableBefore).getTime() : true
        )
        .filter((job) => (filter?.tenantId ? job.tenantId === filter.tenantId : true))
        .filter((job) => (filter?.workspaceId ? job.workspaceId === filter.workspaceId : true))
        .slice(0, filter?.limit ?? 100);
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
    },
    async getTenantMessagingSettings() {
      return undefined;
    },
    async upsertTenantMessagingSettings() {
      return;
    },
    async upsertWorkflowMessageThread(input) {
      const now = new Date().toISOString();
      const created: WorkflowMessageThread = {
        id: `thread-${messageThreads.length + 1}`,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        runId: input.runId,
        channelType: input.channelType,
        channelId: input.channelId,
        rootMessageId: input.rootMessageId,
        threadId: input.threadId,
        providerTeamId: input.providerTeamId,
        status: input.status ?? "active",
        createdAt: now,
        updatedAt: now
      };
      messageThreads.push(created);
      return created;
    },
    async getWorkflowMessageThreadByProviderThread(input) {
      return messageThreads.find(
        (thread) =>
          thread.channelType === input.channelType &&
          thread.channelId === input.channelId &&
          thread.threadId === input.threadId &&
          (!input.providerTeamId || thread.providerTeamId === input.providerTeamId) &&
          thread.status === "active"
      );
    },
    async recordInboundMessageReceipt(input) {
      const key = `${input.provider}:${input.providerTeamId}:${input.eventId}`;
      if (receipts.has(key)) {
        return false;
      }
      receipts.add(key);
      return true;
    },
    async enqueueWorkflowSignal(input: EnqueueWorkflowSignalInput) {
      const now = new Date().toISOString();
      const record: WorkflowSignalInboxRecord = {
        signalId: input.signalId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        runId: input.runId,
        signalType: input.signalType,
        occurredAt: input.occurredAt,
        payload: input.payload,
        status: "pending",
        createdAt: now,
        updatedAt: now
      };
      signalInbox.push(record);
      return record;
    },
    async listPendingWorkflowSignals(input) {
      return signalInbox.filter(
        (item) =>
          item.tenantId === input.tenantId &&
          item.workspaceId === input.workspaceId &&
          item.workflowId === input.workflowId &&
          item.status === "pending"
      );
    },
    async markWorkflowSignalConsumed(signalId) {
      const signal = signalInbox.find((item) => item.signalId === signalId);
      if (signal) {
        signal.status = "consumed";
      }
    },
    async getWorkflowRuntimeSnapshot(tenantId, workspaceId, workflowId) {
      const key = `${tenantId}:${workspaceId}:${workflowId}`;
      const entry = runtimeSnapshots.get(key);
      if (!entry) return undefined;
      return {
        tenantId,
        workspaceId,
        workflowId,
        payload: entry.payload as any,
        updatedAt: entry.updatedAt
      };
    },
    async upsertWorkflowRuntimeSnapshot(input) {
      const key = `${input.tenantId}:${input.workspaceId}:${input.workflowId}`;
      const now = new Date().toISOString();
      runtimeSnapshots.set(key, { payload: input.payload, updatedAt: now });
      return {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        payload: input.payload,
        updatedAt: now
      };
    },
    async upsertUser(input) {
      return {
        id: input.id,
        email: input.email,
        name: input.name,
        image: input.image,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    },
    async upsertConnection(input) {
      return {
        id: "conn-1",
        userId: input.userId,
        providerId: input.providerId,
        providerAccountId: input.providerAccountId,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt,
        scope: input.scope,
        tokenType: input.tokenType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    },
    async getConnection() {
      return undefined;
    },
    async deleteConnection() {
      return;
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

test("createAgent normalizes blank systemPrompt to undefined", async () => {
  const store = createStoreFixture({ agents: [] });
  const service = createDashboardService(store);

  const created = await service.createAgent({
    id: "agent-prompt",
    name: "Prompt Agent",
    systemPrompt: "   "
  });

  assert.equal(created.systemPrompt, undefined);
  const fetched = await service.getAgent("agent-prompt");
  assert.equal(fetched?.systemPrompt, undefined);
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

test("createAgentAndRun creates agent and optionally starts run", async () => {
  const store = createStoreFixture({ agents: [] });
  const service = createDashboardService(store);

  // Case 1: Just create agent
  const result1 = await service.createAgentAndRun({
    id: "agent-1",
    name: "Agent 1",
    owner: "owner@example.com",
    env: "prod",
    version: "1.0.0"
  });
  assert.equal(result1.agent.id, "agent-1");
  assert.equal((result1 as any).run, undefined);

  // Case 2: Create agent AND run
  const result2 = await service.createAgentAndRun({
    id: "agent-2",
    name: "Agent 2",
    owner: "owner@example.com",
    env: "prod",
    version: "1.0.0",
    objectivePrompt: "Do something",
    tenantId: "tenant-2",
    workspaceId: "workspace-2"
  });
  assert.equal(result2.agent.id, "agent-2");
  assert.equal((result2 as any).run.agentId, "agent-2");
  assert.equal((result2 as any).run.status, "queued");
  assert.equal((result2 as any).events[0].tenantId, "tenant-2");
});

test("listScheduledRuns returns one-off and cron upcoming jobs", async () => {
  const now = Date.now();
  const queueJobs: WorkflowQueueJob[] = [
    {
      id: "job-future-one-off",
      runId: "run-one-off",
      agentId: "agent-a",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      workflowId: "wf-one-off",
      requestId: "req-one-off",
      threadId: "thread-one-off",
      objectivePrompt: "Send monthly invoice",
      status: "queued",
      attemptCount: 0,
      maxAttempts: 3,
      availableAt: new Date(now + 60_000).toISOString(),
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    },
    {
      id: "job-future-cron",
      runId: "run-cron",
      agentId: "agent-a",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      workflowId: "wf-cron",
      requestId: "req-cron",
      threadId: "thread-cron",
      objectivePrompt: "Daily triage",
      status: "queued",
      attemptCount: 0,
      maxAttempts: 3,
      availableAt: new Date(now + 120_000).toISOString(),
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    }
  ];
  const runEvents: RunEvent[] = [
    makeEvent({
      runId: "run-one-off",
      message: "Run queued",
      payload: { available_at: queueJobs[0].availableAt, cron: null }
    }),
    makeEvent({
      id: "018f3f10-64df-7c8a-a7dd-53f4f2f6ff1b",
      runId: "run-cron",
      message: "Run queued by planner schedule tool",
      payload: { available_at: queueJobs[1].availableAt, cron: "0 9 * * 1-5" }
    })
  ];
  const store = createStoreFixture({ queueJobs, runEvents });
  const service = createDashboardService(store);

  const scheduled = await service.listScheduledRuns(20, {
    tenantId: "tenant-a",
    workspaceId: "workspace-a"
  });

  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[0].scheduleType, "one_off");
  assert.equal(scheduled[1].scheduleType, "cron");
  assert.equal(scheduled[1].cronExpression, "0 9 * * 1-5");
});

test("ingestSlackThreadReply deduplicates and queues user_input signal continuation", async () => {
  const run = makeRun({
    id: "run-waiting",
    agentId: "agent-a",
    status: "queued"
  });
  const runEvents = [
    makeEvent({
      runId: "run-waiting",
      message: "Run queued",
      payload: {
        objective_prompt: "Collect statuses",
        workflow_id: "wf-waiting",
        thread_id: "thread-1"
      }
    })
  ];
  const store = createStoreFixture({
    runs: [run],
    runEvents
  });
  await store.upsertWorkflowMessageThread({
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    workflowId: "wf-waiting",
    runId: "run-waiting",
    channelType: "slack",
    channelId: "C123",
    rootMessageId: "1730000000.111111",
    threadId: "1730000000.111111",
    providerTeamId: "T123",
    status: "active"
  });
  const service = createDashboardService(store);

  const first = await service.ingestSlackThreadReply({
    providerTeamId: "T123",
    eventId: "Ev-1",
    eventTs: "1730000000.999999",
    channelId: "C123",
    threadId: "1730000000.111111",
    messageId: "1730000001.000001",
    userId: "U123",
    message: "Use this project label"
  });
  assert.equal(first.status, "queued_signal");
  if (first.status === "queued_signal") {
    assert.equal(first.workflowId, "wf-waiting");
  }

  const second = await service.ingestSlackThreadReply({
    providerTeamId: "T123",
    eventId: "Ev-1",
    eventTs: "1730000000.999999",
    channelId: "C123",
    threadId: "1730000000.111111",
    messageId: "1730000001.000001",
    userId: "U123",
    message: "Use this project label"
  });
  assert.deepEqual(second, { status: "duplicate" });

  const queuedSignals = await store.listPendingWorkflowSignals({
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    workflowId: "wf-waiting"
  });
  assert.equal(queuedSignals.length, 1);
  const queuedJobs = await store.listWorkflowJobs({ tenantId: "tenant-a", workspaceId: "workspace-a" });
  assert.equal(queuedJobs.length, 1);
  assert.equal(queuedJobs[0]?.workflowId, "wf-waiting");
});
