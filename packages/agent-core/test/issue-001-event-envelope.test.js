const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime, EnvelopeValidationError } = require("../dist/core/agentRuntime");
const { MemoryEngine } = require("../dist/memory");
const { InterviewObjectivePlugin } = require("../dist/objectives/interview/objective");

function buildRuntime() {
  const memory = new MemoryEngine();
  const runtime = new AgentRuntime("agent", memory);
  runtime.registerObjective(new InterviewObjectivePlugin());
  return runtime;
}

function candidateRegisterPayload() {
  return {
    name: "Ava Nguyen",
    role: "Software Engineer",
    email: "ava@example.com",
    priority: "priority",
    stage: "tech"
  };
}

test("ISSUE-001: runtime rejects envelope without schemaVersion", async () => {
  const runtime = buildRuntime();

  await assert.rejects(
    async () =>
      runtime.run({
        eventId: "11111111-1111-7111-8111-111111111111",
        objectiveId: "interview-management",
        type: "candidate.register",
        threadId: "thread-1",
        occurredAt: "2026-02-17T00:00:00.000Z",
        payload: candidateRegisterPayload()
      }),
    (err) => err instanceof EnvelopeValidationError && err.message === "Missing required field: schemaVersion"
  );
});

test("ISSUE-001: runtime rejects unsupported envelope schema versions", async () => {
  const runtime = buildRuntime();

  await assert.rejects(
    async () =>
      runtime.run({
        eventId: "11111111-1111-7111-8111-111111111111",
        schemaVersion: "v2",
        objectiveId: "interview-management",
        type: "candidate.register",
        threadId: "thread-1",
        occurredAt: "2026-02-17T00:00:00.000Z",
        payload: candidateRegisterPayload()
      }),
    (err) => err instanceof EnvelopeValidationError && err.message === "Unsupported schemaVersion: v2"
  );
});

test("ISSUE-001: runtime accepts valid v1 envelope", async () => {
  const runtime = buildRuntime();

  const result = await runtime.run({
    eventId: "11111111-1111-7111-8111-111111111111",
    schemaVersion: "v1",
    objectiveId: "interview-management",
    type: "candidate.register",
    threadId: "thread-1",
    occurredAt: "2026-02-17T00:00:00.000Z",
    payload: candidateRegisterPayload()
  });

  assert.equal(result.objectiveId, "interview-management");
  assert.equal(result.eventType, "candidate.register");
});

test("ISSUE-001: runtime rejects removed legacy request shape", async () => {
  const runtime = buildRuntime();

  await assert.rejects(
    async () =>
      runtime.run({
        objectiveId: "interview-management",
        event: {
          type: "candidate.register",
          threadId: "thread-legacy",
          payload: candidateRegisterPayload()
        }
      }),
    (err) => err instanceof EnvelopeValidationError && err.message === "Missing required field: schemaVersion"
  );
});
