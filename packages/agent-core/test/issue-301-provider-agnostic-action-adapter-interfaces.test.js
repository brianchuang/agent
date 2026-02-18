const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { ToolRegistry } = require("../dist/core/toolRegistry");
const { ValidationRuntimeError, ToolExecutionError } = require("../dist/core/errors");
const {
  InMemoryActionAdapter,
  StubActionAdapter,
  createActionAdapterTool,
  normalizeAdapterError,
  resolveTenantCredentials
} = require("../dist/core/adapters");

function objectiveRequest(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-301",
    threadId: "thread-301",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Plan and execute adapter-backed actions",
    ...overrides
  };
}

test("ISSUE-301: runtime invokes side effects through adapter interface-backed tools", async () => {
  const runtime = new AgentRuntime("agent", null);
  const registry = new ToolRegistry();

  const calls = [];
  const adapter = new StubActionAdapter({
    execute: async ({ action, tenant }) => {
      calls.push({ action, tenant });
      return {
        status: "ok",
        actionClass: action.actionClass,
        provider: "stub",
        data: { echoed: action.input }
      };
    }
  });

  registry.registerTool(
    createActionAdapterTool({
      toolName: "message.send",
      actionClass: "message",
      operation: "send",
      adapter,
      resolveCredentials: ({ tenantId, workspaceId }) => ({ tenantId, workspaceId, token: "a" })
    })
  );

  const result = await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-301-adapter" }), {
    planner: (context) =>
      context.step_index === 0
        ? {
            type: "tool_call",
            toolName: "message.send",
            args: { to: "user@example.com", body: "hello" }
          }
        : { type: "complete", output: { done: true } },
    toolRegistry: registry,
    maxSteps: 2
  });

  assert.equal(result.status, "completed");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    action: {
      actionClass: "message",
      operation: "send",
      input: { to: "user@example.com", body: "hello" }
    },
    tenant: { tenantId: "tenant-a", workspaceId: "agent" }
  });
});

test("ISSUE-301: adapters expose normalized response and error models", async () => {
  const successAdapter = new StubActionAdapter({
    execute: async () => ({
      status: "ok",
      actionClass: "calendar",
      provider: "stub",
      data: { slots: ["2026-02-18T10:00:00.000Z"] }
    })
  });

  const success = await successAdapter.execute({
    action: { actionClass: "calendar", operation: "find_slots", input: { durationMins: 30 } },
    tenant: { tenantId: "tenant-a", workspaceId: "agent" },
    credentials: { tenantId: "tenant-a", workspaceId: "agent", token: "x" }
  });

  assert.deepEqual(success, {
    status: "ok",
    actionClass: "calendar",
    provider: "stub",
    data: { slots: ["2026-02-18T10:00:00.000Z"] }
  });

  const normalized = normalizeAdapterError("message.send", {
    code: "ADAPTER_TIMEOUT",
    retryable: true,
    message: "provider timed out"
  });

  assert.equal(normalized instanceof ToolExecutionError, true);
  assert.equal(normalized.code, "TOOL_FAILURE");
  assert.equal(normalized.retryable, true);
  assert.match(normalized.message, /ADAPTER_TIMEOUT/);
});

test("ISSUE-301: tenant-scoped credential resolution prevents cross-tenant reuse", async () => {
  const lookup = {
    "tenant-a:agent": { tenantId: "tenant-a", workspaceId: "agent", token: "a" },
    "tenant-b:agent": { tenantId: "tenant-b", workspaceId: "agent", token: "b" }
  };

  const creds = resolveTenantCredentials(
    { tenantId: "tenant-a", workspaceId: "agent" },
    ({ tenantId, workspaceId }) => lookup[`${tenantId}:${workspaceId}`]
  );

  assert.equal(creds.token, "a");

  assert.throws(
    () =>
      resolveTenantCredentials(
        { tenantId: "tenant-a", workspaceId: "agent" },
        () => ({ tenantId: "tenant-b", workspaceId: "agent", token: "b" })
      ),
    (err) =>
      err instanceof ValidationRuntimeError && err.message.includes("credential scope mismatch")
  );
});

test("ISSUE-301: in-memory and stub adapters are deterministic for tests", async () => {
  const memoryAdapter = new InMemoryActionAdapter();

  const first = await memoryAdapter.execute({
    action: { actionClass: "task", operation: "create", input: { title: "Follow up" } },
    tenant: { tenantId: "tenant-a", workspaceId: "agent" },
    credentials: { tenantId: "tenant-a", workspaceId: "agent", token: "a" }
  });

  const second = await memoryAdapter.execute({
    action: { actionClass: "task", operation: "create", input: { title: "Follow up" } },
    tenant: { tenantId: "tenant-a", workspaceId: "agent" },
    credentials: { tenantId: "tenant-a", workspaceId: "agent", token: "a" }
  });

  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
  assert.equal(first.provider, "in-memory");
  assert.equal(second.provider, "in-memory");
  assert.equal(first.id, "task:1");
  assert.equal(second.id, "task:2");
});
