import {
  Agent,
  DashboardMetrics,
  EnqueueWorkflowSignalInput,
  MessagingChannelType,
  ObservabilityStore,
  Run,
  RunEvent,
  RunsFilter,
  UpsertTenantMessagingSettingsInput,
  WorkflowQueueJob,
  getObservabilityStore
} from "@agent/observability";
import { uuidv7 } from "uuidv7";

export type TenantWorkspaceScope = {
  tenantId?: string;
  workspaceId?: string;
};

export type TenantSloSummary = {
  tenantId: string;
  workspaceId: string;
  totalRuns: number;
  failedRuns: number;
  errorRate: number;
  avgLatencyMs: number;
};

export type DashboardMetricsResponse = DashboardMetrics & {
  requestThroughput: number;
  tenantSloSummaries: TenantSloSummary[];
};

export type ScheduledRun = {
  jobId: string;
  runId: string;
  agentId: string;
  workflowId: string;
  tenantId: string;
  workspaceId: string;
  objectivePrompt: string;
  availableAt: string;
  scheduleType: "one_off" | "cron";
  cronExpression?: string;
  source: "planner_schedule_tool" | "control_plane";
};

export type CreateAgentInput = {
  name: string;
  id?: string;
  owner?: string;
  env?: "prod" | "staging";
  version?: string;
  status?: Agent["status"];
  systemPrompt?: string;
  enabledTools?: string[];
};

export type DispatchObjectiveInput = {
  agentId: string;
  objectivePrompt: string;
  tenantId: string;
  workspaceId: string;
  threadId?: string;
};

export type CreateAgentAndRunInput = CreateAgentInput & {
  objectivePrompt?: string;
  tenantId?: string;
  workspaceId?: string;
  threadId?: string;
};

export type TenantMessagingSettingsInput = {
  tenantId: string;
  workspaceId?: string;
  notifierCascade?: MessagingChannelType[];
  slack?: {
    enabled?: boolean;
    defaultChannel?: string;
  };
};

export type IngestSlackThreadReplyInput = {
  providerTeamId: string;
  eventId: string;
  eventTs: string;
  channelId: string;
  threadId: string;
  messageId: string;
  userId: string;
  message: string;
};

export type IngestSlackThreadReplyResult =
  | { status: "duplicate" }
  | { status: "unmapped" }
  | { status: "not_waiting"; workflowId: string; runId: string }
  | { status: "queued_signal"; workflowId: string; runId: string; signalId: string; jobId: string };

export type InboxMessageRole = "user" | "agent";

export type InboxMessage = {
  id: string;
  runId: string;
  threadId: string;
  workflowId: string;
  ts: string;
  role: InboxMessageRole;
  text: string;
};

export type InboxThreadSummary = {
  threadId: string;
  workflowId: string;
  runId: string;
  agentId: string;
  objectivePrompt?: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
};

export type SendInboxMessageInput = {
  tenantId: string;
  workspaceId: string;
  message: string;
  threadId?: string;
  agentId?: string;
};

export type MarkInboxThreadReadInput = {
  tenantId: string;
  workspaceId: string;
  threadId: string;
  readAt?: string;
};

export type AgentDashboardStatus = "active" | "idle" | "waiting_on_you" | "blocked" | "error";

export type AgentSummary = {
  agentId: string;
  agentName: string;
  objectiveSummary?: string;
  status: AgentDashboardStatus;
  lastUpdateAt?: string;
  latestOutcomeSummary: string;
  nextPlannedAction?: string;
  requiredUserAction?: string;
};

const INBOX_THREAD_STATE_PREFIX = "inbox-thread:";

function isWithinLast24Hours(isoDate: string) {
  const now = Date.now();
  const started = new Date(isoDate).getTime();
  return now - started <= 24 * 60 * 60 * 1000;
}

function assertScope(scope?: TenantWorkspaceScope) {
  if (!scope) {
    return;
  }
  const hasTenant = typeof scope.tenantId === "string" && scope.tenantId.length > 0;
  const hasWorkspace = typeof scope.workspaceId === "string" && scope.workspaceId.length > 0;
  if (hasTenant !== hasWorkspace) {
    throw new Error("tenantId and workspaceId must be provided together");
  }
}

