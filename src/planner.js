import { buildStoreLinks, catalogContext } from "./materialCatalog.js";
import { callOpenAIPlan } from "./openai.js";
import { evaluatePlanQuality } from "./evaluator.js";
import {
  buildRoutingPolicy,
  chooseCloudModelForPlan,
  detectEscalationTriggers,
  estimateRoutingCost,
  getRoutingStrategy,
  shouldUseCloud
} from "./routing.js";

export async function generatePlan(payload) {
  const preferences = normalizePreferences(payload);
  const strategy = getRoutingStrategy(preferences.routingStrategy);
  const routingPolicy = buildRoutingPolicy(strategy);
  const routingCost = estimateRoutingCost(strategy);
  const startedAt = performance.now();
  const trace = [];

  trace.push(stage("input-normalization", "local", "Validated image, constraints, and budget inputs.", 4));

  let plan;
  let cloudMetrics = null;
  let mode = "mock";

  if (shouldUseCloud(preferences, strategy)) {
    const cloudStartedAt = performance.now();
    const modelOverride = chooseCloudModelForPlan(strategy);
    const result = await callOpenAIPlan({
      imageDataUrl: preferences.imageDataUrl,
      preferences,
      catalogContextText: catalogContext(),
      modelOverride
    });
    plan = result.plan;
    cloudMetrics = result.metrics;
    mode = "cloud";
    trace.push(
      stage(
        "multimodal-planning",
        result.metrics.model,
        `Single-call prototype using ${strategy.label}; later versions can split this into routed stages.`,
        Math.round(performance.now() - cloudStartedAt)
      )
    );
  } else {
    const fallbackStartedAt = performance.now();
    plan = fallbackPlan(preferences);
    trace.push(
      stage(
        "mock-planning",
        strategy.stageModels.plan_generation,
        "Cloud call was skipped, so the demo returned a deterministic sample plan for routing and benchmark development.",
        Math.round(performance.now() - fallbackStartedAt)
      )
    );
  }

  const verified = verifyPlan(plan, preferences);
  const purchaseLinks = buildStoreLinks(verified.materials, preferences.zipcode);
  const triggeredEscalations = detectEscalationTriggers({ plan: verified, preferences });

  trace.push(stage("material-linking", "local-rules", "Mapped generated materials to store search links.", 7));
  trace.push(stage("safety-verifier", "local-rules", "Checked risk terms and missing user constraints.", 5));
  trace.push(
    stage(
      "routing-policy",
      strategy.id,
      `${strategy.label}: ${strategy.description}`,
      3
    )
  );

  if (triggeredEscalations.length) {
    trace.push(
      stage(
        "escalation-check",
        strategy.escalation.enabled ? strategy.escalation.fallbackModel || "fallback" : "disabled",
        `Verifier triggered: ${triggeredEscalations.join(", ")}.`,
        2
      )
    );
  }

  const metrics = {
    total_latency_ms: Math.round(performance.now() - startedAt),
    cloud_latency_ms: cloudMetrics?.cloud_latency_ms || 0,
    model: cloudMetrics?.model || strategy.stageModels.plan_generation,
    routing_strategy: strategy.id,
    estimated_call_count: mode === "cloud" ? 1 : 0,
    relative_cost_units: routingCost.total_relative_cost_units,
    cloud_stage_count: routingCost.cloud_stage_count
  };

  const evaluationReport = evaluatePlanQuality({
    plan: verified,
    purchaseLinks,
    trace,
    routingCost
  });

  return {
    mode,
    generated_at: new Date().toISOString(),
    metrics,
    routing_strategy: {
      id: strategy.id,
      label: strategy.label,
      description: strategy.description,
      escalation: strategy.escalation
    },
    routing_policy: routingPolicy,
    routing_cost: routingCost,
    triggered_escalations: triggeredEscalations,
    evaluation_report: evaluationReport,
    trace,
    plan: verified,
    purchase_links: purchaseLinks
  };
}

