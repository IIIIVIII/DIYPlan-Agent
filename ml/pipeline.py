"""End-to-end local agent pipeline: perception -> retrieval -> planning.

Returns a payload shaped for the Node planner: a `plan` that validates against
the shared schema, plus `stages`, `retrieval`, `perception`, and `metrics` for
the agent workflow console and the routing benchmark.
"""

from __future__ import annotations

import json
import re
import time
from typing import List, Optional, Tuple

from . import config
from .schemas import Perception, Plan

_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def generate(payload: dict) -> dict:
    preferences = payload.get("preferences", {}) or {}
    image_data_url = payload.get("imageDataUrl") or ""
    started = time.perf_counter()
    stages: List[dict] = []

    if config.MOCK_MODE:
        return _mock_response(preferences, stages, started)

    return _live_response(preferences, image_data_url, stages, started)


# ---------------------------------------------------------------------------
# Live (model-backed) path
# ---------------------------------------------------------------------------
def _live_response(preferences: dict, image_data_url: str, stages: List[dict], started: float) -> dict:
    from . import models
    from .rag.store import get_store
    from . import prompts

    image_path = models.data_url_to_tempfile(image_data_url) if image_data_url else None

    # Stage 1: perception (VLM)
    t0 = time.perf_counter()
    perception = _run_perception(models, prompts, preferences, image_path)
    stages.append(_stage("image-understanding", config.VLM_MODEL, "Vision-language model parsed the reference image.", t0))

    # Stage 2: retrieval (embeddings + vector store)
    t0 = time.perf_counter()
    query = _retrieval_query(perception, preferences)
    retrieved = get_store().retrieve(query, top_k=config.RETRIEVAL_TOP_K)
    stages.append(_stage("knowledge-retrieval", config.EMBED_MODEL, f"Retrieved {len(retrieved)} DIY knowledge snippets.", t0))

    # Stage 3: planning (constrained text LLM if configured, else VLM)
    t0 = time.perf_counter()
    plan_prompt = prompts.planner_prompt(preferences, perception, retrieved)
    plan, plan_model = _run_planning(models, plan_prompt, image_path)
    stages.append(_stage("plan-generation", plan_model, "Structured plan generated and schema-validated.", t0))

    return {
        "mode": "local-mlx",
        "plan": plan.model_dump(),
        "perception": perception,
        "retrieval": retrieved,
        "stages": stages,
        "metrics": {
            "model": config.model_label(),
            "backend": "mlx",
            "local_latency_ms": int((time.perf_counter() - started) * 1000),
        },
    }


def _run_perception(models, prompts, preferences: dict, image_path: Optional[str]) -> dict:
    prompt = prompts.perception_prompt(preferences)
    text = models.vlm_generate(prompt, image_path)
    data = _parse_json(text)
    if data is not None:
        try:
            return Perception(**_coerce_perception(data)).model_dump()
        except Exception:
            pass
    # Soft fallback: keep the pipeline moving even if perception JSON is messy.
    return Perception(
        category=str(preferences.get("furnitureType") or "side table"),
        visible_parts=["top", "legs or sides", "supports"],
        likely_materials=["wood board", "screws", "glue", "finish"],
        style="simple modern wood furniture",
        approx_dimensions_note="dimensions not confidently read from image",
        risk_level="low",
        confidence=0.4 if image_path else 0.2,
    ).model_dump()


def _run_planning(models, plan_prompt: str, image_path: Optional[str]) -> Tuple[Plan, str]:
    use_text_llm = bool(config.PLANNER_MODEL)
    last_error: Optional[str] = None

    for attempt in range(config.JSON_REPAIR_RETRIES + 1):
        prompt = plan_prompt if attempt == 0 else _repair_prompt(plan_prompt, last_error)
        if use_text_llm:
            text = models.text_generate_structured(prompt, Plan)
            model_name = config.PLANNER_MODEL
        else:
            text = models.vlm_generate(prompt, image_path)
            model_name = config.VLM_MODEL
        data = _parse_json(text)
        if data is not None:
            try:
                return Plan(**data), model_name
            except Exception as exc:  # validation failed -> repair
                last_error = str(exc)[:600]
        else:
            last_error = "Output was not valid JSON."

    raise ValueError(f"Local planner could not produce schema-valid JSON: {last_error}")


# ---------------------------------------------------------------------------
# Mock path (no model download)
# ---------------------------------------------------------------------------
def _mock_response(preferences: dict, stages: List[dict], started: float) -> dict:
    from .rag.store import keyword_retrieve

    perception = Perception(
        category=str(preferences.get("furnitureType") or "side table"),
        visible_parts=["top panel", "side supports", "lower shelf"],
        likely_materials=["pine board", "wood screws", "wood glue", "polyurethane"],
        style="clean modern wood furniture",
        approx_dimensions_note="mock perception: no model loaded",
        risk_level="low",
        confidence=0.5,
    ).model_dump()
    stages.append(_stage("image-understanding", "local-mlx-mock", "Mock perception (no VLM loaded).", started))

    query = _retrieval_query(perception, preferences)
    retrieved = keyword_retrieve(query, top_k=config.RETRIEVAL_TOP_K)
    stages.append(_stage("knowledge-retrieval", "keyword-mock", f"Keyword-matched {len(retrieved)} snippets.", started))

    plan = _mock_plan(preferences)
    stages.append(_stage("plan-generation", "local-mlx-mock", "Deterministic mock plan (schema-validated).", started))

    return {
        "mode": "local-mlx-mock",
        "plan": plan.model_dump(),
        "perception": perception,
        "retrieval": retrieved,
        "stages": stages,
        "metrics": {
            "model": "local-mlx-mock",
            "backend": "mock",
            "local_latency_ms": int((time.perf_counter() - started) * 1000),
        },
    }


