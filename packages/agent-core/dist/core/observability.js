"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RuntimeTelemetry = void 0;
const observability_1 = require("@agent/observability");
const uuidv7_1 = require("uuidv7");
class RuntimeTelemetry {
    workspace;
    config;
    store;
    constructor(workspace, config = {}) {
        this.workspace = workspace;
        this.config = config;
        this.store = config.store ?? (0, observability_1.getObservabilityStore)();
    }
    isEnabled() {
        return this.config.enabled === true;
    }
    agentId() {
        return this.config.agentId ?? `agent-${this.workspace}`;
    }
    workflowRunId(input) {
        return `wf:${input.tenantId}:${input.workspaceId}:${input.workflowId}`;
    }
    baseAgent() {
        return {
            id: this.agentId(),
            name: this.config.agentName ?? `Runtime ${this.workspace}`,
            owner: this.config.owner ?? "core@local",
            env: this.config.env ?? "staging",
            version: this.config.version ?? "0.1.0",
            status: "healthy",
            lastHeartbeatAt: new Date().toISOString(),
            errorRate: 0,
            avgLatencyMs: 0
        };
    }
    async appendEvent(input) {
        await this.store.appendRunEvent({
            id: (0, uuidv7_1.uuidv7)(),
            runId: input.runId,
            ts: input.occurredAt,
            type: "log",
            level: input.level,
            message: input.message,
            payload: input.payload,
            correlationId: input.correlationId,
            causationId: input.causationId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            metadata: { source: "agent-core" }
        });
    }
    async ensureWorkflowRun(input) {
        const runId = this.workflowRunId(input);
        const existing = await this.store.getRun(runId);
        await this.store.upsertRun({
            id: runId,
            agentId: this.agentId(),
            status: input.status,
            startedAt: existing?.startedAt ?? input.occurredAt,
            traceId: input.requestId,
            retries: existing?.retries ?? 0,
            endedAt: existing?.endedAt,
            latencyMs: existing?.latencyMs,
            errorSummary: existing?.errorSummary
        });
    }
    async markHeartbeat() {
        if (!this.isEnabled()) {
            return;
        }
        const existing = (await this.store.getAgent(this.agentId())) ?? this.baseAgent();
        await this.store.upsertAgent({
            ...existing,
            lastHeartbeatAt: new Date().toISOString()
        });
    }
    async onRunQueued(params) {
        if (!this.isEnabled()) {
            return;
        }
        await this.markHeartbeat();
        await this.store.upsertRun({
            id: params.runId,
            agentId: this.agentId(),
            status: "queued",
            startedAt: params.startedAt,
            traceId: params.traceId,
            retries: 0
        });
        await this.store.appendRunEvent({
            id: (0, uuidv7_1.uuidv7)(),
            runId: params.runId,
            ts: new Date().toISOString(),
            type: "state",
            level: "info",
            message: "Run queued",
            payload: { traceId: params.traceId },
            correlationId: params.traceId,
            metadata: { source: "agent-core" }
        });
    }
    async onRunFinished(params) {
        if (!this.isEnabled()) {
            return;
        }
        const endedAt = new Date().toISOString();
        const latencyMs = Math.max(1, new Date(endedAt).getTime() - new Date(params.startedAt).getTime());
        await this.store.upsertRun({
            id: params.runId,
            agentId: this.agentId(),
            status: params.status,
            startedAt: params.startedAt,
            endedAt,
            latencyMs,
            errorSummary: params.errorSummary,
            traceId: params.traceId,
            retries: 0
        });
        await this.store.appendRunEvent({
            id: (0, uuidv7_1.uuidv7)(),
            runId: params.runId,
            ts: endedAt,
            type: "log",
            level: params.status === "success" ? "info" : "error",
            message: params.status === "success" ? "Run completed" : "Run failed",
            payload: params.errorSummary ? { error: params.errorSummary } : {},
            correlationId: params.traceId,
            metadata: { source: "agent-core" }
        });
        const agentId = this.agentId();
        const runs = await this.store.listRuns({ agentId });
        const total = runs.length;
        const failedCount = runs.filter((run) => run.status === "failed").length;
        const latencyRuns = runs.filter((run) => typeof run.latencyMs === "number");
        const avgLatencyMs = latencyRuns.length
            ? Math.round(latencyRuns.reduce((acc, run) => acc + (run.latencyMs ?? 0), 0) / latencyRuns.length)
            : latencyMs;
        const existing = (await this.store.getAgent(agentId)) ?? this.baseAgent();
        const errorRate = total > 0 ? (failedCount / total) * 100 : 0;
        await this.store.upsertAgent({
            ...existing,
            status: errorRate > 5 ? "degraded" : "healthy",
            lastHeartbeatAt: new Date().toISOString(),
            errorRate: Number(errorRate.toFixed(1)),
            avgLatencyMs
        });
    }
    async onPlannerRequestReceived(input) {
        if (!this.isEnabled()) {
            return;
        }
        await this.markHeartbeat();
        await this.ensureWorkflowRun({ ...input, status: "running" });
        await this.appendEvent({
            runId: this.workflowRunId(input),
            occurredAt: input.occurredAt,
            level: "info",
            message: "Planner request received",
            correlationId: input.requestId,
            causationId: input.workflowId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            payload: {
                metricType: "request_throughput",
                requestId: input.requestId,
                objectivePromptLength: input.objectivePrompt.length
            }
        });
    }
    async onPlannerStepLatency(input) {
        if (!this.isEnabled()) {
            return;
        }
        await this.appendEvent({
            runId: this.workflowRunId(input),
            occurredAt: input.occurredAt,
            level: "info",
            message: "Planner step latency recorded",
            correlationId: input.requestId,
            causationId: input.workflowId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            payload: {
                metricType: "step_latency",
                requestId: input.requestId,
                stepIndex: input.stepIndex,
                latencyMs: input.latencyMs,
                stepStatus: input.status,
                intentType: input.intentType
            }
        });
    }
    async onPlannerValidationFailure(input) {
        if (!this.isEnabled()) {
            return;
        }
        await this.appendEvent({
            runId: this.workflowRunId(input),
            occurredAt: input.occurredAt,
            level: "error",
            message: "Planner validation failure",
            correlationId: input.requestId,
            causationId: input.workflowId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            payload: {
                metricType: "planner_validation_failure",
                requestId: input.requestId,
                phase: input.phase,
                stepIndex: input.stepIndex,
                errorMessage: input.errorMessage
            }
        });
    }
    async onPolicyDecision(input) {
        if (!this.isEnabled()) {
            return;
        }
        await this.appendEvent({
            runId: this.workflowRunId(input),
            occurredAt: input.occurredAt,
            level: input.outcome === "block" ? "warn" : "info",
            message: "Policy decision recorded",
            correlationId: input.requestId,
            causationId: input.workflowId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            payload: {
                metricType: input.outcome === "rewrite" ? "policy_rewrite" : input.outcome === "block" ? "policy_block" : "policy_allow",
                requestId: input.requestId,
                stepIndex: input.stepIndex,
                policyId: input.policyId,
                reasonCode: input.reasonCode,
                rewritten: input.rewritten
            }
        });
    }
    async onWorkflowTerminal(input) {
        if (!this.isEnabled()) {
            return;
        }
        const runId = this.workflowRunId(input);
        const existing = await this.store.getRun(runId);
        const startedAt = existing?.startedAt ?? input.occurredAt;
        const latencyMs = Math.max(1, new Date(input.occurredAt).getTime() - new Date(startedAt).getTime());
        await this.store.upsertRun({
            id: runId,
            agentId: this.agentId(),
            status: input.status === "completed" ? "success" : "failed",
            startedAt,
            endedAt: input.occurredAt,
            latencyMs,
            errorSummary: input.errorSummary,
            traceId: input.requestId,
            retries: existing?.retries ?? 0
        });
        await this.appendEvent({
            runId,
            occurredAt: input.occurredAt,
            level: input.status === "completed" ? "info" : "error",
            message: input.status === "completed" ? "Workflow terminal completed" : "Workflow terminal failed",
            correlationId: input.requestId,
            causationId: input.workflowId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            payload: {
                metricType: input.status === "completed" ? "terminal_success" : "terminal_failure",
                requestId: input.requestId,
                errorSummary: input.errorSummary ?? null
            }
        });
    }
    async onSignalLifecycle(input) {
        if (!this.isEnabled()) {
            return;
        }
        const correlationId = input.requestId ?? input.signalId;
        await this.appendEvent({
            runId: this.workflowRunId(input),
            occurredAt: input.occurredAt,
            level: input.stage === "dropped" ? "warn" : "info",
            message: "Signal lifecycle recorded",
            correlationId,
            causationId: input.workflowId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            payload: {
                metricType: "signal_lifecycle",
                signalId: input.signalId,
                signalType: input.signalType,
                stage: input.stage,
                reason: input.reason ?? null
            }
        });
    }
}
exports.RuntimeTelemetry = RuntimeTelemetry;
