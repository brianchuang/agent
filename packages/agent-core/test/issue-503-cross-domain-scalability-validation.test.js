const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");
const { ToolRegistry } = require("../dist/core/toolRegistry");
const {
  evaluateCrossDomainScalability,
  assertCrossDomainScalability
} = require("../dist/core/scalability");

function request(overrides = {}) {
  return {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion: "v1",
    tenantId: "tenant-a",
    workspaceId: "agent",
    workflowId: "wf-503",
    threadId: "thread-503",
    occurredAt: "2026-02-17T00:00:00.000Z",
    objective_prompt: "default objective",
    ...overrides
  };
}

test("ISSUE-503: cross-domain suites run through the same planner loop and tool registry without leakage", async () => {
  const persistence = new InMemoryAgentPersistence();
  const agentRuntime = new AgentRuntime("agent", null, undefined, persistence);
  const opsRuntime = new AgentRuntime("ops", null, undefined, persistence);
  const registry = new ToolRegistry();

  registry.registerTool({
    name: "calendar.find_slots",
    validateArgs: () => [],
    execute: ({ tenantId, workspaceId }) => ({
      kind: "calendar",
      tenantId,
      workspaceId
    })
  });

  registry.registerTool({
    name: "task.create",
    validateArgs: () => [],
    execute: ({ tenantId, workspaceId }) => ({
      kind: "task",
      tenantId,
      workspaceId
    })
  });

  const recruitingScenario = {
    scenarioId: "recruiting-schedule",
    domainId: "recruiting",
    tenantId: "tenant-a",
    workspaceId: "agent",
    threadId: "thread-recruiting",
    objective_prompt: "Schedule candidate interview and confirm slots",
    execute: async () => {
      return await agentRuntime.runPlannerLoop(
        request({
          requestId: "11111111-1111-4111-8111-111111111111",
          workflowId: "wf-503-recruiting",
          threadId: "thread-recruiting",
          objective_prompt: "Schedule candidate interview and confirm slots"
        }),
        {
          toolRegistry: registry,
          planner: ({ prior_step_summaries, objective_prompt }) => {
            if (prior_step_summaries.length === 0) {
              assert.ok(objective_prompt.includes("candidate"));
              return {
                type: "tool_call",
                toolName: "calendar.find_slots",
                args: { candidateId: "cand-1" }
              };
            }
            return { type: "complete", output: { done: true } };
          }
        }
      );
    },
    expected: {
      terminalStatus: "completed",
      expectedStepStatuses: ["tool_executed", "completed"],
      requiresNoCrossTenantAccess: true
    }
  };

  const operationsScenario = {
    scenarioId: "operations-task",
    domainId: "operations",
    tenantId: "tenant-b",
    workspaceId: "ops",
    threadId: "thread-ops",
    objective_prompt: "Create an incident follow-up task for this outage",
    execute: async () => {
      return await opsRuntime.runPlannerLoop(
        request({
          requestId: "22222222-2222-4222-8222-222222222222",
          tenantId: "tenant-b",
          workspaceId: "ops",
          workflowId: "wf-503-ops",
          threadId: "thread-ops",
          objective_prompt: "Create an incident follow-up task for this outage"
        }),
        {
          toolRegistry: registry,
          planner: ({ prior_step_summaries, objective_prompt }) => {
            if (prior_step_summaries.length === 0) {
              assert.ok(objective_prompt.includes("incident"));
              return {
                type: "tool_call",
                toolName: "task.create",
                args: { title: "Postmortem" }
              };
            }
            return { type: "complete", output: { done: true } };
          }
        }
      );
    },
    expected: {
      terminalStatus: "completed",
      expectedStepStatuses: ["tool_executed", "completed"],
      requiresNoCrossTenantAccess: true
    }
  };

  const report = await evaluateCrossDomainScalability({
    suiteId: "issue-503-cross-domain",
    suites: [
      {
        domainId: "recruiting",
        scenarios: [recruitingScenario]
      },
      {
        domainId: "operations",
        scenarios: [operationsScenario]
      }
    ],
    runLoad: async () => {
      const requests = [];
      for (let i = 0; i < 20; i += 1) {
        const tenantId = i % 2 === 0 ? "tenant-a" : "tenant-b";
        const workspaceId = tenantId === "tenant-a" ? "agent" : "ops";
        const workflowId = `wf-load-${i}`;
        const runtime = workspaceId === "agent" ? agentRuntime : opsRuntime;
        requests.push(
          runtime.runPlannerLoop(
            request({
              requestId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
              tenantId,
              workspaceId,
              workflowId,
              threadId: `thread-${tenantId}-${i}`,
              objective_prompt: `Load run ${i}`
            }),
            {
              planner: () => ({ type: "complete", output: { i } })
            }
          )
        );
      }

      const results = await Promise.all(requests);
      return {
        tenantSummaries: [
          {
            tenantId: "tenant-a",
            workspaceId: "agent",
            workflowIds: Array.from({ length: 10 }, (_, idx) => `wf-load-${idx * 2}`)
          },
          {
            tenantId: "tenant-b",
            workspaceId: "ops",
            workflowIds: Array.from({ length: 10 }, (_, idx) => `wf-load-${idx * 2 + 1}`)
          }
        ],
        results
      };
    },
    verifyIsolation: ({ tenantSummaries }) => {
      for (const summary of tenantSummaries) {
        for (const workflowId of summary.workflowIds) {
          const workflow = persistence.getWorkflow({
            tenantId: summary.tenantId,
            workspaceId: summary.workspaceId,
            workflowId
          });
          assert.ok(workflow);
          assert.equal(workflow.tenantId, summary.tenantId);
          assert.equal(workflow.workspaceId, summary.workspaceId);
        }
      }

      const tenantARequests = persistence.listObjectiveRequests({
        tenantId: "tenant-a",
        workspaceId: "agent"
      });
      const tenantBRequests = persistence.listObjectiveRequests({
        tenantId: "tenant-b",
        workspaceId: "ops"
      });

      assert.ok(tenantARequests.length >= 11);
      assert.ok(tenantBRequests.length >= 11);
    }
  });

  assertCrossDomainScalability(report);
  assert.equal(report.summary.domainCount, 2);
  assert.equal(report.summary.scenarioPassRate, 1);
  assert.equal(report.summary.isolationPassRate, 1);
  assert.equal(report.summary.loadPassRate, 1);
});

