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

## How We Should Write The Model

The first model to build is not a neural network that draws the final manual. The first model is a strict instruction-generation contract.

For this project, "model" means four layers:

1. **Reference parser**: reads the uploaded product image, optional dimension diagram, and optional source booklet pages. It extracts object type, known dimensions, parts, hardware, and the original step order.
2. **Instruction planner**: converts the reference into a structured JSON manual. It must output part IDs, quantities, geometry kinds, placements, arrows, inset details, hardware counts, and per-step state transitions.
3. **Deterministic renderer**: turns the JSON into a consistent LEGO-style visual manual. The renderer owns the visual style, so every page has the same drawing language.
4. **Verifier**: checks whether the model used the original step sequence, kept the same part geometry across pages, introduced parts before using them, preserved hardware counts, and avoided hallucinated extra steps.

This means the LLM or vision model should never be asked to directly generate SVG pages. It should be asked to fill the contract. The renderer and verifier should be local, cheap, repeatable, and testable.

## Round Table Rules

The round table path is intentionally stricter than the generic side-table fallback:

- The tabletop halves are rendered as true circular/elliptical halves, not rectangular panels.
- The tabletop seam stays aligned across pages.
- The manual follows the provided assembly-book sequence one-to-one at the process level: join tabletop halves, screw the underside frame, set the first leg rail, insert the four legs, tighten the lower X brace, add leveling feet and flip with two people.
- Each page introduces only a small number of new parts.
- Repeated hardware operations use explicit counts such as `2x`, `4x`, or `8x`.
- Local detail insets explain small connection points instead of crowding the main drawing.

For the current round-table fixture, the source booklet is treated as the ground truth. The demo should not invent cutting, sanding, finishing, or extra construction pages when the source manual does not contain those pages. Future work can add a second mode for "build a simplified DIY substitute," but the source-manual mode must stay faithful to the provided booklet.

## Training Direction

Once the contract is stable, we can turn this into a real modeling problem:

- Collect pairs of product image plus source booklet pages mapped to instruction JSON.
- Use a frontier multimodal model to bootstrap labels for parts, hardware, and step order.
- Hand-correct a small set of examples to create a high-quality evaluation set.
- Train or prompt smaller models to produce the same JSON contract.
- Route only the hard stages, such as image understanding or ambiguous part detection, to a stronger model.
- Keep rendering and verification local so cost does not scale with the number of manual pages.

The research question is not only "can the model make a pretty manual?" It is "which stages require expensive multimodal inference, and can structured output plus verification keep the final manual understandable, consistent, and cheap?"

## Research Direction

This model layer also makes the project more useful as an agent/infra benchmark:

- A strong multimodal model can parse the image.
- A smaller model or local rules can normalize part IDs and quantities.
- A deterministic renderer can produce the manual cheaply.
- A verifier can catch inconsistent geometry, missing fasteners, unsafe steps, or steps that use parts before they appear.
- Routing experiments can decide which stages need a stronger model and which stages can stay local.
