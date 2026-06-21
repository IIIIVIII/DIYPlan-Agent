---
name: visual-regression-qa
description: Verify generated manual pages against reference pages using screenshots and page-level checks.
---

# Visual Regression QA

Use after changing manual rendering.

Checks:
- Render generated pages in the browser.
- Compare page count, page order, and page numbers against the source manual.
- Verify visible hardware labels and quantities.
- Verify arrows point in the same operation direction as the reference.
- Verify circles/rectangular zoom insets appear on the same steps.
- Check that no UI chrome overlaps the manual page.
- Check that the source fixture path renders at desktop width and does not appear blank.

Failure policy:
- If a known source manual exists and generated SVG is visibly different, prefer PDF-derived SVG fixture mode.
- If fixture assets fail to load, fall back to generated AssemblyIR but mark fidelity as degraded.
