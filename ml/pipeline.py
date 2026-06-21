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
from .instruction_layout import build_instruction_model
from .schemas import InstructionSpec, Perception, Plan

_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def generate(payload: dict) -> dict:
    preferences = payload.get("preferences", {}) or {}
    image_data_urls = payload.get("imageDataUrls") or []
    if not image_data_urls and payload.get("imageDataUrl"):
        image_data_urls = [payload["imageDataUrl"]]
    started = time.perf_counter()
    stages: List[dict] = []

    if config.MOCK_MODE:
        return _mock_response(preferences, stages, started)

    return _live_response(preferences, image_data_urls, stages, started)


# ---------------------------------------------------------------------------
# Live (model-backed) path
# ---------------------------------------------------------------------------
def _live_response(preferences: dict, image_data_urls, stages: List[dict], started: float) -> dict:
    from . import models
    from .rag.store import get_store
    from . import prompts

    image_paths = [
        p
        for p in (models.data_url_to_tempfile(u) for u in image_data_urls)
        if p
    ]
    # The first/clearest photo is used for the 1:1 part cutouts; all photos
    # feed perception so more angles give more detail.
    image_path = image_paths[0] if image_paths else None

    # Stage 1: perception (VLM, multi-image when several photos are uploaded)
    t0 = time.perf_counter()
    perception = _run_perception(models, prompts, preferences, image_paths)
    stages.append(
        _stage(
            "image-understanding",
            config.VLM_MODEL,
            f"Vision-language model parsed {len(image_paths) or 0} reference photo(s).",
            t0,
        )
    )

    # Stage 2: retrieval (embeddings + vector store)
    t0 = time.perf_counter()
    query = _retrieval_query(perception, preferences)
    retrieved = get_store().retrieve(query, top_k=config.RETRIEVAL_TOP_K)
    stages.append(_stage("knowledge-retrieval", config.EMBED_MODEL, f"Retrieved {len(retrieved)} DIY knowledge snippets.", t0))

    # Stage 3: planning (constrained text LLM if configured, else VLM)
    t0 = time.perf_counter()
    plan_prompt = prompts.planner_prompt(preferences, perception, retrieved)
    plan, plan_model = _run_planning(models, plan_prompt, image_path, preferences, perception)
    stages.append(_stage("plan-generation", plan_model, "Structured plan generated and schema-validated.", t0))

    # Stage 4: segment the real parts 1:1 from the photo. We do NOT build the
    # manual layout here -- the Node side owns the IKEA-style template the user
    # asked us to keep. We just return cutouts grouped by role so Node can drop
    # each real part into the matching slot of its template.
    t0 = time.perf_counter()
    spec = _fallback_instruction_spec(perception, preferences)
    seg_template = build_instruction_model(spec)
    cut_map, tint = _compute_cutouts(seg_template, image_path)
    part_cutouts = _group_cutouts_by_role(seg_template, cut_map)
    n_cut = len(cut_map)
    stages.append(
        _stage(
            "part-segmentation",
            f"{config.GROUNDING_MODEL.split('/')[-1]}+sam2",
            f"Cut {n_cut} real parts 1:1 from the photo."
            if n_cut
            else "No clean parts segmented; manual uses simplified shapes.",
            t0,
        )
    )

    return {
        "mode": "local-mlx",
        "plan": plan.model_dump(),
        "perception": perception,
        "retrieval": retrieved,
        "part_cutouts": part_cutouts,
        "dominant_color": tint,
        "stages": stages,
        "metrics": {
            "model": config.model_label(),
            "backend": "mlx",
            "local_latency_ms": int((time.perf_counter() - started) * 1000),
        },
    }


def _compute_cutouts(seg_template: dict, image_path: Optional[str]):
    """Return (id->cutout map, dominant_color) for the photo, or ({}, None)."""
    if not image_path:
        return {}, None
    try:
        from . import segmentation
    except Exception as exc:  # torch/transformers not available
        print(f"[pipeline] segmentation unavailable: {exc}")
        return {}, None

    parts = seg_template.get("parts", [])
    spec_parts = [{"id": p["id"], "role": p.get("role", "")} for p in parts]
    cut_map = segmentation.cutouts_for_parts(image_path, spec_parts)
    tint = segmentation.dominant_color(image_path)
    return cut_map, tint


