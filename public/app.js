const imageInput = document.querySelector("#image-input");
const dropZone = document.querySelector("#drop-zone");
const previewWrap = document.querySelector("#preview-wrap");
const previewImage = document.querySelector("#preview-image");
const clearImageButton = document.querySelector("#clear-image");
const sampleButton = document.querySelector("#sample-button");
const form = document.querySelector("#plan-form");
const generateButton = document.querySelector("#generate-button");
const statusPill = document.querySelector("#status-pill");
const liquidCanvas = document.querySelector("#liquid-canvas");

const emptyState = document.querySelector("#empty-state");
const loadingState = document.querySelector("#loading-state");
const errorState = document.querySelector("#error-state");
const planOutput = document.querySelector("#plan-output");

let imageDataUrl = "";
let pointerX = 0.5;
let pointerY = 0.5;

startLiquidCanvas();
checkHealth();

imageInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (file) await setImageFromFile(file);
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  const file = event.dataTransfer.files?.[0];
  if (file) await setImageFromFile(file);
});

clearImageButton.addEventListener("click", () => {
  imageDataUrl = "";
  imageInput.value = "";
  previewWrap.hidden = true;
});

sampleButton.addEventListener("click", () => {
  imageDataUrl = sampleImageDataUrl();
  previewImage.src = imageDataUrl;
  previewWrap.hidden = false;
  document.querySelector("#furniture-type").value = "side table";
  document.querySelector("#target-size").value = "24 W x 18 D x 24 H in";
  document.querySelector("#budget").value = "$80 - $140";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await generatePlan();
});

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    statusPill.textContent = health.cloudModelConfigured ? "Cloud ready" : "Mock mode";
    statusPill.classList.toggle("cloud", health.cloudModelConfigured);
    hydrateRoutingStrategies(health.routingStrategies || []);
  } catch {
    statusPill.textContent = "Offline";
  }
}

function hydrateRoutingStrategies(strategies) {
  if (!strategies.length) return;
  const select = document.querySelector("#routing-strategy");
  select.innerHTML = strategies
    .map(
      (strategy) =>
        `<option value="${escapeHtml(strategy.id)}">${escapeHtml(strategy.label)}</option>`
    )
    .join("");
}

