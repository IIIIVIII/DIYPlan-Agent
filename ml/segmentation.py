"""Cut real furniture parts 1:1 out of the uploaded photo.

Pipeline:
  1. GroundingDINO turns text phrases ("table leg", "table top", ...) into
     bounding boxes on the photo.
  2. SAM2 turns each box into a tight segmentation mask.
  3. Each mask is composited into a transparent PNG cutout (the real pixels of
     that part, with its real color) and returned as a data URL.

The instruction-manual renderer then places these cutouts into the exploded,
IKEA-style layout instead of drawing synthetic vector shapes, so the manual
shows the user's actual furniture.

Everything is defensive: any failure (model download, MPS op, no detection)
falls back to "no cutout" for that part, and the renderer draws the synthetic
shape instead. The app never breaks because segmentation is unavailable.
"""

from __future__ import annotations

import base64
import io
import os
from functools import lru_cache
from typing import Dict, List, Optional

from . import config

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

# Detection phrase per semantic role. Kept as simple noun phrases because
# GroundingDINO grounds short concrete nouns far better than long descriptions.
# IMPORTANT: phrases must be mutually non-substring, otherwise the matcher
# cross-assigns detections (e.g. a "table top" box landing on an apron whose
# phrase also contains "table top").
ROLE_PROMPTS: Dict[str, str] = {
    "top": "table top",
    "top_half_left": "table top",
    "top_half_right": "table top",
    "leg": "table leg",
    "apron": "apron",
    "brace": "brace",
    "foot": "foot rail",
    "connector": "metal bracket",
    "shelf": "shelf",
    "side": "side panel",
    "back": "back panel",
}

# Roles we never try to segment (they are hardware count insets, not big parts).
_SKIP_ROLES = {"fastener", "leveler", "connector"}


def _device():
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


@lru_cache(maxsize=1)
def _load_grounding():
    import torch
    from transformers import AutoProcessor, GroundingDinoForObjectDetection

    device = _device()
    processor = AutoProcessor.from_pretrained(config.GROUNDING_MODEL)
    model = (
        GroundingDinoForObjectDetection.from_pretrained(config.GROUNDING_MODEL)
        .to(device)
        .eval()
    )
    return processor, model, device


@lru_cache(maxsize=1)
def _load_sam2():
    import torch
    from transformers import Sam2Model, Sam2Processor

    device = _device()
    processor = Sam2Processor.from_pretrained(config.SAM2_MODEL)
    model = Sam2Model.from_pretrained(config.SAM2_MODEL).to(device).eval()
    return processor, model, device


def warmup() -> bool:
    """Eagerly load both models so the first request is not slow. Returns ok."""
    if not config.SEG_ENABLED:
        return False
    try:
        _load_grounding()
        _load_sam2()
        return True
    except Exception as exc:  # pragma: no cover - depends on local weights
        print(f"[segmentation] warmup failed, will fall back to shapes: {exc}")
        return False


# ---------------------------------------------------------------------------
# Detection + masking
# ---------------------------------------------------------------------------
def _detect(image, phrases: List[str]):
    """Run GroundingDINO. Returns list of {phrase, score, box:[x0,y0,x1,y1]}."""
    import torch

    processor, model, device = _load_grounding()
    # GroundingDINO wants lowercase phrases separated by " . " ending in "."
    text = " . ".join(p.strip().lower() for p in phrases) + " ."
    inputs = processor(images=image, text=text, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)
    results = processor.post_process_grounded_object_detection(
        outputs,
        input_ids=inputs.input_ids,
        threshold=config.SEG_BOX_THRESHOLD,
        text_threshold=config.SEG_TEXT_THRESHOLD,
        target_sizes=[image.size[::-1]],  # (height, width)
    )[0]

    labels = results.get("text_labels") or results.get("labels") or []
    dets = []
    for box, score, label in zip(results["boxes"], results["scores"], labels):
        dets.append(
            {
                "phrase": str(label),
                "score": float(score),
                "box": [float(v) for v in box.tolist()],
            }
        )
    return dets


def _mask_for_box(image, box) -> Optional["object"]:
    """Run SAM2 with a single box prompt. Returns a bool HxW numpy mask."""
    import numpy as np
    import torch

    processor, model, device = _load_sam2()
    inputs = processor(
        images=image,
        input_boxes=[[[float(v) for v in box]]],
        return_tensors="pt",
    ).to(device)
    with torch.no_grad():
        outputs = model(**inputs, multimask_output=False)
    masks = processor.post_process_masks(
        outputs.pred_masks.cpu(), inputs["original_sizes"]
    )[0]
    arr = masks.numpy() if hasattr(masks, "numpy") else np.asarray(masks)
    arr = np.squeeze(arr)
    if arr.ndim == 3:
        arr = arr[0]
    return arr.astype(bool)


