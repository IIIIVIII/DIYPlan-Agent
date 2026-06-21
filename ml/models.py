"""Lazy MLX model loaders and generation helpers.

The VLM is loaded once and reused. We keep the wrapper defensive about
mlx-vlm's evolving return signatures (string vs result object) so version
bumps do not break the service.

In mock mode none of this is imported, so the service runs with zero model
downloads.
"""

from __future__ import annotations

import base64
import re
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Optional, Tuple

from . import config

_DATA_URL_RE = re.compile(r"^data:image/(?P<ext>[a-zA-Z0-9.+-]+);base64,(?P<data>.+)$", re.DOTALL)


def data_url_to_tempfile(data_url: str) -> Optional[str]:
    """Decode a data:image/...;base64 URL into a temp file path."""
    match = _DATA_URL_RE.match(data_url or "")
    if not match:
        return None
    ext = match.group("ext").lower()
    if ext == "jpeg":
        ext = "jpg"
    if ext not in {"png", "jpg", "webp", "gif"}:
        ext = "png"
    raw = base64.b64decode(match.group("data"))
    tmp = tempfile.NamedTemporaryFile(
        prefix="diyplan-", suffix=f".{ext}", delete=False
    )
    tmp.write(raw)
    tmp.flush()
    tmp.close()
    return tmp.name


@lru_cache(maxsize=1)
def load_vlm() -> Tuple[object, object, object]:
    """Load the vision-language model, processor, and its config once."""
    from mlx_vlm import load
    from mlx_vlm.utils import load_config

    model, processor = load(config.VLM_MODEL)
    try:
        model_config = load_config(config.VLM_MODEL)
    except Exception:
        model_config = getattr(model, "config", None)
    return model, processor, model_config


def vlm_generate(prompt: str, image_path=None) -> str:
    """Run a single VLM generation and return decoded text.

    `image_path` may be a single path, a list of paths (multi-image grounding
    for more detail), or None for a text-only call (e.g. translation).
    """
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import apply_chat_template

    model, processor, model_config = load_vlm()

    if isinstance(image_path, (list, tuple)):
        images = [p for p in image_path if p]
    elif image_path:
        images = [image_path]
    else:
        images = []
    num_images = len(images)

    try:
        formatted = apply_chat_template(
            processor, model_config, prompt, num_images=num_images
        )
    except TypeError:
        # Older signature without num_images.
        formatted = apply_chat_template(processor, model_config, prompt)

    result = generate(
        model,
        processor,
        formatted,
        image=images,
        max_tokens=config.MAX_TOKENS,
        temperature=config.TEMPERATURE,
        verbose=False,
    )
    return _result_to_text(result)


@lru_cache(maxsize=1)
def load_text_llm():
    """Load the optional text-only planner model for constrained decoding."""
    import mlx_lm

    return mlx_lm.load(config.PLANNER_MODEL)


def text_generate_structured(prompt: str, schema_model) -> str:
    """Constrained JSON generation via Outlines + mlx-lm.

    Falls back to plain mlx-lm generation if Outlines is unavailable; the
    caller still validates and repairs the result.
    """
    model_tuple = load_text_llm()
    try:
        import outlines

        model = outlines.from_mlxlm(*model_tuple)
        return model(prompt, output_type=schema_model)
    except Exception:
        import mlx_lm

        llm, tokenizer = model_tuple
        return mlx_lm.generate(
            llm,
            tokenizer,
            prompt=prompt,
            max_tokens=config.MAX_TOKENS,
            verbose=False,
        )


def _result_to_text(result) -> str:
    if isinstance(result, str):
        return result
    for attr in ("text", "output", "generation"):
        value = getattr(result, attr, None)
        if isinstance(value, str):
            return value
    # Some versions return (text, usage) tuples.
    if isinstance(result, (tuple, list)) and result and isinstance(result[0], str):
        return result[0]
    return str(result)
