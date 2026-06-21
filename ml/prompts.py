"""Prompt construction for perception and planning.

Prompts are kept here (not inline) so they can be versioned and A/B compared
as part of the routing/benchmark research.
"""

from __future__ import annotations

import json
from typing import List

PERCEPTION_SYSTEM = (
    "You are a careful furniture vision analyst. Look at the image and report "
    "only what is visually supported. Prefer low-risk furniture framing. "
    "Respond with a single JSON object and no extra text."
)

PLANNER_SYSTEM = (
    "You are a cautious DIY furniture planning agent. Generate an inspired-by, "
    "buildable alternative rather than a copy of a branded design. Prefer "
    "beginner-safe joinery, realistic US hardware-store materials, and explicit "
    "assumptions. Never design electrical, plumbing, gas, or high-risk "
    "load-bearing work. Respond with a single JSON object and no extra text."
)


def perception_prompt(preferences: dict, skill_context: str = "") -> str:
    schema_hint = {
        "category": "string (e.g. side table, round dining table, bookshelf)",
        "structure": "string (e.g. pedestal column with wedge-tab cross base, four-leg apron table)",
        "visible_parts": ["string"],
        "likely_materials": ["string"],
        "style": "string",
        "approx_dimensions_note": "string",
        "finish_note": "string (painted vs natural wood vs metal — visually supported only)",
        "risk_level": "low | medium | high",
        "confidence": "number 0..1",
    }
    skills_block = ""
    if skill_context:
        skills_block = f"\nDomain skills (apply when relevant):\n{skill_context}\n\n"
    return (
        f"{PERCEPTION_SYSTEM}\n\n"
        f"User says the furniture type may be: {preferences.get('furnitureType') or 'unknown'}.\n"
        "Identify the object, its visible structural parts, likely materials, "
        "style, a rough size note, finish type (paint vs wood vs metal), and a safety risk level.\n"
        f"{skills_block}"
        "Return JSON exactly in this shape:\n"
        f"{json.dumps(schema_hint, indent=2)}"
    )


def planner_prompt(
    preferences: dict, perception: dict, retrieved: List[dict], skill_context: str = ""
) -> str:
    knowledge = "\n".join(f"- {item['text']}" for item in retrieved) or "- (none)"
    perception_text = json.dumps(perception, indent=2) if perception else "(no perception stage)"
    constraints = {
        "claimed_type": preferences.get("furnitureType") or "auto-detect",
        "target_size": preferences.get("targetSize") or "not specified",
        "budget": preferences.get("budget") or "not specified",
        "skill_level": preferences.get("skillLevel") or "beginner",
        "tools": preferences.get("tools") or ["basic hand tools"],
        "zipcode": preferences.get("zipcode") or "not provided",
    }
    schema_hint = _plan_schema_hint()
    skills_block = ""
    if skill_context:
        skills_block = (
            "\nDomain skills (MUST follow for joinery, manual steps, and finish sourcing):\n"
            f"{skill_context}\n\n"
        )
    return (
        f"{PLANNER_SYSTEM}\n\n"
        "Image understanding result:\n"
        f"{perception_text}\n\n"
        "User constraints:\n"
        f"{json.dumps(constraints, indent=2)}\n\n"
        "Relevant DIY knowledge (use it; do not contradict it):\n"
        f"{knowledge}\n"
        f"{skills_block}"
        "Requirements:\n"
        "- Produce a safer, simplified, inspired-by DIY version.\n"
        "- Prefer low-risk categories (side tables, coffee tables, shelves, nightstands, round tables).\n"
        "- Use real dressed lumber dimensions and realistic US prices.\n"
        "- Keep the itemized material total within the low/high estimate.\n"
        "- Fill every field.\n\n"
        "Return JSON exactly in this shape (types shown, not values):\n"
        f"{schema_hint}"
    )


INSTRUCTION_SYSTEM = (
    "You are an assembly-manual analyst. Break a piece of furniture into its "
    "real physical parts and an ordered, IKEA-style assembly sequence. Do NOT "
    "output pixel coordinates or drawings. Output only a JSON object describing "
    "parts and steps. Give each distinct part its own color so the pieces read "
    "as separated, using realistic material hues (wood browns/tans, metal grey, "
    "etc.) but keeping every part visually distinguishable."
)

