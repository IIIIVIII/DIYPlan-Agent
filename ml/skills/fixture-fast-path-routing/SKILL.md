---
name: fixture-fast-path-routing
description: Short-circuit expensive VLM calls when a known sample/manual fixture has enough information to render directly.
---

# Fixture Fast Path Routing

Use when a sample photo or manual is already recognized as a known fixture.

Rules:
- If furnitureType, dimensions, and source fixture are already known, skip image-understanding for the manual renderer.
- Use local rules for material links, verifier notes, and source page selection.
- Run the VLM only when the product identity, dimensions, or variant is uncertain.
- Add a trace stage named `fixture-fast-path` when this happens.
- Keep cost/latency metrics honest: report skipped model calls as zero-cost deterministic stages.

Fast path eligibility:
- User selected a bundled sample.
- Source manual page IDs are known.
- Required hardware SKUs and counts are in the fixture.
- No user-requested geometry change conflicts with the fixture.
