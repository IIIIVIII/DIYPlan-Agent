---
name: ikea-manual-style
description: IKEA-style assembly manual page conventions for line-art exploded views.
---

# IKEA-style manual conventions

Manual pages are **parametric SVG line art**, not photo cutouts.

## Page types

1. **Parts + hardware inventory** — isolated parts with Nx counts, screw part numbers, allen key.
2. **Numbered steps** — large step digit top-left; exploded isometric; solid black motion arrows.
3. **Detail zoom** — dashed leader to circle inset showing fastener + tool + rotation arrow.
4. **Upside-down assembly** — show rug/blanket under flange when attaching cross base.

## Drawing rules

- White page, black outlines, object colour as flat face tints only.
- Wedge tabs must be visible as triangular protrusions on hub — not invisible joints.
- Caption text explains **mechanical interface** (wedge → dado), not vague "tighten screws".

## Code mapping (Node)

- Renderer: `ikea_line_art_v1.1`
- Generator: `src/pedestalManual.js`
- Joinery spec: `src/pedestalJoinery.js`

If UI shows `AA-PEDESTAL-3` with caption "Drive a screw into each arm", the server is running **stale code** — restart Node after pull.
