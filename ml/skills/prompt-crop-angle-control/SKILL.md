---
name: prompt-crop-angle-control
description: Guide image-understanding prompts to identify parts, view angle, and crop boundaries precisely.
---

# Prompt Crop And Angle Control

Use before visual decomposition.

Rules:
- Identify whether each uploaded image is product photo, dimension diagram, source manual page, or user workspace photo.
- Extract view type: front, side, top, underside, isometric, exploded, detail inset.
- Separate visible parts from inferred hidden parts.
- For diagrams, read labels and dimensions before style.
- For product photos, detect silhouette primitives: circular top, column, cross base, feet, plates, holes.
- Avoid inventing parts outside the crop. Mark uncertain interfaces as `unknown`.
- Prefer multiple images: dimension diagram for size, product photo for form, source manual for assembly sequence.
