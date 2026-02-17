"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePlannerQuality = evaluatePlannerQuality;
exports.assertPlannerQualityThresholds = assertPlannerQualityThresholds;
exports.buildPlannerQualityReportMarkdown = buildPlannerQualityReportMarkdown;
async function evaluatePlannerQuality(suite) {
    assertScenarioIdsUnique(suite.scenarios);
    const scenarioReports = [];
    for (const scenario of suite.scenarios) {
        const result = await scenario.execute();
        const stepStatuses = result.steps.map((step) => step.status);
        const checks = {
            terminalStatusMatch: result.status === scenario.expected.terminalStatus,
            stepStatusesMatch: isEqual(stepStatuses, scenario.expected.expectedStepStatuses),
            maxStepsSatisfied: result.steps.length <= scenario.expected.maxSteps,
            policyCompliant: scenario.expected.requiresPolicyCompliance ? !stepStatuses.includes("failed") : true,
            signalResumeNoDuplication: scenario.expected.noDuplicateStepStatuses
                ? !hasAdjacentDuplicateStatuses(stepStatuses)
                : true
        };
        scenarioReports.push({
            scenarioId: scenario.scenarioId,
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
    const summary = summarize(scenarioReports);
    return {
        schema_version: "planner-quality-report-v1",
        suiteId: suite.suiteId,
        thresholds: clone(suite.thresholds),
        summary,
        scenarios: scenarioReports,
        gates: {
            minSuccessRate: summary.successRate >= suite.thresholds.minSuccessRate,
            maxAverageSteps: summary.averageSteps <= suite.thresholds.maxAverageSteps,
            minPolicyComplianceRate: summary.policyComplianceRate >= suite.thresholds.minPolicyComplianceRate
        }
    };
}
function assertPlannerQualityThresholds(report) {
    const failures = [];
    if (!report.gates.minSuccessRate) {
        failures.push(`successRate ${report.summary.successRate.toFixed(3)} < minSuccessRate ${report.thresholds.minSuccessRate.toFixed(3)}`);
    }
    if (!report.gates.maxAverageSteps) {
        failures.push(`averageSteps ${report.summary.averageSteps.toFixed(3)} > maxAverageSteps ${report.thresholds.maxAverageSteps.toFixed(3)}`);
    }
    if (!report.gates.minPolicyComplianceRate) {
        failures.push(`policyComplianceRate ${report.summary.policyComplianceRate.toFixed(3)} < minPolicyComplianceRate ${report.thresholds.minPolicyComplianceRate.toFixed(3)}`);
    }
    if (failures.length === 0) {
        return;
    }
    throw new Error(`Planner quality regression threshold failed: ${failures.join("; ")}`);
}
function buildPlannerQualityReportMarkdown(report) {
    const lines = [];
    lines.push(`# Planner Quality Report: ${report.suiteId}`);
    lines.push("");
    lines.push(`- Success rate: ${report.summary.successRate.toFixed(3)}`);
    lines.push(`- Average steps: ${report.summary.averageSteps.toFixed(3)}`);
    lines.push(`- Policy compliance rate: ${report.summary.policyComplianceRate.toFixed(3)}`);
    lines.push(`- Signal resume no-duplication rate: ${report.summary.signalResumeNoDuplicationRate.toFixed(3)}`);
    lines.push("");
    lines.push("| Scenario | Passed | Status | Steps | No Dup |\n|---|---|---|---|---|");
    for (const scenario of report.scenarios) {
        lines.push(`| ${scenario.scenarioId} | ${scenario.passed ? "yes" : "no"} | ${scenario.actual.status} | ${scenario.actual.stepCount} | ${scenario.checks.signalResumeNoDuplication ? "yes" : "no"} |`);
    }
    lines.push("");
    lines.push(`Threshold gates: success=${report.gates.minSuccessRate ? "pass" : "fail"}, steps=${report.gates.maxAverageSteps ? "pass" : "fail"}, policy=${report.gates.minPolicyComplianceRate ? "pass" : "fail"}`);
    return lines.join("\n");
}
function summarize(reports) {
    const total = reports.length;
    const passed = reports.filter((scenario) => scenario.passed).length;
    const stepsTotal = reports.reduce((sum, scenario) => sum + scenario.actual.stepCount, 0);
    const policyPass = reports.filter((scenario) => scenario.checks.policyCompliant).length;
    const signalScenarios = reports.filter((scenario) => scenario.expected.noDuplicateStepStatuses === true);
    const signalPass = signalScenarios.filter((scenario) => scenario.checks.signalResumeNoDuplication).length;
    return {
        totalScenarios: total,
        passedScenarios: passed,
        successRate: total === 0 ? 0 : round3(passed / total),
        averageSteps: total === 0 ? 0 : round3(stepsTotal / total),
        policyComplianceRate: total === 0 ? 0 : round3(policyPass / total),
        signalResumeNoDuplicationRate: signalScenarios.length === 0 ? 1 : round3(signalPass / signalScenarios.length)
    };
}
function hasAdjacentDuplicateStatuses(statuses) {
    for (let i = 1; i < statuses.length; i += 1) {
        if (statuses[i - 1] === statuses[i]) {
            return true;
        }
    }
    return false;
}
function assertScenarioIdsUnique(scenarios) {
    const seen = new Set();
    for (const scenario of scenarios) {
        if (seen.has(scenario.scenarioId)) {
            throw new Error(`Duplicate planner quality scenarioId: ${scenario.scenarioId}`);
        }
        seen.add(scenario.scenarioId);
    }
}
function round3(value) {
    return Math.round(value * 1000) / 1000;
}
function clone(value) {
    return structuredClone(value);
}
function isEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
