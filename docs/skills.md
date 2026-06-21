# Runtime skills (ML backend)

Domain knowledge packaged like [Agent Skills](https://github.com/YouMind-OpenLab/ai-image-prompts-skill): each skill is a `SKILL.md` plus optional `references/*.json`, listed in `manifest.json`.

## How it works

1. **Match** — `ml/skills/loader.py` picks skills from furniture type + perception keywords.
2. **Inject** — matched skill text is appended to VLM perception and planner prompts.
3. **Enforce** — Node still applies deterministic joinery (`pedestalJoinery.js`) and SVG manual (`pedestalManual.js`) so output stays correct even if the VLM hallucinates.

## Bundled skills

| ID | Purpose |
|----|---------|
| `token-budget-routing` | Compact context loading for local Qwen/MLX |
| `source-manual-grounding` | Treat source PDFs/booklets as ground truth |
| `assembly-ir-contract` | Structured manual-generation IR |
| `hardware-inventory` | Hardware SKUs, icons, and counts |
| `dimension-diagram-reading` | Dimension extraction from product diagrams |
| `manual-page-layout` | Dense IKEA-style page composition |
| `zoom-inset-detail` | Circular and rectangular detail insets |
| `motion-arrow-language` | Normalized operation/arrow vocabulary |
| `pedestal-joinery` | Wedge-tab hub, dado arms, leveling feet |
| `top-mount-interface` | Round tabletop center mount details |
| `leveling-foot-detail` | Install and final-adjust leveling feet |
| `grimsarbo-pedestal-fixture` | Gold fixture for the provided small red pedestal table |
| `ikea-manual-style` | Line-art page conventions |
| `renderer-primitive-library` | Semantic-to-SVG primitive mapping |
| `manual-verifier` | Checks for source order, counts, insets, and vague actions |
| `finish-color-match` | Primer + paint / powder-coat sourcing |

## Why many small skills?

The local model is small, so one giant prompt is wasteful and brittle. The loader
uses `manifest.json` triggers, priority ordering, and a character budget to load
only the short skills that matter for the current request. This follows the same
pattern as prompt-library skills such as YouMind's `ai-image-prompts-skill`, but
the content here is furniture/manual-specific rather than image-prompt-specific.

## Add a skill

```text
ml/skills/my-skill/
  SKILL.md
  references/data.json   # optional
```

Register triggers in `ml/skills/manifest.json`, restart the ML backend.

## Cursor dev skills

Project skills for editing this repo live in `.cursor/skills/` (separate from runtime `ml/skills/`).
