const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { PayloadValidationError } = require("../dist/core/validation");
const { MemoryEngine } = require("../dist/memory");
const { InterviewObjectivePlugin } = require("../dist/objectives/interview/objective");

function buildRuntimeWithInterview() {
  const memory = new MemoryEngine();
  const runtime = new AgentRuntime("agent", memory);
  runtime.registerObjective(new InterviewObjectivePlugin());
  return { runtime, memory };
}

function envelope(type, payload, threadId = "thread-1") {
  return {
    eventId: "11111111-1111-7111-8111-111111111111",
    schemaVersion: "v1",
    objectiveId: "interview-management",
    type,
    threadId,
    occurredAt: "2026-02-17T00:00:00.000Z",
    payload
  };
}

test("ISSUE-002: missing required fields returns deterministic validation error", async () => {
  const { runtime } = buildRuntimeWithInterview();

  await assert.rejects(
    async () =>
      runtime.run(
        envelope("candidate.register", {
          name: "Ava Nguyen",
          role: "Software Engineer",
          priority: "priority",
          stage: "tech"
        })
      ),
    (err) =>
      err instanceof PayloadValidationError &&
      err.code === "PAYLOAD_VALIDATION_FAILED" &&
      err.objectiveId === "interview-management" &&
      err.eventType === "candidate.register" &&
      Array.isArray(err.details) &&
      err.details.some((d) => d.field === "email" && d.message === "is required")
  );
});

test("ISSUE-002: wrong field types are reported with field-level details", async () => {
  const { runtime } = buildRuntimeWithInterview();

  await assert.rejects(
    async () =>
      runtime.run(
        envelope("candidate.register", {
          name: "Ava Nguyen",
          role: "Software Engineer",
          email: "ava@example.com",
          priority: "vip",
          stage: 42
        })
      ),
    (err) =>
      err instanceof PayloadValidationError &&
      err.details.some((d) => d.field === "priority" && d.expected === "standard|priority") &&
      err.details.some((d) => d.field === "stage" && d.expected === "string")
  );
});

test("ISSUE-002: invalid datetime values are rejected for interview.schedule", async () => {
  const { runtime } = buildRuntimeWithInterview();

  await assert.rejects(
    async () =>
      runtime.run(
        envelope("interview.schedule", {
          candidateId: "cand-1",
          interviewer: "Sam Rivera",
          scheduledAt: "not-a-date",
          durationMinutes: 60
        })
      ),
    (err) =>
      err instanceof PayloadValidationError &&
      err.details.some((d) => d.field === "scheduledAt" && d.message === "must be ISO datetime")
  );
});

test("ISSUE-002: validation failures happen before any objective/memory side effects", async () => {
  const memory = new MemoryEngine();
  let planned = 0;
  let handled = 0;
  const runtime = new AgentRuntime("agent", memory);
  runtime.registerObjective({
    id: "test-objective",
    validator: {
      validate: () => [{ field: "payload", message: "invalid" }]
    },
    planRetrieval: () => {
      planned += 1;
      return undefined;
    },
    handle: () => {
      handled += 1;
      return {};
    }
  });

  await assert.rejects(
    async () =>
      runtime.run({
        eventId: "11111111-1111-7111-8111-111111111111",
        schemaVersion: "v1",
        objectiveId: "test-objective",
        type: "anything",
        threadId: "thread-side-effects",
        occurredAt: "2026-02-17T00:00:00.000Z",
        payload: {}
      }),
    (err) => err instanceof PayloadValidationError
  );

  assert.equal(planned, 0);
  assert.equal(handled, 0);
  assert.equal(memory.getWorkingMemory("thread-side-effects"), undefined);
});