def _group_cutouts_by_role(seg_template: dict, cut_map: dict) -> dict:
    """Group cutouts by part role, in the spatial order they were assigned.

    Node maps these role buckets onto its own IKEA-style template slots, so the
    real parts land in the right place regardless of differing part ids.
    """
    groups: dict = {}
    for part in seg_template.get("parts", []):
        cut = cut_map.get(part["id"])
        if not cut:
            continue
        role = part.get("role", "")
        groups.setdefault(role, []).append(
            {"image": cut["image"], "img_w": cut["img_w"], "img_h": cut["img_h"]}
        )
    return groups


def _run_perception(models, prompts, preferences: dict, image_paths) -> dict:
    if isinstance(image_paths, str) or image_paths is None:
        image_paths = [image_paths] if image_paths else []
    prompt = prompts.perception_prompt(preferences)
    text = models.vlm_generate(prompt, image_paths if image_paths else None)
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
        confidence=0.4 if image_paths else 0.2,
    ).model_dump()


def translate_texts(texts: List[str], target_lang: str) -> List[str]:
    """Translate a list of UI/plan strings into the target language.

    Used by the /translate endpoint so the user can switch the language of an
    already-generated plan. Returns a list aligned with the input; on any
    failure it returns the inputs unchanged so the UI never breaks.
    """
    texts = [str(t) for t in (texts or [])]
    if not texts:
        return []
    lang_name = {"zh": "Simplified Chinese", "en": "English"}.get(
        target_lang, target_lang or "English"
    )
    if config.MOCK_MODE:
        return texts

    from . import models, prompts

    try:
        prompt = prompts.translation_prompt(texts, lang_name)
        out = models.vlm_generate(prompt, None)
        data = _parse_json(out)
        items = None
        if isinstance(data, dict):
            items = data.get("translations") or data.get("items")
        elif isinstance(data, list):
            items = data
        if isinstance(items, list) and len(items) == len(texts):
            return [str(x) for x in items]
    except Exception as exc:
        print(f"[pipeline] translation failed: {exc}")
    return texts


