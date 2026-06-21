---
name: diy-pedestal-manual
description: >-
  Build and debug IKEA-style pedestal table manuals with wedge-tab joinery,
  colour-matched finish sourcing, and parametric SVG in src/pedestalManual.js.
  Use when the user reports wrong assembly steps, missing wedge tabs, stale
  manual pages (AA-PEDESTAL-3 with "Drive a screw into each arm"), or asks to
  add furniture joinery skills.
---

# DIY pedestal manual (project skill)

## Architecture (do not confuse layers)

| Layer | Location | Role |
|-------|----------|------|
| **Runtime skills** | `ml/skills/` | Injected into VLM perception + planner prompts |
| **Joinery rules** | `src/pedestalJoinery.js` | Materials, steps, finish — deterministic |
| **Manual SVG** | `src/pedestalManual.js` | IKEA line-art pages (renderer `ikea_line_art_v1.1`) |
| **Cursor dev skill** | `.cursor/skills/` | Helps *you* edit the above |

## Stale manual symptom

If Step 2 shows **"Drive a screw into each arm"** + four blocks at column base (no wedge tabs, no rug mat): **Node server is stale**. Restart:

```bash
# kill ports 5173 and 8000, then:
PYTORCH_ENABLE_MPS_FALLBACK=1 ml/.venv/bin/python -m ml.app
ML_BACKEND_URL=http://127.0.0.1:8000 PORT=5173 node server.js
```

Correct Step 2 caption: **"Slide arms onto hub wedge tabs"** with upside-down column + zoom **wedge tab → dado**.

## Adding a new runtime skill

1. Create `ml/skills/<id>/SKILL.md` + optional `references/*.json`
2. Register in `ml/skills/manifest.json` with `triggers`
3. `loader.py` auto-matches on furniture type / perception keywords
4. Restart ML backend — trace shows `skill-match` stage

## Reference

- YouMind skill pattern: markdown + JSON references + manifest
- See `ml/skills/pedestal-joinery/` as template
