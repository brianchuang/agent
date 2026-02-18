import {
  Agent,
  DashboardMetrics,
  ObservabilityStore,
  Run,
  RunEvent,
  RunsFilter,
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
        systemPrompt: input.systemPrompt,
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
