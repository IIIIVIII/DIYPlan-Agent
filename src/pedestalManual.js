// Parametric IKEA-style instruction manual for a round pedestal table.
//
// Instead of pasting photo cut-outs, this draws clean isometric line art
// (white pages, black outlines, exploded steps, a parts/hardware page and a
// finished view) procedurally from a small structured spec. The real object
// colour from the photo is used to tint the faces, so the booklet looks like
// the real table while staying a readable, IKEA-like manual.

const ISO_K = Math.cos(Math.PI / 6); // 0.8660 — horizontal iso factor

// ---------------------------------------------------------------------------
// colour helpers
// ---------------------------------------------------------------------------
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function parseHex(hex) {
  const clean = String(hex || "").trim().replace(/^#/, "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

// amt in [-1, 1]: negative darkens, positive lightens.
function shade(hex, amt) {
  const rgb = parseHex(hex) || [180, 180, 180];
  const mix = amt >= 0 ? 255 : 0;
  const t = Math.abs(amt);
  const out = rgb.map((c) => Math.round(c + (mix - c) * t));
  return `#${out.map((c) => clamp(c, 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

// A soft tint for top faces so colour reads but lines stay crisp.
function faces(hex) {
  return {
    top: shade(hex, 0.18),
    right: shade(hex, -0.04),
    left: shade(hex, -0.2),
    line: "#1c1c1c"
  };
}

// ---------------------------------------------------------------------------
// isometric projection
// ---------------------------------------------------------------------------
// Model space: x = right, y = depth (into screen / back), z = up. Units: inches.
function projector(ox, oy, scale) {
  return (x, y, z) => [
    round2(ox + (x - y) * ISO_K * scale),
    round2(oy + ((x + y) * 0.5 - z) * scale)
  ];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function ptStr([x, y]) {
  return `${x},${y}`;
}

// ---------------------------------------------------------------------------
// primitives — every primitive returns an SVG string
// ---------------------------------------------------------------------------
const STROKE = 2.1;
const STROKE_THIN = 1.3;

// Axis-aligned 3D box. (x0,y0,z0) is the min corner; xs/ys/zs are sizes.
function isoBox(P, x0, y0, z0, xs, ys, zs, fill) {
  const x1 = x0 + xs;
  const y1 = y0 + ys;
  const z1 = z0 + zs;
  const c = {
    // top corners (z1)
    tA: P(x0, y0, z1),
    tB: P(x1, y0, z1),
    tC: P(x1, y1, z1),
    tD: P(x0, y1, z1),
    // bottom corners (z0)
    bB: P(x1, y0, z0),
    bC: P(x1, y1, z0),
    bD: P(x0, y1, z0)
  };
  const f = faces(fill);
  const top = `<polygon points="${[c.tA, c.tB, c.tC, c.tD].map(ptStr).join(" ")}" fill="${f.top}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  // right face (x = x1): tB,tC,bC,bB
  const right = `<polygon points="${[c.tB, c.tC, c.bC, c.bB].map(ptStr).join(" ")}" fill="${f.right}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  // left face (y = y1): tD,tC,bC,bD
  const left = `<polygon points="${[c.tD, c.tC, c.bC, c.bD].map(ptStr).join(" ")}" fill="${f.left}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  return left + right + top;
}

// Sample a horizontal circle (radius r, centre cx,cy in model plane) at height z.
function ringPoints(P, cx, cy, r, z, fromDeg, toDeg, steps) {
  const pts = [];
  const n = steps || 40;
  for (let i = 0; i <= n; i += 1) {
    const a = ((fromDeg + (toDeg - fromDeg) * (i / n)) * Math.PI) / 180;
    pts.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a), z));
  }
  return pts;
}

