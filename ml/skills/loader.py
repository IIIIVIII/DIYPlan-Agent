"""Runtime skill loader — inject structured domain knowledge into VLM prompts.

Pattern inspired by community Agent Skills (e.g. YouMind ai-image-prompts-skill):
each skill is a SKILL.md plus optional references/*.json. Skills are matched by
furniture type / perception keywords and appended to perception + planner prompts.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import List

_SKILLS_ROOT = Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def _manifest() -> dict:
    path = _SKILLS_ROOT / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _text_blob(category: str, perception: dict, preferences: dict) -> str:
    parts = [
        str(preferences.get("furnitureType") or ""),
        str(perception.get("category") or ""),
        str(perception.get("structure") or ""),
        " ".join(perception.get("visible_parts") or []),
        " ".join(perception.get("likely_materials") or []),
        str(perception.get("style") or ""),
    ]
    return " ".join(parts).lower()


def match_skills(perception: dict | None, preferences: dict | None) -> List[str]:
    """Return skill ids whose triggers appear in the perception/preferences blob."""
    perception = perception or {}
    preferences = preferences or {}
    blob = _text_blob("", perception, preferences)
    matched: List[str] = []
    for entry in _manifest().get("skills", []):
        triggers = entry.get("triggers") or []
        if any(t.lower() in blob for t in triggers):
            matched.append(entry["id"])
    # Pedestal tables: always load joinery + finish skills when round/dining selected
    ftype = str(preferences.get("furnitureType") or "").lower()
    if any(k in ftype for k in ("round", "dining", "pedestal", "bistro")):
        for sid in ("pedestal-joinery", "finish-color-match", "ikea-manual-style"):
            if sid not in matched:
                matched.append(sid)
    return matched


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


def load_skill_context(skill_ids: List[str], max_chars: int = 12000) -> str:
    """Concatenate matched skills for prompt injection."""
    if not skill_ids:
        return ""
    parts: List[str] = []
    id_to_path = {s["id"]: s["path"] for s in _manifest().get("skills", [])}
    for sid in skill_ids:
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
