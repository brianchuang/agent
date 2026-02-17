const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { ToolExecutionError } = require("../dist/core/errors");
const {
  StubActionAdapter,
  createActionAdapterTool,
  createInMemoryRetryAttemptStore,
  createRetryingActionAdapterTool
} = require("../dist/core/adapters");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");

function toolInput(overrides = {}) {
  return {
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-303",
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    stepNumber: 0,
    toolName: "message.send",
    args: { to: "user@example.com", body: "hello" },
    ...overrides
  };
}

function objectiveRequest(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-303-loop",
    threadId: "thread-303",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Run callback resume flow",
    ...overrides
  };
}

test("ISSUE-303: retryable failures follow deterministic backoff and eventually succeed", async () => {
  const retryStore = createInMemoryRetryAttemptStore();
  const sleeps = [];
  let calls = 0;

  const tool = createRetryingActionAdapterTool(
    createActionAdapterTool({
      toolName: "message.send",
      actionClass: "message",
      operation: "send",
      adapter: new StubActionAdapter({
        execute: async () => {
          calls += 1;
          if (calls < 3) {
            return {
              status: "error",
              actionClass: "message",
              provider: "stub",
              errorCode: "HTTP_503",
              message: "temporary outage",
              retryable: true
            };
          }

          return {
            status: "ok",
            actionClass: "message",
            provider: "stub",
            data: { delivered: true }
          };
        }
      }),
      resolveCredentials: ({ tenantId, workspaceId }) => ({ tenantId, workspaceId, token: "a" })
    }),
    {
      store: retryStore,
      policy: {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitterRatio: 0,
        sleep: async (ms) => {
          sleeps.push(ms);
        }
      }
    }
  );

  const result = await tool.execute(toolInput());

  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [100, 200]);
  assert.equal(result.status, "ok");

  const record = retryStore.get("tenant-a:wf-303:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:0:message.send");
  assert.equal(record.attemptCount, 3);
  assert.equal(record.terminalReason, undefined);
});

test("ISSUE-303: terminal non-retryable failures stop immediately and persist failure metadata", async () => {
  const retryStore = createInMemoryRetryAttemptStore();
  let calls = 0;

  const tool = createRetryingActionAdapterTool(
    createActionAdapterTool({
      toolName: "message.send",
      actionClass: "message",
      operation: "send",
      adapter: new StubActionAdapter({
        execute: async () => {
          calls += 1;
          return {
            status: "error",
            actionClass: "message",
            provider: "stub",
            errorCode: "HTTP_400",
            message: "bad request",
            retryable: false
          };
        }
      }),
      resolveCredentials: ({ tenantId, workspaceId }) => ({ tenantId, workspaceId, token: "a" })
    }),
    {
      store: retryStore,
      policy: {
        maxAttempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitterRatio: 0
      }
    }
  );

  await assert.rejects(() => tool.execute(toolInput()), (error) => {
    assert.equal(error instanceof ToolExecutionError, true);
    assert.match(error.message, /HTTP_400/);
    return true;
  });

  assert.equal(calls, 1);
  const record = retryStore.get("tenant-a:wf-303:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:0:message.send");
  assert.equal(record.attemptCount, 1);
  assert.equal(record.lastErrorCode, "HTTP_400");
  assert.equal(record.terminalReason, "non_retryable");
});

test("ISSUE-303: retry exhaustion records terminal reason and last attempt metadata", async () => {
  const retryStore = createInMemoryRetryAttemptStore();
  const sleeps = [];
  let calls = 0;

  const tool = createRetryingActionAdapterTool(
    createActionAdapterTool({
      toolName: "message.send",
      actionClass: "message",
      operation: "send",
      adapter: new StubActionAdapter({
        execute: async () => {
          calls += 1;
          throw new ToolExecutionError("message.send", "timeout", true);
        }
      }),
      resolveCredentials: ({ tenantId, workspaceId }) => ({ tenantId, workspaceId, token: "a" })
    }),
    {
      store: retryStore,
      policy: {
        maxAttempts: 2,
        baseDelayMs: 50,
        maxDelayMs: 500,
        jitterRatio: 0,
        sleep: async (ms) => {
          sleeps.push(ms);
        }
      }
    }
  );

  await assert.rejects(() => tool.execute(toolInput()), (error) => {
    assert.equal(error instanceof ToolExecutionError, true);
    assert.match(error.message, /timeout/);
    return true;
  });

  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [50]);

  const record = retryStore.get("tenant-a:wf-303:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:0:message.send");
  assert.equal(record.attemptCount, 2);
  assert.equal(record.terminalReason, "max_attempts_exhausted");
});

test("ISSUE-303: provider callback is routed into external_event_signal resume without duplicate side effects", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);
  let providerCalls = 0;

  const adapterTool = createRetryingActionAdapterTool(
    createActionAdapterTool({
      toolName: "message.send",
      actionClass: "message",
      operation: "send",
      adapter: new StubActionAdapter({
        execute: async ({ action }) => {
          providerCalls += 1;
          return {
            status: "ok",
            actionClass: "message",
            provider: "stub",
            data: { accepted: true, input: action.input }
          };
        }
      }),
      resolveCredentials: ({ tenantId, workspaceId }) => ({ tenantId, workspaceId, token: "a" })
    }),
    {
      store: createInMemoryRetryAttemptStore(),
      policy: {
        maxAttempts: 2,
        baseDelayMs: 10,
        maxDelayMs: 100,
        jitterRatio: 0
      }
    }
  );

  const first = await runtime.runPlannerLoop(objectiveRequest(), {
    planner: ({ prior_step_summaries }) => {
      if (prior_step_summaries.length === 0) {
        return {
          type: "tool_call",
          toolName: "message.send",
          args: { to: "user@example.com", body: "hello" }
        };
      }
      if (prior_step_summaries.length === 1) {
        return {
          type: "ask_user",
          question: "Waiting for provider callback"
        };
      }
      return {
        type: "complete",
        output: { done: true }
      };
    },
    executeTool: (input) => adapterTool.execute(input)
  });

  assert.equal(first.status, "waiting_signal");
  assert.equal(providerCalls, 1);

  const resumed = await runtime.resumeWithProviderCallback({
    callbackId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-303-loop",
    eventType: "provider.message.delivered",
    occurredAt: "2026-02-17T00:01:00.000Z",
    payload: { messageId: "msg-1" }
  });

  assert.equal(resumed.status, "resumed");
  assert.equal(resumed.signalType, "external_event_signal");

  const completed = await runtime.runPlannerLoop(
    objectiveRequest({
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    }),
    {
      planner: ({ prior_step_summaries }) => {
        if (prior_step_summaries.length === 0) {
          return {
            type: "tool_call",
            toolName: "message.send",
            args: { to: "user@example.com", body: "hello" }
          };
        }
        if (prior_step_summaries.length === 1) {
          return {
            type: "ask_user",
            question: "Waiting for provider callback"
          };
        }
        return {
          type: "complete",
          output: { done: true }
        };
      },
      executeTool: (input) => adapterTool.execute(input)
    }
  );

  assert.equal(completed.status, "completed");
  assert.equal(providerCalls, 1);
});
