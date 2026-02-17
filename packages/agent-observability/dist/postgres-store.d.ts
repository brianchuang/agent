import { Agent, DashboardData, ObservabilityStore, Run, RunEvent, RunsFilter } from "./types";
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
}
