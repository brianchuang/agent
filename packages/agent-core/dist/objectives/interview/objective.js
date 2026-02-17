"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InterviewObjectivePlugin = void 0;
const validation_1 = require("./validation");
class InterviewObjectivePlugin {
    id = "interview-management";
    validator = new validation_1.InterviewEventValidator();
    candidates = new Map();
    interviews = new Map();
    templates = [
        {
            id: "tpl-schedule-confirmation",
            name: "Schedule Confirmation",
            tags: ["schedule-confirmation", "screen", "tech", "onsite"],
            approved: true,
            body: "Hi {{candidate_name}},\n\nYour {{stage}} interview for {{role}} is confirmed for {{date_time}}.\n\nBest,\nRecruiting Team"
        },
        {
            id: "tpl-next-steps",
            name: "Next Steps Update",
            tags: ["next-steps", "screen", "tech", "onsite", "offer"],
            approved: true,
            body: "Hi {{candidate_name}},\n\nThanks for interviewing for {{role}}. Next step: {{next_step}}.\n\nBest,\nRecruiting Team"
        }
    ];
    planRetrieval(event) {
        const payload = event.payload;
        const candidateId = payload.candidateId;
        if (!candidateId || !this.candidates.has(candidateId)) {
            return undefined;
        }
        const candidate = this.candidates.get(candidateId);
        const defaultQuery = event.type === "actions.suggest"
            ? `suggest actions for ${candidate.stage} interview`
            : `interview communication for ${candidate.role} ${candidate.stage}`;
        return {
            queryText: defaultQuery,
            channel: "chat",
            tags: [candidate.stage, candidate.role.toLowerCase()],
            accountTier: candidate.priority,
            language: "en",
            withinDays: 90,
            budget: {
                maxItems: 8,
                maxTokens: 1800,
                maxByCategory: {
                    template: 3,
                    incident: 4,
                    faq: 1
                }
            }
        };
    }
    handle(context) {
        switch (context.event.type) {
            case "candidate.register":
                return this.onCandidateRegister(context.event.payload);
            case "interview.schedule":
                return this.onInterviewSchedule(context.event.payload);
            case "interview.complete":
                return this.onInterviewComplete(context, context.event.payload);
            case "message.draft":
                return this.onMessageDraft(context.event.payload);
            case "actions.suggest":
                return this.onSuggestActions(context.event.payload);
            default:
                throw new Error(`Unsupported interview objective event: ${context.event.type}`);
        }
    }
    onCandidateRegister(payload) {
        const candidate = {
            id: `cand-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            name: payload.name,
            role: payload.role,
            email: payload.email,
            priority: payload.priority,
            stage: payload.stage
        };
        this.candidates.set(candidate.id, candidate);
        return {
            output: { candidate },
            workingMemoryLines: [`Registered candidate ${candidate.name} for ${candidate.role}.`]
        };
    }
    onInterviewSchedule(payload) {
        const candidate = this.candidates.get(payload.candidateId);
        if (!candidate)
            throw new Error(`Candidate not found: ${payload.candidateId}`);
        const interview = {
            id: `int-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            candidateId: payload.candidateId,
            interviewer: payload.interviewer,
            scheduledAt: new Date(payload.scheduledAt),
            durationMinutes: payload.durationMinutes,
            status: "scheduled"
        };
        this.interviews.set(interview.id, interview);
        return {
            output: { interview },
            workingMemoryLines: [
                `Scheduled ${candidate.stage} interview with ${interview.interviewer} on ${interview.scheduledAt.toISOString()}.`
            ]
        };
    }
    onInterviewComplete(context, payload) {
        const interview = this.interviews.get(payload.interviewId);
        if (!interview)
            throw new Error(`Interview not found: ${payload.interviewId}`);
        interview.status = "completed";
        interview.feedback = payload.feedback;
        const candidate = this.candidates.get(interview.candidateId);
        if (!candidate)
            throw new Error(`Candidate not found: ${interview.candidateId}`);
        const memory = {
            id: `mem-${interview.id}`,
            tier: "raw",
            category: "incident",
            content: payload.feedback,
            summary: `Interview feedback for ${candidate.role}: ${payload.feedback.slice(0, 100)}`,
            metadata: {
                workspace: context.workspace,
                objective: context.objectiveId,
                channel: "chat",
                tags: ["interview-feedback", candidate.stage, candidate.role.toLowerCase()],
                accountTier: candidate.priority,
                language: "en"
            },
            approvedByHuman: false,
            useCount: 0,
            successCount: 0,
            effectiveFrom: new Date(),
            createdAt: new Date()
        };
        return {
            output: { interviewId: interview.id, status: interview.status },
            memoryWrites: [memory],
            workingMemoryLines: [`Interview ${interview.id} completed. Feedback recorded.`]
        };
    }
    onMessageDraft(payload) {
        const candidate = this.candidates.get(payload.candidateId);
        if (!candidate)
            throw new Error(`Candidate not found: ${payload.candidateId}`);
        const template = this.templates.find((x) => x.approved && x.tags.includes(payload.templateTag));
        if (!template)
            throw new Error(`No approved template for tag: ${payload.templateTag}`);
        let message = template.body;
        const variables = {
            candidate_name: candidate.name,
            role: candidate.role,
            stage: candidate.stage,
            ...payload.variables
        };
        for (const [k, v] of Object.entries(variables)) {
            message = message.replaceAll(`{{${k}}}`, v);
        }
        return {
            output: { message },
            workingMemoryLines: [`Drafted ${template.name} message for ${candidate.name}.`]
        };
    }
    onSuggestActions(payload) {
        const candidate = this.candidates.get(payload.candidateId);
        if (!candidate)
            throw new Error(`Candidate not found: ${payload.candidateId}`);
        const candidateInterviews = Array.from(this.interviews.values())
            .filter((x) => x.candidateId === payload.candidateId)
            .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
        const actions = [];
        if (candidateInterviews.length === 0) {
            actions.push("Schedule a screening interview.");
            return { output: { actions } };
        }
        const latest = candidateInterviews[candidateInterviews.length - 1];
        if (latest.status === "scheduled") {
            actions.push(`Send reminder for interview on ${latest.scheduledAt.toISOString()}.`);
        }
        if (latest.status === "completed") {
            if (candidate.stage === "screen")
                actions.push("Decide whether to advance to technical interview.");
            if (candidate.stage === "tech")
                actions.push("Collect panel feedback and decide onsite progression.");
            if (candidate.stage === "onsite")
                actions.push("Prepare hiring decision package.");
            if (candidate.stage === "offer")
                actions.push("Draft offer communication and compensation summary.");
        }
        return { output: { actions } };
    }
}
exports.InterviewObjectivePlugin = InterviewObjectivePlugin;
