// Parametric IKEA-style instruction manual for a round pedestal table.

import { getPedestalJoinerySpec } from "./pedestalJoinery.js";

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
    () => isoBox(P, hubR, -half, 0, armLen, armW, armH, fill),
    () => isoBox(P, -half, hubR, 0, armW, armLen, armH, fill),
    () => isoBox(P, -armLen - hubR, -half, 0, armLen, armW, armH, fill),
    () => isoBox(P, -half, -armLen - hubR, 0, armW, armLen, armH, fill)
  ];
  const order = [2, 3, 1, 0];
  let out = "";
  for (const idx of order) {
    if (idx === hideArm) continue;
    out += arms[idx]();
  }
  return out;
}

// Triangular wedge tab on the hub — the arm block slides onto this horizontally.
function wedgeTab(P, cx, cy, z0, angleDeg, opts, fill) {
  const { hubR, wedgeLen, wedgeSpread, height } = opts;
  const f = faces(fill);
  const a = (angleDeg * Math.PI) / 180;
  const spread = ((wedgeSpread || 22) * Math.PI) / 180;
  const inner = [cx + hubR * Math.cos(a), cy + hubR * Math.sin(a)];
  const tip = [cx + (hubR + wedgeLen) * Math.cos(a), cy + (hubR + wedgeLen) * Math.sin(a)];
  const left = [
    cx + (hubR + wedgeLen * 0.92) * Math.cos(a - spread),
    cy + (hubR + wedgeLen * 0.92) * Math.sin(a - spread)
  ];
  const right = [
    cx + (hubR + wedgeLen * 0.92) * Math.cos(a + spread),
    cy + (hubR + wedgeLen * 0.92) * Math.sin(a + spread)
  ];
  const z1 = z0 + height;
  const bot = [inner, left, right].map(([x, y]) => P(x, y, z0));
  const top = [inner, left, right].map(([x, y]) => P(x, y, z1));
  const sideA = `<polygon points="${[bot[0], bot[1], top[1], top[0]].map(ptStr).join(" ")}" fill="${f.left}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  const sideB = `<polygon points="${[bot[0], bot[2], top[2], top[0]].map(ptStr).join(" ")}" fill="${f.right}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  const topFace = `<polygon points="${top.map(ptStr).join(" ")}" fill="${f.top}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  return sideA + sideB + topFace;
}

// Hub flange (short disc) with four wedge tabs at 0/90/180/270°.
function hubWithWedges(P, cx, cy, z0, opts, fill, hideWedge = -1) {
  const { hubR, hubH, wedgeLen, wedgeSpread, armH } = opts;
  let out = discSolid(P, cx, cy, hubR + 0.15, z0, hubH, fill);
  const angles = [0, 90, 180, 270];
  for (let i = 0; i < angles.length; i += 1) {
    if (i === hideWedge) continue;
    out += wedgeTab(P, cx, cy, z0 + hubH, angles[i], { hubR, wedgeLen, wedgeSpread, height: armH * 0.85 }, fill);
  }
  return out;
}

// Foot arm block; innerR/outerR measured from centre along angleDeg.
function armBlock(P, cx, cy, angleDeg, innerR, outerR, z0, armW, armH, fill, showNotch = false) {
  const a = (angleDeg * Math.PI) / 180;
  const px = -Math.sin(a);
  const py = Math.cos(a);
  const hw = armW / 2;
  const iC = [cx + innerR * Math.cos(a), cy + innerR * Math.sin(a)];
  const oC = [cx + outerR * Math.cos(a), cy + outerR * Math.sin(a)];
  const corners = [
    [iC[0] + px * hw, iC[1] + py * hw],
    [oC[0] + px * hw, oC[1] + py * hw],
    [oC[0] - px * hw, oC[1] - py * hw],
    [iC[0] - px * hw, iC[1] - py * hw]
  ];
  const z1 = z0 + armH;
  const bot = corners.map(([x, y]) => P(x, y, z0));
  const top = corners.map(([x, y]) => P(x, y, z1));
  const f = faces(fill);
  let out = `<polygon points="${[...bot, ...top.slice().reverse()].map(ptStr).join(" ")}" fill="${f.right}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  out += `<polygon points="${top.map(ptStr).join(" ")}" fill="${f.top}" stroke="${f.line}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  if (showNotch) {
    const nMid = P(iC[0], iC[1], z0 + armH * 0.55);
    out += `<line x1="${nMid[0] - 8}" y1="${nMid[1]}" x2="${nMid[0] + 8}" y2="${nMid[1]}" stroke="#111" stroke-width="2.5"/>`;
    out += `<text x="${nMid[0]}" y="${nMid[1] - 10}" font-family="Arial,sans-serif" font-size="9" fill="#333" text-anchor="middle">dado</text>`;
  }
  return out;
}