# Roles the deterministic layout engine understands.
_ROLES = (
    "top, top_half_left, top_half_right, leg, apron, brace, foot, shelf, side, "
    "back, connector, fastener, leveler, generic"
)


def instruction_prompt(preferences: dict, perception: dict) -> str:
    perception_text = json.dumps(perception, indent=2) if perception else "(none)"
    schema_hint = {
        "object_type": "string",
        "topology": "table | shelf",
        "parts": [
            {
                "id": "string (snake_case, unique)",
                "label": "string",
                "role": f"one of: {_ROLES}",
                "shape": "round_half | panel | board | rail | leg | bracket | screw",
                "quantity": "integer >= 1",
                "color": "#RRGGBB (distinct per part)",
                "material_name": "string",
                "cut_size": "string",
            }
        ],
        "steps": [
            {
                "title": "string (e.g. 'Step 1 - Join tabletop halves')",
                "action": "string (what the builder does)",
                "add_parts": ["part id introduced this step"],
                "hardware": [{"name": "string", "count": "integer"}],
                "note": "string",
            }
        ],
    }
    return (
        f"{INSTRUCTION_SYSTEM}\n\n"
        "Image understanding result:\n"
        f"{perception_text}\n\n"
        "Rules:\n"
        "- List every visible structural part (tabletop or its halves, legs, "
        "aprons/rails, braces, feet, shelves, sides), each with its own color.\n"
        "- If the reference is a multi-piece top, use roles top_half_left and "
        "top_half_right; otherwise use a single top.\n"
        "- For a round or oval tabletop, set shape to round_half on the top "
        "halves (or round on a single top) so it is drawn round, not square.\n"
        "- Order steps the way the piece is actually assembled. Each step should "
        "introduce only a few new parts via add_parts (referencing part ids).\n"
        "- Put repeated fasteners in hardware with explicit counts (e.g. 2, 4, 8).\n"
        "- Choose topology 'table' for tables/desks/nightstands, 'shelf' for "
        "bookshelves/shelving.\n\n"
        "Return JSON exactly in this shape (types shown, not values):\n"
        f"{json.dumps(schema_hint, indent=2)}"
    )


def translation_prompt(texts: List[str], target_language: str) -> str:
    """Translate a list of strings, preserving order and count.

    Numbers, units, and dimensions stay as-is; only natural language is
    translated. Returns a strict JSON array so it maps back 1:1.
    """
    return (
        "You are a professional UI/technical translator for a DIY furniture app. "
        f"Translate each string in the array below into {target_language}. "
        "Keep numbers, measurements, units (in, cm, ft), and product codes "
        "unchanged. Keep it natural and concise. Do NOT add or remove items.\n\n"
        "Return ONLY a JSON object of the form {\"translations\": [...]} with "
        "exactly the same number of items, in the same order. No extra text.\n\n"
        f"Input ({len(texts)} items):\n{json.dumps(texts, ensure_ascii=False)}"
    )


def _plan_schema_hint() -> str:
    hint = {
        "project": {
            "title": "string",
            "summary": "string",
            "inspired_by_style": "string",
            "recommended_scope": "string",
        },
        "detected_object": {
            "category": "string",
            "visible_parts": ["string"],
            "likely_materials": ["string"],
            "confidence": "number 0..1",
        },
        "assumptions": ["string"],
        "difficulty": "beginner | intermediate | advanced",
        "estimated_total_cost_usd": {"low": "number", "high": "number", "notes": "string"},
        "dimensions": {
            "width_in": "number",
            "depth_in": "number",
            "height_in": "number",
            "confidence": "number 0..1",
            "notes": "string",
        },
        "materials": [
            {
                "name": "string",
                "category": "string",
                "quantity": "number",
                "unit": "string",
                "estimated_unit_cost_usd": "number",
                "notes": "string",
                "store_query": "string",
                "alternatives": ["string"],
            }
        ],
        "tools": ["string"],
        "steps": [
            {
                "title": "string",
                "detail": "string",
                "estimated_minutes": "number",
                "safety_notes": "string",
            }
        ],
        "safety_checks": ["string"],
        "routing_notes": ["string"],
        "evaluation": {
            "buildability_score": "number 0..100",
            "risk_level": "low | medium | high",
            "missing_inputs": ["string"],
            "verifier_notes": ["string"],
        },
    }
    return json.dumps(hint, indent=2)
