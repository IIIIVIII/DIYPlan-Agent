---
name: pdf-svg-fixture-extraction
description: Convert trusted source-manual PDF pages into exact SVG fixtures when one-to-one fidelity is required.
---

# PDF SVG Fixture Extraction

Use when the user provides an original assembly manual and asks for exact page
detail. Do not ask the model to redraw known pages from memory.

Rules:
- Treat the source PDF as the highest-fidelity visual source.
- Extract the relevant manual pages into SVG fixtures when legal/user-provided context allows it.
- Preserve source page order, page numbers, hardware labels, counts, arrows, insets, and footer codes.
- Use generative drawing only for unknown products or missing pages.
- Keep the fixture renderer separate from the generic renderer so benchmark results can compare exact-source mode vs generated mode.
- Store fixture metadata: source file name, source page numbers, asset URLs, extraction method, and renderer version.

Routing:
- Known source manual + known product = fixture renderer.
- Known source manual + unknown variant = fixture renderer for unchanged pages, generated AssemblyIR for changed pages.
- Product photo only = perception + AssemblyIR + generated renderer.
