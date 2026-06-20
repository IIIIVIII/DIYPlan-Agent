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
  const finishMaterial = findMaterialName(plan, "polyurethane") || findMaterialName(plan, "finish") || "water based polyurethane satin";

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
    part("leveler_set", "Leveling feet", "leveler_set", levelerMaterial, "4 foot glides", 4, {}),
    part("sand_pass", "Sanded round edge", "finish_overlay", "sander or sandpaper", "120-220 grit", 1, {}),
    part("finish_coat", "Clear finish", "finish_overlay", finishMaterial, "2-3 coats", 1, {})
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
      "Round table manual uses a deterministic instruction contract: the agent outputs parts, placements, fastener counts, insets, and state transitions; the renderer keeps the circular tabletop and visual language consistent.",
    view_box: { width: 520, height: 360 },
    parts,
    frames: [
      frame("Check the round tabletop halves", "Lay both halves on a padded floor and confirm the target diameter before joining.", [{ part_id: "top_left_half", quantity: 1 }, { part_id: "top_right_half", quantity: 1 }], topVisible, topVisible, topOpen, {
        surface: "padded_floor",
        arrows: [{ from: [234, 166], to: [258, 166] }, { from: [286, 166], to: [262, 166] }],
        callouts: [{ text: "57 in diameter", x: 260, y: 64 }, { text: "padded floor", x: 112, y: 286 }]
      }),
      frame("Slide halves together", "Move the two straight seam edges together before tightening the connectors.", [{ part_id: "seam_connector_top", quantity: 1 }, { part_id: "seam_connector_bottom", quantity: 1 }], seamVisible, ["seam_connector_top", "seam_connector_bottom"], {
        ...topJoined,
        seam_connector_top: { x: 236, y: 116, width: 48, height: 18 },
        seam_connector_bottom: { x: 236, y: 196, width: 48, height: 18 }
      }, {
        surface: "padded_floor",
        insets: [{ type: "connector", label: "2x", x: 424, y: 236, r: 44, to: [262, 126] }],
        arrows: [{ from: [234, 160], to: [258, 160] }, { from: [286, 160], to: [262, 160] }]
      }),
      frame("Lock the center seam", "Tighten the seam connectors only after the circular edge is flush.", [{ part_id: "bolt_set", quantity: 4 }], [...seamVisible, "bolt_set"], ["bolt_set"], {
        ...topJoined,
        seam_connector_top: { x: 236, y: 116, width: 48, height: 18 },
        seam_connector_bottom: { x: 236, y: 196, width: 48, height: 18 },
        bolt_set: { points: [[246, 125], [274, 125], [246, 205], [274, 205]] }
      }, {
        surface: "padded_floor",
        insets: [{ type: "connector", label: "4x", x: 424, y: 94, r: 42, to: [260, 126] }],
        callouts: [{ text: "flush seam", x: 260, y: 270 }]
      }),
      frame("Place the underside frame", "Center the rectangular frame on the underside of the round tabletop.", [{ part_id: "apron_front", quantity: 1 }, { part_id: "apron_back", quantity: 1 }, { part_id: "apron_left", quantity: 1 }, { part_id: "apron_right", quantity: 1 }], frameVisible, ["apron_front", "apron_back", "apron_left", "apron_right"], {
        ...topJoined,
        ...frameOnly,
        seam_connector_top: { x: 236, y: 116, width: 48, height: 18 },
        seam_connector_bottom: { x: 236, y: 196, width: 48, height: 18 }
      }, {
        surface: "padded_floor",
        arrows: [{ from: [260, 100], to: [260, 142] }],
        callouts: [{ text: "center frame", x: 260, y: 126 }]
      }),
      frame("Fasten the frame to the top", "Pre-drill and drive the eight frame screws into the underside only.", [{ part_id: "screw_set", quantity: 8 }], [...frameVisible, "screw_set"], ["screw_set"], {
        ...assembled,
        screw_set: fastenerPoints.top_frame
      }, {
        surface: "padded_floor",
        insets: [{ type: "screw", label: "8x", x: 424, y: 98, r: 42, to: [346, 152] }]
      }),
      frame("Insert the left leg pair", "Drop the left two legs into the frame sockets before tightening.", [{ part_id: "leg_left_front", quantity: 1 }, { part_id: "leg_left_back", quantity: 1 }], [...frameVisible, "leg_left_front", "leg_left_back"], ["leg_left_front", "leg_left_back"], {
        ...topJoined,
        ...frameOnly,
        seam_connector_top: { x: 236, y: 116, width: 48, height: 18 },
        seam_connector_bottom: { x: 236, y: 196, width: 48, height: 18 },
        leg_left_front: legs.leg_left_front,
        leg_left_back: legs.leg_left_back
      }, {
        surface: "padded_floor",
        arrows: [{ from: [146, 112], to: [146, 152] }, { from: [190, 112], to: [190, 152] }]
      }),
      frame("Insert the right leg pair", "Repeat on the right side and keep all four legs vertical before bolts.", [{ part_id: "leg_right_back", quantity: 1 }, { part_id: "leg_right_front", quantity: 1 }], legVisible, ["leg_right_back", "leg_right_front"], {
        ...topJoined,
        ...frameOnly,
        ...legs,
        seam_connector_top: { x: 236, y: 116, width: 48, height: 18 },
        seam_connector_bottom: { x: 236, y: 196, width: 48, height: 18 }
      }, {
        surface: "padded_floor",
        arrows: [{ from: [334, 112], to: [334, 152] }, { from: [376, 112], to: [376, 152] }]
      }),
      frame("Add lower foot rails", "Connect each leg pair with a lower rail so the base can stand square.", [{ part_id: "foot_left", quantity: 1 }, { part_id: "foot_right", quantity: 1 }], [...legVisible, "foot_left", "foot_right"], ["foot_left", "foot_right"], assembled, {
        surface: "padded_floor",
        arrows: [{ from: [176, 324], to: [176, 296] }, { from: [344, 324], to: [344, 296] }]
      }),
      frame("Install the first cross brace", "Add the first diagonal stretcher across the lower base.", [{ part_id: "cross_beam_a", quantity: 1 }], [...legVisible, "foot_left", "foot_right", "cross_beam_a"], ["cross_beam_a"], {
        ...assembled,
        cross_beam_b: { x: 178, y: 254, width: 164, height: 14, angle: 17 }
      }, {
        surface: "padded_floor",
        arrows: [{ from: [112, 258], to: [172, 264] }]
      }),
      frame("Install the second cross brace", "Add the crossing stretcher to complete the X brace.", [{ part_id: "cross_beam_b", quantity: 1 }], baseVisible, ["cross_beam_b"], assembled, {
        surface: "padded_floor",
        arrows: [{ from: [408, 258], to: [348, 264] }],
        callouts: [{ text: "X brace", x: 260, y: 250 }]
      }),
      frame("Tighten the leg brackets", "Tighten bracket bolts evenly, moving around the table once.", [{ part_id: "bolt_set", quantity: 8 }], [...baseVisible, "bolt_set"], ["bolt_set"], {
        ...assembled,
        bolt_set: fastenerPoints.leg_brackets
      }, {
        surface: "padded_floor",
        insets: [{ type: "screw", label: "8x", x: 426, y: 92, r: 42, to: [364, 158] }]
      }),
      frame("Install the leveling feet", "Thread the four leveling feet into the bottom of the legs.", [{ part_id: "leveler_set", quantity: 4 }], [...baseVisible, "leveler_set"], ["leveler_set"], {
        ...assembled,
        leveler_set: fastenerPoints.levelers
      }, {
        surface: "padded_floor",
        insets: [{ type: "leveler", label: "4x", x: 426, y: 92, r: 42, to: [386, 300] }]
      }),
      frame("Flip the table upright", "Use two people to rotate the table onto its feet without stressing the round top.", [], baseVisible, [], assembled, {
        helper: "two_person_flip",
        arrows: [{ from: [104, 110], to: [144, 78] }, { from: [406, 110], to: [366, 78] }],
        callouts: [{ text: "2 people", x: 432, y: 282 }]
      }),
      frame("Level and finish", "Check height, level the feet, sand exposed edges, and apply thin finish coats.", [{ part_id: "sand_pass", quantity: 1 }, { part_id: "finish_coat", quantity: 1 }], [...baseVisible, "sand_pass", "finish_coat"], ["sand_pass", "finish_coat"], {
        ...assembled,
        sand_pass: { x: 88, y: 66, width: 344, height: 230 },
        finish_coat: { x: 88, y: 66, width: 344, height: 230 }
      }, {
        callouts: [{ text: "29.5 in high", x: 428, y: 186 }, { text: "level feet", x: 260, y: 318 }]
      })
    ]
  };
}

