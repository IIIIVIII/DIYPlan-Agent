---
name: token-budget-routing
description: Keep local VLM prompts compact by loading only relevant skill context.
---

# Token budget and routing

Qwen3-VL-4B should receive compact, high-signal context. Do not inject the entire manual or every skill.

## Rules

- Use manifest triggers to select skills.
- Prefer short skill text plus small JSON references.
- Use retrieval snippets for broad DIY facts; use skills for strict instructions.
- For image understanding, include only perception-critical skills.
- For plan generation, include joinery, material, and safety skills.
- For manual generation, include AssemblyIR, page layout, hardware, arrows, insets, and verifier skills.
- If context is too long, keep:
  1. source-manual-grounding
  2. assembly-ir-contract
  3. hardware-inventory
  4. manual-page-layout
  5. manual-verifier

## Speed guidance

Local renderer and verifier should remain deterministic and zero-cost. Use the VLM only for ambiguous visual understanding and structured extraction.