// The front (viewer-facing) silhouette arc of a horizontal circle runs
// theta in [-45, 135] for this projection.
function discSolid(P, cx, cy, r, zBottom, thickness, fill, opts = {}) {
  const f = faces(fill);
  const zTop = zBottom + thickness;
  const topRing = ringPoints(P, cx, cy, r, zTop, 0, 360, 64);
  const topPath = `<polygon points="${topRing.map(ptStr).join(" ")}" fill="${f.top}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  // side band along the front arc
  const frontBottom = ringPoints(P, cx, cy, r, zBottom, -45, 135, 40);
  const frontTop = ringPoints(P, cx, cy, r, zTop, -45, 135, 40).reverse();
  const band = `<polygon points="${[...frontBottom, ...frontTop].map(ptStr).join(" ")}" fill="${f.right}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  let hole = "";
  if (opts.holeR) {
    const h = ringPoints(P, cx, cy, opts.holeR, zTop, 0, 360, 28);
    hole = `<polygon points="${h.map(ptStr).join(" ")}" fill="${shade(fill, -0.05)}" stroke="${f.line}" stroke-width="${STROKE_THIN}"/>`;
  }
  return band + topPath + hole;
}

// Vertical cylinder (column). Drawn as top ellipse + front side band.
function cylinder(P, cx, cy, r, z0, z1, fill) {
  const f = faces(fill);
  const frontBottom = ringPoints(P, cx, cy, r, z0, -45, 135, 36);
  const frontTop = ringPoints(P, cx, cy, r, z1, -45, 135, 36).reverse();
  const band = `<polygon points="${[...frontBottom, ...frontTop].map(ptStr).join(" ")}" fill="${f.right}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  const topRing = ringPoints(P, cx, cy, r, z1, 0, 360, 48);
  const topCap = `<polygon points="${topRing.map(ptStr).join(" ")}" fill="${f.top}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  return band + topCap;
}

// Tapered cone-ish pedestal (wide top plate to narrow stem) — two stacked discs.
function pedestalColumn(P, cx, cy, opts, fill) {
  const { stemR, stemTopZ, baseZ, coneTopR, coneTopZ } = opts;
  const f = faces(fill);
  // cone: from wide ring at coneTopZ down to stem radius at stemTopZ
  const coneFrontTop = ringPoints(P, cx, cy, coneTopR, coneTopZ, -45, 135, 36);
  const coneFrontBot = ringPoints(P, cx, cy, stemR, stemTopZ, -45, 135, 36).reverse();
  const cone = `<polygon points="${[...coneFrontTop, ...coneFrontBot].map(ptStr).join(" ")}" fill="${f.right}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  const coneTopRing = ringPoints(P, cx, cy, coneTopR, coneTopZ, 0, 360, 48);
  const coneCap = `<polygon points="${coneTopRing.map(ptStr).join(" ")}" fill="${f.top}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  const stem = cylinder(P, cx, cy, stemR, baseZ, stemTopZ, fill);
  return stem + cone + coneCap;
}

// Four-arm cross base centred at model origin, arms along ±x and ±y.
function crossBase(P, opts, fill, hideArm = -1) {
  const { armLen, armW, armH, hubR } = opts;
  const half = armW / 2;
  const arms = [
    // [x0,y0,xs,ys] for each arm extending from the hub outward
    () => isoBox(P, hubR, -half, 0, armLen, armW, armH, fill), // +x (front-right)
    () => isoBox(P, -half, hubR, 0, armW, armLen, armH, fill), // +y (front-left / back)
    () => isoBox(P, -armLen - hubR, -half, 0, armLen, armW, armH, fill), // -x
    () => isoBox(P, -half, -armLen - hubR, 0, armW, armLen, armH, fill) // -y
  ];
  // Draw far arms first (-x, -y), then near arms (+x, +y) so overlaps read right.
  const order = [2, 3, 1, 0];
  let out = "";
  for (const idx of order) {
    if (idx === hideArm) continue;
    out += arms[idx]();
  }
  return out;
}

// small foot glide
function footGlide(P, x, y, fill) {
  const p = P(x, y, 0);
  return `<ellipse cx="${p[0]}" cy="${p[1] + 2}" rx="6" ry="3" fill="${shade(fill, -0.45)}" stroke="#1c1c1c" stroke-width="${STROKE_THIN}"/>`;
}

// ---------------------------------------------------------------------------
// annotation primitives (2D screen space)
// ---------------------------------------------------------------------------
function stepNumber(n, x = 46, y = 78) {
  return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="700" fill="#111">${n}</text>`;
}

function countLabel(text, x, y, size = 30) {
  return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="700" fill="#111" text-anchor="middle">${text}</text>`;
}

