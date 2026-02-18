import { PlannerIntent, StepMetadata, WorkflowStatus } from "./contracts";
import { AgentPersistencePort, PlannerStepRecord, TenantScope, WorkflowScope } from "./persistence/repositories";
export interface ReplayTraceStep {
    step_number: number;
    step: StepMetadata;
    planner_intent: PlannerIntent;
    planner_input: PlannerStepRecord["plannerInput"];
    tool_result?: unknown;
    created_at: string;
}
export interface ReplayTraceV1 {
    schema_version: "replay-trace-v1";
    tenant_id: string;
    workspace_id: string;
    workflow_id: string;
    request: {
        request_id: string;
        objective_prompt: string;
        occurred_at: string;
    };
    steps: ReplayTraceStep[];
    completion?: Record<string, unknown>;
    waiting_question?: string;
}
export interface ReplayAccessScope extends TenantScope {
    allowCrossTenantRead?: boolean;
}
export interface ReplayBuildInput {
    persistence: AgentPersistencePort;
    workflowScope: WorkflowScope;
    actorScope: ReplayAccessScope;
    requestId?: string;
}
export interface ReplayResult {
    workflowId: string;
    tenantId: string;
    workspaceId: string;
    status: WorkflowStatus;
    steps: StepMetadata[];
    completion?: Record<string, unknown>;
    waitingQuestion?: string;
}
export interface ReplayDiffItem {
    step_number: number;
    path: string;
    expected: unknown;
    actual: unknown;
    message: string;
}
export interface ReplayDiffResult {
    hasDrift: boolean;
    diffs: ReplayDiffItem[];
}
export declare function buildReplayTrace(input: ReplayBuildInput): ReplayTraceV1;
export declare function replayTrace(trace: ReplayTraceV1, input: {
    actorScope: ReplayAccessScope;
}): ReplayResult;
export declare function diffReplaySnapshot(input: {
    expected: ReplayTraceV1;
    actual: ReplayTraceV1;
}): ReplayDiffResult;
