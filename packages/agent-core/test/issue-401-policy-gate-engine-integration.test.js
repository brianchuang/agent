const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");
const { PolicyBlockedError } = require("../dist/core/errors");

function objectiveRequest(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-401",
    threadId: "thread-401",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Run policy-gated planner execution",
    ...overrides
  };
}

test("ISSUE-401: blocked actions never reach tool execution and policy decisions are persisted", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);
  let executeToolCalls = 0;

  await assert.rejects(
    async () =>
      await runtime.runPlannerLoop(objectiveRequest(), {
        planner: ({ prior_step_summaries }) =>
          prior_step_summaries.length === 0
            ? {
                type: "tool_call",
                toolName: "message.send",
                args: { to: "candidate@example.com", body: "Interview confirmation" }
              }
            : {
                type: "complete",
                output: { done: true }
              },
        executeTool: () => {
          executeToolCalls += 1;
          return { sent: true };
        },
        policyPackResolver: () => ({
          policyPackId: "tenant-a-communications",
          policyPackVersion: "2026.02.17"
        }),
        policyEngine: {
          evaluate: () => ({
            policyId: "POL-BLOCK-001",
            outcome: "block",
            reasonCode: "external_messaging_disabled"
          })
        }
      }),
    (err) =>
      err instanceof PolicyBlockedError &&
      err.code === "POLICY_BLOCKED" &&
      err.policyId === "POL-BLOCK-001"
  );

  assert.equal(executeToolCalls, 0);

  const decisions = persistence.listPolicyDecisions({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-401"
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].policyId, "POL-BLOCK-001");
  assert.equal(decisions[0].outcome, "block");
  assert.equal(decisions[0].reasonCode, "external_messaging_disabled");
  assert.equal(decisions[0].policyPackId, "tenant-a-communications");
  assert.equal(decisions[0].policyPackVersion, "2026.02.17");
  assert.equal(decisions[0].stepNumber, 0);
});

test("ISSUE-401: rewrite outcomes deterministically alter planner intent before execution", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);
  const toolInputs = [];

  const result = await runtime.runPlannerLoop(
    objectiveRequest({
      workflowId: "wf-401-rewrite",
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    }),
    {
      planner: ({ prior_step_summaries }) => {
        if (prior_step_summaries.length === 0) {
          return {
            type: "tool_call",
            toolName: "message.send",
            args: { to: "candidate@example.com", body: "Contains forbidden token 1234" }
          };
        }

        return {
          type: "complete",
          output: { done: true }
        };
      },
      executeTool: (input) => {
        toolInputs.push(input);
        return { sent: true };
      },
      policyPackResolver: () => ({
        policyPackId: "tenant-a-communications",
        policyPackVersion: "2026.02.17"
      }),
      policyEngine: {
        evaluate: ({ intent }) => ({
          policyId: "POL-REWRITE-001",
          outcome: "rewrite",
          reasonCode: "redact_sensitive_token",
          rewrittenIntent: {
            ...intent,
            args: {
              ...intent.args,
              body: "Contains forbidden token [REDACTED]"
            }
          }
        })
      }
    }
  );

  assert.equal(result.status, "completed");
  assert.equal(toolInputs.length, 1);
  assert.equal(toolInputs[0].toolName, "message.send");
  assert.deepEqual(toolInputs[0].args, {
    to: "candidate@example.com",
    body: "Contains forbidden token [REDACTED]"
  });

  const decisions = persistence.listPolicyDecisions({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-401-rewrite"
  });
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].outcome, "rewrite");
  assert.deepEqual(decisions[0].rewrittenIntent, {
    type: "tool_call",
    toolName: "message.send",
    args: {
      to: "candidate@example.com",
      body: "Contains forbidden token [REDACTED]"
    }
  });
});

