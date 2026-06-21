export const routingStrategies = [
  {
    id: "cost_optimized",
    label: "Cost optimized",
    description: "Prefer cheaper models and local rules; escalate only when verifier confidence is low.",
    stageModels: {
      image_understanding: "mini_multimodal",
      plan_generation: "mini_planner",
      material_matching: "local_rules",
      verification: "local_rules",
      formatting: "local_renderer"
    },
    escalation: {
      enabled: true,
      triggers: ["low_visual_confidence", "high_risk_terms", "missing_dimensions"],
      fallbackStage: "plan_generation",
      fallbackModel: "strong_multimodal"
    }
  },
  {
    id: "quality_first",
    label: "Quality first",
    description: "Use the strongest model for visual understanding and planning, then localize cheap deterministic stages.",
    stageModels: {
      image_understanding: "strong_multimodal",
      plan_generation: "strong_multimodal",
      material_matching: "local_rules",
      verification: "mini_judge",
      formatting: "local_renderer"
    },
    escalation: {
      enabled: false,
      triggers: [],
      fallbackStage: null,
      fallbackModel: null
    }
  },
  {
    id: "local_first",
    label: "Local first",
    description: "Run deterministic/local stages by default; useful as a floor baseline for cost and latency.",
    stageModels: {
      image_understanding: "local_vision_stub",
      plan_generation: "local_template",
      material_matching: "local_rules",
      verification: "local_rules",
      formatting: "local_renderer"
    },
    escalation: {
      enabled: true,
      triggers: ["user_requests_cloud", "unsupported_category"],
      fallbackStage: "image_understanding",
      fallbackModel: "mini_multimodal"
    }
  },
  {
    id: "cascade",
    label: "Cascade",
    description: "Try a cheaper multimodal planner first, then use verifier signals to decide whether to retry with a stronger model.",
    stageModels: {
      image_understanding: "mini_multimodal",
      plan_generation: "mini_planner",
      material_matching: "local_rules",
      verification: "mini_judge",
      formatting: "local_renderer"
    },
    escalation: {
      enabled: true,
      triggers: ["buildability_below_threshold", "cost_inconsistency", "high_risk_terms"],
      fallbackStage: "plan_generation",
      fallbackModel: "strong_multimodal"
    }
  },
  {
    id: "local_mlx",
    label: "Local MLX",
    description: "Run image understanding and planning on a local Apple Silicon MLX model, with deterministic local retrieval, verification, and rendering. Escalate to cloud only on low confidence or high risk.",
    stageModels: {
      image_understanding: "local_mlx_multimodal",
      plan_generation: "local_mlx_multimodal",
      material_matching: "local_rules",
      verification: "local_rules",
      formatting: "local_renderer"
    },
    escalation: {
      enabled: true,
      triggers: ["low_visual_confidence", "high_risk_terms", "buildability_below_threshold"],
      fallbackStage: "plan_generation",
      fallbackModel: "strong_multimodal"
    }
  }
];

export const modelProfiles = {
  strong_multimodal: {
    displayName: process.env.OPENAI_STRONG_MODEL || "gpt-4.1",
    provider: "cloud",
    relativeInputCost: 8,
    relativeOutputCost: 24,
    latencyClass: "high",
    notes: "Best for visual ambiguity, complex spatial reasoning, and high-stakes planning."
  },
  mini_multimodal: {
    displayName: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    provider: "cloud",
    relativeInputCost: 1,
    relativeOutputCost: 4,
    latencyClass: "medium",
    notes: "Default cloud model for low-cost image understanding and structured planning."
  },
  mini_planner: {
    displayName: process.env.OPENAI_ROUTER_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    provider: "cloud",
    relativeInputCost: 1,
    relativeOutputCost: 4,
    latencyClass: "medium",
    notes: "Good candidate for plan generation when task risk is low."
  },
  mini_judge: {
    displayName: process.env.OPENAI_ROUTER_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    provider: "cloud",
    relativeInputCost: 1,
    relativeOutputCost: 2,
    latencyClass: "low",
    notes: "Cheap verifier or reranker model."
  },
  local_mlx_multimodal: {
    displayName: process.env.DIYPLAN_VLM_MODEL || "Qwen3-VL-4B-Instruct-4bit",
    provider: "local-mlx",
    relativeInputCost: 0,
    relativeOutputCost: 0,
    latencyClass: "medium",
    notes: "On-device MLX vision-language model for image understanding and structured planning. No per-token API cost; latency depends on Apple Silicon."
  },
  local_vision_stub: {
    displayName: "local-vision-stub",
    provider: "local",
    relativeInputCost: 0,
    relativeOutputCost: 0,
    latencyClass: "low",
    notes: "Placeholder for local vision tags or deterministic fixtures."
  },
  local_template: {
    displayName: "local-template",
    provider: "local",
    relativeInputCost: 0,
    relativeOutputCost: 0,
    latencyClass: "low",
    notes: "Deterministic fallback plan generator."
  },
  local_rules: {
    displayName: "local-rules",
    provider: "local",
    relativeInputCost: 0,
    relativeOutputCost: 0,
    latencyClass: "low",
    notes: "Catalog matching and safety checks should not require a frontier model."
  },
  local_renderer: {
    displayName: "local-renderer",
    provider: "local",
    relativeInputCost: 0,
    relativeOutputCost: 0,
    latencyClass: "low",
    notes: "Deterministic UI and JSON formatting."
  }
};

