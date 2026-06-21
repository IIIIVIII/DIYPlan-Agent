---
name: assembly-ir-contract
description: Structured intermediate representation for manual-quality assembly instructions.
---

# AssemblyIR contract

The model should not draw SVG. It should output an AssemblyIR that a deterministic renderer can draw.

## Core objects

- `part`: physical component with id, label, quantity, shape, material, color, and source evidence.
- `hardware`: counted fastener/tool with sku, icon, quantity, and source evidence.
- `step`: source-linked assembly operation.
- `view`: page layout region, camera orientation, visible parts, hidden parts, and highlighted parts.
- `operation`: one primary action from the motion vocabulary.
- `inset`: local zoom or rectangular detail.
- `verifier`: constraints the renderer can check.

## Requirements

- Every step references existing part/hardware IDs.
- Every count appears in hardware inventory and at point of use.
- Every inset has a target part or target coordinate label.
- Use `needs_human_check: true` when source evidence is insufficient.
