"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryAgentPersistence = void 0;
class InMemoryAgentPersistenceTransaction {
    state;
    constructor(state) {
        this.state = state;
    }
    recordObjectiveRequest(request) {
        this.state.objectiveRequests.set(requestKey({
            tenantId: request.tenantId,
            workspaceId: request.workspaceId,
            requestId: request.requestId
        }), clone(request));
    }
    getWorkflow(scope) {
        const workflow = this.state.workflows.get(workflowKey(scope));
        return workflow ? clone(workflow) : undefined;
    }
    getOrCreateWorkflow(input) {
        const key = workflowKey(input);
        const existing = this.state.workflows.get(key);
        if (existing) {
            return clone(existing);
        }
        const created = {
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
    saveWorkflow(workflow) {
        this.state.workflows.set(workflowKey(workflow), clone(workflow));
    }
    appendPlannerStep(record) {
        const key = workflowKey(record);
        const existing = this.state.plannerSteps.get(key) ?? [];
        existing.push(clone(record));
        this.state.plannerSteps.set(key, existing);
    }
    putWaitingCheckpoint(scope) {
        this.state.waitingCheckpoints.set(workflowKey(scope), clone(scope));
    }
    consumeWaitingCheckpoint(scope) {
        const key = workflowKey(scope);
        const checkpoint = this.state.waitingCheckpoints.get(key);
        if (!checkpoint) {
            return undefined;
        }
        this.state.waitingCheckpoints.delete(key);
        return clone(checkpoint);
    }
    recordSignal(signal) {
        const signalRecord = {
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
    acknowledgeSignal(scope) {
        const key = signalKey(scope);
        const signal = this.state.signals.get(key);
        if (!signal) {
            return;
        }
        this.state.signals.set(key, clone({
            ...signal,
            signalStatus: "acknowledged",
            acknowledgedAt: scope.acknowledgedAt
        }));
    }
    recordPolicyDecision(record) {
        const key = workflowKey(record);
        const existing = this.state.policyDecisions.get(key) ?? [];
        existing.push(clone(record));
        this.state.policyDecisions.set(key, existing);
    }
    recordApprovalDecision(record) {
        const key = workflowKey(record);
        const existing = this.state.approvalDecisions.get(key) ?? [];
        existing.push(clone(record));
        this.state.approvalDecisions.set(key, existing);
    }
    appendAuditRecord(record) {
        const key = workflowKey(record);
        const existing = this.state.auditRecords.get(key) ?? [];
        existing.push(clone(record));
        this.state.auditRecords.set(key, existing);
    }
    resolveApprovalDecision(scope) {
        const key = workflowKey(scope);
        const existing = this.state.approvalDecisions.get(key) ?? [];
        const index = existing.findIndex((record) => record.approvalId === scope.approvalId);
        if (index < 0) {
            return undefined;
        }
        const updated = {
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
class InMemoryAgentPersistence {
    state = {
        objectiveRequests: new Map(),
        workflows: new Map(),
        plannerSteps: new Map(),
        waitingCheckpoints: new Map(),
        signals: new Map(),
        policyDecisions: new Map(),
        approvalDecisions: new Map(),
        auditRecords: new Map()
    };
    transactionQueue = Promise.resolve();
    activeTransactionState = null;
    async withTransaction(work) {
        if (this.activeTransactionState) {
            const nestedTx = new InMemoryAgentPersistenceTransaction(this.activeTransactionState);
            return await work(nestedTx);
        }
        const execute = async () => {
            const nextState = cloneState(this.state);
            const tx = new InMemoryAgentPersistenceTransaction(nextState);
            this.activeTransactionState = nextState;
            try {
                const result = await work(tx);
                this.state = nextState;
                return result;
            }
            finally {
                this.activeTransactionState = null;
            }
        };
        const pending = this.transactionQueue.then(execute, execute);
        this.transactionQueue = pending.then(() => undefined, () => undefined);
        return pending;
    }
    getWorkflow(scope) {
        const workflow = this.state.workflows.get(workflowKey(scope));
        return workflow ? clone(workflow) : undefined;
    }
    findWorkflowById(workflowId) {
        for (const workflow of this.state.workflows.values()) {
            if (workflow.workflowId === workflowId) {
                return clone(workflow);
            }
        }
        return undefined;
    }
    listPlannerSteps(scope) {
        return clone(this.state.plannerSteps.get(workflowKey(scope)) ?? []);
    }
    listObjectiveRequests(scope) {
        const requests = [];
        for (const request of this.state.objectiveRequests.values()) {
            if (request.tenantId === scope.tenantId && request.workspaceId === scope.workspaceId) {
                requests.push(clone(request));
            }
        }
        return requests;
    }
    listSignals(scope) {
        const records = [];
        for (const signal of this.state.signals.values()) {
            if (signal.tenantId === scope.tenantId &&
                signal.workspaceId === scope.workspaceId &&
                signal.workflowId === scope.workflowId) {
                records.push(clone(signal));
            }
        }
        records.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
        return records;
    }
    listPolicyDecisions(scope) {
        return clone(this.state.policyDecisions.get(workflowKey(scope)) ?? []);
    }
    listApprovalDecisions(scope) {
        return clone(this.state.approvalDecisions.get(workflowKey(scope)) ?? []);
    }
    listAuditRecords(query) {
        const records = [];
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
}
exports.InMemoryAgentPersistence = InMemoryAgentPersistence;
function cloneState(input) {
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
function cloneMap(input) {
    const out = new Map();
    for (const [key, value] of input.entries()) {
        out.set(key, clone(value));
    }
    return out;
}
function clone(value) {
    return structuredClone(value);
}
function workflowKey(scope) {
    return `${scope.tenantId}:${scope.workspaceId}:${scope.workflowId}`;
}
function requestKey(scope) {
    return `${scope.tenantId}:${scope.workspaceId}:${scope.requestId}`;
}
function signalKey(scope) {
    return `${scope.tenantId}:${scope.workspaceId}:${scope.signalId}`;
}