const stageTokenBudget = {
  image_understanding: { inputTokens: 900, outputTokens: 220 },
  plan_generation: { inputTokens: 1300, outputTokens: 1800 },
  material_matching: { inputTokens: 450, outputTokens: 250 },
  verification: { inputTokens: 900, outputTokens: 320 },
  formatting: { inputTokens: 300, outputTokens: 450 }
};

export function listRoutingStrategies() {
  return routingStrategies.map(({ id, label, description }) => ({ id, label, description }));
}

export function getRoutingStrategy(id) {
  return routingStrategies.find((strategy) => strategy.id === id) || routingStrategies[0];
}

export function buildRoutingPolicy(strategy) {
  return Object.entries(strategy.stageModels).map(([stage, profileId]) => {
    const profile = modelProfiles[profileId];
    const budget = stageTokenBudget[stage] || { inputTokens: 0, outputTokens: 0 };
    return {
      stage,
      preferred_model: profile.displayName,
      provider: profile.provider,
      latency_class: profile.latencyClass,
      estimated_input_tokens: budget.inputTokens,
      estimated_output_tokens: budget.outputTokens,
      relative_cost_units: estimateStageCost(profile, budget),
      reason: profile.notes
    };
  });
}

export function estimateRoutingCost(strategy) {
  const stages = buildRoutingPolicy(strategy);
  return {
    total_relative_cost_units: round2(
      stages.reduce((sum, item) => sum + item.relative_cost_units, 0)
    ),
    cloud_stage_count: stages.filter((item) => item.provider === "cloud").length,
    local_stage_count: stages.filter((item) => item.provider !== "cloud").length,
    stages
  };
}

export function chooseCloudModelForPlan(strategy) {
  const planProfile = modelProfiles[strategy.stageModels.plan_generation];
  if (planProfile?.provider === "cloud") return planProfile.displayName;

  const imageProfile = modelProfiles[strategy.stageModels.image_understanding];
  if (imageProfile?.provider === "cloud") return imageProfile.displayName;

  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

export function strategyPrefersLocalMlx(strategy) {
  return (
    modelProfiles[strategy.stageModels.plan_generation]?.provider === "local-mlx" ||
    modelProfiles[strategy.stageModels.image_understanding]?.provider === "local-mlx"
  );
}

export function shouldUseCloud(preferences, strategy) {
  const planProvider = modelProfiles[strategy.stageModels.plan_generation]?.provider;
  const imageProvider = modelProfiles[strategy.stageModels.image_understanding]?.provider;
  const userRequestedCloud = preferences.routingStrategy === "quality_first" || preferences.routingStrategy === "cascade";
  return Boolean(
    process.env.OPENAI_API_KEY &&
      preferences.imageDataUrl &&
      (planProvider === "cloud" || imageProvider === "cloud" || userRequestedCloud)
  );
}

export function detectEscalationTriggers({ plan, preferences }) {
  const triggers = [];
  const visualConfidence = plan.detected_object?.confidence ?? 0;
  const buildability = plan.evaluation?.buildability_score ?? 0;
  const missingInputs = plan.evaluation?.missing_inputs || [];
  const risk = plan.evaluation?.risk_level || "low";

  if (visualConfidence < 0.5) triggers.push("low_visual_confidence");
  if (buildability < 70) triggers.push("buildability_below_threshold");
  if (!preferences.targetSize || missingInputs.length) triggers.push("missing_dimensions");
  if (risk === "high") triggers.push("high_risk_terms");

  const lineItemCost = (plan.materials || []).reduce((sum, item) => {
    return sum + item.quantity * item.estimated_unit_cost_usd;
  }, 0);
  const highEstimate = plan.estimated_total_cost_usd?.high || 0;
  if (highEstimate && lineItemCost > highEstimate * 1.35) triggers.push("cost_inconsistency");

  return Array.from(new Set(triggers));
}

function estimateStageCost(profile, budget) {
  const input = (budget.inputTokens / 1000) * profile.relativeInputCost;
  const output = (budget.outputTokens / 1000) * profile.relativeOutputCost;
  return round2(input + output);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