function smallCode(text, x, y) {
  return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#555" transform="rotate(90 ${x} ${y})">${text}</text>`;
}

function straightArrow(x1, y1, x2, y2, width = 16) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const headL = Math.min(26, len * 0.4);
  const baseX = x2 - Math.cos(ang) * headL;
  const baseY = y2 - Math.sin(ang) * headL;
  const nx = Math.cos(ang + Math.PI / 2);
  const ny = Math.sin(ang + Math.PI / 2);
  const shaftW = width * 0.32;
  const headW = width * 0.9;
  const p = (px, py) => `${round2(px)},${round2(py)}`;
  const pts = [
    p(x1 + nx * shaftW, y1 + ny * shaftW),
    p(baseX + nx * shaftW, baseY + ny * shaftW),
    p(baseX + nx * headW, baseY + ny * headW),
    p(x2, y2),
    p(baseX - nx * headW, baseY - ny * headW),
    p(baseX - nx * shaftW, baseY - ny * shaftW),
    p(x1 - nx * shaftW, y1 - ny * shaftW)
  ];
  return `<polygon points="${pts.join(" ")}" fill="#111"/>`;
}

// curved insertion arrow (quadratic) with a solid head
function curvedArrow(x1, y1, x2, y2, bow = 60) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const cx = mx + Math.cos(ang + Math.PI / 2) * bow;
  const cy = my + Math.sin(ang + Math.PI / 2) * bow;
  const endAng = Math.atan2(y2 - cy, x2 - cx);
  const h = 16;
  const hx = x2 - Math.cos(endAng) * h;
  const hy = y2 - Math.sin(endAng) * h;
  const nx = Math.cos(endAng + Math.PI / 2);
  const ny = Math.sin(endAng + Math.PI / 2);
  return (
    `<path d="M${round2(x1)} ${round2(y1)} Q${round2(cx)} ${round2(cy)} ${round2(hx)} ${round2(hy)}" fill="none" stroke="#111" stroke-width="5" stroke-linecap="round"/>` +
    `<polygon points="${round2(x2)},${round2(y2)} ${round2(hx + nx * 9)},${round2(hy + ny * 9)} ${round2(hx - nx * 9)},${round2(hy - ny * 9)}" fill="#111"/>`
  );
}

// zoom / detail circle with leader line to a focus point
function zoomCircle(cx, cy, r, focusX, focusY, inner) {
  return (
    `<line x1="${focusX}" y1="${focusY}" x2="${cx}" y2="${cy}" stroke="#111" stroke-width="1.4" stroke-dasharray="4 4"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="#111" stroke-width="2.4"/>` +
    `<clipPath id="zoom-${Math.round(cx)}-${Math.round(cy)}"><circle cx="${cx}" cy="${cy}" r="${r - 2}"/></clipPath>` +
    `<g clip-path="url(#zoom-${Math.round(cx)}-${Math.round(cy)})">${inner}</g>`
  );
}

// ---------------------------------------------------------------------------
// hardware icons (2D, IKEA bag style) — drawn around an anchor point
// ---------------------------------------------------------------------------
function buttonScrew(x, y, s = 1) {
  const w = 16 * s;
  const headH = 10 * s;
  const shaftW = 9 * s;
  const shaftH = 30 * s;
  let g = `<g stroke="#1c1c1c" stroke-width="2" fill="#fff">`;
  g += `<path d="M${x - w} ${y} q0 ${-headH} ${w} ${-headH} q${w} 0 ${w} ${headH} z" fill="#fff"/>`;
  g += `<circle cx="${x}" cy="${y - headH * 0.45}" r="${3 * s}" fill="#1c1c1c" stroke="none"/>`;
  g += `<rect x="${x - shaftW / 2}" y="${y}" width="${shaftW}" height="${shaftH}" fill="#fff"/>`;
  // threads
  for (let i = 1; i <= 5; i += 1) {
    const ty = y + (shaftH * i) / 6;
    g += `<line x1="${x - shaftW / 2}" y1="${ty}" x2="${x + shaftW / 2}" y2="${ty - 3}" stroke-width="1.4"/>`;
  }
  g += `</g>`;
  return g;
}