def _run_planning(
    models, plan_prompt: str, image_path: Optional[str], preferences: dict, perception: dict
) -> Tuple[Plan, str]:
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

    # The VLM occasionally emits malformed JSON. Rather than failing the whole
    # request (which would also throw away the good perception + segmentation),
    # fall back to a deterministic plan so the manual and cutouts still render.
    print(f"[pipeline] plan JSON failed, using deterministic fallback: {last_error}")
    prefs = dict(preferences)
    if not prefs.get("furnitureType") or prefs.get("furnitureType") == "auto":
        prefs["furnitureType"] = (perception or {}).get("category") or "side table"
    return _mock_plan(prefs), "local-mlx-plan-fallback"


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

    spec = _fallback_instruction_spec(perception, preferences)
    instruction_model = build_instruction_model(spec)
    stages.append(
        _stage(
            "instruction-manual",
            "local-mlx-mock",
            f"Mock manual: {len(spec.parts)} parts across {len(spec.steps)} steps.",
            started,
        )
    )

    return {
        "mode": "local-mlx-mock",
        "plan": plan.model_dump(),
        "perception": perception,
        "retrieval": retrieved,
        "instruction_model": instruction_model,
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
_PALETTE = [
    "#c9853f", "#a9613a", "#d8a35a", "#8c7a5b", "#b5703a",
    "#7d8a9a", "#9a5b3c", "#caa46a", "#6f5a44", "#b98a55",
]


def _fallback_instruction_spec(perception: dict, preferences: dict) -> InstructionSpec:
    """Build a sensible manual from perception when the model JSON is unusable.

    Covers the common table and shelf topologies so there is always a
    color-coded, step-wise manual to render.
    """
    category = str(
        (perception or {}).get("category") or preferences.get("furnitureType") or "side table"
    ).lower()
    is_shelf = any(k in category for k in ("shelf", "bookcase", "bookshelf"))
    is_round = any(k in category for k in ("round", "dining"))

    parts = []
    steps = []

    def color(i):
        return _PALETTE[i % len(_PALETTE)]

    if is_shelf:
        parts += [
            {"id": "side_l", "label": "Left upright", "role": "side", "shape": "panel", "color": color(0)},
            {"id": "side_r", "label": "Right upright", "role": "side", "shape": "panel", "color": color(1)},
        ]
        for i in range(3):
            parts.append({"id": f"shelf_{i}", "label": f"Shelf {i + 1}", "role": "shelf", "shape": "panel", "color": color(2 + i)})
        parts.append({"id": "back", "label": "Back panel", "role": "back", "shape": "panel", "color": color(6)})
        steps = [
            {"title": "Step 1 - Stand the uprights", "action": "Set the two side uprights parallel.", "add_parts": ["side_l", "side_r"]},
            {"title": "Step 2 - Add the shelves", "action": "Slide each shelf between the uprights and fasten.", "add_parts": ["shelf_0", "shelf_1", "shelf_2"], "hardware": [{"name": "wood screws", "count": 12}]},
            {"title": "Step 3 - Attach the back", "action": "Square the frame and nail on the back panel.", "add_parts": ["back"], "hardware": [{"name": "panel nails", "count": 8}]},
        ]
        return InstructionSpec(object_type=category, topology="shelf", parts=_mk_parts(parts), steps=_mk_steps(steps))

    # Table topology
    if is_round:
        parts += [
            {"id": "top_l", "label": "Left tabletop half", "role": "top_half_left", "shape": "round_half", "color": color(0)},
            {"id": "top_r", "label": "Right tabletop half", "role": "top_half_right", "shape": "round_half", "color": color(0)},
            {"id": "conn", "label": "Seam connector", "role": "connector", "shape": "bracket", "color": "#7d8a9a"},
        ]
        first_step = {"title": "Step 1 - Join tabletop halves", "action": "Slide the two halves together and lock the seam connectors.", "add_parts": ["top_l", "top_r", "conn"], "hardware": [{"name": "seam connector", "count": 2}]}
    else:
        parts += [{"id": "top", "label": "Tabletop", "role": "top", "shape": "panel", "color": color(0)}]
        first_step = {"title": "Step 1 - Prepare the top", "action": "Lay the tabletop face down on a padded surface.", "add_parts": ["top"]}

    parts += [
        {"id": "apron_f", "label": "Front apron", "role": "apron", "shape": "rail", "color": color(3)},
        {"id": "apron_b", "label": "Back apron", "role": "apron", "shape": "rail", "color": color(3)},
        {"id": "apron_l", "label": "Left apron", "role": "apron", "shape": "rail", "color": color(4)},
        {"id": "apron_r", "label": "Right apron", "role": "apron", "shape": "rail", "color": color(4)},
        {"id": "leg_fl", "label": "Front-left leg", "role": "leg", "shape": "leg", "color": color(5)},
        {"id": "leg_fr", "label": "Front-right leg", "role": "leg", "shape": "leg", "color": color(5)},
        {"id": "leg_bl", "label": "Back-left leg", "role": "leg", "shape": "leg", "color": color(6)},
        {"id": "leg_br", "label": "Back-right leg", "role": "leg", "shape": "leg", "color": color(6)},
        {"id": "brace_a", "label": "Cross brace A", "role": "brace", "shape": "rail", "color": color(7)},
        {"id": "brace_b", "label": "Cross brace B", "role": "brace", "shape": "rail", "color": color(7)},
    ]
    steps = [
        first_step,
        {"title": "Step 2 - Attach the apron frame", "action": "Screw the four apron rails into a rectangle under the top.", "add_parts": ["apron_f", "apron_b", "apron_l", "apron_r"], "hardware": [{"name": "wood screws", "count": 8}]},
        {"title": "Step 3 - Fit the four legs", "action": "Bolt a leg into each corner of the apron frame.", "add_parts": ["leg_fl", "leg_fr", "leg_bl", "leg_br"], "hardware": [{"name": "leg bolts", "count": 4}]},
        {"title": "Step 4 - Tighten the cross brace", "action": "Install the lower X brace and tighten evenly.", "add_parts": ["brace_a", "brace_b"], "hardware": [{"name": "bolts", "count": 4}]},
    ]
    return InstructionSpec(object_type=category, topology="table", parts=_mk_parts(parts), steps=_mk_steps(steps))


def _mk_parts(rows):
    out = []
    for r in rows:
        r.setdefault("quantity", 1)
        r.setdefault("material_name", "")
        r.setdefault("cut_size", "")
        out.append(r)
    return out


def _mk_steps(rows):
    for r in rows:
        r.setdefault("hardware", [])
        r.setdefault("note", "")
    return rows


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
