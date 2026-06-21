const imageInput = document.querySelector("#image-input");
const dropZone = document.querySelector("#drop-zone");
const thumbs = document.querySelector("#thumbs");
const previewActions = document.querySelector("#preview-actions");
const analyzeButton = document.querySelector("#analyze-button");
const referenceWrap = document.querySelector("#reference-wrap");
const referenceImage = document.querySelector("#reference-image");
const clearImageButton = document.querySelector("#clear-image");
const sampleButton = document.querySelector("#sample-button");
const form = document.querySelector("#plan-form");
const generateButton = document.querySelector("#generate-button");
const statusPill = document.querySelector("#status-pill");
const liquidCanvas = document.querySelector("#liquid-canvas");
const cursorGlow = document.querySelector("#cursor-glow");

const emptyState = document.querySelector("#empty-state");
const loadingState = document.querySelector("#loading-state");
const errorState = document.querySelector("#error-state");
const planOutput = document.querySelector("#plan-output");
const agentStatePill = document.querySelector("#agent-state-pill");
const agentMessage = document.querySelector("#agent-message");
const agentSteps = document.querySelector("#agent-steps");

let imageDataUrls = [];
let pointerX = 0.5;
let pointerY = 0.5;
let dragDepth = 0;
let agentTimer = null;
let currentLang = localStorage.getItem("diyplan_lang") || "en";
let lastResultBase = null; // original (English) result for re-translation
const translationCache = new Map(); // lang -> translated result
const enhancedSelects = new Map();
const motion = window.gsap;
const AGENT_PHASES = [
  ["Observe", "Read the image or dragged source"],
  ["Measure", "Use user dimensions and visible scale clues"],
  ["Decompose", "Convert furniture into buildable 2D parts"],
  ["Route", "Choose cloud, local, or rule stages"],
  ["Retrieve", "Map parts to hardware-store materials"],
  ["Manual", "Render micro-step assembly pages"],
  ["Verify", "Check safety, cost, and missing inputs"]
];

const I18N = {
  en: {
    "nav.plan": "Plan",
    "nav.evaluate": "Evaluate",
    "brand.eyebrow": "Multimodal routing studio",
    "status.checking": "Checking",
    "status.localReady": "Local MLX ready",
    "status.cloudReady": "Cloud ready",
    "status.mock": "Mock mode",
    "status.offline": "Offline",
    "drop.title": "Drop furniture photos here",
    "drop.meta": "Add several angles of the same item for a more accurate result",
    "analyze.button": "Confirm & auto-fill",
    "analyze.running": "Analyzing photos...",
    "analyze.done": "Analysis complete. Review the auto-filled details, then generate.",
    "analyze.clear": "Clear photos",
    "reference.label": "Dimension reference",
    "sample.button": "Use round table sample",
    "form.furnitureType": "Furniture type",
    "opt.auto": "Auto detect",
    "opt.sideTable": "Side table",
    "opt.coffeeTable": "Coffee table",
    "opt.roundTable": "Round dining table",
    "opt.bookshelf": "Bookshelf",
    "opt.nightstand": "Nightstand",
    "form.skill": "Skill level",
    "opt.beginner": "Beginner",
    "opt.intermediate": "Intermediate",
    "opt.advanced": "Advanced",
    "form.targetSize": "Target size",
    "ph.targetSize": "24 W x 18 D x 24 H in",
    "form.budget": "Budget",
    "ph.budget": "$80 - $150",
    "form.zip": "Zip code",
    "form.tools": "Available tools",
    "tool.drill": "Drill",
    "tool.saw": "Saw",
    "tool.sander": "Sander",
    "tool.clamps": "Clamps",
    "generate.button": "Generate DIY plan",
    "generate.running": "Generating...",
    "agent.runtime": "Agent runtime",
    "agent.heading": "Planning agent",
    "agent.idle": "Idle",
    "agent.intro": "Drop a photo and the agent will observe, decompose, route, verify, and render a build manual.",
    "agent.imageLoaded": "Photo loaded. Click Confirm & auto-fill, or generate directly.",
    "empty.ready": "Ready",
    "empty.heading": "Image in. Build plan out.",
    "empty.vision": "vision",
    "empty.routing": "routing",
    "empty.verifier": "verifier",
    "empty.materials": "materials",
    "loading.text": "Running multimodal planning workflow...",
    "score.buildability": "Buildability",
    "section.research": "Research Evaluation",
    "manual.eyebrow": "Real parts from your photo",
    "section.manual": "Instruction Manual",
    "section.materials": "Materials",
    "section.steps": "Build Steps",
    "section.verifier": "Verifier",
    "section.routing": "Routing Policy",
    "section.trace": "Execution Trace",
    "section.json": "Structured Output"
  },
  zh: {
    "nav.plan": "方案",
    "nav.evaluate": "评估",
    "brand.eyebrow": "多模态路由工作室",
    "status.checking": "检测中",
    "status.localReady": "本地 MLX 就绪",
    "status.cloudReady": "云端就绪",
    "status.mock": "模拟模式",
    "status.offline": "离线",
    "drop.title": "把家具照片拖到这里",
    "drop.meta": "上传同一件物品的多个角度，结果更精确",
    "analyze.button": "确认并自动填写",
    "analyze.running": "正在分析照片...",
    "analyze.done": "分析完成。检查自动填写的信息后再生成。",
    "analyze.clear": "清除照片",
    "reference.label": "尺寸参考",
    "sample.button": "使用圆桌示例",
    "form.furnitureType": "家具类型",
    "opt.auto": "自动识别",
    "opt.sideTable": "边桌",
    "opt.coffeeTable": "茶几",
    "opt.roundTable": "圆形餐桌",
    "opt.bookshelf": "书架",
    "opt.nightstand": "床头柜",
    "form.skill": "技能水平",
    "opt.beginner": "初学者",
    "opt.intermediate": "中级",
    "opt.advanced": "高级",
    "form.targetSize": "目标尺寸",
    "ph.targetSize": "宽24 x 深18 x 高24 英寸",
    "form.budget": "预算",
    "ph.budget": "$80 - $150",
    "form.zip": "邮编",
    "form.tools": "可用工具",
    "tool.drill": "电钻",
    "tool.saw": "锯",
    "tool.sander": "砂磨机",
    "tool.clamps": "夹具",
    "generate.button": "生成 DIY 方案",
    "generate.running": "生成中...",
    "agent.runtime": "智能体运行时",
    "agent.heading": "规划智能体",
    "agent.idle": "空闲",
    "agent.intro": "上传照片后，智能体会观察、拆解、路由、校验，并渲染装配说明书。",
    "agent.imageLoaded": "照片已载入。点击「确认并自动填写」，或直接生成。",
    "empty.ready": "就绪",
    "empty.heading": "图片进，方案出。",
    "empty.vision": "视觉",
    "empty.routing": "路由",
    "empty.verifier": "校验",
    "empty.materials": "材料",
    "loading.text": "正在运行多模态规划流程...",
    "score.buildability": "可制作性",
    "section.research": "研究评估",
    "manual.eyebrow": "来自你照片的真实部件",
    "section.manual": "装配说明书",
    "section.materials": "材料清单",
    "section.steps": "制作步骤",
    "section.verifier": "校验器",
    "section.routing": "路由策略",
    "section.trace": "执行轨迹",
    "section.json": "结构化输出"
  }
};

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
}

