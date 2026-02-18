import {
  ObjectiveRequestV1,
  PolicyOutcome,
  PlannerInputV1,
  PlannerIntent,
  StepMetadata,
  WorkflowStatus,
  WorkflowSignalV1
} from "../contracts";

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

export type AuditEventType =
  | "policy_allow"
  | "policy_rewrite"
  | "policy_block"
  | "approval_pending"
  | "approval_approved"
  | "approval_rejected"
  | "workflow_terminal_completed"
  | "workflow_terminal_failed";

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

interface WaitingWorkflowCheckpoint extends WorkflowScope {}

interface PersistenceState {
  objectiveRequests: Map<string, ObjectiveRequestV1>;
  workflows: Map<string, PersistedWorkflow>;
  plannerSteps: Map<string, PlannerStepRecord[]>;
  waitingCheckpoints: Map<string, WaitingWorkflowCheckpoint>;
  signals: Map<string, WorkflowSignalRecord>;
  policyDecisions: Map<string, PolicyDecisionRecord[]>;
  approvalDecisions: Map<string, ApprovalDecisionRecord[]>;
  auditRecords: Map<string, AuditRecord[]>;
}

export interface InMemoryPersistenceSnapshot {
  objectiveRequests: ObjectiveRequestV1[];
  workflows: PersistedWorkflow[];
  plannerSteps: Array<{ workflowKey: string; records: PlannerStepRecord[] }>;
  waitingCheckpoints: WaitingWorkflowCheckpoint[];
  signals: WorkflowSignalRecord[];
  policyDecisions: Array<{ workflowKey: string; records: PolicyDecisionRecord[] }>;
  approvalDecisions: Array<{ workflowKey: string; records: ApprovalDecisionRecord[] }>;
  auditRecords: Array<{ workflowKey: string; records: AuditRecord[] }>;
}

export interface AgentPersistenceTransaction {
  recordObjectiveRequest(request: ObjectiveRequestV1): void;
  getWorkflow(scope: WorkflowScope): PersistedWorkflow | undefined;
  getOrCreateWorkflow(input: WorkflowScope & { threadId: string }): PersistedWorkflow;
  saveWorkflow(workflow: PersistedWorkflow): void;
  appendPlannerStep(record: PlannerStepRecord): void;
  putWaitingCheckpoint(scope: WorkflowScope): void;
  consumeWaitingCheckpoint(scope: WorkflowScope): WaitingWorkflowCheckpoint | undefined;
  recordSignal(signal: WorkflowSignalV1): void;
  acknowledgeSignal(scope: WorkflowScope & { signalId: string; acknowledgedAt: string }): void;
  recordPolicyDecision(record: PolicyDecisionRecord): void;
  recordApprovalDecision(record: ApprovalDecisionRecord): void;
  appendAuditRecord(record: AuditRecord): void;
  resolveApprovalDecision(
    scope: WorkflowScope & {
      approvalId: string;
      status: Extract<ApprovalDecisionStatus, "approved" | "rejected">;
      approverId: string;
      resolvedAt: string;
      signalId: string;
    }
  ): ApprovalDecisionRecord | undefined;
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

class InMemoryAgentPersistenceTransaction implements AgentPersistenceTransaction {
  constructor(private readonly state: PersistenceState) {}

  recordObjectiveRequest(request: ObjectiveRequestV1): void {
    this.state.objectiveRequests.set(
      requestKey({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        requestId: request.requestId
      }),
      clone(request)
    );
  }

  getWorkflow(scope: WorkflowScope): PersistedWorkflow | undefined {
    const workflow = this.state.workflows.get(workflowKey(scope));
    return workflow ? clone(workflow) : undefined;
  }

  getOrCreateWorkflow(input: WorkflowScope & { threadId: string }): PersistedWorkflow {
    const key = workflowKey(input);
    const existing = this.state.workflows.get(key);
    if (existing) {
      return clone(existing);
    }

    const created: PersistedWorkflow = {
      workflowId: input.workflowId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      status: "running",
      steps: []
    };
    this.state.workflows.set(key, created);
    return clone(created);
  }

  saveWorkflow(workflow: PersistedWorkflow): void {
    this.state.workflows.set(workflowKey(workflow), clone(workflow));
  }

  appendPlannerStep(record: PlannerStepRecord): void {
    const key = workflowKey(record);
    const existing = this.state.plannerSteps.get(key) ?? [];
    existing.push(clone(record));
    this.state.plannerSteps.set(key, existing);
  }

  putWaitingCheckpoint(scope: WorkflowScope): void {
    this.state.waitingCheckpoints.set(workflowKey(scope), clone(scope));
  }

  consumeWaitingCheckpoint(scope: WorkflowScope): WaitingWorkflowCheckpoint | undefined {
    const key = workflowKey(scope);
    const checkpoint = this.state.waitingCheckpoints.get(key);
    if (!checkpoint) {
      return undefined;
    }
    this.state.waitingCheckpoints.delete(key);
    return clone(checkpoint);
  }

