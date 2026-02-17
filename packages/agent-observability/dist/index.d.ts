import { PostgresObservabilityStore } from "./postgres-store";
import { ObservabilityStore } from "./types";
export declare function getObservabilityStore(): ObservabilityStore;
export { PostgresObservabilityStore };
export type { Agent, AgentStatus, DashboardData, DashboardMetrics, JsonValue, ObservabilityStore, Run, RunEvent, RunsFilter, RunStatus } from "./types";
