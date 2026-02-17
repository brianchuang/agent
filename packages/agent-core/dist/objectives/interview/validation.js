"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InterviewEventValidator = void 0;
const CANDIDATE_STAGES = new Set(["screen", "tech", "onsite", "offer"]);
const PRIORITIES = new Set(["standard", "priority"]);
function asRecord(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return undefined;
    }
    return payload;
}
function requiredString(record, field, issues) {
    const value = record[field];
    if (value === undefined) {
        issues.push({ field, message: "is required" });
        return undefined;
    }
    if (typeof value !== "string" || value.length === 0) {
        issues.push({ field, message: "must be a non-empty string", expected: "string" });
        return undefined;
    }
    return value;
}
function requiredNumber(record, field, issues) {
    const value = record[field];
    if (value === undefined) {
        issues.push({ field, message: "is required" });
        return undefined;
    }
    if (typeof value !== "number" || Number.isNaN(value)) {
        issues.push({ field, message: "must be a number", expected: "number" });
        return undefined;
    }
    return value;
}
function mustBeOneOf(field, value, allowed, expected, issues) {
    if (value === undefined)
        return;
    if (!allowed.has(value)) {
        issues.push({ field, message: "must be one of allowed values", expected });
    }
}
function mustBeIsoDatetime(field, value, issues) {
    if (value === undefined)
        return;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
        issues.push({ field, message: "must be ISO datetime", expected: "ISO datetime" });
    }
}
class InterviewEventValidator {
    validate(eventType, payload) {
        const issues = [];
        const record = asRecord(payload);
        if (!record) {
            return [{ field: "payload", message: "must be an object", expected: "object" }];
        }
        switch (eventType) {
            case "candidate.register": {
                requiredString(record, "name", issues);
                requiredString(record, "role", issues);
                requiredString(record, "email", issues);
                const priority = requiredString(record, "priority", issues);
                const stage = requiredString(record, "stage", issues);
                mustBeOneOf("priority", priority, PRIORITIES, "standard|priority", issues);
                mustBeOneOf("stage", stage, CANDIDATE_STAGES, "screen|tech|onsite|offer", issues);
                return issues;
            }
            case "interview.schedule": {
                requiredString(record, "candidateId", issues);
                requiredString(record, "interviewer", issues);
                const scheduledAt = requiredString(record, "scheduledAt", issues);
                mustBeIsoDatetime("scheduledAt", scheduledAt, issues);
                const duration = requiredNumber(record, "durationMinutes", issues);
                if (duration !== undefined && duration <= 0) {
                    issues.push({
                        field: "durationMinutes",
                        message: "must be greater than 0",
                        expected: "positive number"
                    });
                }
                return issues;
            }
            case "interview.complete": {
                requiredString(record, "interviewId", issues);
                requiredString(record, "feedback", issues);
                return issues;
            }
            case "message.draft": {
                requiredString(record, "candidateId", issues);
                requiredString(record, "templateTag", issues);
                const variables = record.variables;
                if (variables === undefined) {
                    issues.push({ field: "variables", message: "is required" });
                }
                else if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
                    issues.push({ field: "variables", message: "must be an object", expected: "object" });
                }
                return issues;
            }
            case "actions.suggest": {
                requiredString(record, "candidateId", issues);
                return issues;
            }
            default:
                return [{ field: "type", message: "unsupported event type" }];
        }
    }
}
exports.InterviewEventValidator = InterviewEventValidator;