async function setImageFromFile(file) {
  if (!file.type.startsWith("image/")) {
    showError("Please upload an image file.");
    return;
  }

  imageDataUrl = await readFileAsDataUrl(file);
  previewImage.src = imageDataUrl;
  previewWrap.hidden = false;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function generatePlan() {
  hideError();
  setBusy(true);

  try {
    const response = await fetch("/api/generate-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageDataUrl,
        furnitureType: document.querySelector("#furniture-type").value,
        skillLevel: document.querySelector("#skill-level").value,
        targetSize: document.querySelector("#target-size").value,
        budget: document.querySelector("#budget").value,
        zipcode: document.querySelector("#zipcode").value,
        routingStrategy: document.querySelector("#routing-strategy").value,
        tools: Array.from(document.querySelectorAll('input[name="tools"]:checked')).map((input) => input.value)
      })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Plan generation failed.");
    renderPlan(result);
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  generateButton.disabled = isBusy;
  generateButton.textContent = isBusy ? "Generating..." : "Generate DIY plan";
  loadingState.hidden = !isBusy;
  emptyState.hidden = true;
  if (isBusy) {
    planOutput.hidden = true;
  }
}

function renderPlan(result) {
  const { plan } = result;
  emptyState.hidden = true;
  errorState.hidden = true;
  planOutput.hidden = false;

  document.querySelector("#mode-label").textContent =
    result.mode === "cloud" ? "Cloud model workflow" : "Local fallback workflow";
  document.querySelector("#plan-title").textContent = plan.project.title;
  document.querySelector("#plan-summary").textContent = plan.project.summary;
  document.querySelector("#buildability-score").textContent = Math.round(
    plan.evaluation.buildability_score
  );

  renderMetrics(result);
  renderResearchScores(result);
  renderMaterials(plan.materials, result.purchase_links);
  renderSteps(plan.steps);
  renderVerifier(plan);
  renderRouting(result.routing_policy);
  renderTrace(result.trace);
  document.querySelector("#json-output").textContent = JSON.stringify(result, null, 2);
}

function renderMetrics(result) {
  const cost = result.plan.estimated_total_cost_usd;
  const dimensions = result.plan.dimensions;
  const metrics = [
    [`$${Math.round(cost.low)} - $${Math.round(cost.high)}`, "Estimated material cost"],
    [`${result.metrics.total_latency_ms} ms`, "Workflow latency"],
    [result.routing_strategy?.label || result.metrics.routing_strategy, "Routing strategy"],
    [`${result.metrics.relative_cost_units}`, "Relative cost units"],
    [result.metrics.model, "Primary model"],
    [`${dimensions.width_in} x ${dimensions.depth_in} x ${dimensions.height_in} in`, "Suggested size"]
  ];

  document.querySelector("#metrics-grid").innerHTML = metrics
    .map(
      ([value, label]) => `
        <div class="metric">
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(label)}</span>
        </div>
      `
    )
    .join("");
}

function renderResearchScores(result) {
  const report = result.evaluation_report;
  const scores = [
    [report.overall_score, "Overall quality"],
    [report.dimensions.completeness.score, "Completeness"],
    [report.dimensions.safety.score, "Safety"],
    [report.dimensions.materials.score, "Materials"],
    [report.dimensions.cost_consistency.score, "Cost consistency"],
    [report.dimensions.observability.score, "Observability"]
  ];

  document.querySelector("#research-score-grid").innerHTML = scores
    .map(
      ([value, label]) => `
        <div class="mini-score">
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(label)}</span>
        </div>
      `
    )
    .join("");

  const issues = [
    ...(result.triggered_escalations || []).map((item) => `Escalation trigger: ${item}`),
    ...report.issues
  ];

  document.querySelector("#research-issues-list").innerHTML = issues.length
    ? issues.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>No major evaluator issues detected.</li>";
}

function renderMaterials(materials, purchaseLinks) {
  const linksByName = new Map(purchaseLinks.map((item) => [item.material, item]));
  document.querySelector("#materials-body").innerHTML = materials
    .map((material) => {
      const links = linksByName.get(material.name);
      return `
        <tr>
          <td>
            <strong>${escapeHtml(material.name)}</strong><br />
            <span>${escapeHtml(material.notes)}</span>
          </td>
          <td>${escapeHtml(`${material.quantity} ${material.unit}`)}</td>
          <td>$${Number(material.estimated_unit_cost_usd).toFixed(0)} ea.</td>
          <td>
            ${
              links
                ? `<a href="${links.home_depot}" target="_blank" rel="noreferrer">Home Depot</a><br />
                   <a href="${links.lowes}" target="_blank" rel="noreferrer">Lowe's</a>`
                : "N/A"
            }
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderSteps(steps) {
  document.querySelector("#steps-list").innerHTML = steps
    .map(
      (step) => `
        <li>
          <strong>${escapeHtml(step.title)} <span>(${step.estimated_minutes} min)</span></strong>
          <p>${escapeHtml(step.detail)}</p>
          <p>${escapeHtml(step.safety_notes)}</p>
        </li>
      `
    )
    .join("");
}

function renderVerifier(plan) {
  const items = [
    `Risk level: ${plan.evaluation.risk_level}`,
    ...plan.safety_checks,
    ...plan.evaluation.missing_inputs,
    ...plan.evaluation.verifier_notes
  ];

  document.querySelector("#verifier-list").innerHTML = items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function renderRouting(policy) {
  document.querySelector("#routing-list").innerHTML = policy
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.stage)}</strong>: ${escapeHtml(item.preferred_model)} (${escapeHtml(item.provider)}, cost ${item.relative_cost_units})</li>`
    )
    .join("");
}

function renderTrace(trace) {
  document.querySelector("#trace-list").innerHTML = trace
    .map(
      (item) => `
        <div class="trace-item">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.model)}</span>
          <span>${item.latency_ms} ms</span>
          <span>${escapeHtml(item.note)}</span>
        </div>
      `
    )
    .join("");
}

function showError(message) {
  errorState.textContent = message;
  errorState.hidden = false;
  loadingState.hidden = true;
}

function hideError() {
  errorState.hidden = true;
  errorState.textContent = "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sampleImageDataUrl() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
      <rect width="800" height="600" fill="#f4efe4"/>
      <rect x="150" y="170" width="500" height="58" rx="8" fill="#b98248"/>
      <rect x="190" y="228" width="72" height="245" fill="#8b5a32"/>
      <rect x="538" y="228" width="72" height="245" fill="#8b5a32"/>
      <rect x="220" y="348" width="360" height="42" rx="6" fill="#a46f3d"/>
      <rect x="142" y="155" width="516" height="24" rx="8" fill="#d29a5b"/>
      <circle cx="214" cy="500" r="18" fill="#5d4636"/>
      <circle cx="586" cy="500" r="18" fill="#5d4636"/>
    </svg>
  `;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function startLiquidCanvas() {
  if (!liquidCanvas) return;

  const ctx = liquidCanvas.getContext("2d", { alpha: false });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    liquidCanvas.width = Math.floor(width * dpr);
    liquidCanvas.height = Math.floor(height * dpr);
    liquidCanvas.style.width = `${width}px`;
    liquidCanvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(time) {
    const t = reducedMotion ? 0.35 : time * 0.00018;
    const px = (pointerX - 0.5) * 90;
    const py = (pointerY - 0.5) * 70;

    ctx.globalCompositeOperation = "source-over";
    const base = ctx.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, "#040604");
    base.addColorStop(0.42, "#15160e");
    base.addColorStop(1, "#030403");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.filter = "blur(26px)";

    drawRibbon(ctx, {
      time: t,
      offset: 0,
      width,
      height,
      pointerX: px,
      pointerY: py,
      colorStops: [
        [0, "rgba(213, 255, 87, 0)"],
        [0.28, "rgba(213, 255, 87, 0.2)"],
        [0.58, "rgba(234, 211, 160, 0.34)"],
        [1, "rgba(139, 178, 255, 0.08)"]
      ],
      lineWidth: Math.max(width, height) * 0.22
    });

    drawRibbon(ctx, {
      time: t * 1.25 + 1.8,
      offset: 1.3,
      width,
      height,
      pointerX: -px * 0.55,
      pointerY: py * 0.85,
      colorStops: [
        [0, "rgba(217, 134, 82, 0)"],
        [0.25, "rgba(217, 134, 82, 0.22)"],
        [0.62, "rgba(194, 201, 164, 0.3)"],
        [1, "rgba(213, 255, 87, 0.1)"]
      ],
      lineWidth: Math.max(width, height) * 0.18
    });

    drawRibbon(ctx, {
      time: t * 0.88 + 3.4,
      offset: 2.2,
      width,
      height,
      pointerX: px * 0.35,
      pointerY: -py * 0.4,
      colorStops: [
        [0, "rgba(139, 178, 255, 0)"],
        [0.34, "rgba(139, 178, 255, 0.22)"],
        [0.7, "rgba(234, 211, 160, 0.2)"],
        [1, "rgba(127, 141, 105, 0.18)"]
      ],
      lineWidth: Math.max(width, height) * 0.14
    });

    ctx.restore();

    const vignette = ctx.createRadialGradient(width * 0.52, height * 0.44, 0, width * 0.52, height * 0.44, Math.max(width, height) * 0.72);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.52)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(2, 3, 2, 0.36)";
    ctx.fillRect(0, 0, width, height);

    if (!reducedMotion) requestAnimationFrame(draw);
  }

  resize();
  draw(0);

  window.addEventListener("resize", () => {
    resize();
    draw(0);
  });

  window.addEventListener("pointermove", (event) => {
    pointerX = event.clientX / Math.max(window.innerWidth, 1);
    pointerY = event.clientY / Math.max(window.innerHeight, 1);
  });

  if (!reducedMotion) requestAnimationFrame(draw);
}

