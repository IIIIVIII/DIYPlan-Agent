export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "project",
    "detected_object",
    "assumptions",
    "difficulty",
    "estimated_total_cost_usd",
    "dimensions",
    "materials",
    "tools",
    "steps",
    "safety_checks",
    "routing_notes",
    "evaluation"
  ],
  properties: {
    project: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "inspired_by_style", "recommended_scope"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        inspired_by_style: { type: "string" },
        recommended_scope: { type: "string" }
      }
    },
    detected_object: {
      type: "object",
      additionalProperties: false,
      required: ["category", "visible_parts", "likely_materials", "confidence"],
      properties: {
        category: { type: "string" },
        visible_parts: { type: "array", items: { type: "string" } },
        likely_materials: { type: "array", items: { type: "string" } },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      }
    },
    assumptions: { type: "array", items: { type: "string" } },
    difficulty: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
    estimated_total_cost_usd: {
      type: "object",
      additionalProperties: false,
      required: ["low", "high", "notes"],
      properties: {
        low: { type: "number", minimum: 0 },
        high: { type: "number", minimum: 0 },
        notes: { type: "string" }
      }
    },
    dimensions: {
      type: "object",
      additionalProperties: false,
      required: ["width_in", "depth_in", "height_in", "confidence", "notes"],
      properties: {
        width_in: { type: "number", minimum: 0 },
        depth_in: { type: "number", minimum: 0 },
        height_in: { type: "number", minimum: 0 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        notes: { type: "string" }
      }
    },
    materials: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "category",
          "quantity",
          "unit",
          "estimated_unit_cost_usd",
          "notes",
          "store_query",
          "alternatives"
        ],
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          quantity: { type: "number", minimum: 0 },
          unit: { type: "string" },
          estimated_unit_cost_usd: { type: "number", minimum: 0 },
          notes: { type: "string" },
          store_query: { type: "string" },
          alternatives: { type: "array", items: { type: "string" } }
        }
      }
    },
    tools: { type: "array", items: { type: "string" } },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "estimated_minutes", "safety_notes"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          estimated_minutes: { type: "number", minimum: 0 },
          safety_notes: { type: "string" }
        }
      }
    },
    safety_checks: { type: "array", items: { type: "string" } },
    routing_notes: { type: "array", items: { type: "string" } },
    evaluation: {
      type: "object",
      additionalProperties: false,
      required: ["buildability_score", "risk_level", "missing_inputs", "verifier_notes"],
      properties: {
        buildability_score: { type: "number", minimum: 0, maximum: 100 },
        risk_level: { type: "string", enum: ["low", "medium", "high"] },
        missing_inputs: { type: "array", items: { type: "string" } },
        verifier_notes: { type: "array", items: { type: "string" } }
      }
    }
  }
};