def _cutout(image, box, mask) -> Optional[dict]:
    """Composite the masked region into a tight transparent PNG data URL."""
    import numpy as np
    from PIL import Image

    rgba = image.convert("RGBA")
    data = np.array(rgba)
    h, w = data.shape[:2]
    if mask is None or mask.shape[:2] != (h, w):
        # Fall back to a rectangular crop if the mask is unusable.
        mask = np.zeros((h, w), dtype=bool)
        x0, y0, x1, y1 = [int(round(v)) for v in box]
        mask[max(0, y0):min(h, y1), max(0, x0):min(w, x1)] = True

    ys, xs = np.where(mask)
    if ys.size == 0:
        return None
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1

    data[..., 3] = np.where(mask, 255, 0)
    crop = data[y0:y1, x0:x1]
    out = Image.fromarray(crop, mode="RGBA")
    # Keep cutouts reasonably small for transport.
    max_side = 320
    if max(out.size) > max_side:
        scale = max_side / max(out.size)
        out = out.resize(
            (max(1, int(out.width * scale)), max(1, int(out.height * scale))),
            Image.LANCZOS,
        )
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return {
        "image": f"data:image/png;base64,{b64}",
        "img_w": out.width,
        "img_h": out.height,
        "box": [x0, y0, x1, y1],
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def cutouts_for_parts(image_path: str, parts: List[dict]) -> Dict[str, dict]:
    """Map each render part id -> cutout dict, for parts we can detect.

    `parts` is a list of {id, role} (the renderer parts). Parts whose role is
    not detectable, or that get no detection, are simply omitted (renderer
    draws the synthetic shape for those).
    """
    if not config.SEG_ENABLED or not image_path:
        return {}
    try:
        from PIL import Image

        image = Image.open(image_path).convert("RGB")
    except Exception as exc:
        print(f"[segmentation] could not open image: {exc}")
        return {}

    # Group parts by role, preserving order, skipping non-detectable roles.
    roles: Dict[str, List[str]] = {}
    for p in parts:
        role = p.get("role") or ""
        if role in _SKIP_ROLES or role not in ROLE_PROMPTS:
            continue
        roles.setdefault(role, []).append(p["id"])
    if not roles:
        return {}

    phrases = sorted({ROLE_PROMPTS[r] for r in roles})
    try:
        dets = _detect(image, phrases)
    except Exception as exc:
        print(f"[segmentation] detection failed: {exc}")
        return {}

    # Bucket each detection under the most specific phrase it matches. We must
    # NOT use loose word overlap here: "table top" and "table leg" share the
    # word "table", which would cross-assign tabletops to legs.
    by_phrase: Dict[str, List[dict]] = {ph: [] for ph in phrases}
    for det in dets:
        dphrase = det["phrase"].lower().strip()
        best = None
        for ph in phrases:
            if ph in dphrase or dphrase in ph:
                if best is None or len(ph) > len(best):
                    best = ph
        if best is not None:
            by_phrase[best].append(det)

    result: Dict[str, dict] = {}
    for role, part_ids in roles.items():
        phrase = ROLE_PROMPTS[role]
        boxes = sorted(by_phrase.get(phrase, []), key=lambda d: -d["score"])
        result.update(_assign_role(image, role, part_ids, boxes))
    return result


def _assign_role(image, role, part_ids, boxes) -> Dict[str, dict]:
    """Assign detected boxes to the part ids of a single role."""
    out: Dict[str, dict] = {}
    n_parts = len(part_ids)

    # Split a single wide tabletop detection into left/right halves. Prefer the
    # flattest, widest box (the actual slab) over a whole-table detection.
    if role in {"top_half_left", "top_half_right"} and boxes:
        def _flatness(d):
            bx = d["box"]
            w = max(1.0, bx[2] - bx[0])
            h = max(1.0, bx[3] - bx[1])
            return w / h

        box = max(boxes, key=_flatness)["box"]
        x0, y0, x1, y1 = box
        mid = (x0 + x1) / 2
        half = [x0, y0, mid, y1] if role.endswith("left") else [mid, y0, x1, y1]
        cut = _safe_cutout(image, half)
        if cut:
            out[part_ids[0]] = cut
        return out

    # Sort multiple boxes spatially so leg_fl/leg_fr/... line up left->right,
    # shelves top->bottom.
    if role in {"shelf"}:
        boxes = sorted(boxes, key=lambda d: d["box"][1])
    else:
        boxes = sorted(boxes, key=lambda d: d["box"][0])

    for pid, det in zip(part_ids, boxes[:n_parts]):
        cut = _safe_cutout(image, det["box"])
        if cut:
            out[pid] = cut
    return out


def dominant_color(image_path: str) -> Optional[str]:
    """Rough dominant color of the object, as a #rrggbb hex string.

    Used to tint synthetic shapes (parts we could not cut out) so the whole
    manual reads in the real object's color family.
    """
    if not image_path:
        return None
    try:
        import numpy as np
        from PIL import Image

        img = Image.open(image_path).convert("RGB")
        img.thumbnail((96, 96))
        data = np.asarray(img).reshape(-1, 3).astype(float)
        # Drop near-white background and near-black shadow pixels.
        brightness = data.mean(axis=1)
        keep = (brightness > 35) & (brightness < 232)
        if keep.sum() > 50:
            data = data[keep]

        # Bias toward the painted / vivid colour of the object (e.g. a red base)
        # rather than the flat average, which would wash out into a muddy grey.
        mx = data.max(axis=1)
        mn = data.min(axis=1)
        sat = (mx - mn) / (mx + 1e-6)  # 0 (grey) .. 1 (vivid)
        if sat.max() > 0.18:
            weight = sat ** 2
        else:
            weight = np.ones(len(data))  # near-greyscale object: plain mean
        weight = weight / weight.sum()
        r, g, b = (int(round(v)) for v in (data * weight[:, None]).sum(axis=0))
        return f"#{r:02x}{g:02x}{b:02x}"
    except Exception:
        return None


def _safe_cutout(image, box) -> Optional[dict]:
    try:
        mask = _mask_for_box(image, box)
    except Exception as exc:
        print(f"[segmentation] SAM2 failed for box {box}: {exc}")
        mask = None
    try:
        return _cutout(image, box, mask)
    except Exception as exc:
        print(f"[segmentation] cutout failed: {exc}")
        return None
