"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const agentRuntime_1 = require("./core/agentRuntime");
const memory_1 = require("./memory");
const objective_1 = require("./objectives/interview/objective");
async function main() {
    const memory = new memory_1.MemoryEngine();
    const runtime = new agentRuntime_1.AgentRuntime("agent", memory, {
        enabled: true,
        agentId: "agent-interview-mgr",
        agentName: "Interview Manager",
        owner: "talent@agent.ai",
        env: "prod",
        version: "0.4.9"
    });
    runtime.registerObjective(new objective_1.InterviewObjectivePlugin());
    memory.addPolicy({
        id: "pol-approval-before-reject",
        name: "Approval Before Rejection",
        objective: "interview-management",
        condition: (ctx) => ctx.tags.includes("rejection"),
        action: "Require recruiter approval before sending rejection communication."
    });
    memory.addMemory({
        id: "tpl-memory-next-steps",
        tier: "canonical",
        category: "template",
        content: "Use concise next-steps email with timeline and required actions.",
        summary: "Next-steps email template pattern for post-interview communication.",
        metadata: {
            workspace: "agent",
            objective: "interview-management",
            channel: "chat",
            tags: ["tech", "software engineer", "next-steps"],
            accountTier: "priority",
            language: "en"
        },
        approvedByHuman: true,
        useCount: 12,
        successCount: 10,
        effectiveFrom: new Date("2026-01-15T00:00:00.000Z"),
        createdAt: new Date("2026-01-15T00:00:00.000Z")
    });
    function envelope(type, threadId, payload) {
        return {
            eventId: (0, node_crypto_1.randomUUID)(),
            schemaVersion: "v1",
            objectiveId: "interview-management",
            type,
            threadId,
            occurredAt: new Date().toISOString(),
            payload
        };
    }
    const reg = await runtime.run({
        ...envelope("candidate.register", "candidate-thread", {
            name: "Ava Nguyen",
            role: "Software Engineer",
            email: "ava@example.com",
            priority: "priority",
            stage: "tech"
        })
    });
    const candidate = reg.result.output?.candidate;
    const sch = await runtime.run(envelope("interview.schedule", candidate.id, {
        candidateId: candidate.id,
        interviewer: "Sam Rivera",
        scheduledAt: "2026-02-20T18:00:00.000Z",
        durationMinutes: 60
    }));
    const interview = sch.result.output?.interview;
    const draft = await runtime.run(envelope("message.draft", candidate.id, {
        candidateId: candidate.id,
        templateTag: "schedule-confirmation",
        variables: {
            date_time: "February 20, 2026 10:00 AM PT"
        }
    }));
    const message = String(draft.result.output?.message ?? "");
    await runtime.run(envelope("interview.complete", candidate.id, {
        interviewId: interview.id,
        feedback: "Strong coding fundamentals, clear communication, mild concerns around distributed systems depth."
    }));
    memory.promoteRawToDistilled("interview-feedback");
    memory.applyDecayAndArchive(120, 1);
    const actions = await runtime.run(envelope("actions.suggest", candidate.id, {
        candidateId: candidate.id
    }));
    const nextActions = actions.result.output?.actions ?? [];
    const pack = actions.retrieved;
    console.log("=== Draft Message ===");
    console.log(message);
    console.log("\n=== Policy Reminder ===");
    console.log(pack.policies[0]?.action ?? "none");
    console.log("\n=== Retrieved Templates ===");
    for (const t of pack.items.filter((x) => x.category === "template")) {
        console.log(`- ${t.summary}`);
    }
    console.log("\n=== Retrieved Incidents ===");
    for (const i of pack.items.filter((x) => x.category === "incident")) {
        console.log(`- ${i.summary}`);
    }
    console.log("\n=== Working Memory (latest lines) ===");
    for (const line of memory.getWorkingMemory(candidate.id)?.lines.slice(-10) ?? []) {
        console.log(`- ${line}`);
    }
    console.log("\n=== Suggested Next Actions ===");
    for (const action of nextActions) {
        console.log(`- ${action}`);
    }
}
void main();
