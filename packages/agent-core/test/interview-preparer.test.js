const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");
const {
  evaluatePlannerQuality,
  assertPlannerQualityThresholds,
} = require("../dist/core/evaluation");

function request(overrides = {}) {
  return {
    requestId: "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb",
    schemaVersion: "v1",
    tenantId: "tenant-b",
    workspaceId: "agent-interview",
    workflowId: "wf-interview",
    threadId: "thread-interview",
    occurredAt: "2026-02-17T09:00:00.000Z",
    objective_prompt: "help me prepare for my interviews",
    ...overrides
  };
}

test("Feature: Interview Preparation - Planner checks calendar for interviews", async () => {
  const suite = {
    suiteId: "interview-prep-suite",
    thresholds: {
      minSuccessRate: 1,
      maxAverageSteps: 5,
      minPolicyComplianceRate: 1
    },
    scenarios: [
      {
        scenarioId: "initial-interview-check",
        tenantId: "tenant-b",
        workspaceId: "agent-interview",
        objective_prompt: "help me prepare for my interviews",
        execute: async () => {
          const persistence = new InMemoryAgentPersistence();
          const runtime = new AgentRuntime("agent-interview", null, undefined, persistence);
          const { ToolRegistry } = require("../dist/core/toolRegistry");
          const registry = new ToolRegistry();

          // Shared "Working Memory" for the agent to observe tool outputs
          const context = {
            events: null,
            research: null,
            docUrl: null
          };

          // Register calendar tool
          registry.registerTool({
            name: "calendar.list_events",
            description: "List calendar events",
            validateArgs: (args) => {
              if (typeof args.startTime !== "string") return [{ field: "startTime", message: "Required" }];
              if (typeof args.endTime !== "string") return [{ field: "endTime", message: "Required" }];
              return [];
            },
            execute: async ({ args }) => {
              const result = {
                events: [
                  {
                    id: "evt-1",
                    subject: "System Design Interview",
                    startTime: "2026-02-18T14:00:00.000Z",
                    endTime: "2026-02-18T15:00:00.000Z"
                  }
                ]
              };
              context.events = result.events;
              return result;
            }
          });

          // Register research tool
          registry.registerTool({
            name: "research.search",
            description: "Research a topic",
            validateArgs: (args) => {
              if (typeof args.query !== "string") return [{ field: "query", message: "Required" }];
              return [];
            },
            execute: async ({ args }) => {
               const result = {
                 results: [
                   { title: "System Design Guide", snippets: ["Scale out, not up", "CAP theorem"] }
                 ]
               };
               context.research = result.results;
               return result;
            }
          });

          // Register document tool
          registry.registerTool({
            name: "document.create",
            description: "Create a document",
            validateArgs: (args) => {
              if (typeof args.title !== "string") return [{ field: "title", message: "Required" }];
              if (typeof args.content !== "string") return [{ field: "content", message: "Required" }];
              return [];
            },
            execute: async ({ args }) => {
               const url = `https://docs.example.com/doc-123/${args.title.replace(/\s+/g, "-")}`;
               const result = {
                 documentId: "doc-123",
                 url
               };
               context.docUrl = url;
               return result;
            }
          });

          // Register email tool (not used in this flow but registered as per requirements)
          registry.registerTool({
            name: "email.search",
            description: "Search emails",
            validateArgs: (args) => {
              if (typeof args.query !== "string") return [{ field: "query", message: "Required" }];
              return [];
            },
            execute: async (args) => {
               return {
                 emails: []
               };
            }
          });

          return await runtime.runPlannerLoop(
            request({ requestId: "11111111-1111-7111-8111-111111111111" }),
            {
              planner: ({ prior_step_summaries }) => {
                // Step 0: Initial state -> Check calendar
                if (prior_step_summaries.length === 0) {
                  return {
                    type: "tool_call",
                    toolName: "calendar.list_events",
                    args: { 
                      startTime: "2026-02-17T09:00:00.000Z",
                      endTime: "2026-02-24T09:00:00.000Z", 
                      query: "interview"
                    }
                  };
                }
                
                // Step 1: Observe Calendar data (from context) -> Do research
                if (context.events && context.events.length > 0 && !context.research) {
                    const eventName = context.events[0].subject;
                    return {
                        type: "tool_call",
                        toolName: "research.search",
                        args: { query: `${eventName} tips` }
                    };
                }

                // Step 2: Observe Research data (from context) -> Create document
                if (context.research && !context.docUrl) {
                    const snippets = context.research.flatMap(r => r.snippets).join("; ");
                    return {
                        type: "tool_call",
                        toolName: "document.create",
                        args: { 
                            title: "Interview Prep Notes",
                            content: `Research findings: ${snippets}`
                        }
                    };
                }

                // Step 3: Observe Document data (from context) -> Complete
                if (context.docUrl) {
                     return { type: "complete", output: { document_url: context.docUrl } };
                }

                // Fallback / Error
                return { type: "complete", output: { error: "unexpected state", context, stepCount: prior_step_summaries.length } };
              },
              toolRegistry: registry
            }
          );
        },
        expected: {
          terminalStatus: "completed",
          expectedStepStatuses: ["tool_executed", "tool_executed", "tool_executed", "completed"],
          maxSteps: 5,
          requiresPolicyCompliance: true
        }
      }
    ]
  };

  const report = await evaluatePlannerQuality(suite);
  assertPlannerQualityThresholds(report);
  
  assert.equal(report.summary.successRate, 1, "Scenario should succeed");
});
