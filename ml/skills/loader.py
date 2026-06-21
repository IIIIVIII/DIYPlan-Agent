"""Runtime skill loader — inject structured domain knowledge into VLM prompts.

Pattern inspired by community Agent Skills (e.g. YouMind ai-image-prompts-skill):
each skill is a SKILL.md plus optional references/*.json. Skills are matched by
furniture type / perception keywords and appended to perception + planner prompts.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Iterable, List

_SKILLS_ROOT = Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def _manifest() -> dict:
    path = _SKILLS_ROOT / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _text_blob(category: str, perception: dict, preferences: dict) -> str:
    parts = [
        category,
        str(preferences.get("furnitureType") or ""),
        str(preferences.get("targetSize") or ""),
        str(preferences.get("description") or ""),
        str(perception.get("category") or ""),
        str(perception.get("structure") or ""),
        str(perception.get("approx_dimensions_note") or ""),
        str(perception.get("finish_note") or ""),
        " ".join(perception.get("visible_parts") or []),
        " ".join(perception.get("likely_materials") or []),
        str(perception.get("style") or ""),
    ]
    return " ".join(parts).lower()


def _append_unique(items: List[str], new_items: Iterable[str]) -> None:
    for item in new_items:
        if item and item not in items:
            items.append(item)


def _skill_entry(skill_id: str) -> dict:
    for entry in _manifest().get("skills", []):
        if entry.get("id") == skill_id:
            return entry
    return {}


def _sort_skill_ids(skill_ids: List[str]) -> List[str]:
    return sorted(
        skill_ids,
        key=lambda sid: (
            int(_skill_entry(sid).get("priority", 1000)),
            sid,
        ),
    )


def match_skills(perception: dict | None, preferences: dict | None) -> List[str]:
    """Return skill ids whose triggers appear in the perception/preferences blob."""
    perception = perception or {}
    preferences = preferences or {}
    blob = _text_blob("", perception, preferences)
    matched: List[str] = []
    for entry in _manifest().get("skills", []):
        if entry.get("always"):
            _append_unique(matched, [entry["id"]])
            continue
        triggers = entry.get("triggers") or []
        if any(t.lower() in blob for t in triggers):
            _append_unique(matched, [entry["id"]])

    manualish = any(k in blob for k in ("manual", "instruction", "assembly", "booklet", "pdf", "ikea", "grimsarbo"))
    if manualish:
        _append_unique(
            matched,
            (
                "source-manual-grounding",
                "pdf-svg-fixture-extraction",
                "fixture-fast-path-routing",
                "assembly-ir-contract",
                "mechanical-assembly-taxonomy",
                "hardware-inventory",
                "manual-page-layout",
                "zoom-inset-detail",
                "motion-arrow-language",
                "prompt-crop-angle-control",
                "renderer-primitive-library",
                "diagram-line-art-control",
                "manual-verifier",
                "visual-regression-qa",
            ),
        )

    # Pedestal tables: load the strict source-manual and joinery/manual skills.
    ftype = str(preferences.get("furnitureType") or "").lower()
    roundish = any(k in ftype for k in ("round", "dining", "pedestal", "bistro")) or any(
        k in blob for k in ("round", "pedestal", "cross base", "column", "40 cm", "195312")
    )
    if roundish:
        _append_unique(
            matched,
            (
                "source-manual-grounding",
                "pdf-svg-fixture-extraction",
                "fixture-fast-path-routing",
                "dimension-diagram-reading",
                "hardware-inventory",
                "grimsarbo-pedestal-fixture",
                "mechanical-assembly-taxonomy",
                "leveling-foot-detail",
                "top-mount-interface",
                "pedestal-joinery",
                "ikea-manual-style",
                "renderer-primitive-library",
                "diagram-line-art-control",
                "manual-verifier",
                "visual-regression-qa",
                "finish-color-match",
            ),
        )

    return _sort_skill_ids(matched)


def _read_skill_body(rel_path: str) -> str:
    path = _SKILLS_ROOT / rel_path
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    # Strip YAML frontmatter if present
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            text = text[end + 3 :].lstrip()
    return text.strip()


def _read_references(skill_id: str) -> str:
    ref_dir = _SKILLS_ROOT / skill_id / "references"
    if not ref_dir.is_dir():
        return ""
    chunks: List[str] = []
    for path in sorted(ref_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            chunks.append(f"### {path.stem}\n{json.dumps(data, indent=2, ensure_ascii=False)}")
        except Exception:
            continue
    return "\n\n".join(chunks)


def load_skill_context(skill_ids: List[str], max_chars: int = 30000) -> str:
    """Concatenate matched skills for prompt injection."""
    if not skill_ids:
        return ""
    parts: List[str] = []
    id_to_path = {s["id"]: s["path"] for s in _manifest().get("skills", [])}
    for sid in _sort_skill_ids(skill_ids):
        rel = id_to_path.get(sid)
        if not rel:
            continue
        body = _read_skill_body(rel)
        refs = _read_references(sid)
        block = f"## Skill: {sid}\n{body}"
        if refs:
            block += f"\n\n### Reference data\n{refs}"
        parts.append(block)
    out = "\n\n---\n\n".join(parts)
    if len(out) > max_chars:
        out = out[: max_chars - 80] + "\n\n[...skill context truncated...]"
    return out


def skills_for_request(perception: dict | None, preferences: dict | None) -> dict:
    ids = match_skills(perception, preferences)
    return {
        "ids": ids,
        "context": load_skill_context(ids),
    }
