import { ObservabilityStore } from "@agent/observability";
export interface RuntimeTelemetryConfig {
    agentId?: string;
    agentName?: string;
    owner?: string;
    env?: "prod" | "staging";
    version?: string;
    enabled?: boolean;
    store?: ObservabilityStore;
}
interface PlannerMetricBase {
    tenantId: string;
    workspaceId: string;
    workflowId: string;
    requestId: string;
    occurredAt: string;
}
export declare class RuntimeTelemetry {
    private readonly workspace;
    private readonly config;
    private readonly store;
    constructor(workspace: string, config?: RuntimeTelemetryConfig);
    private isEnabled;
    private agentId;
    private workflowRunId;
    private baseAgent;
    private appendEvent;
    private ensureWorkflowRun;
    markHeartbeat(): Promise<void>;
    onRunQueued(params: {
        runId: string;
        traceId: string;
        startedAt: string;
    }): Promise<void>;
    onRunFinished(params: {
        runId: string;
        traceId: string;
        startedAt: string;
        status: "success" | "failed";
        errorSummary?: string;
    }): Promise<void>;
    onPlannerRequestReceived(input: PlannerMetricBase & {
        objectivePrompt: string;
    }): Promise<void>;
    onPlannerStepLatency(input: PlannerMetricBase & {
        stepIndex: number;
        latencyMs: number;
        status: string;
        intentType: string;
    }): Promise<void>;
    onPlannerValidationFailure(input: PlannerMetricBase & {
        phase: string;
        errorMessage: string;
        stepIndex: number;
    }): Promise<void>;
    onPolicyDecision(input: PlannerMetricBase & {
        stepIndex: number;
        outcome: "allow" | "rewrite" | "block";
        reasonCode: string;
        policyId: string;
        rewritten: boolean;
    }): Promise<void>;
    onWorkflowTerminal(input: PlannerMetricBase & {
        status: "completed" | "failed";
        errorSummary?: string;
    }): Promise<void>;
    onSignalLifecycle(input: {
        tenantId: string;
        workspaceId: string;
        workflowId: string;
        signalId: string;
        signalType: string;
        stage: "queued" | "delivered" | "resumed" | "dropped";
        occurredAt: string;
        requestId?: string;
        reason?: string;
    }): Promise<void>;
}
export {};
