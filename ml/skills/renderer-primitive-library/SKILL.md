---
name: renderer-primitive-library
description: Map AssemblyIR concepts to deterministic SVG primitives.
---

# Renderer primitive library

The model should choose semantic primitives. The renderer should draw them.

## Primitive names

- `disc_solid`: tabletop, circular plate, hub plate.
- `cylinder`: column, pipe, pedestal stem.
- `cone_frustum`: cone apron or flared collar.
- `iso_box`: rectangular arm block, rail, shelf, leg.
- `thumb_screw`: leveling foot.
- `button_screw`: dome screw.
- `flat_head_screw`: countersunk screw.
- `allen_key`: hex key.
- `circle_inset`: zoom circle.
- `rect_inset`: rectangular detail panel.
- `solid_arrow`: push/drop arrow.
- `curved_arrow`: rotation/tighten arrow.
- `level_icon`: spirit level.

## Rule

If a required primitive does not exist, add it to the deterministic renderer before asking the VLM to draw it.
