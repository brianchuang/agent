import { ObjectiveRequestV1, PolicyOutcome, PlannerInputV1, PlannerIntent, StepMetadata, WorkflowStatus, WorkflowSignalV1 } from "../contracts";
export interface TenantScope {
    tenantId: string;
    workspaceId: string;
}
export interface WorkflowScope extends TenantScope {
    workflowId: string;
}
export type ApprovalDecisionStatus = "pending" | "approved" | "rejected";
export interface PendingApprovalState {
    approvalId: string;
    requestId: string;
    stepNumber: number;
    intent: PlannerIntent;
    riskClass: string;
    reasonCode: string;
    requestedAt: string;
    status: ApprovalDecisionStatus;
    approverId?: string;
    resolvedAt?: string;
    signalId?: string;
}
export interface PersistedWorkflow {
    workflowId: string;
    tenantId: string;
    workspaceId: string;
    threadId: string;
    status: WorkflowStatus;
    steps: StepMetadata[];
    waitingQuestion?: string;
    completion?: Record<string, unknown>;
    pendingApproval?: PendingApprovalState;
}
export interface PlannerStepRecord extends WorkflowScope {
    stepNumber: number;
    step: StepMetadata;
    plannerInput: PlannerInputV1;
    plannerIntent: PlannerIntent;
    toolResult?: unknown;
    createdAt: string;
}
export type SignalStatus = "received" | "acknowledged";
export interface WorkflowSignalRecord extends WorkflowScope {
    signalId: string;
    type: WorkflowSignalV1["type"];
    payload: unknown;
    occurredAt: string;
    signalStatus: SignalStatus;
    acknowledgedAt?: string;
}
export interface PolicyDecisionRecord extends WorkflowScope {
    decisionId: string;
    requestId: string;
    stepNumber: number;
    policyId: string;
    policyPackId: string;
    policyPackVersion: string;
    outcome: PolicyOutcome;
    reasonCode: string;
    originalIntent: PlannerIntent;
    rewrittenIntent?: PlannerIntent;
    evaluatedAt: string;
    correlationSignalId?: string;
}
export interface ApprovalDecisionRecord extends WorkflowScope {
    approvalId: string;
    requestId: string;
    stepNumber: number;
    status: ApprovalDecisionStatus;
    riskClass: string;
    reasonCode: string;
    intent: PlannerIntent;
    requestedAt: string;
    approverId?: string;
    resolvedAt?: string;
    signalId?: string;
}
export type AuditEventType = "policy_allow" | "policy_rewrite" | "policy_block" | "approval_pending" | "approval_approved" | "approval_rejected" | "workflow_terminal_completed" | "workflow_terminal_failed";
export interface AuditRecord extends WorkflowScope {
    auditId: string;
    requestId: string;
    stepNumber: number;
    eventType: AuditEventType;
    occurredAt: string;
    signalCorrelationId: string | null;
    detail?: Record<string, unknown>;
}
export interface AuditQuery extends TenantScope {
    workflowId?: string;
    requestId?: string;
}
interface WaitingWorkflowCheckpoint extends WorkflowScope {
}
export interface AgentPersistenceTransaction {
    recordObjectiveRequest(request: ObjectiveRequestV1): void;
    getWorkflow(scope: WorkflowScope): PersistedWorkflow | undefined;
    getOrCreateWorkflow(input: WorkflowScope & {
        threadId: string;
    }): PersistedWorkflow;
    saveWorkflow(workflow: PersistedWorkflow): void;
    appendPlannerStep(record: PlannerStepRecord): void;
    putWaitingCheckpoint(scope: WorkflowScope): void;
    consumeWaitingCheckpoint(scope: WorkflowScope): WaitingWorkflowCheckpoint | undefined;
    recordSignal(signal: WorkflowSignalV1): void;
    acknowledgeSignal(scope: WorkflowScope & {
        signalId: string;
        acknowledgedAt: string;
    }): void;
    recordPolicyDecision(record: PolicyDecisionRecord): void;
    recordApprovalDecision(record: ApprovalDecisionRecord): void;
    appendAuditRecord(record: AuditRecord): void;
    resolveApprovalDecision(scope: WorkflowScope & {
        approvalId: string;
        status: Extract<ApprovalDecisionStatus, "approved" | "rejected">;
        approverId: string;
        resolvedAt: string;
        signalId: string;
    }): ApprovalDecisionRecord | undefined;
}
export interface AgentPersistencePort {
    withTransaction<T>(work: (tx: AgentPersistenceTransaction) => Promise<T> | T): Promise<T>;
    getWorkflow(scope: WorkflowScope): PersistedWorkflow | undefined;
    findWorkflowById(workflowId: string): PersistedWorkflow | undefined;
    listPlannerSteps(scope: WorkflowScope): PlannerStepRecord[];
    listObjectiveRequests(scope: TenantScope): ObjectiveRequestV1[];
    listSignals(scope: WorkflowScope): WorkflowSignalRecord[];
    listPolicyDecisions(scope: WorkflowScope): PolicyDecisionRecord[];
    listApprovalDecisions(scope: WorkflowScope): ApprovalDecisionRecord[];
    listAuditRecords(query: AuditQuery): AuditRecord[];
}
export declare class InMemoryAgentPersistence implements AgentPersistencePort {
    private state;
    private transactionQueue;
    private activeTransactionState;
    withTransaction<T>(work: (tx: AgentPersistenceTransaction) => Promise<T> | T): Promise<T>;
    getWorkflow(scope: WorkflowScope): PersistedWorkflow | undefined;
    findWorkflowById(workflowId: string): PersistedWorkflow | undefined;
    listPlannerSteps(scope: WorkflowScope): PlannerStepRecord[];
    listObjectiveRequests(scope: TenantScope): ObjectiveRequestV1[];
    listSignals(scope: WorkflowScope): WorkflowSignalRecord[];
    listPolicyDecisions(scope: WorkflowScope): PolicyDecisionRecord[];
    listApprovalDecisions(scope: WorkflowScope): ApprovalDecisionRecord[];
    listAuditRecords(query: AuditQuery): AuditRecord[];
}
export {};