test("ISSUE-401: policy outcomes are deterministic for same inputs", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);

  const makePlanner = () => ({
    type: "tool_call",
    toolName: "calendar.find_slots",
    args: { candidateId: "cand-401", timezone: "UTC" }
  });

  const policyEngine = {
    evaluate: ({ intent }) => {
      const stableInput = JSON.stringify(intent);
      return {
        policyId: "POL-ALLOW-001",
        outcome: "allow",
        reasonCode: `stable-${stableInput.length}`
      };
    }
  };

  for (const [workflowId, requestId] of [
    ["wf-401-det-a", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
    ["wf-401-det-b", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"]
  ]) {
    await runtime.runPlannerLoop(
      objectiveRequest({
        workflowId,
        requestId
      }),
      {
        planner: ({ prior_step_summaries }) =>
          prior_step_summaries.length === 0
            ? makePlanner()
            : {
                type: "complete",
                output: { ok: true }
              },
        executeTool: () => ({ slots: [] }),
        policyPackResolver: () => ({
          policyPackId: "tenant-a-core",
          policyPackVersion: "2026.02.17"
        }),
        policyEngine
      }
    );
  }

  const decisionsA = persistence.listPolicyDecisions({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-401-det-a"
  });
  const decisionsB = persistence.listPolicyDecisions({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-401-det-b"
  });

  assert.equal(decisionsA[0].policyId, decisionsB[0].policyId);
  assert.equal(decisionsA[0].outcome, decisionsB[0].outcome);
  assert.equal(decisionsA[0].reasonCode, decisionsB[0].reasonCode);
  assert.equal(decisionsA[0].policyPackId, decisionsB[0].policyPackId);
  assert.equal(decisionsA[0].policyPackVersion, decisionsB[0].policyPackVersion);
});

test("ISSUE-401: policy evaluation is isolated to active tenant policy pack", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);
  let toolCalls = 0;

  const runWithTenant = async (tenantId, workflowId, requestId) => {
    return await runtime.runPlannerLoop(
      objectiveRequest({
        tenantId,
        workflowId,
        requestId
      }),
      {
        planner: ({ prior_step_summaries }) =>
          prior_step_summaries.length === 0
            ? {
                type: "tool_call",
                toolName: "task.create",
                args: { title: "Submit scorecard" }
              }
            : {
                type: "complete",
                output: { ok: true }
              },
        executeTool: () => {
          toolCalls += 1;
          return { taskId: "task-401" };
        },
        policyPackResolver: ({ request }) => ({
          policyPackId: `${request.tenantId}-pack`,
          policyPackVersion: request.tenantId === "tenant-a" ? "2026.02.17-a" : "2026.02.17-b"
        }),
        policyEngine: {
          evaluate: ({ policyPack }) => {
            if (policyPack.policyPackId === "tenant-a-pack") {
              return {
                policyId: "POL-TENANT-A-BLOCK",
                outcome: "block",
                reasonCode: "tenant_a_task_blocked"
              };
            }

            return {
              policyId: "POL-TENANT-B-ALLOW",
              outcome: "allow",
              reasonCode: "tenant_b_allowed"
            };
          }
        }
      }
    );
  };

  await assert.rejects(
    async () =>
      await runWithTenant("tenant-a", "wf-401-tenant-a", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
    (err) =>
      err instanceof PolicyBlockedError &&
      err.policyId === "POL-TENANT-A-BLOCK"
  );

  const tenantBResult = await runWithTenant(
    "tenant-b",
    "wf-401-tenant-b",
    "ffffffff-ffff-4fff-8fff-ffffffffffff"
  );

  assert.equal(tenantBResult.status, "completed");
  assert.equal(toolCalls, 1);

  const tenantADecisions = persistence.listPolicyDecisions({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-401-tenant-a"
  });
  const tenantBDecisions = persistence.listPolicyDecisions({
    tenantId: "tenant-b",
    workspaceId: "agent",
    workflowId: "wf-401-tenant-b"
  });

  assert.equal(tenantADecisions[0].policyPackId, "tenant-a-pack");
  assert.equal(tenantBDecisions[0].policyPackId, "tenant-b-pack");
  assert.equal(tenantADecisions[0].outcome, "block");
  assert.equal(tenantBDecisions[0].outcome, "allow");
});
