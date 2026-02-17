import { Agent, ClaimWorkflowJobsInput, CompleteWorkflowJobInput, DashboardData, FailWorkflowJobInput, ObservabilityStore, Run, RunEvent, RunsFilter, WorkflowQueueJob, WorkflowQueueJobCreateInput } from "./types";
export declare class PostgresObservabilityStore implements ObservabilityStore {
    private readonly pool;
    constructor(connectionString: string);
    read(): Promise<DashboardData>;
    private listRecentEvents;
    listAgents(): Promise<Agent[]>;
    getAgent(id: string): Promise<Agent | undefined>;
    upsertAgent(agent: Agent): Promise<void>;
    listRuns(filter?: RunsFilter): Promise<Run[]>;
    getRun(id: string): Promise<Run | undefined>;
    upsertRun(run: Run): Promise<void>;
    listRunEvents(runId: string): Promise<RunEvent[]>;
    appendRunEvent(runEvent: RunEvent): Promise<void>;
    enqueueWorkflowJob(input: WorkflowQueueJobCreateInput): Promise<WorkflowQueueJob>;
    claimWorkflowJobs(input: ClaimWorkflowJobsInput): Promise<WorkflowQueueJob[]>;
    completeWorkflowJob(input: CompleteWorkflowJobInput): Promise<void>;
    failWorkflowJob(input: FailWorkflowJobInput): Promise<void>;
    getWorkflowJob(jobId: string): Promise<WorkflowQueueJob | undefined>;
}