function drawArmsOnHub(P, cx, cy, z0, D, fill, hideArm = -1, showNotch = false) {
  const inner = D.hubR + D.wedgeLen * 0.35;
  const outer = D.hubR + D.wedgeLen + D.armLen;
  const angles = [0, 90, 180, 270];
  let out = "";
  const order = [2, 3, 1, 0];
  for (const idx of order) {
    if (idx === hideArm) continue;
    out += armBlock(P, cx, cy, angles[idx], inner, outer, z0, D.armW, D.armH, fill, showNotch && idx === 0);
  }
  return out;
}

// Column for upside-down assembly: wide flange on floor (z=0), stem up to hub.
function upsideDownColumn(P, cx, cy, D, fill) {
  const flangeR = D.coneTopR + 0.4;
  let out = discSolid(P, cx, cy, flangeR, 0, 0.35, fill);
  out += cylinder(P, cx, cy, D.stemR, 0.35, D.colH, fill);
  return out;
}

// Floor mat under upside-down assembly (IKEA rug hint).
function floorMat(P, cx, cy, w, d) {
  const x0 = cx - w / 2;
  const y0 = cy - d / 2;
  const z = 0;
  const pts = [
    P(x0, y0, z),
    P(x0 + w, y0, z),
    P(x0 + w, y0 + d, z),
    P(x0, y0 + d, z)
  ];
  return (
    `<polygon points="${pts.map(ptStr).join(" ")}" fill="#e8e4dc" stroke="#111" stroke-width="${STROKE_THIN}"/>` +
    `<line x1="${pts[3][0]}" y1="${pts[3][1]}" x2="${pts[3][0] + 18}" y2="${pts[3][1] + 6}" stroke="#999" stroke-width="1.2"/>`
  );
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
    colH: round2(clamp(height, 14, 42) * 0.55),
    stemR: 1.4,
    coneTopR: 3.2,
    armLen: round2(clamp(diameter, 12, 48) / 2.8),
    armW: 1.7,
    armH: 1.7,
    hubR: 1.5,
    hubH: 0.45,
    wedgeLen: 1.1,
    wedgeSpread: 24
  };
}

