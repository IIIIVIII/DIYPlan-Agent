---
name: hardware-inventory
description: Extract and preserve counted hardware, part numbers, and tool icons from furniture manuals.
---

# Hardware inventory

Assembly manuals rely on precise hardware identity. Extract hardware as first-class objects, not as prose.

## Extraction rules

- Preserve each visible part number, such as `195312`, `10074126`, `115461`, or `100092`.
- Preserve quantities exactly: `1x`, `3x`, `4x`, `8x`.
- Distinguish hardware classes:
  - thumb leveling foot
  - button-head screw
  - flat-head screw
  - Allen key
  - mounting plate
  - hub/flange plate
- Hardware may appear in inventory and again inside a zoom inset. Link both uses to the same ID.

## AssemblyIR guidance

Represent hardware as:

```json
{
  "id": "leveling_foot_195312",
  "label": "Leveling foot",
  "sku": "195312",
  "quantity": 4,
  "kind": "leveler",
  "icon": "thumb_screw"
}
```

Do not collapse counted hardware into generic "screws".