function normalizePreferences(payload = {}) {
  const imageDataUrl = String(payload.imageDataUrl || "");
  if (imageDataUrl && !imageDataUrl.startsWith("data:image/")) {
    const error = new Error("imageDataUrl must be a data:image URL.");
    error.statusCode = 400;
    throw error;
  }

  return {
    imageDataUrl,
    furnitureType: String(payload.furnitureType || "auto").slice(0, 80),
    targetSize: String(payload.targetSize || "").slice(0, 120),
    budget: String(payload.budget || "").slice(0, 80),
    skillLevel: String(payload.skillLevel || "beginner").slice(0, 40),
    zipcode: String(payload.zipcode || "").replace(/[^\d-]/g, "").slice(0, 10),
    tools: Array.isArray(payload.tools) ? payload.tools.map((tool) => String(tool).slice(0, 60)) : [],
    routingStrategy: String(payload.routingStrategy || "cost_optimized").slice(0, 80)
  };
}

function verifyPlan(plan, preferences) {
  const next = structuredClone(plan);
  const notes = new Set(next.evaluation.verifier_notes || []);

  if (!preferences.targetSize) {
    next.evaluation.missing_inputs.push("Target dimensions should be confirmed before buying materials.");
    notes.add("The current dimensions are model estimates, not measurements from the image.");
  }

  if (!preferences.zipcode) {
    notes.add("Zip code is missing, so purchase links are generic store searches.");
  }

  const highRiskTerms = /\b(electrical|wiring|load-bearing|ceiling|gas|plumbing|ladder)\b/i;
  const combined = [
    next.project.summary,
    next.project.recommended_scope,
    ...next.steps.map((step) => `${step.title} ${step.detail}`)
  ].join(" ");

  if (highRiskTerms.test(combined)) {
    next.evaluation.risk_level = "high";
    next.safety_checks.push("High-risk work detected. Replace with a non-electrical, non-structural simplified build.");
    notes.add("The verifier flagged high-risk terms that should be scoped down before a real build.");
  }

  const materialCost = next.materials.reduce((sum, item) => {
    return sum + item.quantity * item.estimated_unit_cost_usd;
  }, 0);

  if (materialCost > next.estimated_total_cost_usd.high * 1.35) {
    notes.add("Material line items exceed the high-end estimate; cost estimate should be recalibrated.");
  }

  next.evaluation.verifier_notes = Array.from(notes);
  next.routing_notes = [
    ...next.routing_notes,
    "Future version: route material normalization and verifier passes to a smaller local model."
  ];

  return next;
}

function stage(name, model, note, latencyMs) {
  return {
    name,
    model,
    note,
    latency_ms: latencyMs
  };
}

