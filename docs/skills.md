# Runtime skills (ML backend)

Domain knowledge packaged like [Agent Skills](https://github.com/YouMind-OpenLab/ai-image-prompts-skill): each skill is a `SKILL.md` plus optional `references/*.json`, listed in `manifest.json`.

## How it works

1. **Match** — `ml/skills/loader.py` picks skills from furniture type + perception keywords.
2. **Inject** — matched skill text is appended to VLM perception and planner prompts.
3. **Enforce** — Node still applies deterministic joinery (`pedestalJoinery.js`) and SVG manual (`pedestalManual.js`) so output stays correct even if the VLM hallucinates.

## Bundled skills

| ID | Purpose |
|----|---------|
| `pedestal-joinery` | Wedge-tab hub, dado arms, leveling feet |
| `ikea-manual-style` | Line-art page conventions |
| `finish-color-match` | Primer + paint / powder-coat sourcing |

## Add a skill

```text
ml/skills/my-skill/
  SKILL.md
  references/data.json   # optional
```

Register triggers in `ml/skills/manifest.json`, restart the ML backend.

## Cursor dev skills

Project skills for editing this repo live in `.cursor/skills/` (separate from runtime `ml/skills/`).
