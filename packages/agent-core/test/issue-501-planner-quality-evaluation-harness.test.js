const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");
const {
  evaluatePlannerQuality,
  assertPlannerQualityThresholds,
  buildPlannerQualityReportMarkdown
} = require("../dist/core/evaluation");

function request(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-501",
    threadId: "thread-501",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Validate planner quality harness",
    ...overrides
  };
}

test("ISSUE-501: deterministic planner quality report is stable for identical suite input", async () => {
  const suite = {
    suiteId: "planner-quality-smoke",
    thresholds: {
      minSuccessRate: 1,
      maxAverageSteps: 3,
      minPolicyComplianceRate: 1
    },
    scenarios: [
      {
        scenarioId: "complete-no-tools",
        tenantId: "tenant-a",
        workspaceId: "agent",
        objective_prompt: "Return completion immediately",
        execute: async () => {
          const persistence = new InMemoryAgentPersistence();
          const runtime = new AgentRuntime("agent", null, undefined, persistence);
          return await runtime.runPlannerLoop(
            request({ workflowId: "wf-501-s1", requestId: "11111111-1111-4111-8111-111111111111" }),
            {
              planner: () => ({ type: "complete", output: { done: true } })
            }
          );
        },
        expected: {
          terminalStatus: "completed",
          expectedStepStatuses: ["completed"],
          maxSteps: 1,
          requiresPolicyCompliance: true
        }
      },
      {
        scenarioId: "signal-resume-no-dup",
        tenantId: "tenant-a",
        workspaceId: "agent",
        objective_prompt: "Pause for input then continue",
        execute: async () => {
          const persistence = new InMemoryAgentPersistence();
          const runtime = new AgentRuntime("agent", null, undefined, persistence);

          await runtime.runPlannerLoop(
            request({ workflowId: "wf-501-s2", requestId: "22222222-2222-4222-8222-222222222222" }),
            {
              planner: ({ prior_step_summaries }) => {
                if (prior_step_summaries.length === 0) {
                  return { type: "ask_user", question: "Continue?" };
                }
                return { type: "complete", output: { resumed: true } };
              }
            }
          );

          await runtime.resumeWithSignal({
            signalId: "33333333-3333-4333-8333-333333333333",
            schemaVersion: "v1",
            tenantId: "tenant-a",
            workspaceId: "agent",
            workflowId: "wf-501-s2",
            type: "user_input_signal",
            occurredAt: "2026-02-17T00:05:00.000Z",
            payload: { message: "yes" }
          });

          const resumed = await runtime.runPlannerLoop(
            request({ workflowId: "wf-501-s2", requestId: "44444444-4444-4444-8444-444444444444" }),
            {
              planner: ({ prior_step_summaries }) => {
                if (prior_step_summaries.length === 0) {
                  return { type: "ask_user", question: "Continue?" };
                }
                return { type: "complete", output: { resumed: true } };
              }
            }
          );

          return resumed;
        },
        expected: {
          terminalStatus: "completed",
          expectedStepStatuses: ["waiting_signal", "completed"],
          maxSteps: 2,
          requiresPolicyCompliance: true,
          noDuplicateStepStatuses: true
        }
      }
    ]
  };

  const first = await evaluatePlannerQuality(suite);
  const second = await evaluatePlannerQuality(suite);

  assert.deepEqual(second, first);
  assert.equal(first.summary.totalScenarios, 2);
  assert.equal(first.summary.successRate, 1);
  assert.equal(first.summary.signalResumeNoDuplicationRate, 1);

  const markdown = buildPlannerQualityReportMarkdown(first);
  assert.ok(markdown.includes("planner-quality-smoke"));
  assert.ok(markdown.includes("signal-resume-no-dup"));
});

test("ISSUE-501: regression thresholds fail fast when planner quality degrades", async () => {
  const suite = {
    suiteId: "planner-quality-thresholds",
    thresholds: {
      minSuccessRate: 1,
      maxAverageSteps: 1,
      minPolicyComplianceRate: 1
    },
    scenarios: [
      {
        scenarioId: "too-many-steps",
        tenantId: "tenant-a",
        workspaceId: "agent",
        objective_prompt: "Do one tool then complete",
        execute: async () => {
          const persistence = new InMemoryAgentPersistence();
          const runtime = new AgentRuntime("agent", null, undefined, persistence);

          return await runtime.runPlannerLoop(
            request({ workflowId: "wf-501-threshold", requestId: "55555555-5555-4555-8555-555555555555" }),
            {
              planner: ({ prior_step_summaries }) => {
                if (prior_step_summaries.length === 0) {
                  return {
                    type: "tool_call",
                    toolName: "calendar.find_slots",
                    args: { candidateId: "cand-501" }
                  };
                }
                return { type: "complete", output: { ok: true } };
              },
              executeTool: () => ({ slots: ["2026-02-20T10:00:00.000Z"] })
            }
          );
        },
        expected: {
          terminalStatus: "completed",
          expectedStepStatuses: ["tool_executed", "completed"],
          maxSteps: 2,
          requiresPolicyCompliance: true
        }
      }
    ]
  };

  const report = await evaluatePlannerQuality(suite);

  assert.equal(report.summary.averageSteps, 2);
  assert.throws(
    () => assertPlannerQualityThresholds(report),
    (err) => err instanceof Error && err.message.includes("averageSteps")
  );
});
