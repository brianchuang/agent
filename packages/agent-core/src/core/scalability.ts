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

export async function evaluateCrossDomainScalability(
  input: CrossDomainScalabilityInput
): Promise<CrossDomainScalabilityReport> {
  const scenarios = flattenScenarios(input.suites);
  assertScenarioIdsUnique(scenarios);

  const scenarioReports: CrossDomainScenarioReport[] = [];
  for (const scenario of scenarios) {
    const result = await scenario.execute();
    const stepStatuses = result.steps.map((step) => step.status);
    const checks = {
      terminalStatusMatch: result.status === scenario.expected.terminalStatus,
      stepStatusesMatch: isEqual(stepStatuses, scenario.expected.expectedStepStatuses),
      tenantIsolationMatch: scenario.expected.requiresNoCrossTenantAccess
        ? result.steps.every(
            (step) =>
              step.tenantId === scenario.tenantId &&
              step.workspaceId === scenario.workspaceId &&
              step.threadId === scenario.threadId
          )
        : true
    };

    scenarioReports.push({
      scenarioId: scenario.scenarioId,
      domainId: scenario.domainId,
      tenantId: scenario.tenantId,
      workspaceId: scenario.workspaceId,
      objective_prompt: scenario.objective_prompt,
      expected: clone(scenario.expected),
      actual: {
        status: result.status,
        stepStatuses,
        stepCount: result.steps.length
      },
      checks,
      passed: Object.values(checks).every(Boolean)
    });
  }

  const load = {
    executed: false,
    passed: true,
    tenantCount: 0,
    runCount: 0
  };
  if (input.runLoad) {
    load.executed = true;
    try {
      const loadResult = await input.runLoad();
      if (input.verifyIsolation) {
        await input.verifyIsolation(loadResult);
      }
      load.tenantCount = loadResult.tenantSummaries.length;
      load.runCount = loadResult.results.length;
      load.passed = loadResult.results.every((result) => result.status !== "failed");
    } catch {
      load.passed = false;
    }
  }

  const summary = summarize(input.suites, scenarioReports, load.passed);
  return {
    schema_version: "cross-domain-scalability-report-v1",
    suiteId: input.suiteId,
    summary,
    scenarios: scenarioReports,
    load
  };
}

export function assertCrossDomainScalability(report: CrossDomainScalabilityReport): void {
  const failures: string[] = [];
  if (report.summary.domainCount < 2) {
    failures.push(`domainCount ${report.summary.domainCount} < 2`);
  }
  if (report.summary.scenarioPassRate < 1) {
    failures.push(`scenarioPassRate ${report.summary.scenarioPassRate.toFixed(3)} < 1.000`);
  }
  if (report.summary.isolationPassRate < 1) {
    failures.push(`isolationPassRate ${report.summary.isolationPassRate.toFixed(3)} < 1.000`);
  }
  if (report.load.executed && report.summary.loadPassRate < 1) {
    failures.push(`loadPassRate ${report.summary.loadPassRate.toFixed(3)} < 1.000`);
  }

  if (failures.length > 0) {
    throw new Error(`Cross-domain scalability validation failed: ${failures.join("; ")}`);
  }
}

function summarize(
  suites: CrossDomainSuite[],
  reports: CrossDomainScenarioReport[],
  loadPassed: boolean
): CrossDomainScalabilitySummary {
  const totalScenarios = reports.length;
  const passedScenarios = reports.filter((scenario) => scenario.passed).length;
  const isolationRelevant = reports.filter((scenario) => scenario.expected.requiresNoCrossTenantAccess);
  const isolationPassed = isolationRelevant.filter((scenario) => scenario.checks.tenantIsolationMatch).length;

  return {
    domainCount: new Set(suites.map((suite) => suite.domainId)).size,
    totalScenarios,
    passedScenarios,
    scenarioPassRate: totalScenarios === 0 ? 0 : round3(passedScenarios / totalScenarios),
    isolationPassRate:
      isolationRelevant.length === 0 ? 1 : round3(isolationPassed / isolationRelevant.length),
    loadPassRate: loadPassed ? 1 : 0
  };
}

function flattenScenarios(suites: CrossDomainSuite[]): CrossDomainScenario[] {
  const scenarios: CrossDomainScenario[] = [];
  for (const suite of suites) {
    for (const scenario of suite.scenarios) {
      scenarios.push(scenario);
    }
  }
  return scenarios;
}

function assertScenarioIdsUnique(scenarios: CrossDomainScenario[]): void {
  const seen = new Set<string>();
  for (const scenario of scenarios) {
    if (seen.has(scenario.scenarioId)) {
      throw new Error(`Duplicate cross-domain scenarioId: ${scenario.scenarioId}`);
    }
    seen.add(scenario.scenarioId);
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
