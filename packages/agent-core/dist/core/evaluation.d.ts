import { PlannerLoopResult, StepStatus, WorkflowStatus } from "./contracts";
export interface PlannerQualityThresholds {
    minSuccessRate: number;
    maxAverageSteps: number;
    minPolicyComplianceRate: number;
}
export interface PlannerQualityScenarioExpected {
    terminalStatus: WorkflowStatus;
    expectedStepStatuses: StepStatus[];
    maxSteps: number;
    requiresPolicyCompliance: boolean;
    noDuplicateStepStatuses?: boolean;
}
export interface PlannerQualityScenario {
    scenarioId: string;
    tenantId: string;
    workspaceId: string;
    objective_prompt: string;
    execute: () => Promise<PlannerLoopResult>;
    expected: PlannerQualityScenarioExpected;
}
export interface PlannerQualitySuite {
    suiteId: string;
    thresholds: PlannerQualityThresholds;
    scenarios: PlannerQualityScenario[];
}
export interface PlannerQualityScenarioReport {
    scenarioId: string;
    tenantId: string;
    workspaceId: string;
    objective_prompt: string;
    expected: PlannerQualityScenarioExpected;
    actual: {
        status: WorkflowStatus;
        stepStatuses: StepStatus[];
        stepCount: number;
    };
    checks: {
        terminalStatusMatch: boolean;
        stepStatusesMatch: boolean;
        maxStepsSatisfied: boolean;
        policyCompliant: boolean;
        signalResumeNoDuplication: boolean;
    };
    passed: boolean;
}
export interface PlannerQualitySummary {
    totalScenarios: number;
    passedScenarios: number;
    successRate: number;
    averageSteps: number;
    policyComplianceRate: number;
    signalResumeNoDuplicationRate: number;
}
export interface PlannerQualityGateResult {
    minSuccessRate: boolean;
    maxAverageSteps: boolean;
    minPolicyComplianceRate: boolean;
}
export interface PlannerQualityReport {
    schema_version: "planner-quality-report-v1";
    suiteId: string;
    thresholds: PlannerQualityThresholds;
    summary: PlannerQualitySummary;
    scenarios: PlannerQualityScenarioReport[];
    gates: PlannerQualityGateResult;
}
export declare function evaluatePlannerQuality(suite: PlannerQualitySuite): Promise<PlannerQualityReport>;
export declare function assertPlannerQualityThresholds(report: PlannerQualityReport): void;
export declare function buildPlannerQualityReportMarkdown(report: PlannerQualityReport): string;
