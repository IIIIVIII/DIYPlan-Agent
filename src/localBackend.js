const DEFAULT_URL = "http://127.0.0.1:8000";

function backendUrl() {
  return (process.env.ML_BACKEND_URL || DEFAULT_URL).replace(/\/$/, "");
}

function timeoutMs() {
  return Number(process.env.ML_BACKEND_TIMEOUT_MS || 120000);
}

export function localBackendConfigured() {
  // ML_BACKEND_URL only configures *where* the backend is. Set
  // ML_BACKEND_ENABLED=1 to force local-first for every image request,
  // regardless of the selected routing strategy.
  return process.env.ML_BACKEND_ENABLED === "1";
}

export async function checkLocalBackend() {
  try {
    const response = await fetchWithTimeout(`${backendUrl()}/health`, { method: "GET" }, 4000);
    if (!response.ok) return { available: false };
    const body = await response.json();
    return { available: Boolean(body.ok), ...body };
  } catch {
    return { available: false };
  }
}

export async function callLocalPlan({ imageDataUrl, imageDataUrls, preferences }) {
  const startedAt = performance.now();
  const urls = imageDataUrls?.length ? imageDataUrls : imageDataUrl ? [imageDataUrl] : [];
  const response = await fetchWithTimeout(
    `${backendUrl()}/plan`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageDataUrls: urls, preferences })
    },
    timeoutMs()
  );

  const raw = await response.text();
  if (!response.ok) {
    const error = new Error(`Local ML backend failed (${response.status}): ${raw.slice(0, 500)}`);
    error.statusCode = 502;
    throw error;
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    const error = new Error("Local ML backend returned non-JSON output.");
    error.statusCode = 502;
    throw error;
  }

  return {
    plan: body.plan,
    perception: body.perception || null,
    retrieval: body.retrieval || [],
    instructionModel: body.instruction_model || null,
    partCutouts: body.part_cutouts || null,
    dominantColor: body.dominant_color || null,
    stages: body.stages || [],
    metrics: {
      ...(body.metrics || {}),
      mode: body.mode || "local-mlx",
      local_latency_ms: body.metrics?.local_latency_ms ?? Math.round(performance.now() - startedAt)
    }
  };
}

export async function callLocalUnderstand({ imageDataUrls, preferences }) {
  const response = await fetchWithTimeout(
    `${backendUrl()}/understand`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageDataUrls: imageDataUrls || [], preferences: preferences || {} })
    },
    timeoutMs()
  );
  if (!response.ok) {
    const error = new Error(`Local understand failed (${response.status}).`);
    error.statusCode = 502;
    throw error;
  }
  return response.json();
}

export async function callLocalTranslate({ texts, targetLang }) {
  const response = await fetchWithTimeout(
    `${backendUrl()}/translate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts: texts || [], target_lang: targetLang || "en" })
    },
    timeoutMs()
  );
  if (!response.ok) {
    const error = new Error(`Local translate failed (${response.status}).`);
    error.statusCode = 502;
    throw error;
  }
  return response.json();
}

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
