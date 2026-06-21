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


def perception_prompt(preferences: dict) -> str:
    schema_hint = {
        "category": "string (e.g. side table, round dining table, bookshelf)",
        "visible_parts": ["string"],
        "likely_materials": ["string"],
        "style": "string",
        "approx_dimensions_note": "string",
        "risk_level": "low | medium | high",
        "confidence": "number 0..1",
    }
    return (
        f"{PERCEPTION_SYSTEM}\n\n"
        f"User says the furniture type may be: {preferences.get('furnitureType') or 'unknown'}.\n"
        "Identify the object, its visible structural parts, likely materials, "
        "style, a rough size note, and a safety risk level.\n\n"
        "Return JSON exactly in this shape:\n"
        f"{json.dumps(schema_hint, indent=2)}"
    )


def planner_prompt(preferences: dict, perception: dict, retrieved: List[dict]) -> str:
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
    return (
        f"{PLANNER_SYSTEM}\n\n"
        "Image understanding result:\n"
        f"{perception_text}\n\n"
        "User constraints:\n"
        f"{json.dumps(constraints, indent=2)}\n\n"
        "Relevant DIY knowledge (use it; do not contradict it):\n"
        f"{knowledge}\n\n"
        "Requirements:\n"
        "- Produce a safer, simplified, inspired-by DIY version.\n"
        "- Prefer low-risk categories (side tables, coffee tables, shelves, nightstands, round tables).\n"
        "- Use real dressed lumber dimensions and realistic US prices.\n"
        "- Keep the itemized material total within the low/high estimate.\n"
        "- Fill every field.\n\n"
        "Return JSON exactly in this shape (types shown, not values):\n"
        f"{schema_hint}"
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
