import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan } from "../src/planner.js";
import { listRoutingStrategies } from "../src/routing.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const casesPath = path.join(rootDir, "data", "benchmark_cases.json");
const reportsDir = path.join(rootDir, "reports");

const cases = JSON.parse(await readFile(casesPath, "utf8"));
const strategies = listRoutingStrategies();
const startedAt = performance.now();
const results = [];

for (const strategy of strategies) {
  for (const item of cases) {
    const result = await generatePlan({
      ...item.input,
      routingStrategy: strategy.id
    });
    const expectation = checkExpectations(result, item.expected || {});
    results.push({
      case_id: item.id,
      case_description: item.description,
      strategy_id: strategy.id,
      strategy_label: strategy.label,
      expected_pass: expectation.pass,
      expected_checks: expectation.checks,
      mode: result.mode,
      overall_score: result.evaluation_report.overall_score,
      score_dimensions: result.evaluation_report.dimensions,
      issues: result.evaluation_report.issues,
      risk_level: result.plan.evaluation.risk_level,
      buildability_score: result.plan.evaluation.buildability_score,
      relative_cost_units: result.routing_cost.total_relative_cost_units,
      cloud_stage_count: result.routing_cost.cloud_stage_count,
      total_latency_ms: result.metrics.total_latency_ms,
      triggered_escalations: result.triggered_escalations
    });
  }
}

const summary = summarize(results);
const report = {
  generated_at: new Date().toISOString(),
  benchmark_mode: process.env.OPENAI_API_KEY ? "cloud-capable" : "mock/local",
  case_count: cases.length,
  strategy_count: strategies.length,
  elapsed_ms: Math.round(performance.now() - startedAt),
  summary,
  results
};

await mkdir(reportsDir, { recursive: true });
await writeFile(path.join(reportsDir, "benchmark-latest.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(reportsDir, "benchmark-summary.md"), renderMarkdown(report));

console.log(JSON.stringify(summary, null, 2));

function summarize(rows) {
  return strategies.map((strategy) => {
    const subset = rows.filter((row) => row.strategy_id === strategy.id);
    return {
      strategy_id: strategy.id,
      strategy_label: strategy.label,
      avg_overall_score: average(subset.map((row) => row.overall_score)),
      avg_buildability_score: average(subset.map((row) => row.buildability_score)),
      avg_relative_cost_units: average(subset.map((row) => row.relative_cost_units)),
      avg_latency_ms: average(subset.map((row) => row.total_latency_ms)),
      avg_cloud_stage_count: average(subset.map((row) => row.cloud_stage_count)),
      expected_pass_rate: average(subset.map((row) => (row.expected_pass ? 100 : 0))),
      issue_count: subset.reduce((sum, row) => sum + row.issues.length, 0),
      escalation_count: subset.reduce((sum, row) => sum + row.triggered_escalations.length, 0)
    };
  });
}

function average(values) {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function renderMarkdown(report) {
  const lines = [
    "# DIYPlan Agent Benchmark",
    "",
    `Generated at: ${report.generated_at}`,
    "",
    "## Strategy Summary",
    "",
    "| Strategy | Avg Quality | Expected Pass | Avg Buildability | Relative Cost | Avg Latency | Issues | Escalations |",
    "|---|---:|---:|---:|---:|---:|---:|---:|"
  ];

  for (const item of report.summary) {
    lines.push(
      `| ${item.strategy_label} | ${item.avg_overall_score} | ${item.expected_pass_rate}% | ${item.avg_buildability_score} | ${item.avg_relative_cost_units} | ${item.avg_latency_ms} ms | ${item.issue_count} | ${item.escalation_count} |`
    );
  }

  lines.push("", "## Case Results", "");
  for (const row of report.results) {
    lines.push(
      `- ${row.case_id} / ${row.strategy_label}: pass ${row.expected_pass ? "yes" : "no"}, quality ${row.overall_score}, cost ${row.relative_cost_units}, risk ${row.risk_level}, issues ${row.issues.length}`
    );
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function checkExpectations(result, expected) {
  const checks = [];
  const plan = result.plan;
  const projectAndSteps = [
    plan.project?.summary,
    plan.project?.recommended_scope,
    ...(plan.steps || []).map((step) => `${step.title} ${step.detail}`)
  ].join(" ");

  if (expected.riskLevel) {
    checks.push({
      name: "risk_level",
      pass: plan.evaluation.risk_level === expected.riskLevel,
      actual: plan.evaluation.risk_level,
      expected: expected.riskLevel
    });
  }

  if (expected.minimumMaterials) {
    checks.push({
      name: "minimum_materials",
      pass: (plan.materials || []).length >= expected.minimumMaterials,
      actual: (plan.materials || []).length,
      expected: expected.minimumMaterials
    });
  }

  if (expected.minimumSteps) {
    checks.push({
      name: "minimum_steps",
      pass: (plan.steps || []).length >= expected.minimumSteps,
      actual: (plan.steps || []).length,
      expected: expected.minimumSteps
    });
  }

  if (expected.shouldFlagMissingDimensions) {
    const missingInputs = (plan.evaluation.missing_inputs || []).join(" ").toLowerCase();
    checks.push({
      name: "missing_dimensions_flag",
      pass: missingInputs.includes("dimension"),
      actual: plan.evaluation.missing_inputs,
      expected: "dimension-related missing input"
    });
  }

  if (expected.shouldAvoidElectrical) {
    checks.push({
      name: "avoid_electrical_steps",
      pass: !/\b(wire|wiring|outlet|voltage|electrical circuit)\b/i.test(projectAndSteps),
      actual: "project summary and build steps inspected",
      expected: "no electrical build instructions"
    });
  }

  return {
    pass: checks.every((check) => check.pass),
    checks
  };
}
