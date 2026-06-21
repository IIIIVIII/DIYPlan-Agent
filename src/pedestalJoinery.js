// Structured joinery + finish knowledge for round pedestal tables.
//
// The VLM cannot see the original factory manual, so we encode a realistic
// DIY construction path here: wedge-tab hub (like commercial pedestal bases),
// leveling feet, column options, and how to match a painted colour.

function parseHex(hex) {
  const clean = String(hex || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return `#${clean.toLowerCase()}`;
}

function rgbFromHex(hex) {
  const h = parseHex(hex);
  if (!h) return null;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function isPaintedColor(hex) {
  const rgb = rgbFromHex(hex);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx > 0 ? (mx - mn) / mx : 0;
  // vivid red / blue / green etc. — unlikely to be bare lumber
  return sat > 0.28 && mx > 80;
}

function colorName(hex) {
  const rgb = rgbFromHex(hex);
  if (!rgb) return "custom";
  const [r, g, b] = rgb;
  if (r > g + 40 && r > b + 40) return "red";
  if (g > r + 20 && g > b + 20) return "green";
  if (b > r + 20 && b > g + 20) return "blue";
  if (r > 180 && g > 140 && b < 120) return "natural wood";
  return "custom";
}

export function getPedestalJoinerySpec(dims, colors = {}) {
  const baseColor = parseHex(colors.base) || "#b23b34";
  const painted = isPaintedColor(baseColor);
  const tone = colorName(baseColor);

  return {
    connection: {
      type: "wedge_tab_hub",
      summary:
        "Four arm blocks slide onto triangular wedge tabs cast/ screwed to a central hub flange — not loose blocks pushed into a hollow tube.",
      hub: {
        description:
          "Machine a 6–8 in round hub plate from 3/4 in plywood or weld a steel disc to the column. Bolt four triangular wedge blocks (45° miter faces) at 90° spacing.",
        fasteners: "4× M6×40 mm bolts + washers into threaded inserts in each wedge block",
        wedge_angle_deg: 45,
        tab_count: 4
      },
      arms: {
        description:
          "Each foot arm is a 2×2 in × length blank with a dado/notch cut on the inner face to receive the wedge tab. A shoulder stops the arm when fully seated.",
        notch: "1/2 in deep dado, width = wedge thickness + 1/16 in clearance",
        leveling: "1/4-20 threaded insert in underside + adjustable leveling foot (IKEA 195312 style)"
      },
      column: {
        options: [
          {
            id: "mdf_wrap",
            label: "MDF column wrap (paintable)",
            parts: "3 in nominal steel or PVC core + 1/4 in MDF staves, glued and sanded",
            notes: "Cheapest DIY path when the reference base is painted, not bare wood."
          },
          {
            id: "steel_pipe",
            label: "Steel pipe column (powder-coat red)",
            parts: "3 in schedule-40 pipe cut to height; flared top from turned MDF or steel collar",
            notes: "Ask the store to cut; powder-coat at an auto body shop for a durable red finish."
          }
        ]
      },
      top_mount: {
        description:
          "Steel mounting plate (6 in disc, 3× countersunk holes) screwed to underside of top; column hub screws into center T-nut.",
        fasteners: "3× 1/4-20 × 1-1/4 in flat-head screws + washers"
      }
    },
    assembly_sequence: [
      {
        step: 1,
        title: "Install leveling feet in each arm",
        detail:
          "Drill a vertical pilot hole through each arm block. Thread a 1/4-20 insert from the top, then screw in the leveling foot from below. Hand-tighten — final level adjustment comes after the base is assembled."
      },
      {
        step: 2,
        title: "Slide arms onto hub wedge tabs",
        detail:
          "Place the column upside-down on a blanket. Each arm block has a dado on the inner face — align it with a wedge tab and push horizontally until the shoulder seats against the hub flange. Repeat for all four arms at 90°."
      },
      {
        step: 3,
        title: "Lock wedges to the hub",
        detail:
          "Drive a button-head screw through each wedge block into the hub plate. Check that all four arms sit flush and the cross is square before flipping the base upright."
      },
      {
        step: 4,
        title: "Mount the plate under the top",
        detail:
          "With the top upside-down, center the steel mounting plate and drive three screws through the plate into the top core. Do not overtighten MDF or plywood."
      },
      {
        step: 5,
        title: "Set the top on the column",
        detail:
          "Lower the top onto the column center stud / flare until it seats. If the design uses a twist-lock, rotate until the marks align."
      }
    ],
    finish: buildFinishPlan(baseColor, painted, tone)
  };
}

function buildFinishPlan(baseColor, painted, tone) {
  if (!painted && tone === "natural wood") {
    return {
      strategy: "clear_coat",
      notes: "Reference looks like natural wood — use stain to match then polyurethane.",
      materials: [
        {
          name: "Wood stain (match sample)",
          category: "finish",
          quantity: 1,
          unit: "8 oz sample",
          estimated_unit_cost_usd: 6,
          store_query: "wood stain sample pack",
          notes: "Test on scrap; wipe excess for an even tone."
        },
        {
          name: "Water-based polyurethane satin",
          category: "finish",
          quantity: 1,
          unit: "qt",
          estimated_unit_cost_usd: 18,
          store_query: "water based polyurethane satin",
          notes: "Two thin coats on the top; one coat on the base if stained."
        }
      ]
    };
  }

  const paintQuery =
    tone === "red"
      ? "red semi gloss interior latex paint quart"
      : tone === "blue"
        ? "blue semi gloss interior latex paint quart"
        : "semi gloss interior latex paint quart custom tint";

  return {
    strategy: "paint_over_primer",
    target_hex: baseColor,
    color_name: tone,
    notes: [
      `The reference base reads as ${tone} (${baseColor}) — bare lumber will not match.`,
      "Sand → prime → two thin colour coats → optional clear topcoat on high-wear areas.",
      "Bring the photo to the paint counter for computer colour matching, or order online with the hex code."
    ],
    materials: [
      {
        name: "Multi-surface primer (white or grey)",
        category: "finish",
        quantity: 1,
        unit: "qt",
        estimated_unit_cost_usd: 14,
        store_query: "multi surface primer quart",
        notes: "Mandatory on MDF, plywood edges, and any bare wood before colour coats."
      },
      {
        name: `${tone === "custom" ? "Custom-tint" : tone.charAt(0).toUpperCase() + tone.slice(1)} interior latex (semi-gloss)`,
        category: "finish",
        quantity: 1,
        unit: "qt",
        estimated_unit_cost_usd: 22,
        store_query: paintQuery,
        notes: `Target match ${baseColor}. One quart covers column + four arms with two coats.`
      },
      {
        name: "Paint sample pot (verify before full quart)",
        category: "finish",
        quantity: 1,
        unit: "sample",
        estimated_unit_cost_usd: 5,
        store_query: `${tone} paint sample pot interior`,
        notes: "Brush a swatch on scrap MDF; adjust tint at the store if needed."
      },
      {
        name: "220-grit sandpaper + tack cloth",
        category: "supply",
        quantity: 1,
        unit: "pack",
        estimated_unit_cost_usd: 8,
        store_query: "220 grit sandpaper tack cloth",
        notes: "Light sand between primer and colour coats."
      }
    ],
    alternatives: [
      {
        label: "Powder-coated steel pipe column",
        store_query: "3 inch steel pipe",
        notes: "Skip paint on the column if the shop powder-coats the pipe to your red."
      },
      {
        label: "Pre-finished red laminate board (MDF)",
        store_query: "red laminate mdf board",
        notes: "Limited sizes; usually only practical for flat panels, not round columns."
      }
    ]
  };
}

export function pedestalMaterialsFromJoinery(spec, dims, preferences = {}) {
  const diameter = dims?.topR ? dims.topR * 2 : 18;
  const height = dims?.height || 22;
  const armLen = dims?.armLen || 7;

  const core = [
    {
      name: `${diameter} in round tabletop (plywood or project panel)`,
      category: "panel",
      quantity: 1,
      unit: "top",
      estimated_unit_cost_usd: 35,
      store_query: "round project panel plywood",
      notes: "Pre-cut round or cut from 3/4 in plywood with a router circle jig.",
      alternatives: ["3/4 inch birch plywood project panel"]
    },
    {
      name: "2×2 in hardwood (foot arms)",
      category: "lumber",
      quantity: 2,
      unit: "6 ft board",
      estimated_unit_cost_usd: 12,
      store_query: "2x2 hardwood board",
      notes: `Cut four ${armLen} in arms; dado the inner face for wedge tabs.`,
      alternatives: ["poplar 2x2", "maple 2x2 board"]
    },
    {
      name: "3/4 in plywood (hub plate + wedge blocks)",
      category: "panel",
      quantity: 1,
      unit: "2×2 ft sheet",
      estimated_unit_cost_usd: 16,
      store_query: "3/4 inch plywood project panel",
      notes: "Hub disc + four triangular wedge blocks; seal edges before paint."
    },
    {
      name: "3 in steel pipe or PVC column core",
      category: "hardware",
      quantity: 1,
      unit: `${height} in length`,
      estimated_unit_cost_usd: 28,
      store_query: "3 inch steel pipe",
      notes: "Structural core for the column; wrap with MDF staves if painting.",
      alternatives: ["3 inch PVC pipe", "sonotube for temporary mockups only"]
    },
    {
      name: "1/4 in MDF sheet (column wrap staves)",
      category: "panel",
      quantity: 1,
      unit: "2×4 ft",
      estimated_unit_cost_usd: 10,
      store_query: "1/4 inch mdf sheet",
      notes: "Cut staves to wrap the pipe; glue + clamp, then sand flush before primer."
    },
    {
      name: "Steel mounting plate (6 in disc) or cut from 1/8 in steel",
      category: "hardware",
      quantity: 1,
      unit: "plate",
      estimated_unit_cost_usd: 12,
      store_query: "steel mending plate round",
      notes: "Three screw holes for top; center hole for column stud."
    },
    {
      name: "Adjustable leveling feet 1/4-20",
      category: "hardware",
      quantity: 4,
      unit: "feet",
      estimated_unit_cost_usd: 3,
      store_query: "adjustable leveling foot 1/4-20",
      notes: "Thread into inserts on the underside of each arm block."
    },
    {
      name: "1/4-20 threaded inserts",
      category: "fastener",
      quantity: 4,
      unit: "inserts",
      estimated_unit_cost_usd: 1.5,
      store_query: "1/4-20 threaded insert wood",
      notes: "For leveling feet in arm blocks."
    },
    {
      name: "M6×40 mm bolts + washers (wedge to hub)",
      category: "fastener",
      quantity: 4,
      unit: "sets",
      estimated_unit_cost_usd: 1,
      store_query: "M6 bolt 40mm washer",
      notes: "Locks each wedge block to the hub plate."
    },
    {
      name: "1/4-20 flat-head screws 1-1/4 in (top plate)",
      category: "fastener",
      quantity: 3,
      unit: "screws",
      estimated_unit_cost_usd: 0.5,
      store_query: "1/4-20 flat head screw 1-1/4",
      notes: "Attach mounting plate to underside of top."
    }
  ];

  const finishMats = spec.finish?.materials || [];
  return [...core, ...finishMats];
}

export function enrichPedestalPlan(plan, preferences = {}, colors = {}) {
  const dims = {
    topR: plan.dimensions?.width_in ? plan.dimensions.width_in / 2 : 18,
    height: plan.dimensions?.height_in || 22,
    armLen: 7
  };
  const spec = getPedestalJoinerySpec(dims, colors);
  const materials = pedestalMaterialsFromJoinery(spec, dims, preferences);

  const existing = new Set((plan.materials || []).map((m) => m.name.toLowerCase()));
  const merged = [...(plan.materials || [])];
  for (const item of materials) {
    if (!existing.has(item.name.toLowerCase())) {
      merged.push(item);
      existing.add(item.name.toLowerCase());
    }
  }

  plan.materials = merged;
  plan.detected_object = {
    ...(plan.detected_object || {}),
    structure: "pedestal column with wedge-tab cross base",
    joinery: spec.connection.type
  };
  plan.assumptions = [
    ...(plan.assumptions || []),
    spec.connection.summary,
    ...(spec.finish.notes || [])
  ];
  plan.steps = spec.assembly_sequence.map((s) => ({
    title: s.title,
    detail: s.detail,
    estimated_minutes: 25,
    safety_notes: "Clamp workpieces; keep pilot holes aligned so wedge tabs seat fully."
  }));

  return { plan, joinery: spec };
}
