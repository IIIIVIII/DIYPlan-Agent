import { buildStoreLinks, catalogContext } from "./materialCatalog.js";
import { callOpenAIPlan } from "./openai.js";
import { callLocalPlan, checkLocalBackend, localBackendConfigured } from "./localBackend.js";
import { evaluatePlanQuality } from "./evaluator.js";
import {
  buildRoutingPolicy,
  chooseCloudModelForPlan,
  detectEscalationTriggers,
  estimateRoutingCost,
  getRoutingStrategy,
  shouldUseCloud,
  strategyPrefersLocalMlx
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
  let localResult = null;
  let mode = "mock";

  const wantLocal = preferences.imageDataUrl &&
    (strategyPrefersLocalMlx(strategy) || localBackendConfigured());

  if (wantLocal) {
    const health = await checkLocalBackend();
    if (health.available) {
      const localStartedAt = performance.now();
      try {
        localResult = await callLocalPlan({
          imageDataUrl: preferences.imageDataUrl,
          preferences
        });
        plan = localResult.plan;
        mode = localResult.metrics.mode || "local-mlx";
        for (const localStage of localResult.stages) {
          trace.push(stage(localStage.name, localStage.model, localStage.note, localStage.latency_ms || 0));
        }
      } catch (error) {
        trace.push(
          stage(
            "local-backend-error",
            health.model || "local-mlx",
            `Local ML backend failed, falling back: ${String(error.message || error).slice(0, 160)}`,
            Math.round(performance.now() - localStartedAt)
          )
        );
      }
    } else {
      trace.push(
        stage(
          "local-backend-unavailable",
          "local-mlx",
          "Local ML backend was not reachable; using cloud or mock fallback.",
          1
        )
      );
    }
  }

  if (!plan && shouldUseCloud(preferences, strategy)) {
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
  }

  if (!plan) {
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
    local_latency_ms: localResult?.metrics?.local_latency_ms || 0,
    model: cloudMetrics?.model || localResult?.metrics?.model || strategy.stageModels.plan_generation,
    backend: localResult ? "mlx" : mode === "cloud" ? "cloud" : "mock",
    routing_strategy: strategy.id,
    estimated_call_count: mode === "cloud" ? 1 : localResult ? localResult.stages.length : 0,
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
    purchase_links: purchaseLinks,
    local_perception: localResult?.perception || null,
    retrieval: localResult?.retrieval || []
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
  next.instruction_model = buildInstructionModel(next, preferences);

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

function buildInstructionModel(plan, preferences) {
  const category = String(plan.detected_object?.category || preferences.furnitureType || "side table").toLowerCase();
  if (category.includes("round") || category.includes("dining")) return roundTableInstructionModel(plan);
  if (category.includes("book") || category.includes("shelf")) return bookshelfInstructionModel(plan);
  return sideTableInstructionModel(plan);
}

function sideTableInstructionModel(plan) {
  const boardMaterial = findMaterialName(plan, "1x12") || findMaterialName(plan, "board") || "select pine board 1x12";
  const railMaterial = findMaterialName(plan, "1x3") || boardMaterial;
  const screwMaterial = findMaterialName(plan, "screw") || "wood screws 1-1/4 inch";
  const glueMaterial = findMaterialName(plan, "glue") || "interior wood glue";
  const finishMaterial = findMaterialName(plan, "polyurethane") || findMaterialName(plan, "finish") || "water based polyurethane satin";

  const parts = [
    part("top_panel", "Top panel", "panel", boardMaterial, "24 x 18 in", 1, { x: 130, y: 42, width: 260, height: 44 }),
    part("left_side", "Left side panel", "panel", boardMaterial, "18 x 22 in", 1, { x: 116, y: 118, width: 48, height: 170 }),
    part("right_side", "Right side panel", "panel", boardMaterial, "18 x 22 in", 1, { x: 356, y: 118, width: 48, height: 170 }),
    part("lower_shelf", "Lower shelf", "panel", boardMaterial, "20 x 14 in", 1, { x: 168, y: 238, width: 184, height: 34 }),
    part("front_rail", "Front rail", "rail", railMaterial, "20 x 2.5 in", 1, { x: 168, y: 172, width: 184, height: 18 }),
    part("back_rail", "Back rail", "rail", railMaterial, "20 x 2.5 in", 1, { x: 168, y: 202, width: 184, height: 18 }),
    part("left_cleat", "Left shelf cleat", "rail", railMaterial, "14 x 1.5 in", 1, { x: 186, y: 214, width: 28, height: 14 }),
    part("right_cleat", "Right shelf cleat", "rail", railMaterial, "14 x 1.5 in", 1, { x: 306, y: 214, width: 28, height: 14 }),
    part("screw_set", "Screw points", "fastener_set", screwMaterial, "pre-drill first", 18, {}),
    part("glue_lines", "Glue lines", "adhesive_lines", glueMaterial, "thin bead", 1, {}),
    part("sand_pass", "Sanded edges", "finish_overlay", "sander or sandpaper", "120-220 grit", 1, {}),
    part("finish_coat", "Satin finish", "finish_overlay", finishMaterial, "2-3 coats", 1, {})
  ];

  const assembled = {
    top_panel: { x: 130, y: 54, width: 260, height: 44 },
    left_side: { x: 136, y: 96, width: 48, height: 176 },
    right_side: { x: 336, y: 96, width: 48, height: 176 },
    lower_shelf: { x: 168, y: 226, width: 184, height: 34 },
    front_rail: { x: 168, y: 156, width: 184, height: 18 },
    back_rail: { x: 168, y: 188, width: 184, height: 18 },
    left_cleat: { x: 184, y: 214, width: 28, height: 14 },
    right_cleat: { x: 308, y: 214, width: 28, height: 14 },
    screw_set: {
      points: [
        [154, 104],
        [174, 104],
        [346, 104],
        [366, 104],
        [154, 158],
        [174, 158],
        [346, 158],
        [366, 158],
        [172, 235],
        [348, 235],
        [172, 253],
        [348, 253]
      ]
    },
    glue_lines: {
      lines: [
        [136, 96, 184, 96],
        [336, 96, 384, 96],
        [168, 226, 352, 226],
        [168, 156, 352, 156],
        [184, 214, 212, 214],
        [308, 214, 336, 214]
      ]
    },
    sand_pass: { x: 118, y: 42, width: 284, height: 242 },
    finish_coat: { x: 118, y: 42, width: 284, height: 242 }
  };

  return {
    version: "0.2",
    renderer: "step_by_step_vector_manual",
    source: "local_vector_interpreter",
    source_note:
      "MVP renders the plan as LEGO-style micro-steps: each page lists the parts needed, adds only a few pieces, and highlights the new assembly action. Future cloud mode can replace this with true image-to-part segmentation.",
    view_box: { width: 520, height: 360 },
    parts,
    frames: [
      {
        title: "Cut the tabletop",
        caption: "Start with the largest panel and mark a square, flat tabletop.",
        parts_needed: [{ part_id: "top_panel", quantity: 1 }],
        visible_parts: ["top_panel"],
        highlight_parts: ["top_panel"],
        placements: {
          top_panel: { x: 118, y: 154, width: 284, height: 48 }
        },
        callouts: [
          { part_id: "top_panel", text: "24 x 18 in", x: 260, y: 138 },
          { part_id: "top_panel", text: "square corners", x: 382, y: 220 }
        ]
      },
      {
        title: "Cut two matching side panels",
        caption: "Make the left and right panels identical so the table sits level.",
        parts_needed: [
          { part_id: "left_side", quantity: 1 },
          { part_id: "right_side", quantity: 1 }
        ],
        visible_parts: ["left_side", "right_side"],
        highlight_parts: ["left_side", "right_side"],
        placements: {
          left_side: { x: 156, y: 98, width: 58, height: 178 },
          right_side: { x: 306, y: 98, width: 58, height: 178 }
        },
        callouts: [{ part_id: "left_side", text: "same height", x: 260, y: 74 }]
      },
      {
        title: "Cut shelf, rails, and cleats",
        caption: "Prepare the smaller support pieces before assembly begins.",
        parts_needed: [
          { part_id: "lower_shelf", quantity: 1 },
          { part_id: "front_rail", quantity: 1 },
          { part_id: "back_rail", quantity: 1 },
          { part_id: "left_cleat", quantity: 1 },
          { part_id: "right_cleat", quantity: 1 }
        ],
        visible_parts: ["lower_shelf", "front_rail", "back_rail", "left_cleat", "right_cleat"],
        highlight_parts: ["lower_shelf", "front_rail", "back_rail", "left_cleat", "right_cleat"],
        placements: {
          lower_shelf: { x: 152, y: 226, width: 216, height: 36 },
          front_rail: { x: 152, y: 116, width: 216, height: 18 },
          back_rail: { x: 152, y: 154, width: 216, height: 18 },
          left_cleat: { x: 198, y: 190, width: 54, height: 14 },
          right_cleat: { x: 268, y: 190, width: 54, height: 14 }
        },
        callouts: [{ part_id: "front_rail", text: "support pieces", x: 260, y: 92 }]
      },
      {
        title: "Pre-drill the side panels",
        caption: "Mark screw locations before glue-up so the wood does not split.",
        parts_needed: [{ part_id: "screw_set", quantity: 4 }],
        visible_parts: ["left_side", "right_side", "screw_set"],
        highlight_parts: ["screw_set"],
        placements: {
          left_side: { x: 156, y: 98, width: 58, height: 178 },
          right_side: { x: 306, y: 98, width: 58, height: 178 },
          screw_set: {
            points: [
              [172, 116],
              [198, 116],
              [322, 116],
              [348, 116],
              [172, 244],
              [198, 244],
              [322, 244],
              [348, 244]
            ]
          }
        },
        callouts: [{ part_id: "screw_set", text: "pilot holes", x: 260, y: 74 }]
      },
      {
        title: "Add glue under the tabletop",
        caption: "Use a thin bead where the side panels will meet the top.",
        parts_needed: [{ part_id: "glue_lines", quantity: 1 }],
        visible_parts: ["top_panel", "glue_lines"],
        highlight_parts: ["glue_lines"],
        placements: {
          top_panel: { x: 130, y: 94, width: 260, height: 44 },
          glue_lines: {
            lines: [
              [146, 144, 194, 144],
              [326, 144, 374, 144]
            ]
          }
        },
        callouts: [{ part_id: "glue_lines", text: "thin bead", x: 260, y: 176 }]
      },
      {
        title: "Attach the left side panel",
        caption: "Place one side panel under the tabletop and keep the outside edge flush.",
        parts_needed: [
          { part_id: "left_side", quantity: 1 },
          { part_id: "screw_set", quantity: 2 }
        ],
        visible_parts: ["top_panel", "left_side"],
        ghost_parts: ["right_side"],
        highlight_parts: ["left_side"],
        placements: assembled,
        arrows: [{ from: [160, 304], to: [160, 276] }],
        callouts: [{ part_id: "left_side", text: "flush outside", x: 98, y: 132 }]
      },
      {
        title: "Attach the right side panel",
        caption: "Add the second side panel and check that both panels are parallel.",
        parts_needed: [
          { part_id: "right_side", quantity: 1 },
          { part_id: "screw_set", quantity: 2 }
        ],
        visible_parts: ["top_panel", "left_side", "right_side"],
        highlight_parts: ["right_side"],
        placements: assembled,
        arrows: [{ from: [360, 304], to: [360, 276] }],
        callouts: [{ part_id: "right_side", text: "parallel sides", x: 418, y: 132 }]
      },
      {
        title: "Install the back rail",
        caption: "Fit the rear rail first so the side panels stay square.",
        parts_needed: [
          { part_id: "back_rail", quantity: 1 },
          { part_id: "screw_set", quantity: 2 }
        ],
        visible_parts: ["top_panel", "left_side", "right_side", "back_rail"],
        highlight_parts: ["back_rail"],
        placements: assembled,
        arrows: [{ from: [260, 132], to: [260, 188] }],
        callouts: [{ part_id: "back_rail", text: "rear support", x: 260, y: 218 }]
      },
      {
        title: "Install the front rail",
        caption: "Add the front rail at the same height as the rear rail.",
        parts_needed: [
          { part_id: "front_rail", quantity: 1 },
          { part_id: "screw_set", quantity: 2 }
        ],
        visible_parts: ["top_panel", "left_side", "right_side", "back_rail", "front_rail"],
        highlight_parts: ["front_rail"],
        placements: assembled,
        arrows: [{ from: [260, 128], to: [260, 156] }],
        callouts: [{ part_id: "front_rail", text: "front support", x: 260, y: 146 }]
      },
      {
        title: "Add shelf support cleats",
        caption: "Attach the two short cleats so the lower shelf has a ledge to rest on.",
        parts_needed: [
          { part_id: "left_cleat", quantity: 1 },
          { part_id: "right_cleat", quantity: 1 },
          { part_id: "screw_set", quantity: 4 }
        ],
        visible_parts: ["top_panel", "left_side", "right_side", "back_rail", "front_rail", "left_cleat", "right_cleat"],
        highlight_parts: ["left_cleat", "right_cleat"],
        placements: assembled,
        arrows: [
          { from: [102, 220], to: [184, 220] },
          { from: [418, 220], to: [336, 220] }
        ],
        callouts: [{ part_id: "left_cleat", text: "shelf ledge", x: 260, y: 244 }]
      },
      {
        title: "Slide in the lower shelf",
        caption: "Set the shelf on the cleats and center it between the side panels.",
        parts_needed: [{ part_id: "lower_shelf", quantity: 1 }],
        visible_parts: ["top_panel", "left_side", "right_side", "back_rail", "front_rail", "left_cleat", "right_cleat", "lower_shelf"],
        highlight_parts: ["lower_shelf"],
        placements: assembled,
        arrows: [{ from: [82, 242], to: [164, 242] }],
        callouts: [{ part_id: "lower_shelf", text: "center shelf", x: 260, y: 286 }]
      },
      {
        title: "Lock the shelf and rails",
        caption: "Drive the remaining screws after the frame is square.",
        parts_needed: [{ part_id: "screw_set", quantity: 8 }],
        visible_parts: ["top_panel", "left_side", "right_side", "back_rail", "front_rail", "left_cleat", "right_cleat", "lower_shelf", "screw_set"],
        highlight_parts: ["screw_set"],
        placements: assembled,
        callouts: [
          { part_id: "screw_set", text: "tighten last", x: 410, y: 108 },
          { part_id: "screw_set", text: "check square", x: 110, y: 154 }
        ]
      },
      {
        title: "Sand every exposed edge",
        caption: "Round sharp corners and sand with the grain before applying finish.",
        parts_needed: [{ part_id: "sand_pass", quantity: 1 }],
        visible_parts: ["top_panel", "left_side", "right_side", "back_rail", "front_rail", "left_cleat", "right_cleat", "lower_shelf", "sand_pass"],
        highlight_parts: ["sand_pass"],
        placements: assembled,
        callouts: [{ part_id: "sand_pass", text: "round edges", x: 386, y: 58 }]
      },
      {
        title: "Apply thin finish coats",
        caption: "Use two to three thin coats and let each coat dry fully.",
        parts_needed: [{ part_id: "finish_coat", quantity: 1 }],
        visible_parts: ["top_panel", "left_side", "right_side", "back_rail", "front_rail", "left_cleat", "right_cleat", "lower_shelf", "finish_coat"],
        highlight_parts: ["finish_coat"],
        placements: assembled,
        callouts: [{ part_id: "finish_coat", text: "2-3 thin coats", x: 382, y: 58 }]
      }
    ]
  };
}

function bookshelfInstructionModel(plan) {
  const model = sideTableInstructionModel(plan);
  model.source_note =
    "MVP bookshelf mode uses the same 2D manual renderer with shelf-oriented labels; future vision routing can infer exact shelf count from the image.";
  model.parts = model.parts.map((item) => {
    const labels = {
      top_panel: "Top shelf",
      lower_shelf: "Bottom shelf",
      left_side: "Left upright",
      right_side: "Right upright",
      front_rail: "Middle shelf",
      back_rail: "Back stretcher"
    };
    return labels[item.id] ? { ...item, label: labels[item.id] } : item;
  });
  return model;
}

function roundTableInstructionModel(plan) {
  const topMaterial = findMaterialName(plan, "round tabletop") || findMaterialName(plan, "plywood") || findMaterialName(plan, "panel") || "round tabletop panel";
  const legMaterial = findMaterialName(plan, "2x4") || findMaterialName(plan, "leg") || "2x4 hardwood boards";
  const railMaterial = findMaterialName(plan, "1x4") || findMaterialName(plan, "rail") || "1x4 hardwood boards";
  const screwMaterial = findMaterialName(plan, "screw") || "wood screws 1-1/4 inch";
  const connectorMaterial = "tabletop alignment connectors";
  const boltMaterial = "machine bolts and washers";
  const levelerMaterial = "adjustable leveling feet";

  const parts = [
    part("top_left_half", "Left tabletop half", "round_top_half_left", topMaterial, "57 in dia half", 1, { x: 98, y: 78, width: 162, height: 156, depth: 14 }),
    part("top_right_half", "Right tabletop half", "round_top_half_right", topMaterial, "57 in dia half", 1, { x: 260, y: 78, width: 162, height: 156, depth: 14 }),
    part("seam_connector_top", "Upper seam connector", "metal_connector", connectorMaterial, "2 in plate", 1, { x: 236, y: 116, width: 48, height: 18 }),
    part("seam_connector_bottom", "Lower seam connector", "metal_connector", connectorMaterial, "2 in plate", 1, { x: 236, y: 196, width: 48, height: 18 }),
    part("apron_front", "Front apron rail", "rail", railMaterial, "38 x 3 in", 1, { x: 150, y: 144, width: 220, height: 16 }),
    part("apron_back", "Back apron rail", "rail", railMaterial, "38 x 3 in", 1, { x: 150, y: 218, width: 220, height: 16 }),
    part("apron_left", "Left apron rail", "rail", railMaterial, "24 x 3 in", 1, { x: 150, y: 158, width: 16, height: 76 }),
    part("apron_right", "Right apron rail", "rail", railMaterial, "24 x 3 in", 1, { x: 354, y: 158, width: 16, height: 76 }),
    part("leg_left_front", "Left front leg", "angled_leg", legMaterial, "28 in angled", 1, { x: 130, y: 152, width: 34, height: 128, tilt: -8 }),
    part("leg_left_back", "Left back leg", "angled_leg", legMaterial, "28 in angled", 1, { x: 174, y: 152, width: 30, height: 128, tilt: 6 }),
    part("leg_right_back", "Right back leg", "angled_leg", legMaterial, "28 in angled", 1, { x: 316, y: 152, width: 30, height: 128, tilt: -6 }),
    part("leg_right_front", "Right front leg", "angled_leg", legMaterial, "28 in angled", 1, { x: 358, y: 152, width: 34, height: 128, tilt: 8 }),
    part("foot_left", "Left foot rail", "foot_rail", railMaterial, "30 x 3 in", 1, { x: 116, y: 282, width: 120, height: 16 }),
    part("foot_right", "Right foot rail", "foot_rail", railMaterial, "30 x 3 in", 1, { x: 284, y: 282, width: 120, height: 16 }),
    part("cross_beam_a", "Lower cross beam A", "cross_beam", railMaterial, "42 x 3 in", 1, { x: 178, y: 254, width: 164, height: 14, angle: -17 }),
    part("cross_beam_b", "Lower cross beam B", "cross_beam", railMaterial, "42 x 3 in", 1, { x: 178, y: 254, width: 164, height: 14, angle: 17 }),
    part("screw_set", "Screw points", "fastener_set", screwMaterial, "pre-drill first", 28, {}),
    part("bolt_set", "Bolt and washer set", "fastener_set", boltMaterial, "tighten by hand first", 8, {}),
    part("leveler_set", "Leveling feet", "leveler_set", levelerMaterial, "4 foot glides", 4, {})
  ];

  const topOpen = {
    top_left_half: { x: 72, y: 88, width: 162, height: 156, depth: 14 },
    top_right_half: { x: 286, y: 88, width: 162, height: 156, depth: 14 }
  };
  const topJoined = {
    top_left_half: { x: 98, y: 82, width: 162, height: 156, depth: 14 },
    top_right_half: { x: 260, y: 82, width: 162, height: 156, depth: 14 }
  };
  const frameOnly = {
    apron_front: { x: 150, y: 144, width: 220, height: 16 },
    apron_back: { x: 150, y: 218, width: 220, height: 16 },
    apron_left: { x: 150, y: 158, width: 16, height: 76 },
    apron_right: { x: 354, y: 158, width: 16, height: 76 }
  };
  const legs = {
    leg_left_front: { x: 130, y: 152, width: 34, height: 128, tilt: -8 },
    leg_left_back: { x: 174, y: 152, width: 30, height: 128, tilt: 6 },
    leg_right_back: { x: 316, y: 152, width: 30, height: 128, tilt: -6 },
    leg_right_front: { x: 358, y: 152, width: 34, height: 128, tilt: 8 }
  };
  const lowerBase = {
    foot_left: { x: 116, y: 282, width: 120, height: 16 },
    foot_right: { x: 284, y: 282, width: 120, height: 16 },
    cross_beam_a: { x: 178, y: 254, width: 164, height: 14, angle: -17 },
    cross_beam_b: { x: 178, y: 254, width: 164, height: 14, angle: 17 }
  };
  const fastenerPoints = {
    top_frame: { points: [[174, 152], [240, 152], [280, 152], [346, 152], [174, 226], [240, 226], [280, 226], [346, 226]] },
    leg_brackets: { points: [[156, 158], [186, 158], [334, 158], [364, 158], [156, 224], [186, 224], [334, 224], [364, 224]] },
    levelers: { points: [[138, 300], [220, 300], [304, 300], [386, 300]] }
  };
  const assembled = {
    ...topJoined,
    seam_connector_top: { x: 236, y: 116, width: 48, height: 18 },
    seam_connector_bottom: { x: 236, y: 196, width: 48, height: 18 },
    ...frameOnly,
    ...legs,
    ...lowerBase
  };

  const topVisible = ["top_left_half", "top_right_half"];
  const seamVisible = [...topVisible, "seam_connector_top", "seam_connector_bottom"];
  const frameVisible = [...seamVisible, "apron_front", "apron_back", "apron_left", "apron_right"];
  const legVisible = [...frameVisible, ...Object.keys(legs)];
  const baseVisible = [...legVisible, "foot_left", "foot_right", "cross_beam_a", "cross_beam_b"];

  return {
    version: "0.4",
    renderer: "strict_round_table_manual",
    source: "local_instruction_contract",
    source_note:
      "Round table manual mirrors the provided assembly-book flow: six original installation steps rendered through a deterministic LEGO-style parts bin, state diagram, hardware counts, and detail insets.",
    view_box: { width: 520, height: 360 },
    parts,
    frames: [
      frame("Step 1 - Join tabletop halves", "Lay both tabletop halves on a padded floor, slide the straight seam edges together, and lock the two seam connectors.", [{ part_id: "top_left_half", quantity: 1 }, { part_id: "top_right_half", quantity: 1 }, { part_id: "seam_connector_top", quantity: 1 }, { part_id: "seam_connector_bottom", quantity: 1 }], seamVisible, seamVisible, {
        ...topOpen,
        seam_connector_top: { x: 236, y: 118, width: 48, height: 18 },
        seam_connector_bottom: { x: 236, y: 196, width: 48, height: 18 }
      }, {
        surface: "padded_floor",
        insets: [{ type: "connector", label: "2x", x: 424, y: 236, r: 44, to: [260, 126] }],
        arrows: [{ from: [234, 166], to: [258, 166] }, { from: [286, 166], to: [262, 166] }],
        callouts: [{ text: "57 in diameter", x: 260, y: 64 }]
      }),
      frame("Step 2 - Screw underside frame", "Place the rectangular underside frame on the tabletop and fasten the eight screw points.", [{ part_id: "apron_front", quantity: 1 }, { part_id: "apron_back", quantity: 1 }, { part_id: "apron_left", quantity: 1 }, { part_id: "apron_right", quantity: 1 }, { part_id: "screw_set", quantity: 8 }], [...frameVisible, "screw_set"], ["apron_front", "apron_back", "apron_left", "apron_right", "screw_set"], {
        ...assembled,
        screw_set: fastenerPoints.top_frame
      }, {
        surface: "padded_floor",
        insets: [{ type: "screw", label: "8x", x: 424, y: 98, r: 42, to: [346, 152] }]
      }),
      frame("Step 3 - Set first leg rail", "Place the first leg side into the frame sockets and secure the center point with one bolt and washer.", [{ part_id: "leg_left_front", quantity: 1 }, { part_id: "leg_left_back", quantity: 1 }, { part_id: "foot_left", quantity: 1 }, { part_id: "bolt_set", quantity: 1 }], [...frameVisible, "leg_left_front", "leg_left_back", "foot_left", "bolt_set"], ["leg_left_front", "leg_left_back", "foot_left", "bolt_set"], {
        ...topJoined,
        ...frameOnly,
        seam_connector_top: { x: 236, y: 116, width: 48, height: 18 },
        seam_connector_bottom: { x: 236, y: 196, width: 48, height: 18 },
        leg_left_front: legs.leg_left_front,
        leg_left_back: legs.leg_left_back,
        foot_left: lowerBase.foot_left,
        bolt_set: { points: [[260, 190]] }
      }, {
        surface: "padded_floor",
        insets: [{ type: "screw", label: "1x", x: 126, y: 92, r: 42, to: [260, 190] }],
        arrows: [{ from: [146, 112], to: [146, 152] }, { from: [190, 112], to: [190, 152] }]
      }),
      frame("Step 4 - Insert four legs", "Drop all four legs into the frame sockets and check each bracket before tightening.", [{ part_id: "leg_left_front", quantity: 1 }, { part_id: "leg_left_back", quantity: 1 }, { part_id: "leg_right_back", quantity: 1 }, { part_id: "leg_right_front", quantity: 1 }], legVisible, Object.keys(legs), {
        ...topJoined,
        ...frameOnly,
        ...legs,
        seam_connector_top: { x: 236, y: 116, width: 48, height: 18 },
        seam_connector_bottom: { x: 236, y: 196, width: 48, height: 18 }
      }, {
        surface: "padded_floor",
        insets: [{ type: "connector", label: "4x", x: 424, y: 92, r: 42, to: [364, 158] }],
        arrows: [{ from: [146, 112], to: [146, 152] }, { from: [190, 112], to: [190, 152] }, { from: [334, 112], to: [334, 152] }, { from: [376, 112], to: [376, 152] }]
      }),
      frame("Step 5 - Tighten cross brace", "Install the lower X brace and tighten the four visible bolt-and-washer points evenly.", [{ part_id: "cross_beam_a", quantity: 1 }, { part_id: "cross_beam_b", quantity: 1 }, { part_id: "foot_right", quantity: 1 }, { part_id: "bolt_set", quantity: 4 }], [...baseVisible, "bolt_set"], ["cross_beam_a", "cross_beam_b", "foot_right", "bolt_set"], {
        ...assembled,
        bolt_set: { points: [[156, 224], [186, 224], [334, 224], [364, 224]] }
      }, {
        surface: "padded_floor",
        insets: [{ type: "screw", label: "4x", x: 126, y: 96, r: 42, to: [334, 224] }],
        callouts: [{ text: "X brace", x: 260, y: 250 }]
      }),
      frame("Step 6 - Add feet and flip", "Thread in the four leveling feet, then use two people to flip the table upright.", [{ part_id: "leveler_set", quantity: 4 }], [...baseVisible, "leveler_set"], ["leveler_set"], {
        ...assembled,
        leveler_set: fastenerPoints.levelers
      }, {
        helper: "two_person_flip",
        insets: [{ type: "leveler", label: "4x", x: 426, y: 92, r: 42, to: [386, 300] }],
        arrows: [{ from: [104, 110], to: [144, 78] }, { from: [406, 110], to: [366, 78] }],
        callouts: [{ text: "2 people", x: 432, y: 282 }]
      })
    ]
  };
}

function frame(title, caption, partsNeeded, visibleParts, highlightParts, placements, extras = {}) {
  return {
    title,
    caption,
    parts_needed: partsNeeded,
    visible_parts: visibleParts,
    highlight_parts: highlightParts,
    placements,
    ...extras
  };
}

function part(id, label, kind, materialName, cutSize, quantity, geometry) {
  return {
    id,
    label,
    kind,
    material_name: materialName,
    cut_size: cutSize,
    quantity,
    geometry
  };
}

function findMaterialName(plan, needle) {
  const material = (plan.materials || []).find((item) =>
    String(item.name || "").toLowerCase().includes(String(needle).toLowerCase())
  );
  return material?.name || "";
}

function fallbackPlan(preferences) {
  const type = preferences.furnitureType && preferences.furnitureType !== "auto" ? preferences.furnitureType : "side table";
  if (/\b(round|dining)\b/i.test(type)) return roundTablePlan(preferences, type);

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

function roundTablePlan(preferences, type) {
  return {
    project: {
      title: "Round Dining Table Build",
      summary:
        "A simplified round wood dining table plan based on the uploaded reference, using a two-piece circular top, angled leg frames, and a lower X stretcher.",
      inspired_by_style: "round wood tabletop with visible grain, angled legs, and crossed lower support rails",
      recommended_scope:
        "Build a practical inspired-by round table with simplified joinery instead of copying the exact commercial construction."
    },
    detected_object: {
      category: type,
      visible_parts: ["round two-piece tabletop", "four angled legs", "apron rails", "lower X stretcher", "foot rails"],
      likely_materials: ["round tabletop panel", "hardwood boards", "wood screws", "wood glue", "clear polyurethane"],
      confidence: preferences.imageDataUrl ? 0.68 : 0.35
    },
    assumptions: [
      "The diagram suggests a tabletop around 57 inches in diameter and total height around 29.5 inches.",
      "The DIY version uses simplified rails and screw/glue joinery suitable for a prototype.",
      "Final leg angles and overhang should be checked against the real room and tools before cutting."
    ],
    difficulty: preferences.skillLevel === "beginner" ? "intermediate" : preferences.skillLevel,
    estimated_total_cost_usd: {
      low: 180,
      high: 360,
      notes: "Estimate assumes plywood or project panels for the top, hardwood boards for the base, fasteners, glue, and finish."
    },
    dimensions: {
      width_in: 57,
      depth_in: 57,
      height_in: 29.5,
      confidence: 0.74,
      notes: preferences.targetSize || "Based on the provided dimension diagram: 145 cm diameter and about 75 cm height."
    },
    materials: [
      {
        name: "round tabletop panel or 3/4 inch oak plywood",
        category: "panel",
        quantity: 2,
        unit: "half-top blanks",
        estimated_unit_cost_usd: 85,
        notes: "Use for the two semicircle tabletop halves.",
        store_query: "3/4 inch oak plywood project panel",
        alternatives: ["edge-glued round tabletop panel", "hardwood plywood 3/4 inch"]
      },
      {
        name: "2x4 hardwood boards for angled legs",
        category: "lumber",
        quantity: 4,
        unit: "leg blanks",
        estimated_unit_cost_usd: 18,
        notes: "Cut four matching angled legs.",
        store_query: "2x4 hardwood board",
        alternatives: ["poplar 2x4 board", "oak table leg blank"]
      },
      {
        name: "1x4 hardwood boards for rails and stretchers",
        category: "lumber",
        quantity: 4,
        unit: "8 ft board",
        estimated_unit_cost_usd: 14,
        notes: "Use for apron rails, foot rails, seam battens, and the lower X brace.",
        store_query: "1x4 hardwood board",
        alternatives: ["poplar 1x4 board", "select pine board 1x4"]
      },
      {
        name: "wood screws 1-1/4 inch",
        category: "fastener",
        quantity: 1,
        unit: "box",
        estimated_unit_cost_usd: 8,
        notes: "Pre-drill all holes before driving screws.",
        store_query: "wood screws 1-1/4 inch",
        alternatives: ["trim head wood screws", "pocket hole screws"]
      },
      {
        name: "interior wood glue",
        category: "adhesive",
        quantity: 1,
        unit: "bottle",
        estimated_unit_cost_usd: 6,
        notes: "Apply at the tabletop seam and support rails.",
        store_query: "interior wood glue",
        alternatives: ["premium wood glue", "quick set wood glue"]
      },
      {
        name: "water based polyurethane satin",
        category: "finish",
        quantity: 1,
        unit: "quart",
        estimated_unit_cost_usd: 22,
        notes: "Apply thin coats after sanding the tabletop edge and base.",
        store_query: "water based polyurethane satin",
        alternatives: ["wipe-on polyurethane", "clear furniture wax"]
      }
    ],
    tools: ["tape measure", "jigsaw or circle-cutting jig", "drill", "sander", "clamps", "square"],
    steps: [
      {
        title: "Confirm diameter and height",
        detail: "Use the dimension diagram to set the 57 inch tabletop diameter and 29.5 inch finished height.",
        estimated_minutes: 20,
        safety_notes: "Confirm your room clearance before cutting a full-size top."
      },
      {
        title: "Cut tabletop halves",
        detail: "Cut two semicircle blanks and dry-fit the center seam.",
        estimated_minutes: 65,
        safety_notes: "Clamp the panel and keep hands clear of the saw path."
      },
      {
        title: "Build the angled base",
        detail: "Cut four matching legs, connect them with foot rails, and add the lower X stretcher.",
        estimated_minutes: 95,
        safety_notes: "Check that all legs sit flat before fastening the cross brace."
      },
      {
        title: "Mount tabletop",
        detail: "Center the base, pre-drill upward through apron rails, and fasten the top.",
        estimated_minutes: 45,
        safety_notes: "Use screws short enough that they cannot poke through the tabletop."
      },
      {
        title: "Sand and finish",
        detail: "Round the tabletop edge, sand through fine grits, and apply clear finish.",
        estimated_minutes: 100,
        safety_notes: "Finish in a ventilated area and follow drying instructions."
      }
    ],
    safety_checks: [
      "Use this as a furniture prototype plan, not a structural engineering drawing.",
      "Do not use screws that are longer than the tabletop thickness plus rail thickness allows.",
      "Confirm table stability before using it for heavy loads."
    ],
    routing_notes: [
      "Image understanding should identify the round top, angled legs, and X stretcher.",
      "Dimension extraction can be routed to a vision-capable model while material matching stays local."
    ],
    evaluation: {
      buildability_score: 82,
      risk_level: "medium",
      missing_inputs: [],
      verifier_notes: ["Round tabletop cutting requires more precision than the side-table fixture."]
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
