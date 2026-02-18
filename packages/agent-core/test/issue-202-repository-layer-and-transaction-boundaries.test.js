const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");
const { InternalRuntimeError, SignalValidationError } = require("../dist/core/errors");

function objectiveRequest(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-202",
    threadId: "thread-202",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Run a durable planner loop",
    ...overrides
  };
}

test("ISSUE-202: step transaction rolls back fully when execution fails", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);

  await assert.rejects(
    async () =>
      await runtime.runPlannerLoop(objectiveRequest(), {
        planner: () => ({
          type: "tool_call",
          toolName: "calendar.find_slots",
          args: { candidateId: "cand-202" }
        }),
        executeTool: () => {
          throw new Error("provider timed out");
        }
      }),
    (err) =>
      err instanceof InternalRuntimeError &&
      err.code === "INTERNAL_ERROR" &&
      err.message.includes("provider timed out")
  );

  const workflow = persistence.getWorkflow({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-202"
  });
  assert.equal(workflow?.status, "failed");

  const steps = persistence.listPlannerSteps({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-202"
  });
  assert.equal(steps.length, 0);
});

test("ISSUE-202: restart resumes from last committed checkpoint", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtimeA = new AgentRuntime("agent", null, undefined, persistence);
  let toolCalls = 0;

  const waiting = await runtimeA.runPlannerLoop(objectiveRequest({ workflowId: "wf-202-resume" }), {
    planner: ({ prior_step_summaries }) => {
      if (prior_step_summaries.length === 0) {
        return {
          type: "tool_call",
          toolName: "calendar.find_slots",
          args: { candidateId: "cand-202" }
        };
      }

      if (prior_step_summaries.length === 1) {
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

  assert.equal(waiting.status, "waiting_signal");
  assert.equal(toolCalls, 1);

  const runtimeB = new AgentRuntime("agent", null, undefined, persistence);
  await runtimeB.resumeWithSignal({
    signalId: "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-202-resume",
    type: "user_input_signal",
    occurredAt: "2026-02-17T00:05:00.000Z",
    payload: { message: "Yes" }
  });

  const completed = await runtimeB.runPlannerLoop(
    objectiveRequest({
      requestId: "cccccccc-cccc-7ccc-8ccc-cccccccccccc",
      workflowId: "wf-202-resume"
    }),
    {
      planner: ({ prior_step_summaries }) => {
        if (prior_step_summaries.length === 0) {
          return {
            type: "tool_call",
            toolName: "calendar.find_slots",
            args: { candidateId: "cand-202" }
          };
        }

        if (prior_step_summaries.length === 1) {
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
    }
  );

  assert.equal(completed.status, "completed");
  assert.equal(toolCalls, 1);
  assert.deepEqual(completed.steps.map((step) => step.status), [
    "tool_executed",
    "waiting_signal",
    "completed"
  ]);

  const requests = persistence.listObjectiveRequests({
    tenantId: "tenant-a",
    workspaceId: "agent"
  });
  assert.equal(requests.length, 2);
});

test("ISSUE-202: signal checkpoint is consumed exactly once", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);

  await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-202-signal" }), {
    planner: () => ({
      type: "ask_user",
      question: "Need approval"
    })
  });

  const firstResume = await runtime.resumeWithSignal({
    signalId: "dddddddd-dddd-7ddd-8ddd-dddddddddddd",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-202-signal",
    type: "approval_signal",
    occurredAt: "2026-02-17T00:10:00.000Z",
    payload: { approved: true, approverId: "approver-1" }
  });

  assert.equal(firstResume.status, "resumed");

  await assert.rejects(
    async () =>
      await runtime.resumeWithSignal({
        signalId: "eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee",
        schemaVersion: "v1",
        tenantId: "tenant-a",
        workspaceId: "agent",
        workflowId: "wf-202-signal",
        type: "approval_signal",
        occurredAt: "2026-02-17T00:11:00.000Z",
        payload: { approved: true, approverId: "approver-2" }
      }),
    (err) =>
      err instanceof SignalValidationError &&
      err.code === "VALIDATION_ERROR" &&
      err.message.includes("Workflow not found for resume")
  );

  const signals = persistence.listSignals({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-202-signal"
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].signalId, "dddddddd-dddd-7ddd-8ddd-dddddddddddd");
  assert.equal(signals[0].signalStatus, "acknowledged");
});
