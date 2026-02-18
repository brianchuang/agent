const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const {
  ApprovalRequiredError,
  InternalRuntimeError,
  PolicyBlockedError,
  SignalValidationError,
  ToolExecutionError,
  ValidationRuntimeError
} = require("../dist/core/errors");

function objectiveRequest(overrides = {}) {
  return {
    requestId: "22222222-2222-7222-8222-222222222222",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-1",
    threadId: "thread-1",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Schedule a candidate interview",
    ...overrides
  };
}

test("ISSUE-003: runtime validates planner tool_call intents before execution", async () => {
  const runtime = new AgentRuntime("agent", null);
  let calls = 0;

  const result = await runtime.runPlannerIntentStep(
    objectiveRequest(),
    {
      type: "tool_call",
      toolName: "calendar.create_event",
      args: { candidateId: "cand-1" }
    },
    {
      executeTool: ({ toolName, args }) => {
        calls += 1;
        assert.equal(toolName, "calendar.create_event");
        assert.deepEqual(args, { candidateId: "cand-1" });
        return { ok: true };
      }
    }
  );

  assert.equal(calls, 1);
  assert.equal(result.step.status, "tool_executed");
  assert.equal(result.step.intentType, "tool_call");
  assert.equal(result.step.workflowId, "wf-1");
});

test("ISSUE-003: malformed planner intents fail fast without tool side effects", async () => {
  const runtime = new AgentRuntime("agent", null);
  let calls = 0;

  await assert.rejects(
    async () =>
      runtime.runPlannerIntentStep(
        objectiveRequest(),
        {
          type: "tool_call",
          args: { candidateId: "cand-1" }
        },
        {
          executeTool: () => {
            calls += 1;
            return { ok: true };
          }
        }
      ),
    (err) =>
      err instanceof ValidationRuntimeError &&
      err.code === "VALIDATION_ERROR" &&
      err.message.includes("toolName")
  );

  assert.equal(calls, 0);
});

test("ISSUE-003: runtime returns consistent typed errors for failure classes", async () => {
  const runtime = new AgentRuntime("agent", null);

  await assert.rejects(
    async () =>
      runtime.runPlannerIntentStep(
        objectiveRequest(),
        {
          type: "tool_call",
          toolName: "calendar.create_event",
          args: { candidateId: "cand-1" }
        },
        {
          executeTool: () => {
            throw new PolicyBlockedError("POL-001", "blocked by tenant policy");
          }
        }
      ),
    (err) => err instanceof PolicyBlockedError && err.code === "POLICY_BLOCKED"
  );

  await assert.rejects(
    async () =>
      runtime.runPlannerIntentStep(
        objectiveRequest({ workflowId: "wf-2", requestId: "33333333-3333-7333-8333-333333333333" }),
        {
          type: "tool_call",
          toolName: "calendar.create_event",
          args: { candidateId: "cand-1" }
        },
        {
          executeTool: () => {
            throw new ApprovalRequiredError("high_impact_action");
          }
        }
      ),
    (err) => err instanceof ApprovalRequiredError && err.code === "APPROVAL_REQUIRED"
  );

  await assert.rejects(
    async () =>
      runtime.runPlannerIntentStep(
        objectiveRequest({ workflowId: "wf-3", requestId: "44444444-4444-7444-8444-444444444444" }),
        {
          type: "tool_call",
          toolName: "calendar.create_event",
          args: { candidateId: "cand-1" }
        },
        {
          executeTool: () => {
            throw new ToolExecutionError("calendar.create_event", "provider timeout", true);
          }
        }
      ),
    (err) => err instanceof ToolExecutionError && err.code === "TOOL_FAILURE"
  );

  await assert.rejects(
    async () =>
      runtime.runPlannerIntentStep(
        objectiveRequest({ workflowId: "wf-4", requestId: "55555555-5555-7555-8555-555555555555" }),
        {
          type: "tool_call",
          toolName: "calendar.create_event",
          args: { candidateId: "cand-1" }
        },
        {
          executeTool: () => {
            throw new Error("unknown boom");
          }
        }
      ),
    (err) =>
      err instanceof InternalRuntimeError &&
      err.code === "INTERNAL_ERROR" &&
      err.message.includes("unknown boom")
  );
});

test("ISSUE-003: signal contracts are validated and resume tenant-scoped workflow IDs", async () => {
  const runtime = new AgentRuntime("agent", null);

  const waitResult = await runtime.runPlannerIntentStep(objectiveRequest(), {
    type: "ask_user",
    question: "Need interviewer preference."
  });
  assert.equal(waitResult.step.status, "waiting_signal");

  const resumed = await runtime.resumeWithSignal({
    signalId: "66666666-6666-7666-8666-666666666666",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-1",
    type: "user_input_signal",
    occurredAt: "2026-02-17T00:05:00.000Z",
    payload: { message: "Use Sam Rivera" }
  });

  assert.equal(resumed.workflowId, "wf-1");
  assert.equal(resumed.status, "resumed");

  await assert.rejects(
    async () =>
  await runtime.resumeWithSignal({
        signalId: "77777777-7777-7777-8777-777777777777",
        schemaVersion: "v1",
        tenantId: "tenant-a",
        workspaceId: "agent",
        workflowId: "wf-1",
        type: "approval_signal",
        occurredAt: "2026-02-17T00:06:00.000Z",
        payload: { approved: true }
      }),
    (err) =>
      err instanceof SignalValidationError &&
      err.code === "VALIDATION_ERROR" &&
      err.message.includes("approverId")
  );

  await assert.rejects(
    async () =>
  await runtime.resumeWithSignal({
        signalId: "88888888-8888-7888-8888-888888888888",
        schemaVersion: "v1",
        tenantId: "tenant-b",
        workspaceId: "agent",
        workflowId: "wf-1",
        type: "user_input_signal",
        occurredAt: "2026-02-17T00:07:00.000Z",
        payload: { message: "Cross tenant" }
      }),
    (err) =>
      err instanceof SignalValidationError &&
      err.code === "VALIDATION_ERROR" &&
      err.message.includes("not found")
  );
});