function drawRibbon(ctx, config) {
  const { time, offset, width, height, pointerX, pointerY, colorStops, lineWidth } = config;
  const gradient = ctx.createLinearGradient(0, height * 0.2, width, height * 0.86);
  for (const [stop, color] of colorStops) gradient.addColorStop(stop, color);

  const yBase = height * (0.2 + 0.14 * Math.sin(time + offset));
  const amplitude = height * (0.23 + 0.06 * Math.cos(time * 0.7 + offset));
  const xShift = Math.sin(time * 0.85 + offset) * width * 0.14 + pointerX;
  const yShift = Math.cos(time * 0.72 + offset) * height * 0.07 + pointerY;

  ctx.beginPath();
  ctx.moveTo(-width * 0.22, yBase + yShift);
  ctx.bezierCurveTo(
    width * 0.16 + xShift,
    yBase - amplitude + yShift,
    width * 0.42 - xShift,
    yBase + amplitude * 1.25,
    width * 0.72 + xShift * 0.35,
    yBase + amplitude * 0.18 - yShift
  );
  ctx.bezierCurveTo(
    width * 0.98 - xShift * 0.6,
    yBase - amplitude * 0.72,
    width * 1.08 + xShift,
    yBase + amplitude * 0.74,
    width * 1.24,
    yBase + amplitude * 0.4
  );
  ctx.strokeStyle = gradient;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.stroke();
}
