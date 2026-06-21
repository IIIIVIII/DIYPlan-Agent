"""Central configuration for the local ML backend.

Every knob is environment-driven so the same code runs in three modes:

- mock      : no models loaded, deterministic output (great for wiring/tests)
- vlm       : one MLX vision-language model does perception + planning
- vlm+llm   : VLM for perception, separate constrained text LLM for planning

Defaults are tuned for an M3 Pro with 18 GB of unified memory, which is why
the 4-bit 4B-class models are chosen: they leave headroom for the embedding
model and the OS while still giving usable quality.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
LANCE_DIR = DATA_DIR / "lancedb"
KNOWLEDGE_FILE = ROOT / "rag" / "knowledge.jsonl"


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# When true, no MLX/torch model is loaded; the service returns a deterministic
# plan. This mirrors the Node app's "mock mode" so the full pipeline can be
# exercised without downloading several GB of weights.
MOCK_MODE = _flag("DIYPLAN_ML_MOCK", default=False)

# Host/port for the FastAPI service. The Node server talks to this.
HOST = os.environ.get("DIYPLAN_ML_HOST", "127.0.0.1")
PORT = int(os.environ.get("DIYPLAN_ML_PORT", "8000"))

# --- Model selection (Hugging Face mlx-community repo ids) ---
# 4B-4bit is the recommended sweet spot for 18 GB. Bump to the 8B-4bit repo
# if you have >= 32 GB and want higher quality.
VLM_MODEL = os.environ.get(
    "DIYPLAN_VLM_MODEL", "mlx-community/Qwen3-VL-4B-Instruct-4bit"
)

# Optional separate text LLM for the constrained-decoding planning path.
# Leave PLANNER_MODEL empty to reuse the VLM for planning (saves memory).
PLANNER_MODEL = os.environ.get("DIYPLAN_PLANNER_MODEL", "").strip()

# --- Part segmentation (GroundingDINO + SAM2) ---
# Used to cut real parts 1:1 out of the uploaded photo for the manual.
GROUNDING_MODEL = os.environ.get(
    "DIYPLAN_GROUNDING_MODEL", "IDEA-Research/grounding-dino-base"
)
SAM2_MODEL = os.environ.get("DIYPLAN_SAM2_MODEL", "facebook/sam2.1-hiera-small")
SEG_BOX_THRESHOLD = float(os.environ.get("DIYPLAN_SEG_BOX_THRESHOLD", "0.25"))
SEG_TEXT_THRESHOLD = float(os.environ.get("DIYPLAN_SEG_TEXT_THRESHOLD", "0.2"))
# Set to 0 to disable segmentation (manual falls back to synthetic shapes).
SEG_ENABLED = _flag("DIYPLAN_SEG_ENABLED", default=True)

# Embedding model for RAG. bge-small-en-v1.5 is tiny and needs no remote code.
# Alternatives: "nomic-ai/nomic-embed-text-v1.5" (trust_remote_code) or
# "BAAI/bge-m3" (multilingual + hybrid).
EMBED_MODEL = os.environ.get("DIYPLAN_EMBED_MODEL", "BAAI/bge-small-en-v1.5")

# Retrieval depth for the planning prompt.
RETRIEVAL_TOP_K = int(os.environ.get("DIYPLAN_RETRIEVAL_TOP_K", "4"))

# Generation budget for the VLM/LLM planning call.
MAX_TOKENS = int(os.environ.get("DIYPLAN_MAX_TOKENS", "2200"))
TEMPERATURE = float(os.environ.get("DIYPLAN_TEMPERATURE", "0.3"))

# How many times to retry a malformed JSON generation before giving up.
JSON_REPAIR_RETRIES = int(os.environ.get("DIYPLAN_JSON_REPAIR_RETRIES", "1"))


def model_label() -> str:
    """Human-readable id reported back to the Node routing layer."""
    if MOCK_MODE:
        return "local-mlx-mock"
    if PLANNER_MODEL:
        return f"{_short(VLM_MODEL)}+{_short(PLANNER_MODEL)}"
    return _short(VLM_MODEL)


def _short(repo: str) -> str:
    return repo.split("/")[-1]
