export function evaluatePlanQuality({ plan, purchaseLinks, trace, routingCost }) {
  const completeness = scoreCompleteness(plan);
  const safety = scoreSafety(plan);
  const materials = scoreMaterials(plan, purchaseLinks);
  const cost = scoreCostConsistency(plan);
  const observability = scoreObservability(trace, routingCost);
  const overall = Math.round(
    completeness.score * 0.28 +
      safety.score * 0.24 +
      materials.score * 0.2 +
      cost.score * 0.14 +
      observability.score * 0.14
  );

  return {
    overall_score: overall,
    dimensions: {
      completeness,
      safety,
      materials,
      cost_consistency: cost,
      observability
    },
    issues: [
      ...completeness.issues,
      ...safety.issues,
      ...materials.issues,
      ...cost.issues,
      ...observability.issues
    ]
  };
}

function scoreCompleteness(plan) {
  const missingInputs = plan.evaluation?.missing_inputs || [];
  const checks = [
    ["project summary", Boolean(plan.project?.summary)],
    ["detected object category", Boolean(plan.detected_object?.category)],
    ["visible parts", (plan.detected_object?.visible_parts || []).length >= 3],
    ["materials", (plan.materials || []).length >= 4],
    ["tools", (plan.tools || []).length >= 4],
    ["steps", (plan.steps || []).length >= 4],
    ["safety checks", (plan.safety_checks || []).length >= 2],
    ["dimensions", Boolean(plan.dimensions?.width_in && plan.dimensions?.depth_in && plan.dimensions?.height_in)]
  ];
  const result = fromChecks(checks);
  const inputIssues = missingInputs.map((item) => `Verifier missing input: ${item}`);
  return {
    score: Math.max(0, result.score - inputIssues.length * 6),
    issues: [...result.issues, ...inputIssues]
  };
}

function scoreSafety(plan) {
  const issues = [];
  const text = [
    plan.project?.summary,
    plan.project?.recommended_scope,
    ...(plan.steps || []).map((step) => `${step.title} ${step.detail} ${step.safety_notes}`)
  ].join(" ");
  const highRisk = /\b(electrical|wiring|ceiling|gas|plumbing|load-bearing|child crib|ladder)\b/i.test(text);

  if (highRisk && plan.evaluation?.risk_level !== "high") {
    issues.push("High-risk terms were present but risk level was not high.");
  }
  if ((plan.safety_checks || []).length < 2) {
    issues.push("Safety section is too thin for a physical build.");
  }

  const score = highRisk ? 68 : 94;
  return {
    score: Math.max(0, score - issues.length * 12),
    issues
  };
}

function scoreMaterials(plan, purchaseLinks) {
  const issues = [];
  const materials = plan.materials || [];
  const linkCoverage = materials.length ? purchaseLinks.length / materials.length : 0;
  const hasAlternatives = materials.filter((item) => (item.alternatives || []).length > 0).length;

  if (materials.length < 4) issues.push("Material list has fewer than four items.");
  if (linkCoverage < 0.8) issues.push("Store-link coverage is below 80%.");
  if (hasAlternatives < Math.min(3, materials.length)) issues.push("Most materials should include alternatives.");

  const score = Math.round(Math.min(100, 35 + materials.length * 9 + linkCoverage * 25 + hasAlternatives * 4));
  return {
    score: Math.max(0, score - issues.length * 8),
    issues
  };
}

function scoreCostConsistency(plan) {
  const issues = [];
  const low = plan.estimated_total_cost_usd?.low || 0;
  const high = plan.estimated_total_cost_usd?.high || 0;
  const lineItemCost = (plan.materials || []).reduce((sum, item) => {
    return sum + item.quantity * item.estimated_unit_cost_usd;
  }, 0);

  if (!low || !high || high < low) issues.push("Cost estimate range is missing or inverted.");
  if (lineItemCost && high && lineItemCost > high * 1.35) {
    issues.push("Line-item material cost is much higher than the stated estimate.");
  }
  if (lineItemCost && low && lineItemCost < low * 0.45) {
    issues.push("Line-item material cost is much lower than the stated estimate.");
  }

  return {
    score: Math.max(0, 96 - issues.length * 18),
    issues
  };
}

function scoreObservability(trace, routingCost) {
  const issues = [];
  const stageNames = new Set((trace || []).map((item) => item.name));

  for (const required of ["input-normalization", "material-linking", "safety-verifier", "routing-policy"]) {
    if (!stageNames.has(required)) issues.push(`Missing trace stage: ${required}.`);
  }
  if (!routingCost || typeof routingCost.total_relative_cost_units !== "number") {
    issues.push("Routing cost estimate is missing.");
  }

  return {
    score: Math.max(0, 100 - issues.length * 18),
    issues
  };
}

function fromChecks(checks) {
  const passed = checks.filter(([, ok]) => ok).length;
  const issues = checks.filter(([, ok]) => !ok).map(([name]) => `Missing or weak field: ${name}.`);
  return {
    score: Math.round((passed / checks.length) * 100),
    issues
  };
}