function applyLanguage(lang) {
  currentLang = I18N[lang] ? lang : "en";
  localStorage.setItem("diyplan_lang", currentLang);
  document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "en";

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const value = t(node.getAttribute("data-i18n"));
    if (value) node.textContent = value;
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((node) => {
    const value = t(node.getAttribute("data-i18n-ph"));
    if (value) node.setAttribute("placeholder", value);
  });

  document.querySelectorAll(".lang-switch button").forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === currentLang);
  });

  document.querySelectorAll("select").forEach((select) => enhanceSelect(select));

  const generateBtn = document.querySelector("#generate-button");
  if (generateBtn && !generateBtn.disabled) generateBtn.textContent = t("generate.button");

  checkHealth();
  if (lastResultBase) applyContentLanguage();
}

function wireLanguageSwitch() {
  document.querySelectorAll(".lang-switch button").forEach((button) => {
    button.addEventListener("click", () => applyLanguage(button.dataset.lang));
  });
}

function applyContentLanguage() {
  if (!lastResultBase) return;
  const resolved = translationCache.get(currentLang) || lastResultBase;
  renderResolved(resolved);
  if (currentLang !== "en" && !translationCache.has(currentLang)) {
    translateResult(currentLang);
  }
}

async function translateResult(lang) {
  const { clone, strings, setters } = gatherTranslatable(lastResultBase);
  if (!strings.length) {
    translationCache.set(lang, lastResultBase);
    return;
  }
  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts: strings, targetLang: lang })
    });
    const data = await response.json();
    const translations = data.translations || strings;
    setters.forEach((set, index) => set(translations[index] ?? strings[index]));
    translationCache.set(lang, clone);
    if (currentLang === lang) renderResolved(clone);
  } catch {
    translationCache.set(lang, lastResultBase);
  }
}

function gatherTranslatable(result) {
  const clone = structuredClone(result);
  const strings = [];
  const setters = [];
  const add = (obj, key) => {
    const value = obj?.[key];
    if (typeof value === "string" && value.trim()) {
      strings.push(value);
      setters.push((next) => {
        obj[key] = next;
      });
    }
  };
  const addArr = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((value, index) => {
      if (typeof value === "string" && value.trim()) {
        strings.push(value);
        setters.push((next) => {
          arr[index] = next;
        });
      }
    });
  };

  const plan = clone.plan || {};
  if (plan.project) ["title", "summary", "inspired_by_style", "recommended_scope"].forEach((k) => add(plan.project, k));
  addArr(plan.assumptions);
  if (plan.dimensions) add(plan.dimensions, "notes");
  if (plan.estimated_total_cost_usd) add(plan.estimated_total_cost_usd, "notes");
  (plan.materials || []).forEach((material) => {
    ["name", "notes", "unit", "category"].forEach((k) => add(material, k));
    addArr(material.alternatives);
  });
  addArr(plan.tools);
  (plan.steps || []).forEach((step) => ["title", "detail", "safety_notes"].forEach((k) => add(step, k)));
  addArr(plan.safety_checks);
  if (plan.evaluation) addArr(plan.evaluation.verifier_notes);
  const im = plan.instruction_model;
  if (im) {
    (im.parts || []).forEach((part) => add(part, "label"));
    (im.frames || []).forEach((frame) => {
      add(frame, "title");
      add(frame, "caption");
    });
  }
  return { clone, strings, setters };
}

startLiquidCanvas();
startCursorGlow();
enhanceSelects();
applyLanguage(currentLang);
wireLanguageSwitch();
renderAgentConsole("idle");
animateInitialView();
checkHealth();

imageInput.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  for (const file of files) await setImageFromFile(file);
  imageInput.value = "";
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", async (event) => {
  await handleImageDrop(event);
});

document.addEventListener("dragenter", (event) => {
  if (!hasImageLikeDrag(event.dataTransfer)) return;
  dragDepth += 1;
  document.body.classList.add("dragging-image");
});

document.addEventListener("dragover", (event) => {
  if (!hasImageLikeDrag(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});

document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove("dragging-image");
});

document.addEventListener("drop", async (event) => {
  if (!hasImageLikeDrag(event.dataTransfer)) return;
  await handleImageDrop(event);
});

document.addEventListener("paste", async (event) => {
  const active = document.activeElement;
  const isTyping = active?.matches?.("input, textarea, select, [contenteditable='true']");
  const imageFile = Array.from(event.clipboardData?.files || []).find((file) =>
    file.type.startsWith("image/")
  );

  if (imageFile) {
    event.preventDefault();
    await setImageFromFile(imageFile, "Pasted image");
    return;
  }

  if (isTyping) return;
  const text = event.clipboardData?.getData("text/plain")?.trim();
  if (isLikelyImageUrl(text)) {
    event.preventDefault();
    await setImageFromUrl(text, "Pasted image URL");
  }
});

clearImageButton.addEventListener("click", () => {
  imageDataUrls = [];
  imageInput.value = "";
  renderThumbs();
  referenceWrap.hidden = true;
  renderAgentConsole("idle");
});

sampleButton.addEventListener("click", async () => {
  imageDataUrls = [];
  await setImageFromUrl("/examples/round-table-photo.png", "Round table sample", "/examples/round-table-dimensions.png");
  document.querySelector("#furniture-type").value = "round dining table";
  document.querySelector("#target-size").value = "57 in diameter x 29.5 H in";
  document.querySelector("#budget").value = "$180 - $360";
  document.querySelector("#zipcode").value = "90024";
  enhanceSelect(document.querySelector("#furniture-type"));
});

analyzeButton.addEventListener("click", async () => {
  if (!imageDataUrls.length) return;
  analyzeButton.disabled = true;
  analyzeButton.textContent = t("analyze.running");
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageDataUrls })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Analysis failed.");
    applySuggestions(result.suggestions);
    renderAgentConsole("image", { message: t("analyze.done") });
  } catch (error) {
    showError(error.message);
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.textContent = t("analyze.button");
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await generatePlan();
});

