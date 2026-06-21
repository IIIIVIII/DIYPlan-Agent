---
name: source-manual-grounding
description: Ground generated assembly manuals in a provided source booklet or instruction PDF.
---

# Source manual grounding

When a source booklet, dimension drawing, or assembly page is available, treat it as the ground truth for the manual workflow.

## Rules

1. Preserve source step order. Do not invent cutting, sanding, finishing, or alternate construction steps in source-manual mode.
2. Preserve source page grain: if one source page contains step 1 and step 2, the output may keep those two steps together or split them only when the UI requires it.
3. Extract visible facts only: part counts, hardware IDs, tool IDs, arrows, inset callouts, orientation, and safety panels.
4. If a step is ambiguous, mark it as `needs_human_check` instead of guessing.
5. Separate two modes:
   - `source_manual_replica`: reproduce the source assembly sequence.
   - `diy_substitute`: design a buildable inspired-by alternative.

## Output guidance

- Include `source_page`, `source_step`, and `source_evidence` when generating an AssemblyIR step.
- Use the source hardware IDs exactly when visible.
- Never replace a mechanical interface with vague prose such as "attach parts".