test("ISSUE-503: composition boundaries support swapped planner pipeline stages", async () => {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("agent", null, undefined, persistence);

  const report = await evaluateCrossDomainScalability({
    suiteId: "issue-503-stage-swaps",
    suites: [
      {
        domainId: "ops",
        scenarios: [
          {
            scenarioId: "swapped-stages",
            domainId: "ops",
            tenantId: "tenant-a",
            workspaceId: "agent",
            threadId: "thread-stage-swap",
            objective_prompt: "Use custom planner stage pipeline",
            execute: async () => {
              return await runtime.runPlannerLoop(
                request({
                  requestId: "33333333-3333-4333-8333-333333333333",
                  workflowId: "wf-503-stages",
                  threadId: "thread-stage-swap",
                  objective_prompt: "Use custom planner stage pipeline"
                }),
                {
                  planner: () => ({ type: "complete", output: { defaultPlanner: true } }),
                  stages: {
                    buildPlanningContext: ({ request, stepIndex, priorSteps }) => ({
                      contract_version: "planner-input-v1",
                      objective_prompt: `${request.objective_prompt} (custom)`,
                      memory_context: { source: "test" },
                      prior_step_summaries: priorSteps,
                      policy_constraints: ["custom-policy"],
                      available_tools: [],
                      step_index: stepIndex,
                      tenant_id: request.tenantId,
                      workspace_id: request.workspaceId,
                      workflow_id: request.workflowId,
                      thread_id: request.threadId
                    }),
                    plan: () => ({ type: "complete", output: { fromCustomPlanStage: true } })
                  }
                }
              );
            },
            expected: {
              terminalStatus: "completed",
              expectedStepStatuses: ["completed"],
              requiresNoCrossTenantAccess: true
            }
          }
        ]
      },
      {
        domainId: "recruiting",
        scenarios: [
          {
            scenarioId: "swapped-execute",
            domainId: "recruiting",
            tenantId: "tenant-a",
            workspaceId: "agent",
            threadId: "thread-stage-swap-2",
            objective_prompt: "Use custom execute stage",
            execute: async () => {
              return await runtime.runPlannerLoop(
                request({
                  requestId: "44444444-4444-4444-8444-444444444444",
                  workflowId: "wf-503-stages-2",
                  threadId: "thread-stage-swap-2",
                  objective_prompt: "Use custom execute stage"
                }),
                {
                  planner: () => ({ type: "tool_call", toolName: "not-used", args: {} }),
                  stages: {
                    executeIntent: ({ request }) => ({
                      step: {
                        workflowId: request.workflowId,
                        tenantId: request.tenantId,
                        workspaceId: request.workspaceId,
                        threadId: request.threadId,
                        intentType: "complete",
                        status: "completed"
                      },
                      completion: { fromCustomExecuteStage: true }
                    })
                  }
                }
              );
            },
            expected: {
              terminalStatus: "completed",
              expectedStepStatuses: ["completed"],
              requiresNoCrossTenantAccess: true
            }
          }
        ]
      }
    ]
  });

  assertCrossDomainScalability(report);
  assert.equal(report.summary.domainCount, 2);
  assert.equal(report.summary.scenarioPassRate, 1);
});