function applySuggestions(suggestions) {
  if (!suggestions) return;
  const typeSelect = document.querySelector("#furniture-type");
  if (suggestions.furnitureType) {
    typeSelect.value = suggestions.furnitureType;
    enhanceSelect(typeSelect);
  }
  const skillSelect = document.querySelector("#skill-level");
  if (suggestions.skillLevel) {
    skillSelect.value = suggestions.skillLevel;
    enhanceSelect(skillSelect);
  }
  if (suggestions.targetSize) document.querySelector("#target-size").value = suggestions.targetSize;
  if (suggestions.budget) document.querySelector("#budget").value = suggestions.budget;
  if (Array.isArray(suggestions.tools)) {
    document.querySelectorAll('input[name="tools"]').forEach((input) => {
      input.checked = suggestions.tools.includes(input.value);
    });
  }
}

function renderThumbs() {
  if (!imageDataUrls.length) {
    thumbs.hidden = true;
    thumbs.innerHTML = "";
    previewActions.hidden = true;
    return;
  }
  thumbs.hidden = false;
  previewActions.hidden = false;
  thumbs.innerHTML = imageDataUrls
    .map(
      (url, index) => `
        <div class="thumb">
          <img src="${url}" alt="Uploaded furniture ${index + 1}" />
          <button type="button" class="thumb-remove" data-index="${index}" aria-label="Remove photo">&times;</button>
        </div>`
    )
    .join("");
  thumbs.querySelectorAll(".thumb-remove").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      imageDataUrls.splice(index, 1);
      renderThumbs();
      if (!imageDataUrls.length) renderAgentConsole("idle");
    });
  });
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    const local = health.localBackend || {};
    if (local.available) {
      statusPill.textContent = local.mock ? "Local mock" : t("status.localReady");
      statusPill.classList.add("cloud");
    } else if (health.cloudModelConfigured) {
      statusPill.textContent = t("status.cloudReady");
      statusPill.classList.add("cloud");
    } else {
      statusPill.textContent = t("status.mock");
    }
  } catch {
    statusPill.textContent = t("status.offline");
  }
}

async function setImageFromFile(file, sourceLabel = "Uploaded image") {
  if (!file.type.startsWith("image/")) {
    showError("Please upload an image file.");
    return;
  }

  assignImageDataUrl(await readFileAsDataUrl(file), sourceLabel);
}

async function setImageFromUrl(url, sourceLabel = "Dragged image URL", referenceUrl = "") {
  if (!url) return;
  if (url.startsWith("data:image/")) {
    assignImageDataUrl(url, sourceLabel, referenceUrl);
    return;
  }

  const parsedUrl = new URL(url, window.location.href);
  if (parsedUrl.origin === window.location.origin) {
    const response = await fetch(parsedUrl.href);
    if (!response.ok) throw new Error("Could not load local sample image.");
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("The dragged URL is not an image.");
    assignImageDataUrl(await readFileAsDataUrl(blob), sourceLabel, referenceUrl);
    return;
  }

  const response = await fetch("/api/import-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: parsedUrl.href })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not import dragged image.");
  assignImageDataUrl(payload.imageDataUrl, sourceLabel, referenceUrl);
}

function assignImageDataUrl(dataUrl, sourceLabel, referenceUrl = "") {
  if (!dataUrl || imageDataUrls.includes(dataUrl)) return;
  imageDataUrls.push(dataUrl);
  if (imageDataUrls.length > 6) imageDataUrls = imageDataUrls.slice(-6);
  renderThumbs();
  if (referenceUrl) {
    referenceImage.src = referenceUrl;
    referenceWrap.hidden = false;
  } else {
    referenceWrap.hidden = true;
    referenceImage.removeAttribute("src");
  }
  renderAgentConsole("image", { message: t("agent.imageLoaded") });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleImageDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  dragDepth = 0;
  document.body.classList.remove("dragging-image");
  dropZone.classList.remove("dragging");

  try {
    const dragged = await extractDraggedImage(event.dataTransfer);
    if (!dragged) {
      showError("Drop an image file, browser image, image URL, or pasted screenshot.");
      return;
    }

    if (dragged.file) await setImageFromFile(dragged.file, dragged.label);
    if (dragged.url) await setImageFromUrl(dragged.url, dragged.label);
  } catch (error) {
    showError(error.message);
  }
}

async function extractDraggedImage(dataTransfer) {
  const file = Array.from(dataTransfer?.files || []).find((item) =>
    item.type.startsWith("image/")
  );
  if (file) return { file, label: "Dragged image file" };

  const items = Array.from(dataTransfer?.items || []);
  const fileItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
  if (fileItem) return { file: fileItem.getAsFile(), label: "Dragged image file" };

  const htmlItem = items.find((item) => item.kind === "string" && item.type === "text/html");
  if (htmlItem) {
    const html = await dataTransferItemAsString(htmlItem);
    const src = extractImageUrlFromHtml(html);
    if (src) return { url: src, label: "Dragged browser image" };
  }

  for (const type of ["text/uri-list", "text/plain"]) {
    const item = items.find((candidate) => candidate.kind === "string" && candidate.type === type);
    if (!item) continue;
    const value = (await dataTransferItemAsString(item)).split(/\r?\n/).find((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("#");
    });
    if (isLikelyImageUrl(value)) return { url: value.trim(), label: "Dragged image URL" };
  }

  return null;
}

function dataTransferItemAsString(item) {
  return new Promise((resolve) => item.getAsString((value) => resolve(value || "")));
}

function extractImageUrlFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.querySelector("img")?.src || "";
}

function hasImageLikeDrag(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []);
  return types.some((type) =>
    ["Files", "text/html", "text/uri-list", "text/plain"].includes(type)
  );
}

