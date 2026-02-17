import { PostgresObservabilityStore } from "./postgres-store";
import { ObservabilityStore } from "./types";

const DEFAULT_DATABASE_URL = "postgres://agent:agent@127.0.0.1:55432/agent_observability";

let singleton: ObservabilityStore | null = null;

function createStore(): ObservabilityStore {
  return new PostgresObservabilityStore(
    process.env.AGENT_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
  );
}

export function getObservabilityStore(): ObservabilityStore {
  if (!singleton) {
    singleton = createStore();
  }
  return singleton;
}

export { PostgresObservabilityStore };

export type {
  Agent,
  AgentStatus,
  DashboardData,
  DashboardMetrics,
  ClaimWorkflowJobsInput,
  CompleteWorkflowJobInput,
  FailWorkflowJobInput,
  JsonValue,
  ObservabilityStore,
  Run,
  RunEvent,
  RunsFilter,
  RunStatus,
  WorkflowQueueJob,
  WorkflowQueueJobCreateInput,
  WorkflowQueueJobStatus
} from "./types";