function roundTableInstructionModelLegacy(plan) {
  const topMaterial = findMaterialName(plan, "round tabletop") || findMaterialName(plan, "plywood") || findMaterialName(plan, "panel") || "round tabletop panel";
  const legMaterial = findMaterialName(plan, "2x4") || findMaterialName(plan, "leg") || "2x4 hardwood boards";
  const railMaterial = findMaterialName(plan, "1x4") || findMaterialName(plan, "rail") || "1x4 hardwood boards";
  const screwMaterial = findMaterialName(plan, "screw") || "wood screws 1-1/4 inch";
  const glueMaterial = findMaterialName(plan, "glue") || "interior wood glue";
  const finishMaterial = findMaterialName(plan, "polyurethane") || findMaterialName(plan, "finish") || "water based polyurethane satin";

  const parts = [
    part("top_left_half", "Left tabletop half", "round_half_left", topMaterial, "57 in dia half", 1, { x: 108, y: 54, width: 152, height: 58 }),
    part("top_right_half", "Right tabletop half", "round_half_right", topMaterial, "57 in dia half", 1, { x: 260, y: 54, width: 152, height: 58 }),
    part("seam_batten_a", "Seam batten A", "rail", railMaterial, "28 x 3 in", 1, { x: 196, y: 116, width: 128, height: 14 }),
    part("seam_batten_b", "Seam batten B", "rail", railMaterial, "28 x 3 in", 1, { x: 196, y: 136, width: 128, height: 14 }),
    part("apron_front", "Front apron rail", "rail", railMaterial, "38 x 3 in", 1, { x: 154, y: 134, width: 212, height: 16 }),
    part("apron_back", "Back apron rail", "rail", railMaterial, "38 x 3 in", 1, { x: 154, y: 156, width: 212, height: 16 }),
    part("leg_left_front", "Left front leg", "angled_leg", legMaterial, "28 in angled", 1, { x: 142, y: 132, width: 38, height: 150, tilt: -10 }),
    part("leg_left_back", "Left back leg", "angled_leg", legMaterial, "28 in angled", 1, { x: 188, y: 132, width: 34, height: 150, tilt: 7 }),
    part("leg_right_back", "Right back leg", "angled_leg", legMaterial, "28 in angled", 1, { x: 298, y: 132, width: 34, height: 150, tilt: -7 }),
    part("leg_right_front", "Right front leg", "angled_leg", legMaterial, "28 in angled", 1, { x: 340, y: 132, width: 38, height: 150, tilt: 10 }),
    part("foot_left", "Left foot rail", "foot_rail", railMaterial, "30 x 3 in", 1, { x: 124, y: 274, width: 124, height: 16 }),
    part("foot_right", "Right foot rail", "foot_rail", railMaterial, "30 x 3 in", 1, { x: 272, y: 274, width: 124, height: 16 }),
    part("cross_beam_a", "Lower cross beam A", "cross_beam", railMaterial, "42 x 3 in", 1, { x: 154, y: 252, width: 212, height: 16, angle: -16 }),
    part("cross_beam_b", "Lower cross beam B", "cross_beam", railMaterial, "42 x 3 in", 1, { x: 154, y: 252, width: 212, height: 16, angle: 16 }),
    part("screw_set", "Screw points", "fastener_set", screwMaterial, "pre-drill first", 28, {}),
    part("glue_lines", "Glue lines", "adhesive_lines", glueMaterial, "thin bead", 1, {}),
    part("sand_pass", "Sanded round edge", "finish_overlay", "sander or sandpaper", "120-220 grit", 1, {}),
    part("finish_coat", "Clear finish", "finish_overlay", finishMaterial, "2-3 coats", 1, {})
  ];

  const assembled = {
    top_left_half: { x: 108, y: 54, width: 152, height: 58 },
    top_right_half: { x: 260, y: 54, width: 152, height: 58 },
    seam_batten_a: { x: 196, y: 118, width: 128, height: 14 },
    seam_batten_b: { x: 196, y: 138, width: 128, height: 14 },
    apron_front: { x: 154, y: 134, width: 212, height: 16 },
    apron_back: { x: 154, y: 156, width: 212, height: 16 },
    leg_left_front: { x: 142, y: 132, width: 38, height: 150, tilt: -10 },
    leg_left_back: { x: 188, y: 132, width: 34, height: 150, tilt: 7 },
    leg_right_back: { x: 298, y: 132, width: 34, height: 150, tilt: -7 },
    leg_right_front: { x: 340, y: 132, width: 38, height: 150, tilt: 10 },
    foot_left: { x: 124, y: 274, width: 124, height: 16 },
    foot_right: { x: 272, y: 274, width: 124, height: 16 },
    cross_beam_a: { x: 154, y: 252, width: 212, height: 16, angle: -16 },
    cross_beam_b: { x: 154, y: 252, width: 212, height: 16, angle: 16 },
    screw_set: {
      points: [
        [220, 126],
        [300, 126],
        [220, 146],
        [300, 146],
        [162, 144],
        [358, 144],
        [162, 164],
        [358, 164],
        [152, 278],
        [220, 278],
        [300, 278],
        [368, 278]
      ]
    },
    glue_lines: {
      lines: [
        [260, 58, 260, 110],
        [196, 116, 324, 116],
        [154, 134, 366, 134],
        [154, 156, 366, 156]
      ]
    },
    sand_pass: { x: 92, y: 42, width: 336, height: 260 },
    finish_coat: { x: 92, y: 42, width: 336, height: 260 }
  };

  const baseVisible = [
    "top_left_half",
    "top_right_half",
    "seam_batten_a",
    "seam_batten_b",
    "apron_front",
    "apron_back",
    "leg_left_front",
    "leg_left_back",
    "leg_right_back",
    "leg_right_front",
    "foot_left",
    "foot_right",
    "cross_beam_a",
    "cross_beam_b"
  ];

  return {
    version: "0.3",
    renderer: "lego_style_round_table_manual",
    source: "local_vector_interpreter",
    source_note:
      "MVP renders the uploaded round table as LEGO-style micro-steps: each page lists the exact pieces needed, adds only a few parts, and highlights the new action. Future cloud mode can replace this with image-to-part segmentation.",
    view_box: { width: 520, height: 360 },
    parts,
    frames: [
      frame("Read the reference dimensions", "Use the diagram dimensions as the design target before cutting.", [{ part_id: "top_left_half", quantity: 1 }, { part_id: "top_right_half", quantity: 1 }], ["top_left_half", "top_right_half"], ["top_left_half", "top_right_half"], {
        top_left_half: { x: 104, y: 126, width: 156, height: 64 },
        top_right_half: { x: 260, y: 126, width: 156, height: 64 }
      }, {
        callouts: [
          { text: "57 in diameter", x: 260, y: 106 },
          { text: "29.5 in high", x: 412, y: 214 }
        ]
      }),
      frame("Cut the left tabletop half", "Cut one semicircle panel and keep the straight edge clean for the center seam.", [{ part_id: "top_left_half", quantity: 1 }], ["top_left_half"], ["top_left_half"], {
        top_left_half: { x: 146, y: 132, width: 184, height: 76 }
      }, {
        callouts: [{ text: "clean seam edge", x: 316, y: 222 }]
      }),
      frame("Cut the right tabletop half", "Cut the matching semicircle so the two halves create a full round top.", [{ part_id: "top_right_half", quantity: 1 }], ["top_left_half", "top_right_half"], ["top_right_half"], {
        top_left_half: { x: 76, y: 132, width: 184, height: 76 },
        top_right_half: { x: 260, y: 132, width: 184, height: 76 }
      }, {
        arrows: [{ from: [430, 170], to: [444, 170] }],
        callouts: [{ text: "forms full circle", x: 260, y: 116 }]
      }),
      frame("Glue the center seam", "Pull the two tabletop halves together with a thin glue bead at the straight seam.", [{ part_id: "glue_lines", quantity: 1 }], ["top_left_half", "top_right_half", "glue_lines"], ["glue_lines"], {
        top_left_half: { x: 76, y: 132, width: 184, height: 76 },
        top_right_half: { x: 260, y: 132, width: 184, height: 76 },
        glue_lines: { lines: [[260, 128, 260, 212]] }
      }, {
        arrows: [{ from: [228, 170], to: [258, 170] }, { from: [292, 170], to: [262, 170] }],
        callouts: [{ text: "glue seam", x: 260, y: 232 }]
      }),
      frame("Add underside seam battens", "Turn the top over and fasten two battens across the center joint.", [{ part_id: "seam_batten_a", quantity: 1 }, { part_id: "seam_batten_b", quantity: 1 }, { part_id: "screw_set", quantity: 4 }], ["top_left_half", "top_right_half", "seam_batten_a", "seam_batten_b", "screw_set"], ["seam_batten_a", "seam_batten_b", "screw_set"], {
        top_left_half: { x: 108, y: 58, width: 152, height: 58 },
        top_right_half: { x: 260, y: 58, width: 152, height: 58 },
        seam_batten_a: { x: 196, y: 134, width: 128, height: 14 },
        seam_batten_b: { x: 196, y: 160, width: 128, height: 14 },
        screw_set: { points: [[214, 141], [306, 141], [214, 167], [306, 167]] }
      }),
      frame("Cut four angled legs", "Make four matching legs with the same lean angle.", [{ part_id: "leg_left_front", quantity: 1 }, { part_id: "leg_left_back", quantity: 1 }, { part_id: "leg_right_back", quantity: 1 }, { part_id: "leg_right_front", quantity: 1 }], ["leg_left_front", "leg_left_back", "leg_right_back", "leg_right_front"], ["leg_left_front", "leg_left_back", "leg_right_back", "leg_right_front"], {
        leg_left_front: { x: 124, y: 92, width: 38, height: 174, tilt: -9 },
        leg_left_back: { x: 198, y: 92, width: 38, height: 174, tilt: 7 },
        leg_right_back: { x: 284, y: 92, width: 38, height: 174, tilt: -7 },
        leg_right_front: { x: 358, y: 92, width: 38, height: 174, tilt: 9 }
      }, {
        callouts: [{ text: "match angles", x: 260, y: 72 }]
      }),
      frame("Build the left leg frame", "Connect the two left legs with the left foot rail.", [{ part_id: "leg_left_front", quantity: 1 }, { part_id: "leg_left_back", quantity: 1 }, { part_id: "foot_left", quantity: 1 }, { part_id: "screw_set", quantity: 2 }], ["leg_left_front", "leg_left_back", "foot_left"], ["foot_left"], {
        leg_left_front: { x: 168, y: 104, width: 38, height: 160, tilt: -9 },
        leg_left_back: { x: 244, y: 104, width: 34, height: 160, tilt: 7 },
        foot_left: { x: 150, y: 270, width: 144, height: 18 }
      }, {
        arrows: [{ from: [224, 318], to: [224, 290] }]
      }),
      frame("Build the right leg frame", "Repeat the same leg-and-foot assembly for the opposite side.", [{ part_id: "leg_right_back", quantity: 1 }, { part_id: "leg_right_front", quantity: 1 }, { part_id: "foot_right", quantity: 1 }, { part_id: "screw_set", quantity: 2 }], ["leg_left_front", "leg_left_back", "foot_left", "leg_right_back", "leg_right_front", "foot_right"], ["leg_right_back", "leg_right_front", "foot_right"], {
        leg_left_front: { x: 120, y: 104, width: 34, height: 160, tilt: -9 },
        leg_left_back: { x: 176, y: 104, width: 30, height: 160, tilt: 7 },
        foot_left: { x: 102, y: 270, width: 120, height: 18 },
        leg_right_back: { x: 310, y: 104, width: 30, height: 160, tilt: -7 },
        leg_right_front: { x: 366, y: 104, width: 34, height: 160, tilt: 9 },
        foot_right: { x: 292, y: 270, width: 120, height: 18 }
      }),
      frame("Add the first cross stretcher", "Run the first lower stretcher diagonally between the two leg frames.", [{ part_id: "cross_beam_a", quantity: 1 }, { part_id: "screw_set", quantity: 2 }], ["leg_left_front", "leg_left_back", "foot_left", "leg_right_back", "leg_right_front", "foot_right", "cross_beam_a"], ["cross_beam_a"], {
        ...assembled,
        cross_beam_b: { x: 154, y: 252, width: 212, height: 16, angle: 16 }
      }, {
        arrows: [{ from: [116, 250], to: [174, 258] }]
      }),
      frame("Add the second cross stretcher", "Install the crossing stretcher to create the X brace.", [{ part_id: "cross_beam_b", quantity: 1 }, { part_id: "screw_set", quantity: 2 }], ["leg_left_front", "leg_left_back", "foot_left", "leg_right_back", "leg_right_front", "foot_right", "cross_beam_a", "cross_beam_b"], ["cross_beam_b"], assembled, {
        arrows: [{ from: [404, 250], to: [344, 258] }],
        callouts: [{ text: "X brace", x: 260, y: 238 }]
      }),
      frame("Attach front and back apron rails", "Add the rails under the tabletop position to keep the base rigid.", [{ part_id: "apron_front", quantity: 1 }, { part_id: "apron_back", quantity: 1 }, { part_id: "screw_set", quantity: 4 }], ["leg_left_front", "leg_left_back", "leg_right_back", "leg_right_front", "foot_left", "foot_right", "cross_beam_a", "cross_beam_b", "apron_front", "apron_back"], ["apron_front", "apron_back"], assembled, {
        arrows: [{ from: [260, 104], to: [260, 136] }]
      }),
      frame("Place the base under the tabletop", "Center the assembled base under the round tabletop before fastening.", [{ part_id: "top_left_half", quantity: 1 }, { part_id: "top_right_half", quantity: 1 }], baseVisible, ["top_left_half", "top_right_half"], assembled, {
        callouts: [{ text: "center base", x: 260, y: 34 }]
      }),
      frame("Pre-drill tabletop mounting points", "Pre-drill through the apron rails into the underside of the tabletop.", [{ part_id: "screw_set", quantity: 8 }], [...baseVisible, "screw_set"], ["screw_set"], assembled, {
        callouts: [{ text: "pre-drill upward", x: 392, y: 142 }]
      }),
      frame("Fasten the tabletop", "Drive screws after checking that the overhang is even all around.", [{ part_id: "screw_set", quantity: 8 }], [...baseVisible, "screw_set"], ["screw_set"], assembled, {
        callouts: [{ text: "even overhang", x: 128, y: 82 }]
      }),
      frame("Sand the round edge", "Soften the tabletop edge and leg feet before finish.", [{ part_id: "sand_pass", quantity: 1 }], [...baseVisible, "sand_pass"], ["sand_pass"], assembled, {
        callouts: [{ text: "round edge", x: 394, y: 62 }]
      }),
      frame("Apply finish coats", "Apply thin clear coats and let each coat cure before handling.", [{ part_id: "finish_coat", quantity: 1 }], [...baseVisible, "finish_coat"], ["finish_coat"], assembled, {
        callouts: [{ text: "2-3 coats", x: 390, y: 64 }]
      }),
      frame("Final stability check", "Set the table upright, confirm height, and level the feet.", [{ part_id: "foot_left", quantity: 1 }, { part_id: "foot_right", quantity: 1 }], baseVisible, ["foot_left", "foot_right"], assembled, {
        callouts: [
          { text: "29.5 in high", x: 428, y: 186 },
          { text: "level feet", x: 260, y: 316 }
        ]
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
