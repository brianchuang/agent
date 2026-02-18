export interface EventEnvelopeV1 {
    eventId: string;
    schemaVersion: "v1";
    objectiveId: string;
    type: string;
    threadId: string;
    occurredAt: string;
    payload: unknown;
}
export interface ObjectiveRequestV1 {
    requestId: string;
    schemaVersion: "v1";
    tenantId: string;
    workspaceId: string;
    workflowId: string;
    threadId: string;
    occurredAt: string;
    objective_prompt: string;
}
export interface ToolCallIntent {
    type: "tool_call";
    toolName: string;
    args: Record<string, unknown>;
}
export interface AskUserIntent {
    type: "ask_user";
    question: string;
}
export interface CompleteIntent {
    type: "complete";
    output?: Record<string, unknown>;
}
export type PlannerIntent = ToolCallIntent | AskUserIntent | CompleteIntent;
export type SignalType = "approval_signal" | "external_event_signal" | "timer_signal" | "user_input_signal";
export interface WorkflowSignalV1 {
    signalId: string;
    schemaVersion: "v1";
    tenantId: string;
    workspaceId: string;
    workflowId: string;
    type: SignalType;
    occurredAt: string;
    payload: unknown;
}
export type StepStatus = "tool_executed" | "waiting_signal" | "completed" | "failed";
export interface StepMetadata {
    workflowId: string;
    tenantId: string;
    workspaceId: string;
    threadId: string;
    intentType: PlannerIntent["type"];
    status: StepStatus;
}
export interface PlannerStepResult {
    step: StepMetadata;
    toolResult?: unknown;
    completion?: Record<string, unknown>;
}
export type WorkflowStatus = "running" | "waiting_signal" | "completed" | "failed";
export interface PlannerLoopContext {
    objective_prompt: string;
    stepIndex: number;
    priorSteps: StepMetadata[];
}
export interface PlannerInputV1 {
    contract_version: "planner-input-v1";
    objective_prompt: string;
    memory_context: Record<string, unknown>;
    prior_step_summaries: StepMetadata[];
    policy_constraints: string[];
    available_tools: ToolMetadata[];
    step_index: number;
    stepIndex?: number;
    tenant_id: string;
    workspace_id: string;
    workflow_id: string;
    thread_id: string;
    priorSteps?: StepMetadata[];
}
export interface ToolTenantScope {
    tenantId: string;
    workspaceId: string;
}
export interface ToolMetadata {
    name: string;
    description?: string;
}
export interface ToolExecutionInput {
    tenantId: string;
    workspaceId: string;
    workflowId: string;
    requestId?: string;
    stepNumber?: number;
    toolName: string;
    args: Record<string, unknown>;
}
export interface ToolRegistryPort {
    listTools: (scope: ToolTenantScope) => ToolMetadata[];
    execute: (input: ToolExecutionInput) => unknown | Promise<unknown>;
}
export interface PlannerContextProvider {
    memory?: (input: {
        request: ObjectiveRequestV1;
        stepIndex: number;
    }) => Record<string, unknown>;
    policyConstraints?: (input: {
        request: ObjectiveRequestV1;
        stepIndex: number;
    }) => string[];
}
export interface PlannerStageInput {
    request: ObjectiveRequestV1;
    stepIndex: number;
    priorSteps: StepMetadata[];
    toolRegistry?: ToolRegistryPort;
    contextProvider?: PlannerContextProvider;
}
export interface PlannerExecuteStageInput {
    request: ObjectiveRequestV1;
    stepIndex?: number;
    intent: PlannerIntent;
    executeTool?: (input: ToolExecutionInput) => unknown | Promise<unknown>;
    toolRegistry?: ToolRegistryPort;
}
export interface PolicyPackReference {
    policyPackId: string;
    policyPackVersion: string;
}
export interface PolicyEvaluationInput {
    request: ObjectiveRequestV1;
    stepIndex: number;
    intent: PlannerIntent;
    plannerInput: PlannerInputV1;
    policyPack: PolicyPackReference;
}
export type PolicyOutcome = "allow" | "block" | "rewrite";
export interface PolicyEvaluationResult {
    policyId: string;
    outcome: PolicyOutcome;
    reasonCode: string;
    rewrittenIntent?: PlannerIntent;
}
export interface PolicyEnginePort {
    evaluate: (input: PolicyEvaluationInput) => PolicyEvaluationResult | Promise<PolicyEvaluationResult>;
}
export interface PolicyPackResolverInput {
    request: ObjectiveRequestV1;
    stepIndex: number;
}
export type PolicyPackResolver = (input: PolicyPackResolverInput) => PolicyPackReference | Promise<PolicyPackReference>;
export interface PlannerPolicyStageInput {
    request: ObjectiveRequestV1;
    stepIndex: number;
    intent: PlannerIntent;
    plannerInput: PlannerInputV1;
    policyEngine?: PolicyEnginePort;
    policyPackResolver?: PolicyPackResolver;
}
export interface PlannerPolicyStageResult extends PolicyEvaluationResult {
    policyPack: PolicyPackReference;
}
export interface ApprovalRequirement {
    riskClass: string;
    requiresApproval: boolean;
    reasonCode: string;
}
export interface ApprovalPolicyInput {
    request: ObjectiveRequestV1;
    stepIndex: number;
    intent: PlannerIntent;
    plannerInput: PlannerInputV1;
}
export interface ApprovalPolicyPort {
    classify: (input: ApprovalPolicyInput) => ApprovalRequirement | Promise<ApprovalRequirement>;
}
export interface PlannerApprovalStageInput extends ApprovalPolicyInput {
    approvalPolicy?: ApprovalPolicyPort;
}
export interface PlannerLoopStages {
    buildPlanningContext: (input: PlannerStageInput) => PlannerInputV1 | Promise<PlannerInputV1>;
    plan: (input: PlannerInputV1, deps: PlannerLoopDeps) => PlannerIntent | Promise<PlannerIntent>;
    validateIntent: (intent: PlannerIntent) => void | Promise<void>;
    evaluatePolicy: (input: PlannerPolicyStageInput) => PlannerPolicyStageResult | Promise<PlannerPolicyStageResult>;
    evaluateApproval: (input: PlannerApprovalStageInput) => ApprovalRequirement | Promise<ApprovalRequirement>;
    executeIntent: (input: PlannerExecuteStageInput) => PlannerStepResult | Promise<PlannerStepResult>;
}
export interface PlannerLoopDeps {
    planner?: ((context: PlannerLoopContext) => PlannerIntent | Promise<PlannerIntent>) | ((context: PlannerInputV1) => PlannerIntent | Promise<PlannerIntent>);
    executeTool?: (input: ToolExecutionInput) => unknown | Promise<unknown>;
    toolRegistry?: ToolRegistryPort;
    contextProvider?: PlannerContextProvider;
    policyEngine?: PolicyEnginePort;
    policyPackResolver?: PolicyPackResolver;
    approvalPolicy?: ApprovalPolicyPort;
    stages?: Partial<PlannerLoopStages>;
    maxSteps?: number;
}
export interface PlannerLoopResult {
    workflowId: string;
    status: WorkflowStatus;
    steps: StepMetadata[];
    waitingQuestion?: string;
    completion?: Record<string, unknown>;
}
