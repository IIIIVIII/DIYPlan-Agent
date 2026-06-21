---
name: pedestal-joinery
description: Wedge-tab hub joinery for round pedestal tables. Use when planning or drawing pedestal/cross-base tables.
---

# Pedestal table joinery (wedge-tab hub)

Commercial pedestal bases use a **hub flange with four triangular wedge tabs**. Foot arms have a **dado/notch** on the inner face and slide horizontally onto each tab until a shoulder seats against the hub. Do NOT describe "four blocks pushed into a hollow tube" or generic screw-only joints.

## Required connection detail

1. **Hub plate**: 6–8 in plywood or steel disc at column base.
2. **Wedge blocks**: four miter-cut triangular blocks bolted to hub at 90°.
3. **Arms**: 2×2 blanks, inner dado = wedge thickness + 1/16 in clearance.
4. **Lock**: M6 bolt through wedge into hub after arms seated.
5. **Leveling**: 1/4-20 insert + adjustable foot in underside of each arm (install before paint).

## Assembly order (upside-down)

1. Thread leveling feet into four arm blocks.
2. Place column upside-down on blanket; slide each arm onto a wedge tab (4×).
3. Bolt wedges to hub; check square.
4. Flip base upright; mount top plate; set top on column.

## Planner output rules

- `detected_object.structure` must mention **wedge-tab cross base**.
- `materials` must include: hub plywood, 2×2 arms, wedge bolts, leveling feet, threaded inserts.
- `steps` must describe dado + wedge slide — never "drive screws into arms" without explaining the wedge interface.
