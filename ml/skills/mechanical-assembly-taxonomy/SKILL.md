---
name: mechanical-assembly-taxonomy
description: Normalize assembly operations and hardware interfaces before planning.
---

# Mechanical Assembly Taxonomy

Use when converting a photo/manual into build steps.

Operation classes:
- `thread`: screw, leveling foot, insert, bolt.
- `slide`: rail into socket, dado onto wedge, tab into slot.
- `tighten`: Allen key, screwdriver, wrench.
- `drop`: vertical placement of disc/tabletop/plate.
- `align`: holes, notches, arrows, marks.
- `adjust`: leveling foot, final square/level check.

Interface classes:
- threaded shaft into insert
- screw through plate into base
- round plate onto hole pattern
- rail/block onto hub socket
- column into pedestal hub

Rules:
- One primary operation per rendered step.
- Every hardware operation must name the SKU/count if known.
- Every hidden interface should use dashed lines or a zoom inset.
