# DIYPlan Instruction Model

The manual should not be free-form prose or free-form SVG generated directly by an LLM.

The project uses a structured instruction model:

1. Vision or mock planner identifies the furniture type, visible parts, approximate dimensions, and risk level.
2. A domain instruction model converts the object into stable parts with IDs, quantities, material names, cut sizes, and geometry kinds.
3. Each assembly frame describes a state transition: visible parts, newly highlighted parts, exact pieces needed, placements, arrows, insets, and safety notes.
4. A deterministic browser renderer turns those frames into one consistent visual manual.
5. A verifier can check that required parts appear before they are used, fastener counts are explicit, and the same part keeps a consistent shape across pages.

This is why the app should have its own model layer before doing more cloud-model work. The cloud model can help infer parts from an uploaded image, but it should output structured data into this contract. It should not directly invent the final instruction pages.

## Current Contract

Each part has:

- `id`
- `label`
- `kind`
- `material_name`
- `cut_size`
- `quantity`
- `geometry`

Each frame has:

- `title`
- `caption`
- `parts_needed`
- `visible_parts`
- `highlight_parts`
- `placements`
- optional `arrows`
- optional `callouts`
- optional `insets`
- optional scene helpers such as `surface` or `helper`

## Round Table Rules

The round table path is intentionally stricter than the generic side-table fallback:

- The tabletop halves are rendered as true circular/elliptical halves, not rectangular panels.
- The tabletop seam stays aligned across pages.
- The manual follows a state progression inspired by real furniture instructions: join tabletop, lock seam, place underside frame, fasten frame, insert leg pairs, add lower rails, add X brace, tighten brackets, add levelers, flip with two people, final check.
- Each page introduces only a small number of new parts.
- Repeated hardware operations use explicit counts such as `2x`, `4x`, or `8x`.
- Local detail insets explain small connection points instead of crowding the main drawing.

## Research Direction

This model layer also makes the project more useful as an agent/infra benchmark:

- A strong multimodal model can parse the image.
- A smaller model or local rules can normalize part IDs and quantities.
- A deterministic renderer can produce the manual cheaply.
- A verifier can catch inconsistent geometry, missing fasteners, unsafe steps, or steps that use parts before they appear.
- Routing experiments can decide which stages need a stronger model and which stages can stay local.
