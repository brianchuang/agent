import { PlannerLoopResult, StepStatus, WorkflowStatus } from "./contracts";
export interface CrossDomainScenarioExpected {
    terminalStatus: WorkflowStatus;
    expectedStepStatuses: StepStatus[];
    requiresNoCrossTenantAccess: boolean;
}
export interface CrossDomainScenario {
    scenarioId: string;
    domainId: string;
    tenantId: string;
    workspaceId: string;
    threadId: string;
    objective_prompt: string;
    execute: () => Promise<PlannerLoopResult>;
    expected: CrossDomainScenarioExpected;
}
export interface CrossDomainSuite {
    domainId: string;
    scenarios: CrossDomainScenario[];
}
export interface TenantLoadSummary {
    tenantId: string;
    workspaceId: string;
    workflowIds: string[];
}
export interface CrossDomainLoadResult {
    tenantSummaries: TenantLoadSummary[];
    results: PlannerLoopResult[];
}
export interface CrossDomainScalabilityInput {
    suiteId: string;
    suites: CrossDomainSuite[];
    runLoad?: () => Promise<CrossDomainLoadResult>;
    verifyIsolation?: (result: CrossDomainLoadResult) => void | Promise<void>;
}
export interface CrossDomainScenarioReport {
    scenarioId: string;
    domainId: string;
    tenantId: string;
    workspaceId: string;
    objective_prompt: string;
    expected: CrossDomainScenarioExpected;
    actual: {
        status: WorkflowStatus;
        stepStatuses: StepStatus[];
        stepCount: number;
    };
    checks: {
        terminalStatusMatch: boolean;
        stepStatusesMatch: boolean;
        tenantIsolationMatch: boolean;
    };
    passed: boolean;
}
export interface CrossDomainScalabilitySummary {
    domainCount: number;
    totalScenarios: number;
    passedScenarios: number;
    scenarioPassRate: number;
    isolationPassRate: number;
    loadPassRate: number;
}
export interface CrossDomainScalabilityReport {
    schema_version: "cross-domain-scalability-report-v1";
    suiteId: string;
    summary: CrossDomainScalabilitySummary;
    scenarios: CrossDomainScenarioReport[];
    load: {
        executed: boolean;
        passed: boolean;
        tenantCount: number;
        runCount: number;
    };
}
export declare function evaluateCrossDomainScalability(input: CrossDomainScalabilityInput): Promise<CrossDomainScalabilityReport>;
export declare function assertCrossDomainScalability(report: CrossDomainScalabilityReport): void;
