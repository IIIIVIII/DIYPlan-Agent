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
