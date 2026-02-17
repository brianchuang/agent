export type AgentStatus = "healthy" | "degraded" | "offline";
export type RunStatus = "success" | "failed" | "running" | "queued";
export type Agent = {
    id: string;
    name: string;
    owner: string;
    env: "prod" | "staging";
    version: string;
    status: AgentStatus;
    lastHeartbeatAt: string;
    errorRate: number;
    avgLatencyMs: number;
};
export type Run = {
    id: string;
    agentId: string;
    status: RunStatus;
    startedAt: string;
    endedAt?: string;
    latencyMs?: number;
    errorSummary?: string;
    traceId: string;
    retries: number;
};
export type JsonValue = string | number | boolean | null | {
    [key: string]: JsonValue;
} | JsonValue[];
export type RunEvent = {
    id: string;
    runId: string;
    ts: string;
    type: "state" | "tool_call" | "log";
    level: "info" | "warn" | "error";
    message: string;
    payload: Record<string, JsonValue>;
    correlationId?: string;
    causationId?: string;
    tenantId?: string;
    workspaceId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, JsonValue>;
};
export type DashboardData = {
    agents: Agent[];
    runs: Run[];
    runEvents: RunEvent[];
};
export type RunsFilter = {
    agentId?: string;
    status?: RunStatus;
    query?: string;
};
export type DashboardMetrics = {
    healthyAgents: number;
    totalAgents: number;
    avgErrorRate: number;
    avgLatencyMs: number;
    failedRuns24h: number;
};
export interface ObservabilityStore {
    read(): Promise<DashboardData>;
    listAgents(): Promise<Agent[]>;
    getAgent(id: string): Promise<Agent | undefined>;
    upsertAgent(agent: Agent): Promise<void>;
    listRuns(filter?: RunsFilter): Promise<Run[]>;
    getRun(id: string): Promise<Run | undefined>;
    upsertRun(run: Run): Promise<void>;
    listRunEvents(runId: string): Promise<RunEvent[]>;
    appendRunEvent(runEvent: RunEvent): Promise<void>;
}
