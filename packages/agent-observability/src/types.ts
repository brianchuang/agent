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
  systemPrompt?: string;
  enabledTools?: string[];
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

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

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

export type WorkflowQueueJobStatus = "queued" | "claimed" | "completed" | "failed";

export type WorkflowQueueJob = {
  id: string;
  runId: string;
  agentId: string;
  tenantId: string;
  workspaceId: string;
  workflowId: string;
  requestId: string;
  threadId: string;
  objectivePrompt: string;
  status: WorkflowQueueJobStatus;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowQueueJobCreateInput = {
  id: string;
  runId: string;
  agentId: string;
  tenantId: string;
  workspaceId: string;
  workflowId: string;
  requestId: string;
  threadId: string;
  objectivePrompt: string;
  maxAttempts: number;
  availableAt: string;
};

export type WorkflowQueueJobsFilter = {
  statuses?: WorkflowQueueJobStatus[];
  availableAfter?: string;
  availableBefore?: string;
  tenantId?: string;
  workspaceId?: string;
  limit?: number;
};

export type ClaimWorkflowJobsInput = {
  workerId: string;
  limit: number;
  leaseMs: number;
  tenantId?: string;
  workspaceId?: string;
  now?: string;
};

export type CompleteWorkflowJobInput = {
  jobId: string;
  leaseToken: string;
};

export type FailWorkflowJobInput = {
  jobId: string;
  leaseToken: string;
  error: string;
  retryAt?: string;
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
  enqueueWorkflowJob(input: WorkflowQueueJobCreateInput): Promise<WorkflowQueueJob>;
  listWorkflowJobs(filter?: WorkflowQueueJobsFilter): Promise<WorkflowQueueJob[]>;
  claimWorkflowJobs(input: ClaimWorkflowJobsInput): Promise<WorkflowQueueJob[]>;
  completeWorkflowJob(input: CompleteWorkflowJobInput): Promise<void>;
  failWorkflowJob(input: FailWorkflowJobInput): Promise<void>;
  getWorkflowJob(jobId: string): Promise<WorkflowQueueJob | undefined>;
  getTenantMessagingSettings(
    tenantId: string,
    workspaceId: string
  ): Promise<TenantMessagingSettings | undefined>;
  upsertTenantMessagingSettings(input: UpsertTenantMessagingSettingsInput): Promise<void>;
  upsertWorkflowMessageThread(input: UpsertWorkflowMessageThreadInput): Promise<WorkflowMessageThread>;
  getWorkflowMessageThreadByProviderThread(
    input: WorkflowMessageThreadLookupInput
  ): Promise<WorkflowMessageThread | undefined>;
  recordInboundMessageReceipt(input: InboundMessageReceiptInput): Promise<boolean>;
  enqueueWorkflowSignal(input: EnqueueWorkflowSignalInput): Promise<WorkflowSignalInboxRecord>;
  listPendingWorkflowSignals(
    input: ListPendingWorkflowSignalsInput
  ): Promise<WorkflowSignalInboxRecord[]>;
  markWorkflowSignalConsumed(signalId: string, consumedAt: string): Promise<void>;
  getWorkflowRuntimeSnapshot(
    tenantId: string,
    workspaceId: string,
    workflowId: string
  ): Promise<WorkflowRuntimeSnapshotRecord | undefined>;
  upsertWorkflowRuntimeSnapshot(input: {
    tenantId: string;
    workspaceId: string;
    workflowId: string;
    payload: JsonValue;
  }): Promise<WorkflowRuntimeSnapshotRecord>;

  // Auth & Connections
  upsertUser(input: UpsertUserInput): Promise<User>;
  upsertConnection(input: UpsertConnectionInput): Promise<Connection>;
  getConnection(userId: string, providerId: string): Promise<Connection | undefined>;
  deleteConnection(userId: string, providerId: string): Promise<void>;
}

export type User = {
  id: string;
  email: string;
  name?: string;
  image?: string;
  createdAt: string;
  updatedAt: string;
};

export type Connection = {
  id: string;
  userId: string;
  providerId: string;
  providerAccountId: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertUserInput = {
  id: string;
  email: string;
  name?: string;
  image?: string;
};

export type UpsertConnectionInput = {
  userId: string;
  providerId: string;
  providerAccountId: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
};

export type MessagingChannelType = "web_ui" | "slack";

export type SlackChannelSettings = {
  enabled?: boolean;
  defaultChannel?: string;
};

export type TenantMessagingSettings = {
  tenantId: string;
  workspaceId?: string;
  notifierCascade: MessagingChannelType[];
  slack?: SlackChannelSettings;
  updatedAt?: string;
};

export type UpsertTenantMessagingSettingsInput = {
  tenantId: string;
  workspaceId?: string;
  notifierCascade?: MessagingChannelType[];
  slack?: SlackChannelSettings;
};

export type WorkflowMessageThreadStatus = "active" | "closed";

export type WorkflowMessageThread = {
  id: string;
  tenantId: string;
  workspaceId: string;
  workflowId: string;
  runId: string;
  channelType: MessagingChannelType;
  channelId: string;
  rootMessageId: string;
  threadId: string;
  providerTeamId?: string;
  status: WorkflowMessageThreadStatus;
  createdAt: string;
  updatedAt: string;
};

export type UpsertWorkflowMessageThreadInput = {
  tenantId: string;
  workspaceId: string;
  workflowId: string;
  runId: string;
  channelType: MessagingChannelType;
  channelId: string;
  rootMessageId: string;
  threadId: string;
  providerTeamId?: string;
  status?: WorkflowMessageThreadStatus;
};

export type WorkflowMessageThreadLookupInput = {
  channelType: MessagingChannelType;
  channelId: string;
  threadId: string;
  providerTeamId?: string;
};

export type InboundMessageReceiptInput = {
  provider: MessagingChannelType;
  providerTeamId: string;
  eventId: string;
  tenantId: string;
  workspaceId: string;
};

export type WorkflowSignalInboxStatus = "pending" | "consumed";

export type WorkflowSignalInboxRecord = {
  signalId: string;
  tenantId: string;
  workspaceId: string;
  workflowId: string;
  runId: string;
  signalType: "approval_signal" | "external_event_signal" | "timer_signal" | "user_input_signal";
  occurredAt: string;
  payload: JsonValue;
  status: WorkflowSignalInboxStatus;
  consumedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueWorkflowSignalInput = {
  signalId: string;
  tenantId: string;
  workspaceId: string;
  workflowId: string;
  runId: string;
  signalType: "approval_signal" | "external_event_signal" | "timer_signal" | "user_input_signal";
  occurredAt: string;
  payload: JsonValue;
};

export type ListPendingWorkflowSignalsInput = {
  tenantId: string;
  workspaceId: string;
  workflowId: string;
  limit?: number;
};

export type WorkflowRuntimeSnapshotRecord = {
  tenantId: string;
  workspaceId: string;
  workflowId: string;
  payload: JsonValue;
  updatedAt: string;
};