function thumbScrew(x, y, s = 1) {
  const w = 17 * s;
  const headH = 16 * s;
  const shaftW = 8 * s;
  const shaftH = 22 * s;
  let g = `<g stroke="#1c1c1c" stroke-width="2" fill="#fff">`;
  g += `<rect x="${x - w}" y="${y - headH}" width="${w * 2}" height="${headH}" rx="3" fill="#fff"/>`;
  for (let i = -3; i <= 3; i += 1) {
    g += `<line x1="${x + i * (w / 3.5)}" y1="${y - headH + 2}" x2="${x + i * (w / 3.5)}" y2="${y - 2}" stroke-width="1.3"/>`;
  }
  g += `<rect x="${x - shaftW / 2}" y="${y}" width="${shaftW}" height="${shaftH}" fill="#fff"/>`;
  for (let i = 1; i <= 4; i += 1) {
    const ty = y + (shaftH * i) / 5;
    g += `<line x1="${x - shaftW / 2}" y1="${ty}" x2="${x + shaftW / 2}" y2="${ty - 2.5}" stroke-width="1.3"/>`;
  }
  g += `</g>`;
  return g;
}

function allenKey(x, y, s = 1) {
  const longArm = 70 * s;
  const shortArm = 26 * s;
  const t = 7 * s;
  return (
    `<g stroke="#1c1c1c" stroke-width="2" fill="#fff" stroke-linejoin="round">` +
    `<path d="M${x} ${y} h${t} v${longArm} h${shortArm} v${-t} h${-shortArm + t} v${-longArm} z" fill="#fff"/>` +
    `</g>`
  );
}

function camPlate(x, y, s = 1) {
  const r = 26 * s;
  let g = `<g stroke="#1c1c1c" stroke-width="2" fill="#fff">`;
  g += `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.42}" fill="#fff"/>`;
  for (const dx of [-0.45, 0.1, 0.55]) {
    g += `<ellipse cx="${x + dx * r}" cy="${y - 2}" rx="${5 * s}" ry="${5 * s * 0.5}" fill="#fff" stroke-width="1.6"/>`;
  }
  g += `</g>`;
  return g;
}

// ---------------------------------------------------------------------------
// page assembly
// ---------------------------------------------------------------------------
const PAGE_W = 680;
const PAGE_H = 860;

function pageFrame(inner, opts = {}) {
  const number = opts.number != null ? stepNumber(opts.number) : "";
  return (
    `<rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff"/>` +
    `<rect x="10" y="10" width="${PAGE_W - 20}" height="${PAGE_H - 20}" fill="none" stroke="#111" stroke-width="2.5" rx="6"/>` +
    number +
    inner +
    `<text x="${PAGE_W - 30}" y="${PAGE_H - 26}" font-family="Arial, sans-serif" font-size="13" fill="#777" text-anchor="end">${opts.code || ""}</text>`
  );
}

// ---------------------------------------------------------------------------
// the manual
// ---------------------------------------------------------------------------
function defaultDims(plan, preferences) {
  const dimText = String(
    preferences.targetSize || plan?.recommended_design?.dimensions || plan?.dimensions || ""
  ).toLowerCase();
  const nums = (dimText.match(/\d+(\.\d+)?/g) || []).map(Number);
  let diameter = nums.find((n) => n >= 12 && n <= 60) || 18;
  let height = nums.find((n) => n >= 14 && n <= 45) || 22;
  if (dimText.includes("cm")) {
    diameter = round2(diameter / 2.54);
    height = round2(height / 2.54);
  }
  return {
    topR: round2(clamp(diameter, 12, 48) / 2),
    topTh: 1.1,
    height: clamp(height, 14, 42),
    stemR: 1.4,
    coneTopR: 3.2,
    armLen: round2(clamp(diameter, 12, 48) / 2.4),
    armW: 1.7,
    armH: 1.7,
    hubR: 1.6
  };
}

