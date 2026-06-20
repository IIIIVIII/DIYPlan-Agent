import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan } from "./src/planner.js";
import { listRoutingStrategies } from "./src/routing.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const maxBodyBytes = 18 * 1024 * 1024;

await loadDotEnv();

const port = Number(process.env.PORT || 5173);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        cloudModelConfigured: Boolean(process.env.OPENAI_API_KEY),
        defaultModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        routingStrategies: listRoutingStrategies()
      });
    }

    if (req.method === "POST" && req.url === "/api/generate-plan") {
      const payload = await readJsonBody(req);
      const plan = await generatePlan(payload);
      return sendJson(res, 200, plan);
    }

    if (req.method === "POST" && req.url === "/api/import-image") {
      const payload = await readJsonBody(req);
      const imageDataUrl = await importRemoteImage(payload.url || payload.imageUrl);
      return sendJson(res, 200, { imageDataUrl });
    }

    if (req.method === "GET") {
      return serveStatic(req, res);
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, {
      error: error.message || "Unexpected server error",
      details: process.env.NODE_ENV === "development" ? error.stack : undefined
    });
  }
});

server.listen(port, () => {
  console.log(`DIYPlan Agent demo running at http://localhost:${port}`);
});

async function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) return;

  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      const error = new Error("Uploaded image is too large for this demo. Try an image under 12 MB.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const safePath = normalizePublicPath(url.pathname);
  const filePath = path.join(publicDir, safePath);
  const ext = path.extname(filePath).toLowerCase();

  try {
    const contents = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes.get(ext) || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(contents);
  } catch {
    const fallback = await readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(fallback);
  }
}

function normalizePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const withoutTraversal = decoded.replace(/\.\./g, "");
  if (withoutTraversal === "/" || withoutTraversal === "") return "index.html";
  return withoutTraversal.replace(/^\/+/, "");
}

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function importRemoteImage(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    const error = new Error("Dragged image URL is not valid.");
    error.statusCode = 400;
    throw error;
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    const error = new Error("Only http and https image URLs can be imported.");
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "DIYPlan-Agent/0.1 image importer"
    }
  });

  if (!response.ok) {
    const error = new Error(`Could not import image URL (${response.status}).`);
    error.statusCode = 400;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    const error = new Error("Dragged URL did not resolve to an image.");
    error.statusCode = 400;
    throw error;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > 8 * 1024 * 1024) {
    const error = new Error("Remote image is too large for this demo. Try an image under 8 MB.");
    error.statusCode = 413;
    throw error;
  }

  return `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`;
}
