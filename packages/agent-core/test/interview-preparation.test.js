const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");
const {
  evaluatePlannerQuality,
  buildPlannerQualityReportMarkdown
} = require("../dist/core/evaluation");

function request(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-interview",
    workspaceId: "agent-interview",
    workflowId: "wf-interview-001",
    threadId: "thread-interview",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "Help me prepare for a systems design interview",
    ...overrides
  };
}

test("Scenario: Help me prepare for interviews (Mocked Planner)", async () => {
  const suite = {
    suiteId: "interview-prep-scenario",
    thresholds: {
      minSuccessRate: 1,
      maxAverageSteps: 5,
      minPolicyComplianceRate: 1
    },
    scenarios: [
      {
        scenarioId: "systems-design-interview-Mock",
        tenantId: "tenant-interview",
        workspaceId: "agent-interview",
        objective_prompt: "Help me prepare for a systems design interview",
        execute: async () => {
          const persistence = new InMemoryAgentPersistence();
          const runtime = new AgentRuntime("agent-interview", null, undefined, persistence);

          const req1 = request({ 
            requestId: "11111111-1111-4111-8111-111111111111",
            workflowId: "wf-interview-001"
          });

          // 1. Initial Plan: Agent decides to ask the first question
          const initialResult = await runtime.runPlannerLoop(
            req1,
            {
              planner: ({ prior_step_summaries }) => {
                // If no steps, start interview
                if (prior_step_summaries.length === 0) {
                  return {
                    type: "ask_user",
                    question: "Great, let's start. Design a URL shortener like Bitly. What are the key requirements?"
                  };
                }
                return { type: "complete", output: { error: "Unexpected state 1" } };
              }
            }
          );
          // 2. User answers first question -> Signal
          await runtime.resumeWithSignal({
            signalId: "22222222-2222-4222-8222-222222222222",
            schemaVersion: "v1",
            tenantId: "tenant-interview",
            workspaceId: "agent-interview",
            workflowId: "wf-interview-001",
            type: "user_input_signal",
            occurredAt: "2026-02-17T00:01:00.000Z",
            payload: { message: "It needs to be highly available, scalable write throughput, and short URLs should be 7 characters." }
          });

          // 3. Planner responds to answer and asks follow-up
          await runtime.runPlannerLoop(
            request({ requestId: "33333333-3333-4333-8333-333333333333" }),
            {
              planner: ({ prior_step_summaries }) => {
                // We expect prior steps: [ask_user(waiting)]
                if (prior_step_summaries.length >= 1) {
                   return {
                    type: "ask_user",
                    question: "Good. How would you handle the database schema and unique ID generation?"
                  };
                }
                return { type: "complete", output: { error: "Unexpected state 2" } };
              }
            }
          );

          // 4. User answers second question -> Signal
          await runtime.resumeWithSignal({
            signalId: "44444444-4444-4444-8444-444444444444",
            schemaVersion: "v1",
            tenantId: "tenant-interview",
            workspaceId: "agent-interview",
            workflowId: "wf-interview-001",
            type: "user_input_signal",
            occurredAt: "2026-02-17T00:02:00.000Z",
            payload: { message: "I'd use a counter range server or Zookeeper needed for ID generation. Simple key-value store for mapping." }
          });

          // 5. Planner evaluates and completes
          const result = await runtime.runPlannerLoop(
            request({ requestId: "55555555-5555-4555-8555-555555555555" }),
            {
              planner: ({ prior_step_summaries }) => {
                 if (prior_step_summaries.length >= 4) {
                   return {
                    type: "complete",
                    output: {
                        feedback: "Solid approach. Zookeeper is a good choice for distributed ID generation. You passed this mock interview.",
                        score: "Pass"
                    }
                  };
                }
                return { type: "complete", output: { error: "Unexpected state 3" } };
              }
            }
          );

          return result;
        },
        expected: {
          terminalStatus: "completed",
          // Expected flow:
          // 1. ask_user (waiting_signal)
          // 2. resume (completes the step 1 as resumed or adds a resumed step? standard flow updates step 1 to resumed? No, standard flow appends a signal step?)
          // Let's check `issue-501`: expectedStepStatuses: ["waiting_signal", "completed"] for a simple resume.
          // Here we have:
          // 1. wait (ask Q1)
          // 2. wait (ask Q2) -- wait, step 1 becomes 'resumed'? No, look at `issue-101`:
          //    "ISSUE-101: planner loop pauses on ask_user and stores waiting state" -> step status "waiting_signal"
          //    "ISSUE-101: pause/resume continues... " -> second pass steps: [ "tool_executed", "waiting_signal", "completed" ] ?
          // Wait, if we resume a waiting step, does it stay in history?
          // In `issue-101`:
          // firstPass: 1 step (waiting)
          // resume: status "resumed"
          // secondPass: 3 steps? [tool, waiting, completed]?
          // Ah, `planner` gets `priorSteps`. The runtime reconstructs history.
          // If step 1 was waiting, and we resume, does step 1 become completed?
          // Let's look at `issue-501`:
          // "signal-resume-no-dup": expectedStepStatuses: ["waiting_signal", "completed"]
          // It seems the "waiting_signal" step is PRESERVED in history as the step that asked.
          // Then the NEXT step (after resume) is generated.
          // So:
          // 1. Step 1: ask_user -> waiting_signal
          // [Resume Signal]
          // 2. Step 2: ask_user -> waiting_signal OR complete
          //
          // In my scenario:
          // 1. Ask Q1 -> waiting_signal
          // [Resume 1]
          // 2. Ask Q2 -> waiting_signal
          // [Resume 2]
          // 3. Complete -> completed
          expectedStepStatuses: ["waiting_signal", "waiting_signal", "completed"],
          maxSteps: 3,
          requiresPolicyCompliance: true
        }
      }
    ]
  };

  const report = await evaluatePlannerQuality(suite);
  console.log(buildPlannerQualityReportMarkdown(report));

  assert.equal(report.summary.passedScenarios, 1);
  assert.equal(report.summary.successRate, 1);
});
