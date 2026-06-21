---
name: parametric-cad-grounding
description: Use CAD-like part primitives and constraints before rendering assembly diagrams.
---

# Parametric CAD Grounding

Use for furniture that must be mechanically coherent.

Rules:
- Represent parts as constrained primitives: disc, cylinder, rail, plate, screw, threaded foot, bracket, hinge, socket.
- Attach every rendered part to a coordinate frame and assembly state.
- Keep dimensions in a normalized unit system before drawing.
- Validate that mating parts share compatible interfaces: hole diameter, screw count, slot direction, tab/socket orientation.
- Do not render floating parts without an operation arrow or exploded-view offset.
- Prefer deterministic primitives over free-form image generation for instruction diagrams.

For generated manuals, output AssemblyIR before SVG:
- `part`
- `interface`
- `operation`
- `view`
- `callout`
- `verifier`
