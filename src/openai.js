import { planSchema } from "./schema.js";

const responsesUrl = "https://api.openai.com/v1/responses";

export async function callOpenAIPlan({ imageDataUrl, preferences, catalogContextText }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.5-mini";
  const strongModel = process.env.OPENAI_STRONG_MODEL || "gpt-5.5";
  const routerModel = process.env.OPENAI_ROUTER_MODEL || model;
  const startedAt = performance.now();

  const response = await fetch(responsesUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 4500,
      text: {
        format: {
          type: "json_schema",
          name: "diy_furniture_plan",
          strict: true,
          schema: planSchema
        }
      },
      input: [
        {
          role: "system",
          content:
            "You are a cautious DIY furniture planning agent. Generate inspired-by, buildable alternatives rather than copies of branded furniture. Prefer beginner-safe joinery, realistic materials, and explicit assumptions. Do not design electrical work or high-risk load-bearing structures."
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildPrompt(preferences, catalogContextText, { strongModel, routerModel })
            },
            {
              type: "input_image",
              image_url: imageDataUrl
            }
          ]
        }
      ]
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    const error = new Error(`OpenAI request failed with ${response.status}: ${raw.slice(0, 1000)}`);
    error.statusCode = 502;
    throw error;
  }

  const json = JSON.parse(raw);
  const text = extractResponseText(json);
  const plan = parsePlanJson(text);

  return {
    plan,
    metrics: {
      model,
      cloud_latency_ms: Math.round(performance.now() - startedAt),
      response_id: json.id || null
    }
  };
}

function buildPrompt(preferences, catalogContextText, models) {
  return `
Create a structured DIY furniture plan from the uploaded inspiration image.

User constraints:
- Claimed furniture type: ${preferences.furnitureType || "auto-detect"}
- Target size: ${preferences.targetSize || "not specified"}
- Budget: ${preferences.budget || "not specified"}
- Skill level: ${preferences.skillLevel || "beginner"}
- Available tools: ${(preferences.tools || []).join(", ") || "basic hand tools"}
- Zip code: ${preferences.zipcode || "not provided"}

Local material catalog snippets:
${catalogContextText}

Routing research context:
- Strong multimodal model candidate: ${models.strongModel}
- Router / lower-cost model candidate: ${models.routerModel}
- Prefer separating image understanding, planning, retrieval, verification, and cost formatting.

Output requirements:
- Do not recreate a branded design exactly.
- Produce a safer, simplified, inspired-by DIY version.
- Prefer low-risk furniture categories such as side tables, coffee tables, shelves, or nightstands.
- If the image appears to be high-risk, state the safer simplified scope.
- Use realistic US hardware-store materials.
- Fill every schema field.
`.trim();
}

function extractResponseText(json) {
  if (typeof json.output_text === "string") return json.output_text;

  const chunks = [];
  for (const item of json.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.output_text === "string") chunks.push(content.output_text);
    }
  }

  if (chunks.length) return chunks.join("\n");
  throw new Error("OpenAI response did not include output text.");
}

function parsePlanJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Model response was not valid JSON.");
  }
}