function fallbackPlan(preferences) {
  const type = preferences.furnitureType && preferences.furnitureType !== "auto" ? preferences.furnitureType : "side table";

  return {
    project: {
      title: `Simplified ${titleCase(type)} Build`,
      summary:
        "A beginner-friendly, inspired-by furniture plan using common boards, square joinery, and a durable clear finish.",
      inspired_by_style: "clean modern wood furniture with visible grain and simple geometry",
      recommended_scope:
        "Build a simplified table or shelf form rather than copying the original image detail-for-detail."
    },
    detected_object: {
      category: type,
      visible_parts: ["top panel", "side supports", "lower stretcher", "simple rectangular frame"],
      likely_materials: ["pine board", "wood screws", "wood glue", "clear polyurethane"],
      confidence: preferences.imageDataUrl ? 0.52 : 0.2
    },
    assumptions: [
      "The image is treated as visual inspiration, not an exact technical drawing.",
      "Final dimensions should be measured by the builder before cutting.",
      "The plan avoids electrical work and complex load-bearing joinery."
    ],
    difficulty: preferences.skillLevel === "advanced" ? "intermediate" : "beginner",
    estimated_total_cost_usd: {
      low: 55,
      high: 115,
      notes: "Estimate assumes common pine boards and basic finish from a US hardware store."
    },
    dimensions: {
      width_in: 24,
      depth_in: 18,
      height_in: 24,
      confidence: 0.45,
      notes: preferences.targetSize || "Default dimensions are for a compact side table."
    },
    materials: [
      {
        name: "select pine board 1x12",
        category: "lumber",
        quantity: 2,
        unit: "8 ft board",
        estimated_unit_cost_usd: 18,
        notes: "Use for the top, lower shelf, and side panels.",
        store_query: "select pine board 1x12",
        alternatives: ["3/4 inch plywood project panel", "edge-glued pine panel"]
      },
      {
        name: "select pine board 1x3",
        category: "lumber",
        quantity: 2,
        unit: "8 ft board",
        estimated_unit_cost_usd: 9,
        notes: "Use for rails and underside support.",
        store_query: "select pine board 1x3",
        alternatives: ["1x2 pine board", "poplar board 1x3"]
      },
      {
        name: "wood screws 1-1/4 inch",
        category: "fastener",
        quantity: 1,
        unit: "box",
        estimated_unit_cost_usd: 8,
        notes: "Pre-drill to avoid splitting.",
        store_query: "wood screws 1-1/4 inch",
        alternatives: ["pocket hole screws", "trim head wood screws"]
      },
      {
        name: "interior wood glue",
        category: "adhesive",
        quantity: 1,
        unit: "bottle",
        estimated_unit_cost_usd: 6,
        notes: "Apply at all wood-to-wood joints.",
        store_query: "interior wood glue",
        alternatives: ["premium wood glue", "quick set wood glue"]
      },
      {
        name: "water based polyurethane satin",
        category: "finish",
        quantity: 1,
        unit: "quart",
        estimated_unit_cost_usd: 22,
        notes: "Two to three thin coats give a durable tabletop finish.",
        store_query: "water based polyurethane satin",
        alternatives: ["wipe-on polyurethane", "clear furniture wax"]
      }
    ],
    tools: ["tape measure", "saw", "drill", "sander", "clamps", "square"],
    steps: [
      {
        title: "Confirm dimensions",
        detail: "Choose final width, depth, and height based on the target room and mark a cut list.",
        estimated_minutes: 20,
        safety_notes: "Measure twice before cutting."
      },
      {
        title: "Cut panels and rails",
        detail: "Cut the top, lower shelf, side pieces, and support rails from the pine boards.",
        estimated_minutes: 45,
        safety_notes: "Wear eye protection and clamp workpieces before cutting."
      },
      {
        title: "Dry fit the frame",
        detail: "Assemble without glue first and verify that corners are square.",
        estimated_minutes: 25,
        safety_notes: "Do not force warped boards into alignment."
      },
      {
        title: "Glue and screw joints",
        detail: "Apply wood glue, pre-drill holes, and fasten the rails and panels with screws.",
        estimated_minutes: 50,
        safety_notes: "Keep hands clear of drill path and wipe away excess glue."
      },
      {
        title: "Sand and finish",
        detail: "Sand through medium and fine grits, then apply two or three thin coats of clear finish.",
        estimated_minutes: 80,
        safety_notes: "Finish in a ventilated space and follow product drying instructions."
      }
    ],
    safety_checks: [
      "Use this only for light household use unless a real structural design is verified.",
      "Do not add electrical components in the MVP scope.",
      "Round or sand sharp edges before use."
    ],
    routing_notes: [
      "Image understanding would be routed to a stronger multimodal model.",
      "Cost formatting and material matching can be routed to local rules or a small model."
    ],
    evaluation: {
      buildability_score: 78,
      risk_level: "low",
      missing_inputs: [],
      verifier_notes: ["Fallback plan is generic because no cloud model result was used."]
    }
  };
}

function titleCase(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