  recordSignal(signal: WorkflowSignalV1): void {
    const signalRecord: WorkflowSignalRecord = {
      signalId: signal.signalId,
      tenantId: signal.tenantId,
      workspaceId: signal.workspaceId,
      workflowId: signal.workflowId,
      type: signal.type,
      payload: signal.payload,
      occurredAt: signal.occurredAt,
      signalStatus: "received"
    };
    this.state.signals.set(signalKey(signalRecord), clone(signalRecord));
  }

  acknowledgeSignal(scope: WorkflowScope & { signalId: string; acknowledgedAt: string }): void {
    const key = signalKey(scope);
    const signal = this.state.signals.get(key);
    if (!signal) {
      return;
    }

    this.state.signals.set(
      key,
      clone({
        ...signal,
        signalStatus: "acknowledged",
        acknowledgedAt: scope.acknowledgedAt
      })
    );
  }

  recordPolicyDecision(record: PolicyDecisionRecord): void {
    const key = workflowKey(record);
    const existing = this.state.policyDecisions.get(key) ?? [];
    existing.push(clone(record));
    this.state.policyDecisions.set(key, existing);
  }

  recordApprovalDecision(record: ApprovalDecisionRecord): void {
    const key = workflowKey(record);
    const existing = this.state.approvalDecisions.get(key) ?? [];
    existing.push(clone(record));
    this.state.approvalDecisions.set(key, existing);
  }

  appendAuditRecord(record: AuditRecord): void {
    const key = workflowKey(record);
    const existing = this.state.auditRecords.get(key) ?? [];
    existing.push(clone(record));
    this.state.auditRecords.set(key, existing);
  }

  resolveApprovalDecision(
    scope: WorkflowScope & {
      approvalId: string;
      status: Extract<ApprovalDecisionStatus, "approved" | "rejected">;
      approverId: string;
      resolvedAt: string;
      signalId: string;
    }
  ): ApprovalDecisionRecord | undefined {
    const key = workflowKey(scope);
    const existing = this.state.approvalDecisions.get(key) ?? [];
    const index = existing.findIndex((record) => record.approvalId === scope.approvalId);
    if (index < 0) {
      return undefined;
    }

    const updated: ApprovalDecisionRecord = {
      ...existing[index],
      status: scope.status,
      approverId: scope.approverId,
      resolvedAt: scope.resolvedAt,
      signalId: scope.signalId
    };
    existing[index] = clone(updated);
    this.state.approvalDecisions.set(key, existing);
    return updated;
  }
}

export class InMemoryAgentPersistence implements AgentPersistencePort {
  private state: PersistenceState = {
    objectiveRequests: new Map(),
    workflows: new Map(),
    plannerSteps: new Map(),
    waitingCheckpoints: new Map(),
    signals: new Map(),
    policyDecisions: new Map(),
    approvalDecisions: new Map(),
    auditRecords: new Map()
  };
  private transactionQueue: Promise<void> = Promise.resolve();
  private activeTransactionState: PersistenceState | null = null;

