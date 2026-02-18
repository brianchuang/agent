const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");
const {
  buildReplayTrace,
  replayTrace,
  diffReplaySnapshot
} = require("../dist/core/replay");

function objectiveRequest(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-203",
    threadId: "thread-203",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Run replay-safe planner loop",
    ...overrides
  };
}

test("ISSUE-203: replay reconstructs persisted execution without external side effects", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);
  let sideEffectCalls = 0;

  const loopResult = await runtime.runPlannerLoop(objectiveRequest(), {
    planner: ({ step_index }) => {
      if (step_index === 0) {
        return {
          type: "tool_call",
          toolName: "calendar.find_slots",
          args: { candidateId: "cand-203" }
        };
      }
      return {
        type: "complete",
        output: { scheduled: true }
      };
    },
    executeTool: () => {
      sideEffectCalls += 1;
      return { slots: ["2026-02-19T10:00:00.000Z"] };
    }
  });

  assert.equal(loopResult.status, "completed");
  assert.equal(sideEffectCalls, 1);

  const trace = buildReplayTrace({
    persistence,
    workflowScope: {
      tenantId: "tenant-a",
      workspaceId: "agent",
      workflowId: "wf-203"
    },
    requestId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
    actorScope: {
      tenantId: "tenant-a",
      workspaceId: "agent"
    }
  });

  assert.equal(trace.schema_version, "replay-trace-v1");
  assert.equal(trace.steps.length, 2);

  const replayResult = replayTrace(trace, {
    actorScope: {
      tenantId: "tenant-a",
      workspaceId: "agent"
    }
  });

  assert.equal(sideEffectCalls, 1);
  assert.equal(replayResult.status, "completed");
  assert.deepEqual(replayResult.steps.map((step) => step.status), [
    "tool_executed",
    "completed"
  ]);
});

test("ISSUE-203: replay drift reports deterministic step-level diffs", () => {
  const baseline = {
    schema_version: "replay-trace-v1",
    tenant_id: "tenant-a",
    workspace_id: "agent",
    workflow_id: "wf-203",
    request: {
      request_id: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
      objective_prompt: "Run replay-safe planner loop",
      occurred_at: "2026-02-17T00:00:00.000Z"
    },
    steps: [
      {
        step_number: 0,
        step: {
          workflowId: "wf-203",
          tenantId: "tenant-a",
          workspaceId: "agent",
          threadId: "thread-203",
          intentType: "tool_call",
          status: "tool_executed"
        },
        planner_intent: {
          type: "tool_call",
          toolName: "calendar.find_slots",
          args: { candidateId: "cand-203" }
        },
        tool_result: { slots: ["2026-02-19T10:00:00.000Z"] }
      }
    ]
  };

  const candidate = {
    ...baseline,
    steps: [
      {
        ...baseline.steps[0],
        step: {
          ...baseline.steps[0].step,
          status: "failed"
        },
        planner_intent: {
          type: "tool_call",
          toolName: "calendar.book_slot",
          args: { slotId: "slot-1" }
        }
      }
    ]
  };

  const drift = diffReplaySnapshot({
    expected: baseline,
    actual: candidate
  });

  assert.equal(drift.hasDrift, true);
  assert.deepEqual(
    drift.diffs.map((item) => item.path),
    ["steps[0].step.status", "steps[0].planner_intent.toolName"]
  );
  assert.equal(drift.diffs[0].expected, "tool_executed");
  assert.equal(drift.diffs[0].actual, "failed");
});

test("ISSUE-203: replay trace access is denied across tenant boundaries without explicit authorization", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);

  await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-203-isolation" }), {
    planner: () => ({
      type: "complete",
      output: { ok: true }
    })
  });

  assert.throws(
    () =>
      buildReplayTrace({
        persistence,
        workflowScope: {
          tenantId: "tenant-a",
          workspaceId: "agent",
          workflowId: "wf-203-isolation"
        },
        requestId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
        actorScope: {
          tenantId: "tenant-b",
          workspaceId: "agent"
        }
      }),
    (err) =>
      err instanceof Error && err.message.includes("Replay access denied for tenant/workspace")
  );
});
