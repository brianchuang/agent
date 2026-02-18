const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");

function objectiveRequest(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-403",
    threadId: "thread-403",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Run auditable governance flow",
    ...overrides
  };
}

test("ISSUE-403: audit API reconstructs full decision chain by request with tenant scoping", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);

  await runtime.runPlannerLoop(objectiveRequest(), {
    planner: () => ({
      type: "tool_call",
      toolName: "message.send",
      args: { to: "candidate@example.com", body: "Please confirm interview details" }
    }),
    executeTool: () => ({ sent: true }),
    policyPackResolver: () => ({
      policyPackId: "tenant-a-governance",
      policyPackVersion: "2026.02.17"
    }),
    policyEngine: {
      evaluate: () => ({
        policyId: "POL-BLOCK-403",
        outcome: "block",
        reasonCode: "communications_frozen"
      })
    }
  }).catch(() => {});

  await runtime.runPlannerLoop(
    objectiveRequest({
      requestId: "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb",
      workflowId: "wf-403-approval"
    }),
    {
      planner: ({ prior_step_summaries }) =>
        prior_step_summaries.length === 0
          ? {
              type: "tool_call",
              toolName: "message.send",
              args: { to: "candidate@example.com", body: "Interview moved to 3pm" }
            }
          : {
              type: "complete",
              output: { done: true }
            },
      executeTool: () => ({ sent: true }),
      approvalPolicy: {
        classify: ({ intent }) =>
          intent.type === "tool_call"
            ? {
                riskClass: "high_impact_external_communication",
                requiresApproval: true,
                reasonCode: "approval_required"
              }
            : {
                riskClass: "low",
                requiresApproval: false,
                reasonCode: "low_risk"
              }
      }
    }
  );

  await runtime.resumeWithSignal({
    signalId: "cccccccc-cccc-7ccc-8ccc-cccccccccccc",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-403-approval",
    type: "approval_signal",
    occurredAt: "2026-02-17T00:01:00.000Z",
    payload: {
      approved: true,
      approverId: "approver-403"
    }
  });

  await runtime.runPlannerLoop(
    objectiveRequest({
      requestId: "dddddddd-dddd-7ddd-8ddd-dddddddddddd",
      workflowId: "wf-403-approval",
      occurredAt: "2026-02-17T00:02:00.000Z"
    }),
    {
      planner: ({ prior_step_summaries }) =>
        prior_step_summaries.length === 0
          ? {
              type: "tool_call",
              toolName: "message.send",
              args: { to: "candidate@example.com", body: "Interview moved to 3pm" }
            }
          : {
              type: "complete",
              output: { done: true }
            },
      executeTool: () => ({ sent: true }),
      approvalPolicy: {
        classify: () => ({
          riskClass: "low",
          requiresApproval: false,
          reasonCode: "already_approved"
        })
      }
    }
  );

  const blockedAudit = persistence.listAuditRecords({
    tenantId: "tenant-a",
    workspaceId: "agent",
    requestId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa"
  });
  assert.equal(blockedAudit.length, 2);
  assert.deepEqual(
    blockedAudit.map((record) => record.eventType),
    ["policy_block", "workflow_terminal_failed"]
  );
  assert.ok(blockedAudit.every((record) => typeof record.stepNumber === "number"));
  assert.ok(blockedAudit.every((record) => record.requestId === "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa"));

  const approvalAudit = persistence.listAuditRecords({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-403-approval"
  });
  const resolved = approvalAudit.find((record) => record.eventType === "approval_approved");
  assert.ok(resolved);
  assert.equal(resolved.signalCorrelationId, "cccccccc-cccc-7ccc-8ccc-cccccccccccc");
  assert.ok(
    approvalAudit.some((record) => record.eventType === "approval_pending"),
    "expected pending approval audit row"
  );
  assert.ok(
    approvalAudit.some((record) => record.eventType === "workflow_terminal_completed"),
    "expected terminal completion audit row"
  );
  assert.ok(approvalAudit.every((record) => record.tenantId === "tenant-a"));
  assert.ok(approvalAudit.every((record) => record.workflowId === "wf-403-approval"));

  const crossTenantAudit = persistence.listAuditRecords({
    tenantId: "tenant-b",
    workspaceId: "agent",
    workflowId: "wf-403-approval"
  });
  assert.deepEqual(crossTenantAudit, []);
});
