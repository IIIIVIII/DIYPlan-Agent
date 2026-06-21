import { writeFileSync, mkdirSync } from "node:fs";
import { generatePedestalManual } from "../src/pedestalManual.js";

const baseColor = process.argv[2] || "#c0392b";
const model = generatePedestalManual(
  { recommended_design: { dimensions: "18 in diameter, 22 in tall" } },
  { targetSize: "18 in diameter, 22 in tall" },
  { baseColor }
);

mkdirSync("/tmp/pedestal", { recursive: true });
const vb = model.view_box;
model.pages.forEach((p, i) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb.width} ${vb.height}" width="${vb.width}" height="${vb.height}">${p.svg}</svg>`;
  const file = `/tmp/pedestal/page-${i + 1}-${p.id}.svg`;
  writeFileSync(file, svg);
  console.log(file);
});
console.log("pages:", model.pages.length, "renderer:", model.renderer);
