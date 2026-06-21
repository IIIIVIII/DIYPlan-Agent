---
name: dimension-diagram-reading
description: Read furniture dimension diagrams and preserve metric/imperial measurements.
---

# Dimension diagram reading

Dimension pages are evidence for scale and proportions. Extract dimensions separately from assembly steps.

## Rules

- Preserve both metric and imperial values when shown.
- Record what the dimension measures: diameter, total height, tabletop thickness, apron/cone depth, base footprint.
- If a dimension line points to a subassembly, store it on that part, not only on the overall object.
- Use dimension confidence:
  - `high`: label is visible and linked to a clear dimension line.
  - `medium`: visible but line target is partly ambiguous.
  - `low`: inferred from product category only.

## Example

For a small pedestal table:

```json
{
  "diameter_cm": 40,
  "diameter_in": 15.75,
  "height_cm": 43,
  "height_in": 16.875,
  "top_to_cone_depth_cm": 11,
  "top_to_cone_depth_in": 4.375
}
```
