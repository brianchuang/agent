const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");

function request(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-502",
    threadId: "thread-502",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Collect runtime metrics and tracing",
    ...overrides
  };
}

function createInMemoryObservabilityStore() {
  const agents = new Map();
  const runs = new Map();
  const runEvents = [];

  return {
    read: async () => ({
      agents: Array.from(agents.values()),
      runs: Array.from(runs.values()),
      runEvents: runEvents.slice()
    }),
    listAgents: async () => Array.from(agents.values()),
    getAgent: async (id) => agents.get(id),
    upsertAgent: async (agent) => {
      agents.set(agent.id, structuredClone(agent));
    },
    listRuns: async (filter) => {
      let out = Array.from(runs.values());
      if (filter?.agentId) {
        out = out.filter((run) => run.agentId === filter.agentId);
      }
      if (filter?.status) {
        out = out.filter((run) => run.status === filter.status);
      }
      if (filter?.query) {
        out = out.filter((run) =>
          [run.id, run.agentId, run.traceId].some((value) => String(value).includes(filter.query))
        );
      }
      return out.map((run) => structuredClone(run));
    },
    getRun: async (id) => {
      const run = runs.get(id);
      return run ? structuredClone(run) : undefined;
    },
    upsertRun: async (run) => {
      runs.set(run.id, structuredClone(run));
    },
    listRunEvents: async (runId) => {
      return runEvents
        .filter((event) => event.runId === runId)
        .map((event) => structuredClone(event));
    },
    appendRunEvent: async (event) => {
      runEvents.push(structuredClone(event));
    }
  };
}

test("ISSUE-502: planner loop emits traceable request, policy, step, and terminal metrics", async () => {
  const persistence = new InMemoryAgentPersistence();
  const store = createInMemoryObservabilityStore();
  const runtime = new AgentRuntime(
    "agent",
    null,
    {
      enabled: true,
      agentId: "agent-core",
      store
    },
    persistence
  );

  const response = await runtime.runPlannerLoop(request(), {
    planner: ({ prior_step_summaries }) => {
      if (prior_step_summaries.length === 0) {
        return {
          type: "tool_call",
          toolName: "calendar.find_slots",
          args: { candidateId: "cand-502" }
        };
      }
      return {
        type: "complete",
        output: { done: true }
      };
    },
    executeTool: () => ({ slots: ["2026-02-18T09:00:00.000Z"] }),
    policyEngine: {
      evaluate: ({ stepIndex }) => ({
        policyId: `POL-502-${stepIndex}`,
        outcome: stepIndex === 0 ? "rewrite" : "allow",
        reasonCode: stepIndex === 0 ? "normalize_tool" : "allow_complete",
        rewrittenIntent:
          stepIndex === 0
            ? {
                type: "tool_call",
                toolName: "calendar.find_slots",
                args: { candidateId: "cand-502", timezone: "UTC" }
              }
            : undefined
      })
    }
  });

  assert.equal(response.status, "completed");

  const events = (await store.read()).runEvents;
  const metricEvents = events.filter((event) => event.message.includes("metric") || event.message.includes("Planner") || event.message.includes("Workflow") || event.message.includes("Policy") || event.message.includes("Signal"));

  assert.ok(metricEvents.some((event) => event.message === "Planner request received"));
  assert.ok(metricEvents.some((event) => event.message === "Policy decision recorded"));
  assert.ok(metricEvents.some((event) => event.message === "Planner step latency recorded"));
  assert.ok(metricEvents.some((event) => event.message === "Workflow terminal completed"));

  const requestCorrelationEvents = metricEvents.filter(
    (event) => event.payload && event.payload.requestId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  );
  assert.ok(requestCorrelationEvents.length > 0);
  assert.ok(
    requestCorrelationEvents.every(
      (event) => event.correlationId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    )
  );
  assert.ok(
    requestCorrelationEvents.every((event) => event.tenantId === "tenant-a" && event.workspaceId === "agent")
  );
});

test("ISSUE-502: signal lifecycle metrics include delivered/resumed and dropped outcomes", async () => {
  const persistence = new InMemoryAgentPersistence();
  const store = createInMemoryObservabilityStore();
  const runtime = new AgentRuntime(
    "agent",
    null,
    {
      enabled: true,
      agentId: "agent-core",
      store
    },
    persistence
  );

  await runtime.runPlannerLoop(request({ workflowId: "wf-502-signal" }), {
    planner: () => ({ type: "ask_user", question: "Proceed?" })
  });

  await runtime.resumeWithSignal({
    signalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-502-signal",
    type: "user_input_signal",
    occurredAt: "2026-02-17T00:01:00.000Z",
    payload: { message: "yes" }
  });

  await assert.rejects(
    () =>
      runtime.resumeWithSignal({
        signalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        schemaVersion: "v1",
        tenantId: "tenant-a",
        workspaceId: "agent",
        workflowId: "wf-missing",
        type: "user_input_signal",
        occurredAt: "2026-02-17T00:02:00.000Z",
        payload: { message: "hello" }
      }),
    /Workflow not found for resume/
  );

  const events = (await store.read()).runEvents;
  assert.ok(
    events.some(
      (event) =>
        event.message === "Signal lifecycle recorded" && event.payload.stage === "delivered"
    )
  );
  assert.ok(
    events.some(
      (event) => event.message === "Signal lifecycle recorded" && event.payload.stage === "resumed"
    )
  );
  assert.ok(
    events.some(
      (event) => event.message === "Signal lifecycle recorded" && event.payload.stage === "dropped"
    )
  );
});

test("ISSUE-502: planner validation failures are emitted as metrics with request correlation", async () => {
  const persistence = new InMemoryAgentPersistence();
  const store = createInMemoryObservabilityStore();
  const runtime = new AgentRuntime(
    "agent",
    null,
    {
      enabled: true,
      agentId: "agent-core",
      store
    },
    persistence
  );

  await assert.rejects(
    () =>
      runtime.runPlannerLoop(request({ workflowId: "wf-502-invalid" }), {
        planner: () => ({
          type: "tool_call",
          toolName: "",
          args: {}
        })
      }),
    /toolName is required/
  );

  const events = (await store.read()).runEvents;
  const validationEvent = events.find((event) => event.message === "Planner validation failure");
  assert.ok(validationEvent);
  assert.equal(validationEvent.correlationId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(validationEvent.payload.phase, "intent_validation");
});
