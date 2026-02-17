const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { ToolRegistry } = require("../dist/core/toolRegistry");

function objectiveRequest(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-103",
    threadId: "thread-103",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Plan the next best action",
    ...overrides
  };
}

test("ISSUE-103: planner receives versioned prompt contract with memory, policy, prior steps, and tools", async () => {
  const runtime = new AgentRuntime("agent", null);
  const registry = new ToolRegistry();

  registry.registerTool({
    name: "calendar.find_slots",
    description: "Find available interview slots",
    validateArgs: () => [],
    execute: () => ({ slots: [] }),
    isAuthorized: ({ tenantId }) => tenantId === "tenant-a"
  });

  registry.registerTool({
    name: "message.send",
    description: "Send a message",
    validateArgs: () => [],
    execute: () => ({ sent: true }),
    isAuthorized: ({ tenantId }) => tenantId === "tenant-b"
  });

  const plannerContexts = [];

  const result = await runtime.runPlannerLoop(objectiveRequest(), {
    toolRegistry: registry,
    contextProvider: {
      memory: () => ({ recalls: ["candidate prefers mornings"] }),
      policyConstraints: () => ["no_weekend_scheduling"]
    },
    planner: (context) => {
      plannerContexts.push(context);
      if (context.step_index === 0) {
        return {
          type: "tool_call",
          toolName: "calendar.find_slots",
          args: { candidateId: "cand-103" }
        };
      }

      return {
        type: "complete",
        output: { scheduled: true }
      };
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(plannerContexts.length, 2);

  assert.equal(plannerContexts[0].contract_version, "planner-input-v1");
  assert.equal(plannerContexts[0].objective_prompt, "Plan the next best action");
  assert.deepEqual(plannerContexts[0].memory_context, {
    recalls: ["candidate prefers mornings"]
  });
  assert.deepEqual(plannerContexts[0].policy_constraints, ["no_weekend_scheduling"]);
  assert.deepEqual(plannerContexts[0].available_tools, [
    { name: "calendar.find_slots", description: "Find available interview slots" }
  ]);
  assert.deepEqual(plannerContexts[0].prior_step_summaries, []);
  assert.equal(plannerContexts[1].prior_step_summaries.length, 1);
  assert.equal(plannerContexts[1].prior_step_summaries[0].status, "tool_executed");
});

test("ISSUE-103: planner loop stages are composable and replaceable in tests", async () => {
  const runtime = new AgentRuntime("agent", null);
  const stageCalls = [];

  const result = await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-103-stages" }), {
    planner: () => {
      throw new Error("default planner must not run when plan stage is overridden");
    },
    stages: {
      buildPlanningContext: (input) => {
        stageCalls.push("buildPlanningContext");
        return {
          contract_version: "planner-input-v1",
          objective_prompt: input.request.objective_prompt,
          memory_context: { source: "custom-stage" },
          prior_step_summaries: [],
          policy_constraints: [],
          available_tools: [],
          step_index: 0,
          tenant_id: input.request.tenantId,
          workspace_id: input.request.workspaceId,
          workflow_id: input.request.workflowId,
          thread_id: input.request.threadId
        };
      },
      plan: () => {
        stageCalls.push("plan");
        return {
          type: "complete",
          output: { from: "stage" }
        };
      },
      validateIntent: (intent) => {
        stageCalls.push(`validate:${intent.type}`);
      },
      executeIntent: ({ request, intent }) => {
        stageCalls.push(`execute:${intent.type}`);
        return {
          step: {
            workflowId: request.workflowId,
            tenantId: request.tenantId,
            workspaceId: request.workspaceId,
            threadId: request.threadId,
            intentType: "complete",
            status: "completed"
          },
          completion: { from: "custom-executor" }
        };
      }
    }
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.completion, { from: "custom-executor" });
  assert.deepEqual(stageCalls, [
    "buildPlanningContext",
    "plan",
    "validate:complete",
    "execute:complete"
  ]);
});
