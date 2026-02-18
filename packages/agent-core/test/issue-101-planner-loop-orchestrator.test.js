const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { ValidationRuntimeError, SignalValidationError } = require("../dist/core/errors");

function objectiveRequest(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-101",
    threadId: "thread-101",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Plan an interview loop and finalize schedule",
    ...overrides
  };
}

test("ISSUE-101: planner loop completes and emits per-step statuses", async () => {
  const runtime = new AgentRuntime("agent", null);
  const toolCalls = [];

  const result = await runtime.runPlannerLoop(objectiveRequest(), {
    planner: ({ stepIndex }) => {
      if (stepIndex === 0) {
        return {
          type: "tool_call",
          toolName: "calendar.find_slots",
          args: { candidateId: "cand-101" }
        };
      }

      return {
        type: "complete",
        output: { scheduled: true }
      };
    },
    executeTool: (input) => {
      toolCalls.push(input.toolName);
      return { slots: ["2026-02-18T10:00:00.000Z"] };
    }
  });

  assert.equal(result.workflowId, "wf-101");
  assert.equal(result.status, "completed");
  assert.equal(toolCalls.length, 1);
  assert.deepEqual(result.steps.map((step) => step.status), ["tool_executed", "completed"]);
  assert.deepEqual(result.completion, { scheduled: true });
});

test("ISSUE-101: planner loop pauses on ask_user and stores waiting state", async () => {
  const runtime = new AgentRuntime("agent", null);

  const result = await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-ask" }), {
    planner: () => ({
      type: "ask_user",
      question: "Which interviewer should I assign?"
    })
  });

  assert.equal(result.status, "waiting_signal");
  assert.equal(result.waitingQuestion, "Which interviewer should I assign?");
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].status, "waiting_signal");
});

test("ISSUE-101: malformed planner intents fail fast and mark workflow failed", async () => {
  const runtime = new AgentRuntime("agent", null);
  let toolCalls = 0;

  await assert.rejects(
    async () =>
  await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-bad" }), {
        planner: () => ({ type: "tool_call", args: { x: 1 } }),
        executeTool: () => {
          toolCalls += 1;
          return { ok: true };
        }
      }),
    (err) =>
      err instanceof ValidationRuntimeError &&
      err.code === "VALIDATION_ERROR" &&
      err.message.includes("toolName")
  );

  assert.equal(toolCalls, 0);
});

test("ISSUE-101: max-step guard halts runaway workflows", async () => {
  const runtime = new AgentRuntime("agent", null);

  await assert.rejects(
    async () =>
  await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-max" }), {
        maxSteps: 2,
        planner: () => ({
          type: "tool_call",
          toolName: "calendar.find_slots",
          args: { candidateId: "cand-101" }
        }),
        executeTool: () => ({ slots: [] })
      }),
    (err) =>
      err instanceof ValidationRuntimeError &&
      err.code === "VALIDATION_ERROR" &&
      err.message.includes("max step")
  );
});

test("ISSUE-101: pause/resume continues by workflow ID without re-running completed steps", async () => {
  const runtime = new AgentRuntime("agent", null);
  let toolCalls = 0;

  const firstPass = await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-resume" }), {
    planner: ({ priorSteps }) => {
      if (priorSteps.length === 0) {
        return {
          type: "tool_call",
          toolName: "calendar.find_slots",
          args: { candidateId: "cand-101" }
        };
      }

      if (priorSteps.length === 1) {
        return {
          type: "ask_user",
          question: "Proceed with first available slot?"
        };
      }

      return {
        type: "complete",
        output: { scheduled: true }
      };
    },
    executeTool: () => {
      toolCalls += 1;
      return { slots: ["2026-02-18T10:00:00.000Z"] };
    }
  });

  assert.equal(firstPass.status, "waiting_signal");
  assert.equal(toolCalls, 1);

  const resumed = await runtime.resumeWithSignal({
    signalId: "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-resume",
    type: "user_input_signal",
    occurredAt: "2026-02-17T00:05:00.000Z",
    payload: { message: "Yes, proceed." }
  });

  assert.equal(resumed.status, "resumed");

  const secondPass = await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-resume" }), {
    planner: ({ priorSteps }) => {
      if (priorSteps.length === 0) {
        return {
          type: "tool_call",
          toolName: "calendar.find_slots",
          args: { candidateId: "cand-101" }
        };
      }

      if (priorSteps.length === 1) {
        return {
          type: "ask_user",
          question: "Proceed with first available slot?"
        };
      }

      return {
        type: "complete",
        output: { scheduled: true }
      };
    },
    executeTool: () => {
      toolCalls += 1;
      return { slots: ["2026-02-18T10:00:00.000Z"] };
    }
  });

  assert.equal(secondPass.status, "completed");
  assert.equal(toolCalls, 1);
  assert.equal(secondPass.steps.length, 3);
  assert.deepEqual(secondPass.steps.map((step) => step.status), [
    "tool_executed",
    "waiting_signal",
    "completed"
  ]);
});

test("ISSUE-101: tenant/workspace checks are enforced on every resumed step", async () => {
  const runtime = new AgentRuntime("agent", null);
  await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-tenant" }), {
    planner: () => ({
      type: "ask_user",
      question: "Need confirmation"
    })
  });
  await runtime.resumeWithSignal({
    signalId: "cccccccc-cccc-7ccc-8ccc-cccccccccccc",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-tenant",
    type: "user_input_signal",
    occurredAt: "2026-02-17T00:10:00.000Z",
    payload: { message: "Continue" }
  });

  await assert.rejects(
    async () =>
  await runtime.runPlannerLoop(
        objectiveRequest({
          workflowId: "wf-tenant",
          requestId: "dddddddd-dddd-7ddd-8ddd-dddddddddddd",
          tenantId: "tenant-b"
        }),
        {
          planner: () => ({ type: "complete", output: { ok: true } })
        }
      ),
    (err) =>
      err instanceof SignalValidationError &&
      err.code === "VALIDATION_ERROR" &&
      err.message.includes("tenant/workspace")
  );
});
