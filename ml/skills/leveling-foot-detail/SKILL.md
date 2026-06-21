---
name: leveling-foot-detail
description: Model adjustable leveling feet and final level checks for table bases.
---

# Leveling foot detail

Leveling feet are not generic screws. They are adjustable glides used to level the final table.

## Rules

- Inventory as hardware with SKU when visible.
- Step 1 often installs one foot into each arm, repeated 4x.
- Use a circular inset to show the threaded foot and rotation arrow.
- Final page should show up/down adjustment arrows at each base arm.
- Final page may include a spirit level icon on the tabletop.

## AssemblyIR

- `hardware.kind`: `leveling_foot`
- `operation`: `thread_rotate` during installation, `adjust_level` during final check.
- Preserve count: usually `4x`.