function isLikelyImageUrl(value) {
  if (!value) return false;
  if (value.startsWith("data:image/")) return true;
  try {
    const url = new URL(value, window.location.href);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const extensionMatch = url.pathname.match(/\.([a-z0-9]+)$/i);
    return !extensionMatch || ["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(extensionMatch[1].toLowerCase());
  } catch {
    return false;
  }
}

async function generatePlan() {
  hideError();
  setBusy(true);
  startAgentRun();

  try {
    const response = await fetch("/api/generate-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageDataUrls,
        furnitureType: document.querySelector("#furniture-type").value,
        skillLevel: document.querySelector("#skill-level").value,
        targetSize: document.querySelector("#target-size").value,
        budget: document.querySelector("#budget").value,
        zipcode: document.querySelector("#zipcode").value,
        routingStrategy: "local_mlx",
        tools: Array.from(document.querySelectorAll('input[name="tools"]:checked')).map((input) => input.value)
      })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Plan generation failed.");
    renderPlan(result);
    finishAgentRun(result);
  } catch (error) {
    showError(error.message);
    failAgentRun(error.message);
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  generateButton.disabled = isBusy;
  generateButton.textContent = isBusy ? t("generate.running") : t("generate.button");
  loadingState.hidden = !isBusy;
  emptyState.hidden = true;
  if (isBusy) {
    planOutput.hidden = true;
  }
}

function renderPlan(result) {
  lastResultBase = result;
  translationCache.clear();
  translationCache.set("en", result);
  applyContentLanguage();
}

function renderResolved(result) {
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
  const instructionModel = getInstructionModel(plan);
  renderInstructionManual(instructionModel);
  renderMaterials(plan.materials, result.purchase_links, instructionModel);
  renderSteps(plan.steps, instructionModel);
  renderVerifier(plan);
  renderRouting(result.routing_policy);
  renderTrace(result.trace);
  document.querySelector("#json-output").textContent = JSON.stringify(result, null, 2);
  animateResultView();
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

function renderAgentConsole(state, options = {}) {
  const activeIndex = options.activeIndex ?? -1;
  const message =
    options.message ||
    {
      idle: "Drop an image and the agent will observe, decompose, route, verify, and render a build manual.",
      image: "Image loaded. The agent is ready to inspect furniture geometry and user constraints.",
      running: "Agent is running the multimodal planning workflow.",
      done: "Agent run complete. Review the visual manual, materials, verifier, and trace.",
      error: "Agent run stopped before producing a complete plan."
    }[state] ||
    "Agent runtime ready.";

  agentStatePill.textContent = state === "image" ? "Ready" : state;
  agentStatePill.dataset.state = state;
  agentMessage.textContent = message;
  agentSteps.innerHTML = AGENT_PHASES.map(([label, detail], index) => {
    const status =
      state === "done"
        ? "done"
        : state === "error" && index === activeIndex
          ? "error"
          : index < activeIndex
            ? "done"
            : index === activeIndex
              ? "active"
              : "queued";
    return `
      <div class="agent-step ${status}">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <div>
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(detail)}</small>
        </div>
      </div>
    `;
  }).join("");
}

function startAgentRun() {
  clearInterval(agentTimer);
  let activeIndex = 0;
  renderAgentConsole("running", { activeIndex });
  agentTimer = setInterval(() => {
    activeIndex = Math.min(activeIndex + 1, AGENT_PHASES.length - 1);
    renderAgentConsole("running", { activeIndex });
  }, 380);
}

function finishAgentRun(result) {
  clearInterval(agentTimer);
  agentTimer = null;
  const frames = result.plan?.instruction_model?.frames?.length || 0;
  const parts = result.plan?.instruction_model?.parts?.length || 0;
  renderAgentConsole("done", {
    activeIndex: AGENT_PHASES.length,
    message: `Agent finished: ${parts} parts, ${frames} instruction pages, ${result.purchase_links?.length || 0} store-link groups.`
  });
}

function failAgentRun(message) {
  clearInterval(agentTimer);
  agentTimer = null;
  renderAgentConsole("error", { activeIndex: 0, message });
}

function renderMaterials(materials, purchaseLinks, instructionModel) {
  const linksByName = new Map(purchaseLinks.map((item) => [item.material, item]));
  const partsByMaterial = groupPartsByMaterial(instructionModel.parts || []);
  document.querySelector("#materials-bento").innerHTML = materials
    .map((material, index) => {
      const links = linksByName.get(material.name);
      const parts = partsByMaterial.get(normalizeKey(material.name)) || [];
      return `
        <article class="material-card magnetic" style="--i: ${index}">
          <div class="card-glow"></div>
          <div class="material-card-top">
            <span class="material-index">${String(index + 1).padStart(2, "0")}</span>
            <span class="material-category">${escapeHtml(material.category)}</span>
          </div>
          <div class="material-visuals">
            ${parts.length ? parts.slice(0, 4).map((part) => renderPartChip(part)).join("") : renderGenericMaterialChip(material)}
          </div>
          <h4>${escapeHtml(material.name)}</h4>
          <p>${escapeHtml(material.notes)}</p>
          <div class="material-stats">
            <span><strong>${escapeHtml(material.quantity)}</strong>${escapeHtml(material.unit)}</span>
            <span><strong>$${Number(material.estimated_unit_cost_usd).toFixed(0)}</strong>each</span>
          </div>
          <div class="material-links">
            ${
              links
                ? `<a href="${links.home_depot}" target="_blank" rel="noreferrer">Home Depot</a>
                   <a href="${links.lowes}" target="_blank" rel="noreferrer">Lowe's</a>`
                : "<span>N/A</span>"
            }
          </div>
          <div class="alternatives">
            ${(material.alternatives || [])
              .slice(0, 3)
              .map((item) => `<span>${escapeHtml(item)}</span>`)
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");
  bindMagneticCards();
}

function renderSteps(steps, instructionModel) {
  const frames = instructionModel.frames || [];
  const stepItems = frames.length
    ? frames.map((frame, index) => ({
        title: frame.title,
        detail: frame.caption,
        estimated_minutes: steps[index]?.estimated_minutes || 20,
        safety_notes: steps[index]?.safety_notes || "Confirm fit before fastening.",
        frame
      }))
    : steps.map((step) => ({ ...step, frame: null }));

  document.querySelector("#steps-list").innerHTML = stepItems
    .map((step, index) => {
      const frame = frames[index] || frames[frames.length - 1] || null;
      return `
        <li class="manual-step-card">
          <div class="step-thumb">
            ${frame ? renderInstructionSvg(instructionModel, frame, { compact: true }) : ""}
          </div>
          <div class="step-copy">
            <span class="step-number">${String(index + 1).padStart(2, "0")}</span>
            <strong>${escapeHtml(step.title)} <span>(${step.estimated_minutes} min)</span></strong>
            <p>${escapeHtml(step.detail)}</p>
            <p>${escapeHtml(step.safety_notes)}</p>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderInstructionManual(instructionModel) {
  const parts = instructionModel.parts || [];
  const frames = instructionModel.frames || [];
  document.querySelector("#instruction-mode").textContent = humanizeRenderer(instructionModel.renderer || "2D vector");
  document.querySelector("#instruction-note").textContent = instructionModel.source_note || "";
  document.querySelector("#parts-tray").innerHTML = `
    <div class="parts-tray-header">
      <span>${parts.length} parts</span>
      <strong>Cut + assembly inventory</strong>
    </div>
    <div class="parts-inventory-grid">
      ${parts.map((part) => renderInventoryPart(part)).join("")}
    </div>
  `;
  document.querySelector("#instruction-pages").innerHTML = frames
    .map(
      (frame, index) => `
        <article class="manual-page">
          <div class="manual-page-head">
            <span>${index + 1}</span>
            <div>
              <h4>${escapeHtml(frame.title)}</h4>
              <p>${escapeHtml(frame.caption)}</p>
            </div>
          </div>
          ${renderFramePartsBin(parts, frame)}
          ${renderInstructionSvg(instructionModel, frame)}
        </article>
      `
    )
    .join("");
}

function getInstructionModel(plan) {
  if (plan.instruction_model?.parts?.length && plan.instruction_model?.frames?.length) {
    return plan.instruction_model;
  }

  return {
    version: "client-fallback",
    renderer: "2d_vector_manual",
    source_note: "Client fallback: generated a simple 2D manual from the material and step list.",
    view_box: { width: 520, height: 360 },
    parts: (plan.materials || []).slice(0, 6).map((material, index) => ({
      id: `material_${index}`,
      label: material.name,
      kind: material.category === "fastener" ? "fastener_set" : "panel",
      material_name: material.name,
      cut_size: material.unit,
      quantity: material.quantity,
      geometry: { x: 70 + (index % 3) * 140, y: 74 + Math.floor(index / 3) * 104, width: 104, height: 54 }
    })),
    frames: (plan.steps || []).slice(0, 5).map((step, index, steps) => ({
      title: step.title,
      caption: step.detail,
      visible_parts: (plan.materials || []).slice(0, Math.min(index + 2, 6)).map((_, partIndex) => `material_${partIndex}`),
      highlight_parts: [`material_${Math.min(index, Math.max(steps.length - 1, 0))}`],
      placements: {}
    }))
  };
}

function renderInventoryPart(part) {
  return `
    <article class="part-inventory-card">
      ${renderPartChip(part)}
      <div>
        <strong>${escapeHtml(part.label)}</strong>
        <span>${escapeHtml(part.cut_size || part.material_name || "part")}</span>
      </div>
      <small>x${escapeHtml(part.quantity || 1)}</small>
    </article>
  `;
}

function renderPartChip(part) {
  return `
    <span class="part-chip">
      <svg viewBox="0 0 120 76" aria-hidden="true">
        ${renderMiniPartShape(part)}
      </svg>
      <em>${escapeHtml(part.label)}</em>
    </span>
  `;
}

function renderFramePartsBin(parts, frame) {
  const partById = new Map(parts.map((part) => [part.id, part]));
  const needed = frame.parts_needed?.length
    ? frame.parts_needed
    : (frame.highlight_parts || []).map((partId) => ({ part_id: partId, quantity: partById.get(partId)?.quantity || 1 }));

  if (!needed.length) return "";

  return `
    <div class="step-parts-bin" aria-label="Parts needed for this step">
      <span>Pieces needed</span>
      <div class="needed-parts-grid">
        ${needed
          .map((item) => {
            const part = partById.get(item.part_id);
            if (!part) return "";
            return `
              <div class="needed-part">
                ${renderPartChip(part)}
                <strong>x${escapeHtml(item.quantity || 1)}</strong>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderGenericMaterialChip(material) {
  const part = {
    label: material.category || "material",
    kind: material.category === "fastener" ? "fastener_set" : "panel",
    material_name: material.name,
    quantity: material.quantity || 1,
    cut_size: material.unit || ""
  };
  return renderPartChip(part);
}

function renderMiniPartShape(part) {
  if (part.kind?.startsWith("round_top_half") || part.kind?.startsWith("round_half")) {
    const left = part.kind.endsWith("_left");
    return `
      <path class="mini-board" d="${left ? "M100 12 L100 64 C72 64 18 58 18 38 C18 18 72 12 100 12 Z" : "M20 12 L20 64 C48 64 102 58 102 38 C102 18 48 12 20 12 Z"}" />
      <path class="mini-grain" d="M32 30 C 50 18, 70 42, 94 30" />
      <path class="mini-grain" d="M30 48 C 52 38, 72 58, 94 48" />
    `;
  }

  if (part.kind === "metal_connector") {
    return `
      <rect class="mini-board" x="28" y="28" width="64" height="20" rx="5" />
      <circle class="mini-fastener" cx="42" cy="38" r="4" />
      <circle class="mini-fastener" cx="78" cy="38" r="4" />
    `;
  }

  if (part.kind === "leveler_set") {
    return [0, 1, 2, 3]
      .map((index) => `<g><line class="mini-adhesive" x1="${30 + index * 20}" y1="22" x2="${30 + index * 20}" y2="48" /><circle class="mini-fastener" cx="${30 + index * 20}" cy="55" r="7" /></g>`)
      .join("");
  }

  if (part.kind === "angled_leg") {
    return `
      <polygon class="mini-board" points="46,14 78,14 70,62 38,62" />
      <path class="mini-grain" d="M56 22 C 48 34, 66 42, 56 56" />
    `;
  }

  if (part.kind === "fastener_set") {
    return [0, 1, 2, 3, 4, 5]
      .map((index) => `<circle class="mini-fastener" cx="${32 + (index % 3) * 28}" cy="${26 + Math.floor(index / 3) * 22}" r="5" />`)
      .join("");
  }

  if (part.kind === "adhesive_lines") {
    return `
      <path class="mini-adhesive" d="M22 26 C 42 12, 58 42, 78 26 S 102 36, 104 24" />
      <path class="mini-adhesive" d="M20 48 C 42 34, 60 60, 84 46 S 104 58, 108 44" />
    `;
  }

  if (part.kind === "finish_overlay") {
    return `
      <rect class="mini-finish" x="18" y="14" width="84" height="48" rx="7" />
      <path class="mini-spark" d="M42 22 L46 32 L56 36 L46 40 L42 50 L38 40 L28 36 L38 32 Z" />
    `;
  }

  const height = part.kind === "rail" ? 18 : 42;
  const y = part.kind === "rail" ? 29 : 17;
  return `
    <rect class="mini-board" x="18" y="${y}" width="84" height="${height}" rx="5" />
    <path class="mini-grain" d="M28 ${y + 12} C 44 ${y + 4}, 64 ${y + 20}, 92 ${y + 10}" />
    <path class="mini-grain" d="M30 ${y + height - 10} C 54 ${y + height - 18}, 74 ${y + height - 2}, 96 ${y + height - 12}" />
  `;
}

function renderInstructionSvg(instructionModel, frame, options = {}) {
  const viewBox = instructionModel.view_box || { width: 520, height: 360 };
  const parts = instructionModel.parts || [];
  const visibleParts = new Set(frame.visible_parts || []);
  const ghostParts = new Set(frame.ghost_parts || []);
  const highlightParts = new Set(frame.highlight_parts || []);
  const partSvg = parts
    .filter((part) => visibleParts.has(part.id) || ghostParts.has(part.id))
    .map((part) => {
      const placement = { ...(part.geometry || {}), ...(frame.placements?.[part.id] || {}) };
      return drawInstructionPart(part, placement, {
        ghost: ghostParts.has(part.id),
        highlight: highlightParts.has(part.id),
        compact: options.compact,
        color: part.color
      });
    })
    .join("");

  return `
    <svg class="instruction-svg${options.compact ? " compact" : ""}" viewBox="0 0 ${safeNumber(viewBox.width, 520)} ${safeNumber(viewBox.height, 360)}" role="img" aria-label="${escapeHtml(frame.title)}">
      <defs>
        <marker id="arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="currentColor"></path>
        </marker>
      </defs>
      <rect class="manual-paper-bg" x="0" y="0" width="${safeNumber(viewBox.width, 520)}" height="${safeNumber(viewBox.height, 360)}" rx="16"></rect>
      <g class="manual-grid-lines">
        ${drawManualGrid(safeNumber(viewBox.width, 520), safeNumber(viewBox.height, 360))}
      </g>
      ${drawInstructionScene(frame, viewBox)}
      <g class="manual-parts">${partSvg}</g>
      ${drawInstructionArrows(frame.arrows || [])}
      ${options.compact ? "" : drawInstructionInsets(frame.insets || [])}
      ${options.compact ? "" : drawInstructionCallouts(frame.callouts || [])}
    </svg>
  `;
}

function shadeHex(hex, amount) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex || "");
  if (!match) return hex || "#b5703a";
  const value = parseInt(match[1], 16);
  let r = (value >> 16) & 255;
  let g = (value >> 8) & 255;
  let b = value & 255;
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  r = Math.round(r + (target - r) * t);
  g = Math.round(g + (target - g) * t);
  b = Math.round(b + (target - b) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function colorAttrsFor(part, state) {
  if (!part || !part.color) return "";
  const base = state && state.highlight ? shadeHex(part.color, 0.18) : part.color;
  const stroke = shadeHex(part.color, -0.42);
  return ` data-colored="1" style="--mp-fill:${base};--mp-stroke:${stroke}"`;
}

function drawInstructionPart(part, placement, state) {
  const classes = [
    "manual-part",
    `manual-part-${part.kind || "panel"}`,
    state.ghost ? "ghost" : "",
    state.highlight ? "highlight" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const colorAttrs = colorAttrsFor(part, state);

  if (part.image) {
    const x = safeNumber(placement.x);
    const y = safeNumber(placement.y);
    const width = safeNumber(placement.width, 120);
    const height = safeNumber(placement.height, 80);
    const outline = state.highlight
      ? `<rect class="manual-cutout-outline" x="${x - 2}" y="${y - 2}" width="${width + 4}" height="${height + 4}" rx="8"></rect>`
      : "";
    return `
      <g class="${classes} manual-part-cutout">
        <image href="${part.image}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"></image>
        ${outline}
      </g>
    `;
  }

  if (part.kind === "fastener_set") {
    return (placement.points || [])
      .map(([x, y]) => `<circle class="${classes}" cx="${safeNumber(x)}" cy="${safeNumber(y)}" r="${state.compact ? 5 : 7}"></circle>`)
      .join("");
  }

  if (part.kind === "adhesive_lines") {
    return (placement.lines || [])
      .map(([x1, y1, x2, y2]) => `<line class="${classes}" x1="${safeNumber(x1)}" y1="${safeNumber(y1)}" x2="${safeNumber(x2)}" y2="${safeNumber(y2)}"></line>`)
      .join("");
  }

  if (part.kind === "finish_overlay") {
    return `
      <rect class="${classes}" x="${safeNumber(placement.x)}" y="${safeNumber(placement.y)}" width="${safeNumber(placement.width, 120)}" height="${safeNumber(placement.height, 80)}" rx="18"></rect>
      <path class="manual-spark ${state.highlight ? "highlight" : ""}" d="M${safeNumber(placement.x) + 42} ${safeNumber(placement.y) + 28} l8 20 l20 8 l-20 8 l-8 20 l-8 -20 l-20 -8 l20 -8 z"></path>
    `;
  }

  if (part.kind?.startsWith("round_top_half") || part.kind?.startsWith("round_half")) {
    return drawRoundTopHalf(part, placement, classes, state);
  }

  if (part.kind === "metal_connector") {
    const x = safeNumber(placement.x);
    const y = safeNumber(placement.y);
    const width = safeNumber(placement.width, 64);
    const height = safeNumber(placement.height, 20);
    const holes = [
      [x + width * 0.24, y + height / 2],
      [x + width * 0.76, y + height / 2]
    ];
    return `
      <g class="${classes}"${colorAttrs}>
        <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6"></rect>
        ${holes.map(([hx, hy]) => `<circle class="manual-hole" cx="${hx}" cy="${hy}" r="4"></circle>`).join("")}
      </g>
    `;
  }

  if (part.kind === "leveler_set") {
    return (placement.points || [])
      .map(([x, y]) => `
        <g class="${classes}"${colorAttrs}>
          <line x1="${safeNumber(x)}" y1="${safeNumber(y) - 18}" x2="${safeNumber(x)}" y2="${safeNumber(y) + 2}"></line>
          <circle cx="${safeNumber(x)}" cy="${safeNumber(y) + 8}" r="${state.compact ? 5 : 8}"></circle>
        </g>
      `)
      .join("");
  }

  if (part.kind === "angled_leg") {
    const x = safeNumber(placement.x);
    const y = safeNumber(placement.y);
    const width = safeNumber(placement.width, 34);
    const height = safeNumber(placement.height, 140);
    const tilt = safeNumber(placement.tilt, 0);
    const points = [
      [x + Math.max(0, tilt), y],
      [x + width + Math.max(0, tilt), y],
      [x + width - Math.min(0, tilt), y + height],
      [x - Math.min(0, tilt), y + height]
    ]
      .map((point) => point.join(","))
      .join(" ");
    return `
      <g class="${classes}"${colorAttrs}>
        <polygon points="${points}"></polygon>
        <path class="manual-grain" d="M${x + width * 0.45} ${y + 16} C ${x + width * 0.2} ${y + 48}, ${x + width * 0.82} ${y + 80}, ${x + width * 0.45} ${y + height - 18}"></path>
      </g>
    `;
  }

  if (part.kind === "cross_beam") {
    const x = safeNumber(placement.x);
    const y = safeNumber(placement.y);
    const width = safeNumber(placement.width, 160);
    const height = safeNumber(placement.height, 16);
    const angle = safeNumber(placement.angle, 0);
    return `
      <g class="${classes}"${colorAttrs} transform="rotate(${angle} ${x + width / 2} ${y + height / 2})">
        <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6"></rect>
        <path class="manual-grain" d="M${x + 12} ${y + height * 0.5} C ${x + width * 0.32} ${y + 2}, ${x + width * 0.68} ${y + height - 2}, ${x + width - 12} ${y + height * 0.5}"></path>
      </g>
    `;
  }

  const x = safeNumber(placement.x);
  const y = safeNumber(placement.y);
  const width = safeNumber(placement.width, 120);
  const height = safeNumber(placement.height, 36);
  const label = width > 70 && height > 24 && !state.compact ? `<text class="manual-part-label" x="${x + width / 2}" y="${y + height / 2 + 4}">${escapeHtml(part.label)}</text>` : "";

  return `
    <g class="${classes}"${colorAttrs}>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="7"></rect>
      <path class="manual-grain" d="M${x + 12} ${y + height * 0.35} C ${x + width * 0.28} ${y + 4}, ${x + width * 0.62} ${y + height - 5}, ${x + width - 14} ${y + height * 0.34}"></path>
      <path class="manual-grain" d="M${x + 16} ${y + height * 0.72} C ${x + width * 0.34} ${y + height * 0.48}, ${x + width * 0.64} ${y + height + 2}, ${x + width - 18} ${y + height * 0.64}"></path>
      ${label}
    </g>
  `;
}

function drawRoundTopHalf(part, placement, classes, state) {
  const colorAttrs = colorAttrsFor(part, state);
  const x = safeNumber(placement.x);
  const y = safeNumber(placement.y);
  const width = safeNumber(placement.width, 150);
  const height = safeNumber(placement.height, 126);
  const depth = safeNumber(placement.depth, 12);
  const left = part.kind.endsWith("_left");
  const seamX = left ? x + width : x;
  const outerX = left ? x : x + width;
  const topD = left
    ? `M${seamX} ${y} L${seamX} ${y + height} C${x + width * 0.48} ${y + height}, ${outerX} ${y + height * 0.82}, ${outerX} ${y + height / 2} C${outerX} ${y + height * 0.18}, ${x + width * 0.48} ${y}, ${seamX} ${y} Z`
    : `M${seamX} ${y} L${seamX} ${y + height} C${x + width * 0.52} ${y + height}, ${outerX} ${y + height * 0.82}, ${outerX} ${y + height / 2} C${outerX} ${y + height * 0.18}, ${x + width * 0.52} ${y}, ${seamX} ${y} Z`;
  const rimD = left
    ? `M${seamX} ${y + height} L${seamX} ${y + height + depth} C${x + width * 0.48} ${y + height + depth}, ${outerX} ${y + height * 0.82 + depth}, ${outerX} ${y + height / 2 + depth} L${outerX} ${y + height / 2} C${outerX} ${y + height * 0.82}, ${x + width * 0.48} ${y + height}, ${seamX} ${y + height} Z`
    : `M${seamX} ${y + height} L${seamX} ${y + height + depth} C${x + width * 0.52} ${y + height + depth}, ${outerX} ${y + height * 0.82 + depth}, ${outerX} ${y + height / 2 + depth} L${outerX} ${y + height / 2} C${outerX} ${y + height * 0.82}, ${x + width * 0.52} ${y + height}, ${seamX} ${y + height} Z`;
  const seam = `<line class="manual-seam" x1="${seamX}" y1="${y + 5}" x2="${seamX}" y2="${y + height + depth - 4}"></line>`;
  const label = !state.compact ? `<text class="manual-part-label" x="${left ? x + width * 0.62 : x + width * 0.38}" y="${y + height / 2 + 5}">${escapeHtml(part.label)}</text>` : "";

  return `
    <g class="${classes}"${colorAttrs}>
      <path class="manual-tabletop-rim" d="${rimD}"></path>
      <path class="manual-tabletop-surface" d="${topD}"></path>
      ${seam}
      <path class="manual-grain" d="M${left ? x + width * 0.2 : x + width * 0.05} ${y + height * 0.38} C ${x + width * 0.36} ${y + 8}, ${x + width * 0.68} ${y + height - 8}, ${left ? x + width * 0.9 : x + width * 0.8} ${y + height * 0.34}"></path>
      <path class="manual-grain" d="M${left ? x + width * 0.18 : x + width * 0.08} ${y + height * 0.68} C ${x + width * 0.42} ${y + height * 0.5}, ${x + width * 0.66} ${y + height + 6}, ${left ? x + width * 0.92 : x + width * 0.82} ${y + height * 0.64}"></path>
      ${label}
    </g>
  `;
}

function drawInstructionScene(frame, viewBox) {
  const width = safeNumber(viewBox.width, 520);
  const height = safeNumber(viewBox.height, 360);
  const elements = [];

  if (frame.surface === "padded_floor") {
    elements.push(`
      <path class="manual-surface" d="M52 88 C150 60, 250 56, 340 72 C442 90, 506 142, 504 244 C410 304, 206 318, 70 268 C48 210, 36 148, 52 88 Z"></path>
      ${Array.from({ length: 18 }, (_, index) => {
        const x = 58 + index * 25;
        return `<path class="manual-surface-stitch" d="M${x} 76 c10 10 10 20 0 30"></path>`;
      }).join("")}
      ${Array.from({ length: 16 }, (_, index) => {
        const x = 80 + index * 25;
        return `<path class="manual-surface-stitch" d="M${x} 282 c10 10 10 20 0 30"></path>`;
      }).join("")}
    `);
  }

  if (frame.helper === "two_person_flip") {
    elements.push(`
      <g class="manual-helper-scene" transform="translate(${width - 178} ${height - 106})">
        <circle cx="32" cy="30" r="12"></circle>
        <path d="M32 44 L32 82 M12 58 L52 58 M20 102 L32 82 L44 102"></path>
        <circle cx="126" cy="30" r="12"></circle>
        <path d="M126 44 L126 82 M106 58 L146 58 M114 102 L126 82 L138 102"></path>
      </g>
    `);
  }

  if (!elements.length) return "";
  return `<g class="manual-scene">${elements.join("")}</g>`;
}

function drawInstructionInsets(insets) {
  if (!insets.length) return "";
  return `
    <g class="manual-insets">
      ${insets
        .map((inset) => {
          const x = safeNumber(inset.x, 420);
          const y = safeNumber(inset.y, 86);
          const r = safeNumber(inset.r, 42);
          const label = escapeHtml(inset.label || "");
          const type = inset.type || "screw";
          const detail =
            type === "connector"
              ? `<rect x="${x - 26}" y="${y - 8}" width="52" height="16" rx="5"></rect><circle cx="${x - 14}" cy="${y}" r="4"></circle><circle cx="${x + 14}" cy="${y}" r="4"></circle><path d="M${x - 40} ${y + 20} L${x - 12} ${y + 8} M${x + 40} ${y + 20} L${x + 12} ${y + 8}"></path>`
              : type === "leveler"
                ? `<line x1="${x}" y1="${y - 26}" x2="${x}" y2="${y + 8}"></line><circle cx="${x}" cy="${y + 18}" r="11"></circle><path d="M${x - 22} ${y - 4} q22 -18 44 0"></path>`
                : `<path class="manual-thread" d="M${x} ${y - 30} L${x} ${y + 26}"></path><circle cx="${x}" cy="${y - 34}" r="11"></circle><path d="M${x - 22} ${y - 14} L${x + 22} ${y - 14} M${x - 22} ${y + 8} L${x + 22} ${y + 8}"></path>`;
          const leader = inset.to
            ? `<path class="manual-inset-leader" d="M${x - r * 0.65} ${y + r * 0.65} C${x - r * 1.5} ${y + r * 1.2}, ${safeNumber(inset.to[0]) + 30} ${safeNumber(inset.to[1]) - 20}, ${safeNumber(inset.to[0])} ${safeNumber(inset.to[1])}"></path>`
            : "";
          return `
            <g class="manual-inset">
              ${leader}
              <circle cx="${x}" cy="${y}" r="${r}"></circle>
              ${label ? `<text class="manual-inset-label" x="${x - r - 12}" y="${y - r + 12}">${label}</text>` : ""}
              <g class="manual-inset-detail">${detail}</g>
            </g>
          `;
        })
        .join("")}
    </g>
  `;
}

function drawInstructionArrows(arrows) {
  if (!arrows.length) return "";
  return `
    <g class="manual-arrows">
      ${arrows
        .map(
          (arrow) =>
            `<line x1="${safeNumber(arrow.from?.[0])}" y1="${safeNumber(arrow.from?.[1])}" x2="${safeNumber(arrow.to?.[0])}" y2="${safeNumber(arrow.to?.[1])}" marker-end="url(#arrow-head)"></line>`
        )
        .join("")}
    </g>
  `;
}

function drawInstructionCallouts(callouts) {
  if (!callouts.length) return "";
  return `
    <g class="manual-callouts">
      ${callouts
        .map((callout) => {
          const x = safeNumber(callout.x, 20);
          const y = safeNumber(callout.y, 20);
          const text = escapeHtml(callout.text || "");
          const width = Math.max(96, text.length * 8.4);
          return `
            <g>
              <rect x="${x - width / 2}" y="${y - 18}" width="${width}" height="26" rx="13"></rect>
              <text x="${x}" y="${y}">${text}</text>
            </g>
          `;
        })
        .join("")}
    </g>
  `;
}

function drawManualGrid(width, height) {
  const lines = [];
  for (let x = 40; x < width; x += 40) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}"></line>`);
  }
  for (let y = 40; y < height; y += 40) {
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}"></line>`);
  }
  return lines.join("");
}

function groupPartsByMaterial(parts) {
  const map = new Map();
  for (const part of parts) {
    const key = normalizeKey(part.material_name);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(part);
  }
  return map;
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function humanizeRenderer(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : fallback;
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

function enhanceSelects() {
  document.querySelectorAll("select").forEach((select) => enhanceSelect(select));
  document.addEventListener("click", (event) => {
    for (const { root, close } of enhancedSelects.values()) {
      if (!root.contains(event.target)) close();
    }
  });
}

function enhanceSelect(select) {
  if (!select) return;

  const existing = enhancedSelects.get(select);
  if (existing) {
    existing.render();
    return;
  }

  select.classList.add("native-select");
  const root = document.createElement("div");
  root.className = "liquid-select";
  root.dataset.selectFor = select.id;
  root.innerHTML = `
    <button class="liquid-select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span></span>
      <i></i>
    </button>
    <div class="liquid-select-menu" role="listbox"></div>
  `;
  select.insertAdjacentElement("afterend", root);

  const button = root.querySelector(".liquid-select-button");
  const label = button.querySelector("span");
  const menu = root.querySelector(".liquid-select-menu");

  const close = () => {
    root.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
    if (motion) {
      motion.to(menu, {
        autoAlpha: 0,
        y: -8,
        scale: 0.98,
        duration: 0.18,
        ease: "power2.out",
        pointerEvents: "none"
      });
    }
  };

  const open = () => {
    for (const entry of enhancedSelects.values()) {
      if (entry.root !== root) entry.close();
    }
    root.classList.add("open");
    button.setAttribute("aria-expanded", "true");
    if (motion) {
      motion.fromTo(
        menu,
        { autoAlpha: 0, y: -8, scale: 0.98 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.22, ease: "power3.out", pointerEvents: "auto" }
      );
      motion.fromTo(
        menu.querySelectorAll(".liquid-select-option"),
        { x: -8, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.18, stagger: 0.025, ease: "power2.out" }
      );
    }
  };

  const render = () => {
    const selected = select.options[select.selectedIndex] || select.options[0];
    label.textContent = selected?.textContent || "";
    menu.innerHTML = Array.from(select.options)
      .map(
        (option) => `
          <button class="liquid-select-option${option.value === select.value ? " selected" : ""}" type="button" role="option" aria-selected="${option.value === select.value}" data-value="${escapeHtml(option.value)}">
            <span>${escapeHtml(option.textContent)}</span>
          </button>
        `
      )
      .join("");
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    root.classList.contains("open") ? close() : open();
  });

  menu.addEventListener("click", (event) => {
    const option = event.target.closest(".liquid-select-option");
    if (!option) return;
    select.value = option.dataset.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    render();
    close();
  });

  select.addEventListener("change", render);
  enhancedSelects.set(select, { root, render, close });
  render();
  close();
}

function animateInitialView() {
  if (!motion) return;
  motion.from(".topbar", { y: -18, opacity: 0, duration: 0.55, ease: "power3.out" });
  motion.from(".input-panel", { x: -24, opacity: 0, duration: 0.72, delay: 0.08, ease: "power3.out" });
  motion.from(".results-panel", { x: 24, opacity: 0, duration: 0.72, delay: 0.12, ease: "power3.out" });
  motion.from(".empty-grid span", {
    y: 22,
    opacity: 0,
    duration: 0.48,
    delay: 0.32,
    stagger: 0.05,
    ease: "power3.out"
  });
}

function animateResultView() {
  if (!motion) return;
  const targets = [
    ".plan-header",
    ".metric",
    ".mini-score",
    ".part-inventory-card",
    ".manual-page",
    ".material-card",
    ".manual-step-card",
    ".trace-item"
  ];
  motion.fromTo(
    targets.join(","),
    { y: 24, opacity: 0, filter: "blur(8px)" },
    {
      y: 0,
      opacity: 1,
      filter: "blur(0px)",
      duration: 0.55,
      stagger: 0.025,
      ease: "power3.out"
    }
  );
  bindMagneticCards();
}

function bindMagneticCards() {
  document.querySelectorAll(".magnetic, .metric, .mini-score").forEach((card) => {
    if (card.dataset.magneticBound) return;
    card.dataset.magneticBound = "true";
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      card.style.setProperty("--mx", `${(event.clientX - rect.left).toFixed(1)}px`);
      card.style.setProperty("--my", `${(event.clientY - rect.top).toFixed(1)}px`);
      if (motion) {
        motion.to(card, {
          rotateX: -y * 4,
          rotateY: x * 5,
          y: -2,
          duration: 0.28,
          ease: "power2.out"
        });
      }
    });
    card.addEventListener("pointerleave", () => {
      if (motion) {
        motion.to(card, { rotateX: 0, rotateY: 0, y: 0, duration: 0.35, ease: "power2.out" });
      }
    });
  });
}

function startCursorGlow() {
  if (!cursorGlow || window.matchMedia("(pointer: coarse)").matches) return;
  window.addEventListener("pointermove", (event) => {
    if (motion) {
      motion.to(cursorGlow, {
        x: event.clientX,
        y: event.clientY,
        duration: 0.35,
        ease: "power3.out"
      });
    } else {
      cursorGlow.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    }
  });
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
