"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReplayTrace = buildReplayTrace;
exports.replayTrace = replayTrace;
exports.diffReplaySnapshot = diffReplaySnapshot;
function buildReplayTrace(input) {
    assertReplayAccess({
        traceTenantId: input.workflowScope.tenantId,
        traceWorkspaceId: input.workflowScope.workspaceId,
        actorScope: input.actorScope
    });
    const workflow = input.persistence.getWorkflow(input.workflowScope);
    if (!workflow) {
        throw new Error(`Workflow not found for replay trace: ${input.workflowScope.workflowId}`);
    }
    const requests = input.persistence
        .listObjectiveRequests({
        tenantId: input.workflowScope.tenantId,
        workspaceId: input.workflowScope.workspaceId
    })
        .filter((request) => request.workflowId === input.workflowScope.workflowId)
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const selectedRequest = pickRequest(requests, input.requestId);
    const steps = input.persistence
        .listPlannerSteps(input.workflowScope)
        .sort((left, right) => left.stepNumber - right.stepNumber)
        .map((record) => ({
        step_number: record.stepNumber,
        step: clone(record.step),
        planner_intent: clone(record.plannerIntent),
        planner_input: clone(record.plannerInput),
        tool_result: clone(record.toolResult),
        created_at: record.createdAt
    }));
    return {
        schema_version: "replay-trace-v1",
        tenant_id: input.workflowScope.tenantId,
        workspace_id: input.workflowScope.workspaceId,
        workflow_id: input.workflowScope.workflowId,
        request: {
            request_id: selectedRequest.requestId,
            objective_prompt: selectedRequest.objective_prompt,
            occurred_at: selectedRequest.occurredAt
        },
        steps,
        completion: clone(workflow.completion),
        waiting_question: workflow.waitingQuestion
    };
}
function replayTrace(trace, input) {
    assertReplayAccess({
        traceTenantId: trace.tenant_id,
        traceWorkspaceId: trace.workspace_id,
        actorScope: input.actorScope
    });
    const orderedSteps = [...trace.steps].sort((left, right) => left.step_number - right.step_number);
    const steps = orderedSteps.map((item) => clone(item.step));
    const lastStep = steps.at(-1);
    const lastIntent = orderedSteps.at(-1)?.planner_intent;
    const waitingQuestion = lastStep?.status === "waiting_signal"
        ? lastIntent?.type === "ask_user"
            ? lastIntent.question
            : undefined
        : undefined;
    const completionFromTrace = trace.completion ?? deriveCompletionFromSteps(orderedSteps);
    return {
        workflowId: trace.workflow_id,
        tenantId: trace.tenant_id,
        workspaceId: trace.workspace_id,
        status: deriveWorkflowStatus(steps),
        steps,
        completion: completionFromTrace,
        waitingQuestion
    };
}
function diffReplaySnapshot(input) {
    const diffs = [];
    if (input.expected.steps.length !== input.actual.steps.length) {
        diffs.push({
            step_number: -1,
            path: "steps.length",
            expected: input.expected.steps.length,
            actual: input.actual.steps.length,
            message: "Replay drift at steps length"
        });
    }
    const stepCount = Math.min(input.expected.steps.length, input.actual.steps.length);
    for (let i = 0; i < stepCount; i += 1) {
        const expectedStep = input.expected.steps[i];
        const actualStep = input.actual.steps[i];
        pushDiff(diffs, i, "step.status", expectedStep.step.status, actualStep.step.status);
        pushDiff(diffs, i, "planner_intent.type", expectedStep.planner_intent.type, actualStep.planner_intent.type);
        if (expectedStep.planner_intent.type === "tool_call" && actualStep.planner_intent.type === "tool_call") {
            pushDiff(diffs, i, "planner_intent.toolName", expectedStep.planner_intent.toolName, actualStep.planner_intent.toolName);
        }
    }
    return {
        hasDrift: diffs.length > 0,
        diffs
    };
}
function pickRequest(requests, requestId) {
    if (requestId) {
        const selected = requests.find((request) => request.requestId === requestId);
        if (!selected) {
            throw new Error(`Objective request not found for replay trace: ${requestId}`);
        }
        return selected;
    }
    const first = requests.at(0);
    if (!first) {
        throw new Error("Objective request not found for replay trace");
    }
    return first;
}
function deriveWorkflowStatus(steps) {
    const lastStep = steps.at(-1);
    if (!lastStep) {
        return "running";
    }
    if (lastStep.status === "completed") {
        return "completed";
    }
    if (lastStep.status === "waiting_signal") {
        return "waiting_signal";
    }
    if (lastStep.status === "failed") {
        return "failed";
    }
    return "running";
}
function deriveCompletionFromSteps(steps) {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
        const intent = steps[i].planner_intent;
        if (intent.type === "complete") {
            return clone(intent.output ?? {});
        }
    }
    return undefined;
}
function pushDiff(diffs, stepNumber, field, expected, actual) {
    if (isEqual(expected, actual)) {
        return;
    }
    diffs.push({
        step_number: stepNumber,
        path: `steps[${stepNumber}].${field}`,
        expected,
        actual,
        message: `Replay drift at steps[${stepNumber}].${field}`
    });
}
function assertReplayAccess(input) {
    const isSameTenant = input.traceTenantId === input.actorScope.tenantId;
    const isSameWorkspace = input.traceWorkspaceId === input.actorScope.workspaceId;
    if ((isSameTenant && isSameWorkspace) || input.actorScope.allowCrossTenantRead === true) {
        return;
    }
    throw new Error("Replay access denied for tenant/workspace");
}
function clone(value) {
    if (value === undefined) {
        return value;
    }
    return structuredClone(value);
}
function isEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
