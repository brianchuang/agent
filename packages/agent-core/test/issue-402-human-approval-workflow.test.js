const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");
const { SignalValidationError } = require("../dist/core/errors");

function objectiveRequest(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-402",
    threadId: "thread-402",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Send a high-impact candidate communication",
    ...overrides
  };
}

function plannerForApprovalFlow({ prior_step_summaries }) {
  if (prior_step_summaries.length === 0) {
    return {
      type: "tool_call",
      toolName: "message.send",
      args: {
        to: "candidate@example.com",
        body: "We need to reschedule your interview."
      }
    };
  }

  return {
    type: "complete",
    output: { done: true }
  };
}

function highImpactApprovalPolicy() {
  return {
    classify: ({ intent }) => {
      if (intent.type === "tool_call" && intent.toolName === "message.send") {
        return {
          riskClass: "high_impact_external_communication",
          requiresApproval: true,
          reasonCode: "high_impact_message"
        };
      }

      return {
        riskClass: "low",
        requiresApproval: false,
        reasonCode: "not_high_impact"
      };
    }
  };
}

test("ISSUE-402: high-impact actions pause until approval is resolved", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);
  let executeToolCalls = 0;

  const result = await runtime.runPlannerLoop(objectiveRequest(), {
    planner: plannerForApprovalFlow,
    executeTool: () => {
      executeToolCalls += 1;
      return { sent: true };
    },
    approvalPolicy: highImpactApprovalPolicy()
  });

  assert.equal(result.status, "waiting_signal");
  assert.equal(result.waitingQuestion, "Approval required for high_impact_message");
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].intentType, "tool_call");
  assert.equal(result.steps[0].status, "waiting_signal");
  assert.equal(executeToolCalls, 0);

  const approvals = persistence.listApprovalDecisions({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-402"
  });

  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].status, "pending");
  assert.equal(approvals[0].riskClass, "high_impact_external_communication");
  assert.equal(approvals[0].reasonCode, "high_impact_message");
});

test("ISSUE-402: approved actions execute exactly once after approval signal", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);
  let executeToolCalls = 0;

  await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-402-approved" }), {
    planner: plannerForApprovalFlow,
    executeTool: () => {
      executeToolCalls += 1;
      return { sent: true };
    },
    approvalPolicy: highImpactApprovalPolicy()
  });

  await runtime.resumeWithSignal({
    signalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-402-approved",
    type: "approval_signal",
    occurredAt: "2026-02-17T00:05:00.000Z",
    payload: {
      approved: true,
      approverId: "approver-402"
    }
  });

  const completed = await runtime.runPlannerLoop(
    objectiveRequest({
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      workflowId: "wf-402-approved"
    }),
    {
      planner: plannerForApprovalFlow,
      executeTool: () => {
        executeToolCalls += 1;
        return { sent: true };
      },
      approvalPolicy: highImpactApprovalPolicy()
    }
  );

  assert.equal(completed.status, "completed");
  assert.equal(executeToolCalls, 1);

  const approvals = persistence.listApprovalDecisions({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-402-approved"
  });

  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].status, "approved");
  assert.equal(approvals[0].approverId, "approver-402");
  assert.equal(approvals[0].resolvedAt, "2026-02-17T00:05:00.000Z");
});

test("ISSUE-402: rejected approvals end workflow with auditable terminal state", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);

  await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-402-rejected" }), {
    planner: plannerForApprovalFlow,
    executeTool: () => ({ sent: true }),
    approvalPolicy: highImpactApprovalPolicy()
  });

  await runtime.resumeWithSignal({
    signalId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-402-rejected",
    type: "approval_signal",
    occurredAt: "2026-02-17T00:06:00.000Z",
    payload: {
      approved: false,
      approverId: "approver-403"
    }
  });

  const workflow = persistence.getWorkflow({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-402-rejected"
  });

  assert.equal(workflow?.status, "failed");

  const approvals = persistence.listApprovalDecisions({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-402-rejected"
  });

  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].status, "rejected");
  assert.equal(approvals[0].approverId, "approver-403");
  assert.equal(approvals[0].resolvedAt, "2026-02-17T00:06:00.000Z");
});

test("ISSUE-402: tenant-scoped approvals cannot unblock another tenant workflow", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);

  await runtime.runPlannerLoop(objectiveRequest({ workflowId: "wf-402-isolation" }), {
    planner: plannerForApprovalFlow,
    executeTool: () => ({ sent: true }),
    approvalPolicy: highImpactApprovalPolicy()
  });

  await assert.rejects(
    async () =>
      await runtime.resumeWithSignal({
        signalId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        schemaVersion: "v1",
        tenantId: "tenant-b",
        workspaceId: "agent",
        workflowId: "wf-402-isolation",
        type: "approval_signal",
        occurredAt: "2026-02-17T00:07:00.000Z",
        payload: {
          approved: true,
          approverId: "approver-cross-tenant"
        }
      }),
    (err) =>
      err instanceof SignalValidationError &&
      err.code === "VALIDATION_ERROR" &&
      err.message.includes("Workflow not found for resume")
  );

  const workflow = persistence.getWorkflow({
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-402-isolation"
  });

  assert.equal(workflow?.status, "waiting_signal");
});