function scopeMatchesEvent(event: RunEvent, scope?: TenantWorkspaceScope) {
  if (!scope?.tenantId || !scope.workspaceId) {
    return true;
  }
  return event.tenantId === scope.tenantId && event.workspaceId === scope.workspaceId;
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function extractObjectivePromptFromQueuedEvent(events: RunEvent[]): string | undefined {
  const queued = events.find((event) => event.message === "Run queued");
  const objectivePrompt = queued?.payload?.objective_prompt;
  return typeof objectivePrompt === "string" && objectivePrompt.trim().length > 0
    ? objectivePrompt
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inboxStateWorkflowId(threadId: string) {
  return `${INBOX_THREAD_STATE_PREFIX}${threadId}`;
}

function extractRunRoutingMeta(events: RunEvent[]): {
  workflowId?: string;
  threadId?: string;
  objectivePrompt?: string;
} {
  const queued = events.find((event) => event.message === "Run queued");
  return {
    workflowId: asTrimmedString(queued?.payload?.workflow_id),
    threadId: asTrimmedString(queued?.payload?.thread_id),
    objectivePrompt: asTrimmedString(queued?.payload?.objective_prompt)
  };
}

function projectInboxMessages(events: RunEvent[]): InboxMessage[] {
  const sorted = events.slice().sort((left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime());
  const { threadId, workflowId } = extractRunRoutingMeta(sorted);
  if (!threadId || !workflowId) {
    return [];
  }

  const messages: InboxMessage[] = [];
  for (const event of sorted) {
    if (event.message === "Run queued") {
      const objectivePrompt = asTrimmedString(event.payload?.objective_prompt);
      if (!objectivePrompt) {
        continue;
      }
      messages.push({
        id: `${event.id}:queued`,
        runId: event.runId,
        threadId,
        workflowId,
        ts: event.ts,
        role: "user",
        text: objectivePrompt
      });
      continue;
    }

    if (event.message === "Run waiting for signal") {
      const waitingQuestion = asTrimmedString(
        typeof event.payload?.output === "object" && event.payload.output
          ? (event.payload.output as { waitingQuestion?: unknown }).waitingQuestion
          : undefined
      );
      if (!waitingQuestion) {
        continue;
      }
      messages.push({
        id: `${event.id}:waiting`,
        runId: event.runId,
        threadId,
        workflowId,
        ts: event.ts,
        role: "agent",
        text: waitingQuestion
      });
      continue;
    }

    if (event.message === "Run completed") {
      const output =
        typeof event.payload?.output === "object" && event.payload.output
          ? (event.payload.output as { result?: unknown })
          : undefined;
      const completionText =
        asTrimmedString(output?.result) ??
        asTrimmedString(
          typeof output?.result === "object" && output.result
            ? (output.result as { message?: unknown }).message
            : undefined
        );
      if (!completionText) {
        continue;
      }
      messages.push({
        id: `${event.id}:completed`,
        runId: event.runId,
        threadId,
        workflowId,
        ts: event.ts,
        role: "agent",
        text: completionText
      });
      continue;
    }

    if (event.message === "Inbound user input signal queued") {
      const userMessage = asTrimmedString(event.payload?.message);
      if (!userMessage) {
        continue;
      }
      messages.push({
        id: `${event.id}:signal`,
        runId: event.runId,
        threadId,
        workflowId,
        ts: event.ts,
        role: "user",
        text: userMessage
      });
    }
  }

  return messages;
}

function extractWaitingQuestion(events: RunEvent[]): string | undefined {
  for (const event of events) {
    if (event.message !== "Run waiting for signal") {
      continue;
    }
    const question = asTrimmedString(
      typeof event.payload?.output === "object" && event.payload.output
        ? (event.payload.output as { waitingQuestion?: unknown }).waitingQuestion
        : undefined
    );
    if (question) {
      return question;
    }
  }
  return undefined;
}

function isRunAwaitingUserSignal(events: RunEvent[]): boolean {
  const sorted = events
    .slice()
    .sort((left, right) => new Date(right.ts).getTime() - new Date(left.ts).getTime());
  for (const event of sorted) {
    if (event.message === "Run waiting for signal") {
      return true;
    }
    if (
      event.message === "Workflow signal resumed" ||
      event.message === "Run completed" ||
      event.message === "Run failed"
    ) {
      return false;
    }
  }
  return false;
}

function hasBlockedSignal(event?: RunEvent): boolean {
  if (!event) {
    return false;
  }
  const message = event.message.toLowerCase();
  return message.includes("blocked") || message.includes("approval");
}

function compareIsoDesc(left?: string, right?: string): number {
  const leftTs = left ? new Date(left).getTime() : 0;
  const rightTs = right ? new Date(right).getTime() : 0;
  return rightTs - leftTs;
}

function statusSortOrder(status: AgentDashboardStatus): number {
  switch (status) {
    case "waiting_on_you":
      return 0;
    case "error":
      return 1;
    case "blocked":
      return 2;
    case "active":
      return 3;
    case "idle":
      return 4;
    default:
      return 5;
  }
}

export function createDashboardService(store: ObservabilityStore) {
  async function scopedRunIds(scope?: TenantWorkspaceScope): Promise<Set<string> | null> {
    if (!scope?.tenantId || !scope.workspaceId) {
      return null;
    }
    const data = await store.read();
    const ids = new Set<string>();
    for (const event of data.runEvents) {
      if (scopeMatchesEvent(event, scope)) {
        ids.add(event.runId);
      }
    }
    return ids;
  }

  async function runVisibleInScope(runId: string, scope?: TenantWorkspaceScope): Promise<boolean> {
    if (!scope?.tenantId || !scope.workspaceId) {
      return true;
    }
    const events = await store.listRunEvents(runId);
    return events.some((event) => scopeMatchesEvent(event, scope));
  }

  function buildRunEvent(input: {
    runId: string;
    tenantId: string;
    workspaceId: string;
    message: string;
    payload: RunEvent["payload"];
  }): RunEvent {
    return {
      id: uuidv7(),
      runId: input.runId,
      ts: new Date().toISOString(),
      type: "state",
      level: "info",
      message: input.message,
      payload: input.payload,
      correlationId: input.runId,
      causationId: input.runId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId
    };
  }

  async function inferScheduleMetadata(
    job: WorkflowQueueJob
  ): Promise<Pick<ScheduledRun, "scheduleType" | "cronExpression" | "source">> {
    const events = await store.listRunEvents(job.runId);
    const schedulingEvent = events.find((event) => event.message === "Run queued by planner schedule tool");
    if (!schedulingEvent) {
      return {
        scheduleType: "one_off",
        source: "control_plane"
      };
    }
    const cronValue = schedulingEvent.payload?.cron;
    if (typeof cronValue === "string" && cronValue.length > 0) {
      return {
        scheduleType: "cron",
        cronExpression: cronValue,
        source: "planner_schedule_tool"
      };
    }
    return {
      scheduleType: "one_off",
      source: "planner_schedule_tool"
    };
  }

  return {
    async listAgents(scope?: TenantWorkspaceScope) {
      assertScope(scope);
      const agents = await store.listAgents();
      if (!scope?.tenantId || !scope.workspaceId) {
        return agents;
      }
      const runs = await this.listRuns(scope);
      const visibleAgentIds = new Set(runs.map((run) => run.agentId));
      return agents.filter((agent) => visibleAgentIds.has(agent.id));
    },

    async getAgent(id: string, scope?: TenantWorkspaceScope) {
      assertScope(scope);
      const agent = await store.getAgent(id);
      if (!agent) {
        return undefined;
      }
      if (!scope?.tenantId || !scope.workspaceId) {
        return agent;
      }

      const runs = await store.listRuns({ agentId: id });
      for (const run of runs) {
        if (await runVisibleInScope(run.id, scope)) {
          return agent;
        }
      }
      return undefined;
    },

    async createAgent(input: CreateAgentInput) {
      assertNonEmpty(input.name, "name");
      const id = input.id || uuidv7();
      const owner = input.owner || "unknown"; // Or maybe get from auth context if available
      const env = input.env || "prod";
      const version = input.version || "1.0.0";
      const normalizedSystemPrompt =
        typeof input.systemPrompt === "string" && input.systemPrompt.trim().length > 0
          ? input.systemPrompt.trim()
          : undefined;
      
      const now = new Date().toISOString();
      const agent: Agent = {
        id,
        name: input.name,
        owner,
        env,
        version,
        status: input.status ?? "healthy",
        lastHeartbeatAt: now,
        errorRate: 0,
        avgLatencyMs: 0,
        systemPrompt: normalizedSystemPrompt,
        enabledTools: input.enabledTools
      };
      await store.upsertAgent(agent);
      return agent;
    },

    async listRuns(filter?: RunsFilter & TenantWorkspaceScope) {
      assertScope(filter);
      const runIdSet = await scopedRunIds(filter);
      const runs = await store.listRuns(filter);
      if (!runIdSet) {
        return runs;
      }
      return runs.filter((run) => runIdSet.has(run.id));
    },

    async listAgentSummaries(scope?: TenantWorkspaceScope): Promise<AgentSummary[]> {
      assertScope(scope);
      const [agents, runs] = await Promise.all([this.listAgents(scope), this.listRuns(scope)]);

      const runsByAgent = new Map<string, Run[]>();
      for (const run of runs) {
        const existing = runsByAgent.get(run.agentId);
        if (existing) {
          existing.push(run);
        } else {
          runsByAgent.set(run.agentId, [run]);
        }
      }

      const summaries = await Promise.all(
        agents.map(async (agent) => {
          const agentRuns = (runsByAgent.get(agent.id) ?? []).slice().sort((left, right) =>
            compareIsoDesc(left.startedAt, right.startedAt)
          );
          const latestRun = agentRuns[0];
          if (!latestRun) {
            return {
              agentId: agent.id,
              agentName: agent.name,
              status: "idle",
              lastUpdateAt: agent.lastHeartbeatAt,
              latestOutcomeSummary: "No recent activity.",
              nextPlannedAction: "Waiting for a new request."
            } satisfies AgentSummary;
          }

          const events = (await this.listRunEvents(latestRun.id, scope)).slice().sort((left, right) =>
            compareIsoDesc(left.ts, right.ts)
          );
          const latestEvent = events[0];
          const queuedEvent = events.find((event) => event.message === "Run queued");
          const objectiveSummary = asTrimmedString(queuedEvent?.payload?.objective_prompt);
          const waitingQuestion = extractWaitingQuestion(events);

          if (waitingQuestion) {
            return {
              agentId: agent.id,
              agentName: agent.name,
              objectiveSummary,
              status: "waiting_on_you",
              lastUpdateAt: latestEvent?.ts ?? latestRun.startedAt,
              latestOutcomeSummary: "Waiting for your answer to continue.",
              nextPlannedAction: "Continue as soon as you reply.",
              requiredUserAction: waitingQuestion
            } satisfies AgentSummary;
          }

          if (latestRun.status === "failed") {
            return {
              agentId: agent.id,
              agentName: agent.name,
              objectiveSummary,
              status: "error",
              lastUpdateAt: latestEvent?.ts ?? latestRun.startedAt,
              latestOutcomeSummary: "Last task failed and needs attention.",
              nextPlannedAction: "Review details in advanced diagnostics."
            } satisfies AgentSummary;
          }

          if (hasBlockedSignal(latestEvent)) {
            return {
              agentId: agent.id,
              agentName: agent.name,
              objectiveSummary,
              status: "blocked",
              lastUpdateAt: latestEvent?.ts ?? latestRun.startedAt,
              latestOutcomeSummary: "Work is blocked and needs review.",
              nextPlannedAction: "Resolve blocker and retry."
            } satisfies AgentSummary;
          }

          if (latestRun.status === "queued" || latestRun.status === "running") {
            return {
              agentId: agent.id,
              agentName: agent.name,
              objectiveSummary,
              status: "active",
              lastUpdateAt: latestEvent?.ts ?? latestRun.startedAt,
              latestOutcomeSummary: "Working on your latest request.",
              nextPlannedAction: "Will post an update when complete."
            } satisfies AgentSummary;
          }

          return {
            agentId: agent.id,
            agentName: agent.name,
            objectiveSummary,
            status: "idle",
            lastUpdateAt: latestEvent?.ts ?? latestRun.startedAt,
            latestOutcomeSummary: "Last task completed.",
            nextPlannedAction: "Waiting for a new request."
          } satisfies AgentSummary;
        })
      );

      return summaries.sort((left, right) => {
        const orderDelta = statusSortOrder(left.status) - statusSortOrder(right.status);
        if (orderDelta !== 0) {
          return orderDelta;
        }
        return compareIsoDesc(left.lastUpdateAt, right.lastUpdateAt);
      });
    },

    async listInboxThreads(scope: TenantWorkspaceScope): Promise<InboxThreadSummary[]> {
      assertScope(scope);
      assertNonEmpty(scope.tenantId, "tenantId");
      assertNonEmpty(scope.workspaceId, "workspaceId");

      const runs = await this.listRuns(scope);
      const rows = await Promise.all(
        runs.map(async (run) => {
          const events = await this.listRunEvents(run.id, scope);
          const meta = extractRunRoutingMeta(events);
          if (!meta.threadId || !meta.workflowId) {
            return undefined;
          }
          const messages = projectInboxMessages(events);
          if (messages.length === 0) {
            return undefined;
          }
          return {
            threadId: meta.threadId,
            workflowId: meta.workflowId,
            runId: run.id,
            agentId: run.agentId,
            objectivePrompt: meta.objectivePrompt,
            messages
          };
        })
      );

      const byThread = new Map<
        string,
        {
          threadId: string;
          workflowId: string;
          runId: string;
          agentId: string;
          objectivePrompt?: string;
          messages: InboxMessage[];
        }
      >();

      for (const row of rows) {
        if (!row) {
          continue;
        }
        const current = byThread.get(row.threadId);
        if (!current) {
          byThread.set(row.threadId, row);
          continue;
        }
        const merged = current.messages.concat(row.messages).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
        const currentLast = current.messages[current.messages.length - 1];
        const nextLast = row.messages[row.messages.length - 1];
        const useNext = Boolean(nextLast && currentLast && new Date(nextLast.ts).getTime() > new Date(currentLast.ts).getTime());
        byThread.set(row.threadId, {
          threadId: row.threadId,
          workflowId: useNext ? row.workflowId : current.workflowId,
          runId: useNext ? row.runId : current.runId,
          agentId: useNext ? row.agentId : current.agentId,
          objectivePrompt: current.objectivePrompt ?? row.objectivePrompt,
          messages: merged
        });
      }

      const summaries = await Promise.all(
        Array.from(byThread.values()).map(async (thread) => {
          const snapshot = await store.getWorkflowRuntimeSnapshot(
            scope.tenantId as string,
            scope.workspaceId as string,
            inboxStateWorkflowId(thread.threadId)
          );
          const readAt = asTrimmedString(
            typeof snapshot?.payload === "object" && snapshot.payload
              ? (snapshot.payload as { inboxReadAt?: unknown }).inboxReadAt
              : undefined
          );
          const unreadCount = thread.messages.filter(
            (message) =>
              message.role === "agent" &&
              (!readAt || new Date(message.ts).getTime() > new Date(readAt).getTime())
          ).length;
          const last = thread.messages[thread.messages.length - 1];
          return {
            threadId: thread.threadId,
            workflowId: thread.workflowId,
            runId: thread.runId,
            agentId: thread.agentId,
            objectivePrompt: thread.objectivePrompt,
            lastMessage: last.text,
            lastMessageAt: last.ts,
            unreadCount
          } satisfies InboxThreadSummary;
        })
      );

      return summaries.sort(
        (left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime()
      );
    },

    async listInboxMessages(scope: TenantWorkspaceScope, threadId: string): Promise<InboxMessage[]> {
      assertScope(scope);
      assertNonEmpty(scope.tenantId, "tenantId");
      assertNonEmpty(scope.workspaceId, "workspaceId");
      assertNonEmpty(threadId, "threadId");

      const runs = await this.listRuns(scope);
      const rows = await Promise.all(
        runs.map(async (run) => {
          const events = await this.listRunEvents(run.id, scope);
          const meta = extractRunRoutingMeta(events);
          if (meta.threadId !== threadId) {
            return [] as InboxMessage[];
          }
          return projectInboxMessages(events);
        })
      );

      return rows
        .flat()
        .sort((left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime());
    },

    async markInboxThreadRead(input: MarkInboxThreadReadInput) {
      assertNonEmpty(input.tenantId, "tenantId");
      assertNonEmpty(input.workspaceId, "workspaceId");
      assertNonEmpty(input.threadId, "threadId");
      const readAt = input.readAt ?? new Date().toISOString();
      await store.upsertWorkflowRuntimeSnapshot({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        workflowId: inboxStateWorkflowId(input.threadId),
        payload: { inboxReadAt: readAt }
      });
      return { threadId: input.threadId, readAt };
    },

    async sendInboxMessage(input: SendInboxMessageInput) {
      assertNonEmpty(input.tenantId, "tenantId");
      assertNonEmpty(input.workspaceId, "workspaceId");
      assertNonEmpty(input.message, "message");
      const scope = { tenantId: input.tenantId, workspaceId: input.workspaceId };
      const message = input.message.trim();
      const requestedThreadId = asTrimmedString(input.threadId);
      let resolvedAgentId = asTrimmedString(input.agentId);
      let threadRunMeta:
        | {
            run: Run;
            workflowId: string;
            threadId: string;
            events: RunEvent[];
          }
        | undefined;

      if (requestedThreadId) {
        const runs = await this.listRuns(scope);
        for (const run of runs) {
          const events = await this.listRunEvents(run.id, scope);
          const meta = extractRunRoutingMeta(events);
          if (meta.threadId !== requestedThreadId || !meta.workflowId) {
            continue;
          }
          if (!resolvedAgentId) {
            resolvedAgentId = run.agentId;
          }
          if (!threadRunMeta || new Date(run.startedAt).getTime() > new Date(threadRunMeta.run.startedAt).getTime()) {
            threadRunMeta = {
              run,
              workflowId: meta.workflowId,
              threadId: requestedThreadId,
              events
            };
          }
        }

        if (threadRunMeta && threadRunMeta.run.status === "queued" && isRunAwaitingUserSignal(threadRunMeta.events)) {
          const signalId = uuidv7();
          const occurredAt = new Date().toISOString();
          await store.enqueueWorkflowSignal({
            signalId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            workflowId: threadRunMeta.workflowId,
            runId: threadRunMeta.run.id,
            signalType: "user_input_signal",
            occurredAt,
            payload: {
              message,
              provider: {
                channelType: "web_ui",
                threadId: requestedThreadId
              }
            }
          });

          await store.appendRunEvent({
            id: uuidv7(),
            runId: threadRunMeta.run.id,
            ts: new Date().toISOString(),
            type: "state",
            level: "info",
            message: "Inbound user input signal queued",
            payload: {
              signalId,
              workflowId: threadRunMeta.workflowId,
              threadId: requestedThreadId,
              message,
              channelType: "web_ui"
            },
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            correlationId: threadRunMeta.run.id,
            causationId: signalId
          });

          const objectivePrompt =
            extractObjectivePromptFromQueuedEvent(threadRunMeta.events) ??
            "Continue workflow from pending user input signal.";
          const job = await store.enqueueWorkflowJob({
            id: `job_${uuidv7()}`,
            runId: threadRunMeta.run.id,
            agentId: threadRunMeta.run.agentId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            workflowId: threadRunMeta.workflowId,
            requestId: `req_signal_${signalId}`,
            threadId: requestedThreadId,
            objectivePrompt,
            maxAttempts: 3,
            availableAt: new Date().toISOString()
          });

          return {
            threadId: requestedThreadId,
            run: threadRunMeta.run,
            signalId,
            jobId: job.id
          };
        }
      }

      if (!resolvedAgentId) {
        const agents = await store.listAgents();
        if (agents.length === 0) {
          throw new Error("No agents found. Create an agent before sending inbox messages.");
        }
        resolvedAgentId = agents[0].id;
      }

      const created = await this.dispatchObjectiveRun({
        agentId: resolvedAgentId,
        objectivePrompt: message,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        threadId: requestedThreadId
      });

      return {
        threadId: created.job.threadId,
        ...created
      };
    },

    async getTenantMessagingSettings(tenantId: string, workspaceId: string) {
      assertNonEmpty(tenantId, "tenantId");
      assertNonEmpty(workspaceId, "workspaceId");
      return store.getTenantMessagingSettings(tenantId, workspaceId);
    },

    async upsertTenantMessagingSettings(input: TenantMessagingSettingsInput) {
      assertNonEmpty(input.tenantId, "tenantId");
      const payload: UpsertTenantMessagingSettingsInput = {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        notifierCascade: input.notifierCascade,
        slack: input.slack
      };
      await store.upsertTenantMessagingSettings(payload);
      const resolvedWorkspace = input.workspaceId ?? "default";
      const resolved = await store.getTenantMessagingSettings(input.tenantId, resolvedWorkspace);
      if (!resolved) {
        throw new Error("Unable to read tenant messaging settings after update");
      }
      return resolved;
    },

    async ingestSlackThreadReply(input: IngestSlackThreadReplyInput): Promise<IngestSlackThreadReplyResult> {
      assertNonEmpty(input.providerTeamId, "providerTeamId");
      assertNonEmpty(input.eventId, "eventId");
      assertNonEmpty(input.eventTs, "eventTs");
      assertNonEmpty(input.channelId, "channelId");
      assertNonEmpty(input.threadId, "threadId");
      assertNonEmpty(input.messageId, "messageId");
      assertNonEmpty(input.userId, "userId");
      assertNonEmpty(input.message, "message");

      const mapping = await store.getWorkflowMessageThreadByProviderThread({
        channelType: "slack",
        channelId: input.channelId,
        threadId: input.threadId,
        providerTeamId: input.providerTeamId
      });
      if (!mapping) {
        return { status: "unmapped" };
      }

      const accepted = await store.recordInboundMessageReceipt({
        provider: "slack",
        providerTeamId: input.providerTeamId,
        eventId: input.eventId,
        tenantId: mapping.tenantId,
        workspaceId: mapping.workspaceId
      });
      if (!accepted) {
        return { status: "duplicate" };
      }

      const run = await store.getRun(mapping.runId);
      const existingEvents = await store.listRunEvents(mapping.runId);
      if (!run || run.status !== "queued" || !isRunAwaitingUserSignal(existingEvents)) {
        await store.appendRunEvent({
          id: uuidv7(),
          runId: mapping.runId,
          ts: new Date().toISOString(),
          type: "state",
          level: "warn",
          message: "Slack reply ignored because workflow is not waiting",
          payload: {
            workflowId: mapping.workflowId,
            channelId: input.channelId,
            threadId: input.threadId,
            messageId: input.messageId
          },
          tenantId: mapping.tenantId,
          workspaceId: mapping.workspaceId,
          correlationId: mapping.runId,
          causationId: input.eventId
        });
        return { status: "not_waiting", workflowId: mapping.workflowId, runId: mapping.runId };
      }

      const signalId = uuidv7();
      const signalOccurredAt = new Date(Number.parseFloat(input.eventTs) * 1000);
      const occurredAt = Number.isFinite(signalOccurredAt.getTime())
        ? signalOccurredAt.toISOString()
        : new Date().toISOString();
      const signalPayload = {
        message: input.message,
        provider: {
          channelId: input.channelId,
          userId: input.userId,
          threadId: input.threadId,
          messageId: input.messageId,
          eventId: input.eventId,
          providerTeamId: input.providerTeamId
        }
      } satisfies Record<string, unknown>;

      const signalInput: EnqueueWorkflowSignalInput = {
        signalId,
        tenantId: mapping.tenantId,
        workspaceId: mapping.workspaceId,
        workflowId: mapping.workflowId,
        runId: mapping.runId,
        signalType: "user_input_signal",
        occurredAt,
        payload: signalPayload
      };
      await store.enqueueWorkflowSignal(signalInput);

      await store.appendRunEvent({
        id: uuidv7(),
        runId: mapping.runId,
        ts: new Date().toISOString(),
        type: "state",
        level: "info",
        message: "Inbound user input signal queued",
        payload: {
          signalId,
          workflowId: mapping.workflowId,
          channelId: input.channelId,
          threadId: input.threadId,
          messageId: input.messageId,
          eventId: input.eventId,
          message: input.message
        },
        tenantId: mapping.tenantId,
        workspaceId: mapping.workspaceId,
        correlationId: mapping.runId,
        causationId: input.eventId
      });

      const objectivePrompt =
        extractObjectivePromptFromQueuedEvent(existingEvents) ??
        "Continue workflow from pending user input signal.";
      const job = await store.enqueueWorkflowJob({
        id: `job_${uuidv7()}`,
        runId: mapping.runId,
        agentId: run.agentId,
        tenantId: mapping.tenantId,
        workspaceId: mapping.workspaceId,
        workflowId: mapping.workflowId,
        requestId: `req_signal_${signalId}`,
        threadId: mapping.threadId,
        objectivePrompt,
        maxAttempts: 3,
        availableAt: new Date().toISOString()
      });

      return {
        status: "queued_signal",
        workflowId: mapping.workflowId,
        runId: mapping.runId,
        signalId,
        jobId: job.id
      };
    },

    async getRun(id: string, scope?: TenantWorkspaceScope) {
      assertScope(scope);
      const run = await store.getRun(id);
      if (!run) {
        return undefined;
      }
      if (await runVisibleInScope(id, scope)) {
        return run;
      }
      return undefined;
    },

    async dispatchObjectiveRun(input: DispatchObjectiveInput) {
      assertNonEmpty(input.agentId, "agentId");
      assertNonEmpty(input.objectivePrompt, "objectivePrompt");
      assertNonEmpty(input.tenantId, "tenantId");
      assertNonEmpty(input.workspaceId, "workspaceId");
      const agent = await store.getAgent(input.agentId);
      if (!agent) {
        throw new Error("Agent not found");
      }

      const runId = `run_${uuidv7()}`;
      const requestId = `req_${uuidv7()}`;
      const workflowId = `wf_${uuidv7()}`;
      const threadId = input.threadId ?? workflowId;
      const run: Run = {
        id: runId,
        agentId: input.agentId,
        status: "queued",
        startedAt: new Date().toISOString(),
        traceId: `trace_${uuidv7()}`,
        retries: 0
      };

      const events = [
        buildRunEvent({
          runId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          message: "Run queued",
          payload: {
            objective_prompt: input.objectivePrompt,
            request_id: requestId,
            workflow_id: workflowId,
            thread_id: threadId
          }
        })
      ];

      await store.upsertRun(run);
      for (const event of events) {
        await store.appendRunEvent(event);
      }
      const job = await store.enqueueWorkflowJob({
        id: `job_${uuidv7()}`,
        runId,
        agentId: input.agentId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        workflowId,
        requestId,
        threadId,
        objectivePrompt: input.objectivePrompt,
        maxAttempts: 3,
        availableAt: new Date().toISOString()
      });

      return { run, events, job };
    },

    async createAgentAndRun(input: CreateAgentAndRunInput) {
      const agent = await this.createAgent(input);
      if (input.objectivePrompt && input.tenantId && input.workspaceId) {
        const runResult = await this.dispatchObjectiveRun({
          agentId: agent.id,
          objectivePrompt: input.objectivePrompt,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          threadId: input.threadId || uuidv7()
        });
        return { agent, ...runResult };
      }
      return { agent };
    },

    async listRunEvents(runId: string, scope?: TenantWorkspaceScope) {
      assertScope(scope);
      const events = await store.listRunEvents(runId);
      return events.filter((event) => scopeMatchesEvent(event, scope));
    },

    async listScheduledRuns(limit = 20, scope?: TenantWorkspaceScope): Promise<ScheduledRun[]> {
      assertScope(scope);
      const jobs = await store.listWorkflowJobs({
        statuses: ["queued"],
        availableAfter: new Date().toISOString(),
        tenantId: scope?.tenantId,
        workspaceId: scope?.workspaceId,
        limit
      });

      const scheduled = await Promise.all(
        jobs.map(async (job) => {
          const meta = await inferScheduleMetadata(job);
          return {
            jobId: job.id,
            runId: job.runId,
            agentId: job.agentId,
            workflowId: job.workflowId,
            tenantId: job.tenantId,
            workspaceId: job.workspaceId,
            objectivePrompt: job.objectivePrompt,
            availableAt: job.availableAt,
            scheduleType: meta.scheduleType,
            cronExpression: meta.cronExpression,
            source: meta.source
          } satisfies ScheduledRun;
        })
      );

      return scheduled;
    },

    async listRecentEvents(limit = 10, scope?: TenantWorkspaceScope): Promise<RunEvent[]> {
      assertScope(scope);
      const data = await store.read();

      return data.runEvents
        .filter((event) => scopeMatchesEvent(event, scope))
        .slice()
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
        .slice(0, limit);
    },

    async listIncidents(scope?: TenantWorkspaceScope) {
      return this.listRuns({ status: "failed", ...scope });
    },

    async listAgentRuns(agentId: string, scope?: TenantWorkspaceScope) {
      return this.listRuns({ agentId, ...scope });
    },

    async getMetrics(scope?: TenantWorkspaceScope): Promise<DashboardMetricsResponse> {
      assertScope(scope);
      const [agents, runs, events] = await Promise.all([
        this.listAgents(scope),
        this.listRuns(scope),
        this.listRecentEvents(10_000, scope)
      ]);

      const healthyAgents = agents.filter((agent) => agent.status === "healthy").length;
      const avgErrorRate = agents.length
        ? agents.reduce((total, agent) => total + agent.errorRate, 0) / agents.length
        : 0;
      const avgLatencyMs = agents.length
        ? Math.round(agents.reduce((total, agent) => total + agent.avgLatencyMs, 0) / agents.length)
        : 0;
      const failedRuns24h = runs.filter(
        (run) => run.status === "failed" && isWithinLast24Hours(run.startedAt)
      ).length;

      const runsById = new Map(runs.map((run) => [run.id, run] as const));
      const scopeKeys = new Set<string>();
      for (const event of events) {
        if (event.tenantId && event.workspaceId) {
          scopeKeys.add(`${event.tenantId}:${event.workspaceId}`);
        }
      }

      const tenantSloSummaries = Array.from(scopeKeys.values())
        .map((scopeKey) => {
          const [tenantId, workspaceId] = scopeKey.split(":");
          const scopedRunsByEventId = new Set(
            events
              .filter((event) => event.tenantId === tenantId && event.workspaceId === workspaceId)
              .map((event) => event.runId)
          );
          const scopedRuns = Array.from(scopedRunsByEventId)
            .map((runId) => runsById.get(runId))
            .filter((run): run is NonNullable<typeof run> => Boolean(run));
          const failedRuns = scopedRuns.filter((run) => run.status === "failed").length;
          const latencyRuns = scopedRuns.filter((run) => typeof run.latencyMs === "number");
          const avgLatencyMsForScope = latencyRuns.length
            ? Math.round(
                latencyRuns.reduce((total, run) => total + (run.latencyMs ?? 0), 0) /
                  latencyRuns.length
              )
            : 0;
          const errorRate = scopedRuns.length
            ? Number(((failedRuns / scopedRuns.length) * 100).toFixed(1))
            : 0;
          return {
            tenantId,
            workspaceId,
            totalRuns: scopedRuns.length,
            failedRuns,
            errorRate,
            avgLatencyMs: avgLatencyMsForScope
          };
        })
        .sort((left, right) => {
          if (left.tenantId !== right.tenantId) {
            return left.tenantId.localeCompare(right.tenantId);
          }
          return left.workspaceId.localeCompare(right.workspaceId);
        });

      return {
        healthyAgents,
        totalAgents: agents.length,
        avgErrorRate,
        avgLatencyMs,
        failedRuns24h,
        requestThroughput: events.filter((event) => event.message === "Planner request received").length,
        tenantSloSummaries
      };
    }
  };
}

const dashboardService = createDashboardService(getObservabilityStore());

export const listAgents = dashboardService.listAgents.bind(dashboardService);
export const getAgent = dashboardService.getAgent.bind(dashboardService);
export const createAgent = dashboardService.createAgent.bind(dashboardService);
export const listAgentSummaries = dashboardService.listAgentSummaries.bind(dashboardService);
export const listRuns = dashboardService.listRuns.bind(dashboardService);
export const getRun = dashboardService.getRun.bind(dashboardService);
export const dispatchObjectiveRun = dashboardService.dispatchObjectiveRun.bind(dashboardService);
export const listRunEvents = dashboardService.listRunEvents.bind(dashboardService);
export const listScheduledRuns = dashboardService.listScheduledRuns.bind(dashboardService);
export const listRecentEvents = dashboardService.listRecentEvents.bind(dashboardService);
export const listIncidents = dashboardService.listIncidents.bind(dashboardService);
export const listAgentRuns = dashboardService.listAgentRuns.bind(dashboardService);
export const getMetrics = dashboardService.getMetrics.bind(dashboardService);
export const createAgentAndRun = dashboardService.createAgentAndRun.bind(dashboardService);
export const getTenantMessagingSettings = dashboardService.getTenantMessagingSettings.bind(dashboardService);
export const upsertTenantMessagingSettings = dashboardService.upsertTenantMessagingSettings.bind(dashboardService);
export const ingestSlackThreadReply = dashboardService.ingestSlackThreadReply.bind(dashboardService);
export const listInboxThreads = dashboardService.listInboxThreads.bind(dashboardService);
export const listInboxMessages = dashboardService.listInboxMessages.bind(dashboardService);
export const markInboxThreadRead = dashboardService.markInboxThreadRead.bind(dashboardService);
export const sendInboxMessage = dashboardService.sendInboxMessage.bind(dashboardService);