function generatePedestalManual(plan, preferences = {}, options = {}) {
  const D = defaultDims(plan, preferences);
  const baseColor = options.baseColor || "#b23b34";
  const topColor = options.topColor || "#d8b486";
  const cx = 0;
  const cy = 0;
  const joinery = getPedestalJoinerySpec(D, { base: baseColor });
  const hubOpts = {
    hubR: D.hubR,
    hubH: D.hubH,
    wedgeLen: D.wedgeLen,
    wedgeSpread: D.wedgeSpread,
    armH: D.armH
  };

  const drawTop = (P, zLift = 0, withHole = true) =>
    discSolid(P, cx, cy, D.topR, D.height + zLift, D.topTh, topColor, { holeR: withHole ? 0.9 : 0 });

  // Finished (right-side-up): cross base on floor, column, top.
  const drawFinished = (P) => {
    let g = drawArmsOnHub(P, cx, cy, 0, D, baseColor);
    g += hubWithWedges(P, cx, cy, D.armH * 0.2, hubOpts, baseColor);
    g += cylinder(P, cx, cy, D.stemR, D.armH + D.hubH, D.height - 1.2, baseColor);
    g += discSolid(P, cx, cy, D.coneTopR, D.height - 1.2, 0.9, baseColor);
    return g;
  };

  const drawFeet = (P) => {
    const outer = D.hubR + D.wedgeLen + D.armLen;
    const pts = [
      [outer, 0],
      [-outer, 0],
      [0, outer],
      [0, -outer]
    ];
    return pts.map(([x, y]) => footGlide(P, x, y, baseColor)).join("");
  };

  const pages = [];

  // ---- Parts inventory -------------------------------------------------------
  {
    let g = "";
    g += `<text x="${PAGE_W / 2}" y="64" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#111" text-anchor="middle">PARTS</text>`;
    g += drawTop(projector(180, 150, 9), -D.height, true);
    g += countLabel("1x", 180, 235, 26);
    const Pp = projector(470, 280, 9);
    g += upsideDownColumn(Pp, cx, cy, D, baseColor);
    g += hubWithWedges(Pp, cx, cy, D.colH, hubOpts, baseColor);
    g += countLabel("1x", 470, 360, 26);
    g += countLabel("4x", 500, 392, 22);
    const hy = 560;
    g += `<line x1="60" y1="${hy - 70}" x2="${PAGE_W - 60}" y2="${hy - 70}" stroke="#ccc" stroke-width="1.5"/>`;
    g += `<text x="${PAGE_W / 2}" y="${hy - 84}" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#111" text-anchor="middle">HARDWARE</text>`;
    g += buttonScrew(140, hy, 1.1) + countLabel("4x", 140, hy + 70) + smallCode("M6 hub", 168, hy + 6);
    g += buttonScrew(270, hy, 0.9) + countLabel("3x", 270, hy + 70) + smallCode("top plate", 296, hy + 6);
    g += thumbScrew(400, hy, 1.05) + countLabel("4x", 400, hy + 70) + smallCode("195312", 426, hy + 6);
    g += allenKey(520, hy - 60, 1) + countLabel("1x", 540, hy + 70) + smallCode("100092", 590, hy - 4);
    pages.push({
      id: "parts",
      number: null,
      title: "Parts & hardware",
      caption: "Hub plate, four wedge blocks, four arm blanks, column core, top, and counted hardware.",
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { code: "AA-PEDESTAL-1" })
    });
  }

  // ---- Step 1: leveling feet into arm blocks ---------------------------------
  {
    let g = "";
    const P = projector(280, 420, 22);
    g += armBlock(P, cx, cy, 0, 0, D.armLen + 1.5, 0, D.armW, D.armH, baseColor, true);
    g += countLabel("4x", 120, 200, 28);
    const footPt = P(D.armLen * 0.35, 0, 0);
    let inner = thumbScrew(490, 280, 1.35);
    inner += `<path d="M490 240 q18 -28 0 -48" fill="none" stroke="#111" stroke-width="4" marker-end="url(#cw)"/>`;
    inner += countLabel("1x", 490, 360, 22);
    g +=
      `<defs><marker id="cw" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#111"/></marker></defs>` +
      zoomCircle(500, 290, 82, footPt[0], footPt[1], inner);
    pages.push({
      id: "leveling-feet",
      number: 1,
      title: joinery.assembly_sequence[0].title,
      caption: joinery.assembly_sequence[0].detail,
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { number: 1, code: "AA-PEDESTAL-2" })
    });
  }

  // ---- Step 2: slide arms onto wedge tabs (upside-down hub) ------------------
  {
    let g = "";
    const P = projector(330, 520, 17);
    g += floorMat(P, cx, cy - 2, 8, 5);
    g += upsideDownColumn(P, cx, cy, D, baseColor);
    g += hubWithWedges(P, cx, cy, D.colH, hubOpts, baseColor, 0);
    g += drawArmsOnHub(P, cx, cy, D.colH, D, baseColor, 0);
    const Pexp = projector(330 + 155, 520 - 35, 17);
    g += armBlock(Pexp, cx, cy, 0, D.hubR + D.wedgeLen * 0.2, D.hubR + D.wedgeLen + D.armLen + 2, D.colH, D.armW, D.armH, baseColor);
    g += straightArrow(565, 455, 455, 495, 18);
    g += countLabel("4x", 565, 420, 26);
    const wedgeFocus = P(D.hubR + D.wedgeLen * 0.5, 0, D.colH + D.armH * 0.5);
    let inner = "";
    inner += wedgeTab(projector(500, 280, 14), cx, cy, 0, 0, hubOpts, baseColor);
    inner += `<text x="500" y="360" font-family="Arial,sans-serif" font-size="11" fill="#333" text-anchor="middle">wedge tab → dado</text>`;
    g += zoomCircle(510, 300, 72, wedgeFocus[0], wedgeFocus[1], inner);
    pages.push({
      id: "wedge-slide",
      number: 2,
      title: joinery.assembly_sequence[1].title,
      caption: joinery.assembly_sequence[1].detail,
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { number: 2, code: "AA-PEDESTAL-3" })
    });
  }

  // ---- Step 3: bolt wedges to hub --------------------------------------------
  {
    let g = "";
    const P = projector(300, 540, 16);
    g += floorMat(P, cx, cy - 2, 8, 5);
    g += upsideDownColumn(P, cx, cy, D, baseColor);
    g += hubWithWedges(P, cx, cy, D.colH, hubOpts, baseColor);
    g += drawArmsOnHub(P, cx, cy, D.colH, D, baseColor);
    const focus = P(D.hubR + 0.3, 0.4, D.colH + D.hubH);
    let inner = buttonScrew(470, 255, 1.35) + allenKey(525, 215, 1.05);
    inner += straightArrow(470, 205, 470, 240, 12);
    g += zoomCircle(495, 265, 78, focus[0], focus[1], inner);
    g += countLabel("4x", 495, 370, 24);
    pages.push({
      id: "hub-lock",
      number: 3,
      title: joinery.assembly_sequence[2].title,
      caption: joinery.assembly_sequence[2].detail,
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { number: 3, code: "AA-PEDESTAL-4" })
    });
  }

  // ---- Step 4: mounting plate under top --------------------------------------
  {
    let g = "";
    const P = projector(330, 430, 12);
    g += discSolid(P, cx, cy, D.topR, 0, D.topTh, topColor, { holeR: 0.9 });
    const Pp = projector(330, 250, 12);
    g += discSolid(Pp, cx, cy, D.coneTopR + 0.5, 0, 0.35, shade(baseColor, -0.08));
    g += straightArrow(330, 295, 330, 375, 20);
    g += buttonScrew(520, 250, 1.1) + countLabel("3x", 520, 320);
    g += allenKey(580, 200, 0.9);
    pages.push({
      id: "plate",
      number: 4,
      title: joinery.assembly_sequence[3].title,
      caption: joinery.assembly_sequence[3].detail,
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { number: 4, code: "AA-PEDESTAL-5" })
    });
  }

  // ---- Step 5: set top on column ---------------------------------------------
  {
    let g = "";
    const P = projector(330, 660, 13);
    g += drawFinished(P);
    g += drawFeet(P);
    g += drawTop(projector(330, 200, 13), -D.height, true);
    g += straightArrow(330, 295, 330, 355, 22);
    g += countLabel("1x", 430, 245, 26);
    pages.push({
      id: "join",
      number: 5,
      title: joinery.assembly_sequence[4].title,
      caption: joinery.assembly_sequence[4].detail,
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { number: 5, code: "AA-PEDESTAL-6" })
    });
  }

  // ---- Finished --------------------------------------------------------------
  {
    let g = "";
    const P = projector(330, 540, 15);
    g += drawFinished(P);
    g += drawFeet(P);
    g += drawTop(P, 0, true);
    g += `<text x="${PAGE_W / 2}" y="760" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#111" text-anchor="middle">DONE</text>`;
    pages.push({
      id: "done",
      number: null,
      title: "Finished",
      caption: "Flip the base upright if you assembled upside-down; level with the four feet.",
      view_box: { width: PAGE_W, height: PAGE_H },
      svg: pageFrame(g, { code: "AA-PEDESTAL-7" })
    });
  }

  const parts = [
    { id: "top", label: "Round table top", kind: "round_top", material_name: "plywood round top", cut_size: `${round2(D.topR * 2)} in dia`, quantity: 1 },
    { id: "hub", label: "Hub plate + wedge blocks", kind: "hub", material_name: "3/4 in plywood hub", cut_size: "6 in disc + 4 wedges", quantity: 1 },
    { id: "column", label: "Column core + wrap", kind: "column", material_name: "steel pipe + MDF wrap", cut_size: `${D.height} in`, quantity: 1 },
    { id: "arm", label: "Foot arm (dadoed)", kind: "arm", material_name: "2x2 hardwood", cut_size: `${D.armLen} in`, quantity: 4 },
    { id: "plate", label: "Mounting plate", kind: "plate", material_name: "steel plate", cut_size: "6 in", quantity: 1 },
    { id: "leveler", label: "Leveling feet", kind: "fastener_set", material_name: "1/4-20 leveling feet", cut_size: "4 pack", quantity: 4 }
  ];

  const frames = pages.map((p, i) => ({
    title: p.title,
    caption: p.caption,
    page_index: i,
    visible_parts: [],
    highlight_parts: []
  }));

  return {
    version: "1.1",
    renderer: "ikea_line_art_v1.1",
    archetype: "pedestal_round_table",
    source: "parametric_vector",
    source_note:
      "Isometric manual with wedge-tab hub joinery (structured carpentry knowledge, not photo collage). Faces tinted from the reference colour.",
    colors: { base: baseColor, top: topColor },
    joinery: joinery.connection,
    finish_plan: joinery.finish,
    dims: D,
    view_box: { width: PAGE_W, height: PAGE_H },
    pages,
    parts,
    frames
  };
}

export { generatePedestalManual, shade };