function generatePedestalManual(plan, preferences = {}, options = {}) {
  const D = defaultDims(plan, preferences);
  const baseColor = options.baseColor || "#b23b34"; // painted base/column
  const topColor = options.topColor || "#d8b486"; // plywood top
  const cx = 0;
  const cy = 0;

  // shared geometry helpers given a projector
  const drawTop = (P, zLift = 0, withHole = true) =>
    discSolid(P, cx, cy, D.topR, D.height + zLift, D.topTh, topColor, { holeR: withHole ? 0.9 : 0 });
  const drawColumn = (P, baseZ = 0) =>
    pedestalColumn(
      P,
      cx,
      cy,
      {
        stemR: D.stemR,
        baseZ,
        stemTopZ: baseZ + D.height - 4,
        coneTopR: D.coneTopR,
        coneTopZ: baseZ + D.height - 0.8
      },
      baseColor
    );
  const drawBase = (P, hideArm = -1) => crossBase(P, D, baseColor, hideArm);
  const drawFeet = (P) =>
    footGlide(P, D.armLen + D.hubR, 0, baseColor) +
    footGlide(P, -D.armLen - D.hubR, 0, baseColor) +
    footGlide(P, 0, D.armLen + D.hubR, baseColor) +
    footGlide(P, 0, -D.armLen - D.hubR, baseColor);

  const pages = [];

  // ---- Page 1: parts & hardware inventory ----------------------------------
  {
    let g = "";
    const P = projector(190, 360, 13);
    g += `<text x="${PAGE_W / 2}" y="64" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#111" text-anchor="middle">PARTS</text>`;
    // top
    g += drawTop(projector(180, 150, 9), -D.height, true);
    g += countLabel("1x", 180, 235, 26);
    // column + base preview
    g += drawColumn(projector(470, 250, 8));
    g += drawBase(projector(470, 300, 8));
    g += countLabel("1x", 470, 360, 26);
    g += countLabel("4x", 470, 392, 22);
    // hardware row
    const hy = 560;
    g += `<line x1="60" y1="${hy - 70}" x2="${PAGE_W - 60}" y2="${hy - 70}" stroke="#ccc" stroke-width="1.5"/>`;
    g += `<text x="${PAGE_W / 2}" y="${hy - 84}" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#111" text-anchor="middle">HARDWARE</text>`;
    g += buttonScrew(140, hy, 1.1) + countLabel("3x", 140, hy + 70) + smallCode("1154 61", 168, hy + 6);
    g += buttonScrew(270, hy, 0.9) + countLabel("8x", 270, hy + 70) + smallCode("100 74126", 296, hy + 6);
    g += thumbScrew(400, hy, 1.05) + countLabel("4x", 400, hy + 70) + smallCode("195 312", 426, hy + 6);
    g += allenKey(520, hy - 60, 1) + countLabel("1x", 540, hy + 70) + smallCode("100 092", 590, hy - 4);
    pages.push({
      id: "parts",
      number: null,
      title: "Parts & hardware",
      caption: "Lay out every part and count the hardware before you start.",
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { code: "AA-PEDESTAL-1" })
    });
  }

  // ---- Page 2: build the cross base ---------------------------------------
  {
    let g = "";
    const P = projector(330, 540, 18);
    // column standing, one arm exploded out before insertion
    g += drawColumn(P);
    g += drawBase(P, 0); // hide +x arm
    // exploded +x arm floating to the right
    const Pexp = projector(330 + 150, 540 - 50, 18);
    g += isoBox(Pexp, D.hubR, -D.armW / 2, 0, D.armLen, D.armW, D.armH, baseColor);
    // motion arrow pushing arm into hub
    g += curvedArrow(560, 470, 470, 520, 40);
    g += countLabel("4x", 560, 440, 26);
    pages.push({
      id: "base",
      number: 1,
      title: "Build the cross base",
      caption: "Slide all four arms into the central column hub.",
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { number: 1, code: "AA-PEDESTAL-2" })
    });
  }

  // ---- Page 3: lock the base with screws ----------------------------------
  {
    let g = "";
    const P = projector(300, 560, 17);
    g += drawColumn(P);
    g += drawBase(P);
    // zoom into a hub screw with allen key
    const focus = P(D.hubR + 0.5, 0, D.armH);
    let inner = "";
    inner += buttonScrew(470, 250, 1.4);
    inner += allenKey(520, 215, 1.1);
    inner += straightArrow(470, 200, 470, 235, 14);
    g += zoomCircle(490, 255, 78, focus[0], focus[1], inner);
    g += countLabel("4x", 490, 360, 24);
    pages.push({
      id: "base-lock",
      number: 2,
      title: "Tighten the base",
      caption: "Drive a screw into each arm and tighten with the hex key.",
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { number: 2, code: "AA-PEDESTAL-3" })
    });
  }

  // ---- Page 4: mounting plate under the top -------------------------------
  {
    let g = "";
    // top shown upside down (flat), plate + 3 screws coming in
    const P = projector(330, 430, 12);
    g += discSolid(P, cx, cy, D.topR, 0, D.topTh, topColor, { holeR: 0.9 });
    // mounting plate above (a small disc) descending
    const Pp = projector(330, 250, 12);
    g += discSolid(Pp, cx, cy, D.coneTopR + 0.6, 0, 0.4, shade(baseColor, -0.1));
    g += curvedArrow(330, 300, 330, 380, 0);
    // screws callout
    g += buttonScrew(520, 250, 1.1) + countLabel("3x", 520, 320);
    g += allenKey(580, 200, 0.9);
    pages.push({
      id: "plate",
      number: 3,
      title: "Fix the mounting plate",
      caption: "Turn the top upside down and screw the plate onto its centre.",
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { number: 3, code: "AA-PEDESTAL-4" })
    });
  }

  // ---- Page 5: join top to base -------------------------------------------
  {
    let g = "";
    const P = projector(330, 660, 13);
    g += drawColumn(P);
    g += drawBase(P);
    g += drawFeet(P);
    // top floating above, descending (drawn at z=0 via the -height offset)
    g += drawTop(projector(330, 200, 13), -D.height, true);
    g += straightArrow(330, 300, 330, 360, 22);
    g += countLabel("1x", 430, 250, 26);
    pages.push({
      id: "join",
      number: 4,
      title: "Set the top on the base",
      caption: "Lower the top onto the column and press until it seats.",
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { number: 4, code: "AA-PEDESTAL-5" })
    });
  }

  // ---- Page 6: finished ----------------------------------------------------
  {
    let g = "";
    const P = projector(330, 540, 15);
    g += drawColumn(P);
    g += drawBase(P);
    g += drawFeet(P);
    g += drawTop(P, 0, true);
    g += `<text x="${PAGE_W / 2}" y="760" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#111" text-anchor="middle">DONE</text>`;
    pages.push({
      id: "done",
      number: null,
      title: "Finished",
      caption: "Your round pedestal table is ready.",
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { code: "AA-PEDESTAL-6" })
    });
  }

  // structured parts list (for the materials cross-reference / inventory tray)
  const parts = [
    { id: "top", label: "Round table top", kind: "round_top", material_name: "plywood round top", cut_size: `${round2(D.topR * 2)} in dia`, quantity: 1 },
    { id: "column", label: "Central column", kind: "column", material_name: "turned/painted post", cut_size: `${D.height} in`, quantity: 1 },
    { id: "arm", label: "Cross-base arm", kind: "arm", material_name: "hardwood arm", cut_size: `${D.armLen} in`, quantity: 4 },
    { id: "plate", label: "Mounting plate", kind: "plate", material_name: "steel plate", cut_size: "center", quantity: 1 },
    { id: "screw_button", label: "Button screws", kind: "fastener_set", material_name: "button head screws", cut_size: "with hex key", quantity: 11 },
    { id: "thumb_screw", label: "Leveling thumb screws", kind: "fastener_set", material_name: "thumb screws", cut_size: "adjust feet", quantity: 4 }
  ];

  const frames = pages.map((p, i) => ({
    title: p.title,
    caption: p.caption,
    page_index: i,
    visible_parts: [],
    highlight_parts: []
  }));

  return {
    version: "1.0",
    renderer: "ikea_line_art_v1",
    archetype: "pedestal_round_table",
    source: "parametric_vector",
    source_note:
      "Clean isometric line-art manual generated parametrically from the detected pedestal-table structure, tinted with the real object colour.",
    colors: { base: baseColor, top: topColor },
    dims: D,
    view_box: { width: PAGE_W, height: PAGE_H },
    pages,
    parts,
    frames
  };
}

export { generatePedestalManual, shade };
