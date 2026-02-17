const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { ValidationRuntimeError } = require("../dist/core/errors");
const { ToolRegistry } = require("../dist/core/toolRegistry");

function objectiveRequest(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-102",
    threadId: "thread-102",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Use tools to complete this workflow",
    ...overrides
  };
}

test("ISSUE-102: unknown tools are rejected deterministically", async () => {
  const runtime = new AgentRuntime("agent", null);
  const registry = new ToolRegistry();

  await assert.rejects(
    async () =>
  await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-102-unknown" }), {
        planner: () => ({
          type: "tool_call",
          toolName: "calendar.unknown",
          args: { candidateId: "cand-101" }
        }),
        toolRegistry: registry
      }),
    (err) =>
      err instanceof ValidationRuntimeError &&
      err.code === "VALIDATION_ERROR" &&
      err.message.includes("Unknown tool")
  );
});

test("ISSUE-102: invalid args are rejected before handler execution", async () => {
  const runtime = new AgentRuntime("agent", null);
  const registry = new ToolRegistry();
  let handlerCalls = 0;

  registry.registerTool({
    name: "calendar.find_slots",
    validateArgs: (args) => {
      if (typeof args.candidateId !== "string") {
        return [{ field: "candidateId", message: "candidateId must be string" }];
      }
      return [];
    },
    execute: () => {
      handlerCalls += 1;
      return { slots: [] };
    }
  });

  await assert.rejects(
    async () =>
  await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-102-invalid-args" }), {
        planner: () => ({
          type: "tool_call",
          toolName: "calendar.find_slots",
          args: { candidateId: 123 }
        }),
        toolRegistry: registry
      }),
    (err) =>
      err instanceof ValidationRuntimeError &&
      err.code === "VALIDATION_ERROR" &&
      err.message.includes("candidateId")
  );

  assert.equal(handlerCalls, 0);
});

test("ISSUE-102: unauthorized tenant-tool combinations are rejected before execution", async () => {
  const runtime = new AgentRuntime("agent", null);
  const registry = new ToolRegistry();
  let handlerCalls = 0;

  registry.registerTool({
    name: "message.send",
    validateArgs: () => [],
    isAuthorized: ({ tenantId }) => tenantId === "tenant-allowed",
    execute: () => {
      handlerCalls += 1;
      return { sent: true };
    }
  });

  await assert.rejects(
    async () =>
  await runtime.runPlannerLoop(
        objectiveRequest({
          workflowId: "wf-102-tenant-denied",
          tenantId: "tenant-blocked"
        }),
        {
          planner: () => ({
            type: "tool_call",
            toolName: "message.send",
            args: { to: "user@example.com" }
          }),
          toolRegistry: registry
        }
      ),
    (err) =>
      err instanceof ValidationRuntimeError &&
      err.code === "VALIDATION_ERROR" &&
      err.message.includes("not authorized")
  );

  assert.equal(handlerCalls, 0);
});

test("ISSUE-102: registry metadata is tenant-filtered for planner tool availability", async () => {
  const registry = new ToolRegistry();

  registry.registerTool({
    name: "calendar.find_slots",
    validateArgs: () => [],
    isAuthorized: ({ tenantId }) => tenantId === "tenant-a",
    execute: () => ({ slots: [] })
  });

  registry.registerTool({
    name: "message.draft",
    validateArgs: () => [],
    execute: () => ({ body: "draft" })
  });

  const tenantATools = registry.listTools({ tenantId: "tenant-a", workspaceId: "agent" });
  const tenantBTools = registry.listTools({ tenantId: "tenant-b", workspaceId: "agent" });

  assert.deepEqual(
    tenantATools.map((tool) => tool.name).sort(),
    ["calendar.find_slots", "message.draft"]
  );
  assert.deepEqual(tenantBTools.map((tool) => tool.name), ["message.draft"]);
});