  async withTransaction<T>(work: (tx: AgentPersistenceTransaction) => Promise<T> | T): Promise<T> {
    if (this.activeTransactionState) {
      const nestedTx = new InMemoryAgentPersistenceTransaction(this.activeTransactionState);
      return await work(nestedTx);
    }

    const execute = async (): Promise<T> => {
      const nextState = cloneState(this.state);
      const tx = new InMemoryAgentPersistenceTransaction(nextState);
      this.activeTransactionState = nextState;
      try {
        const result = await work(tx);
        this.state = nextState;
        return result;
      } finally {
        this.activeTransactionState = null;
      }
    };

    const pending = this.transactionQueue.then(execute, execute);
    this.transactionQueue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  getWorkflow(scope: WorkflowScope): PersistedWorkflow | undefined {
    const workflow = this.state.workflows.get(workflowKey(scope));
    return workflow ? clone(workflow) : undefined;
  }

  findWorkflowById(workflowId: string): PersistedWorkflow | undefined {
    for (const workflow of this.state.workflows.values()) {
      if (workflow.workflowId === workflowId) {
        return clone(workflow);
      }
    }
    return undefined;
  }

  listPlannerSteps(scope: WorkflowScope): PlannerStepRecord[] {
    return clone(this.state.plannerSteps.get(workflowKey(scope)) ?? []);
  }

  listObjectiveRequests(scope: TenantScope): ObjectiveRequestV1[] {
    const requests: ObjectiveRequestV1[] = [];
    for (const request of this.state.objectiveRequests.values()) {
      if (request.tenantId === scope.tenantId && request.workspaceId === scope.workspaceId) {
        requests.push(clone(request));
      }
    }
    return requests;
  }

  listSignals(scope: WorkflowScope): WorkflowSignalRecord[] {
    const records: WorkflowSignalRecord[] = [];
    for (const signal of this.state.signals.values()) {
      if (
        signal.tenantId === scope.tenantId &&
        signal.workspaceId === scope.workspaceId &&
        signal.workflowId === scope.workflowId
      ) {
        records.push(clone(signal));
      }
    }

    records.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    return records;
  }

  listPolicyDecisions(scope: WorkflowScope): PolicyDecisionRecord[] {
    return clone(this.state.policyDecisions.get(workflowKey(scope)) ?? []);
  }

  listApprovalDecisions(scope: WorkflowScope): ApprovalDecisionRecord[] {
    return clone(this.state.approvalDecisions.get(workflowKey(scope)) ?? []);
  }

  listAuditRecords(query: AuditQuery): AuditRecord[] {
    const records: AuditRecord[] = [];
    for (const workflowRecords of this.state.auditRecords.values()) {
      for (const record of workflowRecords) {
        if (record.tenantId !== query.tenantId || record.workspaceId !== query.workspaceId) {
          continue;
        }
        if (query.workflowId && record.workflowId !== query.workflowId) {
          continue;
        }
        if (query.requestId && record.requestId !== query.requestId) {
          continue;
        }
        records.push(clone(record));
      }
    }

    records.sort((left, right) => {
      const byTime = left.occurredAt.localeCompare(right.occurredAt);
      if (byTime !== 0) {
        return byTime;
      }
      return left.stepNumber - right.stepNumber;
    });
    return records;
  }

  toSnapshot(): InMemoryPersistenceSnapshot {
    return {
      objectiveRequests: Array.from(this.state.objectiveRequests.values()).map(clone),
      workflows: Array.from(this.state.workflows.values()).map(clone),
      plannerSteps: Array.from(this.state.plannerSteps.entries()).map(([key, records]) => ({
        workflowKey: key,
        records: clone(records)
      })),
      waitingCheckpoints: Array.from(this.state.waitingCheckpoints.values()).map(clone),
      signals: Array.from(this.state.signals.values()).map(clone),
      policyDecisions: Array.from(this.state.policyDecisions.entries()).map(([key, records]) => ({
        workflowKey: key,
        records: clone(records)
      })),
      approvalDecisions: Array.from(this.state.approvalDecisions.entries()).map(([key, records]) => ({
        workflowKey: key,
        records: clone(records)
      })),
      auditRecords: Array.from(this.state.auditRecords.entries()).map(([key, records]) => ({
        workflowKey: key,
        records: clone(records)
      }))
    };
  }

  static fromSnapshot(snapshot: InMemoryPersistenceSnapshot): InMemoryAgentPersistence {
    const persistence = new InMemoryAgentPersistence();
    persistence.state = {
      objectiveRequests: new Map(
        snapshot.objectiveRequests.map((request) => [
          requestKey({
            tenantId: request.tenantId,
            workspaceId: request.workspaceId,
            requestId: request.requestId
          }),
          clone(request)
        ])
      ),
      workflows: new Map(
        snapshot.workflows.map((workflow) => [workflowKey(workflow), clone(workflow)])
      ),
      plannerSteps: new Map(
        snapshot.plannerSteps.map((entry) => [entry.workflowKey, clone(entry.records)])
      ),
      waitingCheckpoints: new Map(
        snapshot.waitingCheckpoints.map((checkpoint) => [workflowKey(checkpoint), clone(checkpoint)])
      ),
      signals: new Map(
        snapshot.signals.map((signal) => [signalKey(signal), clone(signal)])
      ),
      policyDecisions: new Map(
        snapshot.policyDecisions.map((entry) => [entry.workflowKey, clone(entry.records)])
      ),
      approvalDecisions: new Map(
        snapshot.approvalDecisions.map((entry) => [entry.workflowKey, clone(entry.records)])
      ),
      auditRecords: new Map(
        snapshot.auditRecords.map((entry) => [entry.workflowKey, clone(entry.records)])
      )
    };
    return persistence;
  }
}

function cloneState(input: PersistenceState): PersistenceState {
  return {
    objectiveRequests: cloneMap(input.objectiveRequests),
    workflows: cloneMap(input.workflows),
    plannerSteps: cloneMap(input.plannerSteps),
    waitingCheckpoints: cloneMap(input.waitingCheckpoints),
    signals: cloneMap(input.signals),
    policyDecisions: cloneMap(input.policyDecisions),
    approvalDecisions: cloneMap(input.approvalDecisions),
    auditRecords: cloneMap(input.auditRecords)
  };
}

function cloneMap<K, V>(input: Map<K, V>): Map<K, V> {
  const out = new Map<K, V>();
  for (const [key, value] of input.entries()) {
    out.set(key, clone(value));
  }
  return out;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function workflowKey(scope: WorkflowScope): string {
  return `${scope.tenantId}:${scope.workspaceId}:${scope.workflowId}`;
}

function requestKey(scope: TenantScope & { requestId: string }): string {
  return `${scope.tenantId}:${scope.workspaceId}:${scope.requestId}`;
}

function signalKey(scope: WorkflowScope & { signalId: string }): string {
  return `${scope.tenantId}:${scope.workspaceId}:${scope.signalId}`;
}