def _mock_plan(preferences: dict) -> Plan:
    furniture = str(preferences.get("furnitureType") or "side table")
    return Plan(
        project={
            "title": f"Simplified {furniture.title()} Build",
            "summary": "A beginner-friendly, inspired-by build using common boards and square joinery.",
            "inspired_by_style": "clean modern wood furniture with visible grain",
            "recommended_scope": "Build a simplified form rather than copying the reference exactly.",
        },
        detected_object={
            "category": furniture,
            "visible_parts": ["top panel", "side supports", "lower shelf"],
            "likely_materials": ["pine board", "wood screws", "wood glue", "polyurethane"],
            "confidence": 0.5,
        },
        assumptions=[
            "The image is visual inspiration, not a technical drawing.",
            "Final dimensions are measured before cutting.",
        ],
        difficulty="beginner",
        estimated_total_cost_usd={"low": 55, "high": 115, "notes": "Common pine boards and basic finish."},
        dimensions={
            "width_in": 24,
            "depth_in": 18,
            "height_in": 24,
            "confidence": 0.45,
            "notes": preferences.get("targetSize") or "Default compact side-table size.",
        },
        materials=[
            {
                "name": "select pine board 1x12",
                "category": "lumber",
                "quantity": 2,
                "unit": "8 ft board",
                "estimated_unit_cost_usd": 18,
                "notes": "Top, lower shelf, and side panels.",
                "store_query": "select pine board 1x12",
                "alternatives": ["3/4 inch plywood project panel", "edge-glued pine panel"],
            },
            {
                "name": "wood screws 1-1/4 inch",
                "category": "fastener",
                "quantity": 1,
                "unit": "box",
                "estimated_unit_cost_usd": 8,
                "notes": "Pre-drill to avoid splitting.",
                "store_query": "wood screws 1-1/4 inch",
                "alternatives": ["pocket hole screws"],
            },
            {
                "name": "water based polyurethane satin",
                "category": "finish",
                "quantity": 1,
                "unit": "quart",
                "estimated_unit_cost_usd": 22,
                "notes": "Two to three thin coats.",
                "store_query": "water based polyurethane satin",
                "alternatives": ["wipe-on polyurethane"],
            },
        ],
        tools=["tape measure", "saw", "drill", "sander", "clamps", "square"],
        steps=[
            {"title": "Confirm dimensions", "detail": "Mark a cut list from final width, depth, and height.", "estimated_minutes": 20, "safety_notes": "Measure twice before cutting."},
            {"title": "Cut panels", "detail": "Cut top, shelf, and side pieces.", "estimated_minutes": 45, "safety_notes": "Wear eye protection; clamp work."},
            {"title": "Glue and screw", "detail": "Glue joints, pre-drill, and fasten.", "estimated_minutes": 50, "safety_notes": "Keep hands clear of the drill path."},
            {"title": "Sand and finish", "detail": "Sand through grits and apply thin finish coats.", "estimated_minutes": 80, "safety_notes": "Finish in a ventilated space."},
        ],
        safety_checks=[
            "Light household use only unless a structural design is verified.",
            "No electrical components in this scope.",
            "Round or sand sharp edges before use.",
        ],
        routing_notes=[
            "Mock plan from the local backend; swap to a loaded VLM for real perception.",
            "Material matching and verification stay on local rules.",
        ],
        evaluation={
            "buildability_score": 78,
            "risk_level": "low",
            "missing_inputs": [],
            "verifier_notes": ["Mock plan is generic because no model was loaded."],
        },
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _retrieval_query(perception: dict, preferences: dict) -> str:
    parts = [
        perception.get("category", ""),
        " ".join(perception.get("likely_materials", [])),
        preferences.get("skillLevel", ""),
        "joinery dimensions safety cost",
    ]
    return " ".join(p for p in parts if p).strip() or "diy furniture build"


def _parse_json(text: str) -> Optional[dict]:
    if not text:
        return None
    cleaned = text.strip()
    # Strip markdown code fences if present.
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        match = _JSON_BLOCK_RE.search(cleaned)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                return None
    return None


def _coerce_perception(data: dict) -> dict:
    risk = str(data.get("risk_level", "low")).lower()
    if risk not in {"low", "medium", "high"}:
        risk = "low"
    data["risk_level"] = risk
    try:
        data["confidence"] = max(0.0, min(1.0, float(data.get("confidence", 0.4))))
    except Exception:
        data["confidence"] = 0.4
    for key in ("visible_parts", "likely_materials"):
        if not isinstance(data.get(key), list):
            data[key] = [str(data.get(key))] if data.get(key) else []
    return data


def _repair_prompt(base: str, error: Optional[str]) -> str:
    return (
        f"{base}\n\n"
        f"Your previous answer failed validation: {error}\n"
        "Return ONLY a corrected JSON object that fixes the issue. No prose."
    )


def _stage(name: str, model: str, note: str, since: float) -> dict:
    return {
        "name": name,
        "model": model,
        "note": note,
        "latency_ms": int((time.perf_counter() - since) * 1000),
    }
