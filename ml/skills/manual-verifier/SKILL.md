---
name: manual-verifier
description: Verification checks for assembly-manual correctness.
---

# Manual verifier

Before rendering, verify the AssemblyIR or instruction model.

## Checks

1. `all_parts_defined`: every step part exists in inventory.
2. `all_hardware_defined`: every step hardware item exists in inventory.
3. `count_consistency`: inventory quantities match repeated use counts.
4. `source_order`: steps follow source booklet order.
5. `single_primary_action`: each step has one main operation.
6. `inset_required`: tiny hardware operations have zoom insets.
7. `geometry_consistency`: same part keeps shape across pages.
8. `no_generic_attach`: reject vague actions like "attach" unless the mechanical interface is specified.
9. `safe_scope`: do not add electrical, wall-mounted load-bearing, or seating-load claims.

## Failure handling

If a check fails, repair the structured model before rendering. Do not hide verifier failures in captions.
