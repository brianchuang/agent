import { Agent, ClaimWorkflowJobsInput, CompleteWorkflowJobInput, DashboardData, FailWorkflowJobInput, ObservabilityStore, Run, RunEvent, RunsFilter, WorkflowQueueJob, WorkflowQueueJobCreateInput, WorkflowQueueJobsFilter, UpsertUserInput, UpsertConnectionInput, Connection, User } from "./types";
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
    listWorkflowJobs(filter?: WorkflowQueueJobsFilter): Promise<WorkflowQueueJob[]>;
    claimWorkflowJobs(input: ClaimWorkflowJobsInput): Promise<WorkflowQueueJob[]>;
    completeWorkflowJob(input: CompleteWorkflowJobInput): Promise<void>;
    failWorkflowJob(input: FailWorkflowJobInput): Promise<void>;
    getWorkflowJob(jobId: string): Promise<WorkflowQueueJob | undefined>;
    upsertUser(input: UpsertUserInput): Promise<User>;
    upsertConnection(input: UpsertConnectionInput): Promise<Connection>;
    getConnection(userId: string, providerId: string): Promise<Connection | undefined>;
    deleteConnection(userId: string, providerId: string): Promise<void>;
}
