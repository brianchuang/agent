const test = require("node:test");
const assert = require("node:assert/strict");

const { ToolExecutionError, ValidationRuntimeError } = require("../dist/core/errors");
const {
  StubActionAdapter,
  createActionAdapterTool,
  createInMemoryIdempotencyStore,
  createIdempotentActionAdapterTool,
  defaultComposeIdempotencyKey
} = require("../dist/core/adapters");

function toolInput(overrides = {}) {
  return {
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-302",
    requestId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
    stepNumber: 0,
    toolName: "message.send",
    args: { to: "user@example.com", body: "hello" },
    ...overrides
  };
}

function createBaseAdapter(counter) {
  return new StubActionAdapter({
    execute: async ({ action }) => {
      counter.calls += 1;
      return {
        status: "ok",
        actionClass: action.actionClass,
        provider: "stub",
        data: { id: `msg-${counter.calls}`, echoed: action.input }
      };
    }
  });
}

test("ISSUE-302: idempotency key composes tenant/request/step/tool/payload hash", () => {
  const key = defaultComposeIdempotencyKey(toolInput());

  assert.match(key, /^tenant-a:[^:]+:0:message\.send:[0-9a-f]{64}$/);
});

test("ISSUE-302: replayed side effect with same idempotency key executes provider only once", async () => {
  const counter = { calls: 0 };
  const adapterTool = createIdempotentActionAdapterTool(
    createActionAdapterTool({
      toolName: "message.send",
      actionClass: "message",
      operation: "send",
      adapter: createBaseAdapter(counter),
      resolveCredentials: ({ tenantId, workspaceId }) => ({ tenantId, workspaceId, token: "a" })
    }),
    { store: createInMemoryIdempotencyStore() }
  );

  const first = await adapterTool.execute(toolInput());
  const second = await adapterTool.execute(toolInput());

  assert.equal(counter.calls, 1);
  assert.deepEqual(second, first);
});

test("ISSUE-302: duplicate in-flight calls are deduped to a single provider execution", async () => {
  const counter = { calls: 0 };
  let unblock;
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });

  const adapter = new StubActionAdapter({
    execute: async ({ action }) => {
      counter.calls += 1;
      await gate;
      return {
        status: "ok",
        actionClass: action.actionClass,
        provider: "stub",
        data: { id: "inflight" }
      };
    }
  });

  const adapterTool = createIdempotentActionAdapterTool(
    createActionAdapterTool({
      toolName: "message.send",
      actionClass: "message",
      operation: "send",
      adapter,
      resolveCredentials: ({ tenantId, workspaceId }) => ({ tenantId, workspaceId, token: "a" })
    }),
    { store: createInMemoryIdempotencyStore() }
  );

  const p1 = adapterTool.execute(toolInput());
  const p2 = adapterTool.execute(toolInput());
  unblock();

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(counter.calls, 1);
  assert.deepEqual(r1, r2);
});

test("ISSUE-302: collisions with mismatched fingerprint throw deterministic error", async () => {
  const counter = { calls: 0 };
  const adapterTool = createIdempotentActionAdapterTool(
    createActionAdapterTool({
      toolName: "message.send",
      actionClass: "message",
      operation: "send",
      adapter: createBaseAdapter(counter),
      resolveCredentials: ({ tenantId, workspaceId }) => ({ tenantId, workspaceId, token: "a" })
    }),
    {
      store: createInMemoryIdempotencyStore(),
      composeKey: () => "fixed-key"
    }
  );

  await adapterTool.execute(toolInput({ args: { to: "user@example.com", body: "hello" } }));

  await assert.rejects(
    () => adapterTool.execute(toolInput({ args: { to: "user@example.com", body: "different" } })),
    (error) => {
      assert.equal(error instanceof ValidationRuntimeError, true);
      assert.match(error.message, /Idempotency key collision/);
      return true;
    }
  );

  assert.equal(counter.calls, 1);
});

test("ISSUE-302: idempotency is isolated per tenant", async () => {
  const counter = { calls: 0 };
  const adapterTool = createIdempotentActionAdapterTool(
    createActionAdapterTool({
      toolName: "message.send",
      actionClass: "message",
      operation: "send",
      adapter: createBaseAdapter(counter),
      resolveCredentials: ({ tenantId, workspaceId }) => ({ tenantId, workspaceId, token: tenantId })
    }),
    { store: createInMemoryIdempotencyStore() }
  );

  await adapterTool.execute(toolInput({ tenantId: "tenant-a", workspaceId: "agent" }));
  await adapterTool.execute(toolInput({ tenantId: "tenant-b", workspaceId: "agent" }));

  assert.equal(counter.calls, 2);
});

test("ISSUE-302: missing request/step fields fail before provider execution", async () => {
  const counter = { calls: 0 };
  const adapterTool = createIdempotentActionAdapterTool(
    createActionAdapterTool({
      toolName: "message.send",
      actionClass: "message",
      operation: "send",
      adapter: createBaseAdapter(counter),
      resolveCredentials: ({ tenantId, workspaceId }) => ({ tenantId, workspaceId, token: "a" })
    }),
    { store: createInMemoryIdempotencyStore() }
  );

  await assert.rejects(
    () =>
      adapterTool.execute(
        toolInput({
          requestId: undefined
        })
      ),
    (error) => {
      assert.equal(error instanceof ValidationRuntimeError, true);
      assert.match(error.message, /requestId/);
      return true;
    }
  );

  assert.equal(counter.calls, 0);
});
