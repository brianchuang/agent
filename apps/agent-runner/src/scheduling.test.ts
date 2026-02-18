import test from "node:test";
import assert from "node:assert/strict";
import { resolveScheduleTimeUtc, nextCronOccurrenceUtc } from "./scheduling";
import { createPlannerScheduleWorkflowTool } from "./schedulerTool";

test("resolveScheduleTimeUtc supports delaySeconds", () => {
  const now = new Date("2026-02-17T12:00:00.000Z");
  const at = resolveScheduleTimeUtc({ delaySeconds: 90 }, now);
  assert.equal(at.toISOString(), "2026-02-17T12:01:30.000Z");
});

test("nextCronOccurrenceUtc computes next minute boundary in UTC", () => {
  const now = new Date("2026-02-17T12:34:20.000Z");
  const next = nextCronOccurrenceUtc("35 12 * * *", now);
  assert.equal(next.toISOString(), "2026-02-17T12:35:00.000Z");
});

test("resolveScheduleTimeUtc enforces exactly one strategy", () => {
  assert.throws(
    () =>
      resolveScheduleTimeUtc({
        runAt: "2026-02-17T15:00:00.000Z",
        delaySeconds: 10
      }),
    /Exactly one of runAt, delaySeconds, or cron/
  );
});

test("planner_schedule_workflow enqueues a future workflow job", async () => {
  const calls: { run?: Record<string, unknown>; event?: Record<string, unknown>; job?: Record<string, unknown> } = {};
  const fakeStore = {
    async upsertRun(input: Record<string, unknown>) {
      calls.run = input;
    },
    async appendRunEvent(input: Record<string, unknown>) {
      calls.event = input;
    },
    async enqueueWorkflowJob(input: Record<string, unknown>) {
      calls.job = input;
      return {
        ...input,
        status: "queued",
        attemptCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }
  } as any;

  const tool = createPlannerScheduleWorkflowTool({
    store: fakeStore,
    defaults: {
      agentId: "agent_123",
      objectivePrompt: "Send daily status summary",
      threadId: "thread_abc"
    }
  });

  const result = await tool.execute({
    tenantId: "tenant_1",
    workspaceId: "workspace_1",
    workflowId: "wf_source",
    requestId: "req_source",
    stepNumber: 2,
    toolName: tool.name,
    args: {
      runAt: "2026-02-18T09:00:00.000Z"
    }
  });

  assert.equal((calls.job?.availableAt as string) ?? "", "2026-02-18T09:00:00.000Z");
  assert.equal((calls.job?.objectivePrompt as string) ?? "", "Send daily status summary");
  assert.equal((result as { ok: boolean }).ok, true);
});
