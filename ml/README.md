# DIYPlan Local ML Backend (Apple Silicon / MLX)

This is the on-device model layer for DIYPlan Agent. It turns a furniture
image plus user constraints into a schema-valid DIY plan, using open-weight
models that run locally on Apple Silicon via [MLX](https://github.com/ml-explore/mlx).

It is a separate Python service so the heavy ML stack stays out of the Node
app. The Node server calls it over HTTP for the **Local MLX** routing strategy.

## Pipeline

```
image + constraints
   │
   ▼
1. Perception      Qwen3-VL-4B-Instruct-4bit (MLX-VLM)   → structured tags
2. Retrieval       bge-small-en-v1.5 + LanceDB           → DIY knowledge snippets
3. Planning        same VLM (or a constrained text LLM)  → plan JSON (schema-validated)
   │
   ▼
plan JSON  ──►  (handed back to Node: verifier + instruction renderer + evaluator)
```

The model is asked to **fill a JSON contract**, not to write prose or draw the
manual. The Pydantic schema in `schemas.py` mirrors the Node `planSchema`, so a
generation that validates here is guaranteed to be shape-compatible downstream.
Invalid JSON is repaired-and-retried before the service errors out.

## Model choices (tuned for M3 Pro / 18 GB)

| Stage | Default model | Why |
|---|---|---|
| Vision + planning | `mlx-community/Qwen3-VL-4B-Instruct-4bit` (~2.5 GB) | Best quality/speed on 18 GB; reused for both stages to save memory |
| Embeddings | `BAAI/bge-small-en-v1.5` (~130 MB) | Tiny, fast, no `trust_remote_code` |
| Vector store | LanceDB (on disk) | Survives restarts; in-memory fallback if unavailable |

All are configurable via environment variables (see `config.py`). With ≥32 GB
you can bump the VLM to the `8B-4bit` repo, or set `DIYPLAN_PLANNER_MODEL` to a
separate text LLM for constrained-decoding (Outlines) planning.

## Setup

```bash
cd ~/Desktop/DIYPlan-Agent
python3 -m venv ml/.venv
source ml/.venv/bin/activate
pip install -r ml/requirements.txt
```

Build the RAG index (downloads the embedding model on first run):

```bash
python -m ml.ingest          # LanceDB index
# or python -m ml.ingest --memory   # skip LanceDB
```

## Run

```bash
# Live mode (loads MLX models; first run downloads weights from Hugging Face)
./ml/run.sh

# Mock mode (no downloads, deterministic output — great for wiring/tests)
DIYPLAN_ML_MOCK=1 ./ml/run.sh
```

The service listens on `http://127.0.0.1:8000`. Point the Node app at it with
`ML_BACKEND_URL` (already the default) and choose the **Local MLX** routing
strategy, or set `ML_BACKEND_ENABLED=1` to always try local first.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health`     | readiness + active model ids |
| POST | `/plan`       | full pipeline (perception + retrieval + planning) |
| POST | `/understand` | perception only |
| POST | `/retrieve`   | RAG retrieval only |

Example:

```bash
curl -s http://127.0.0.1:8000/health
curl -s -X POST http://127.0.0.1:8000/retrieve \
  -H 'content-type: application/json' \
  -d '{"query":"round table leg joinery","top_k":3}'
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DIYPLAN_ML_MOCK` | `0` | Skip model loading, return deterministic output |
| `DIYPLAN_ML_HOST` / `DIYPLAN_ML_PORT` | `127.0.0.1` / `8000` | Bind address |
| `DIYPLAN_VLM_MODEL` | `mlx-community/Qwen3-VL-4B-Instruct-4bit` | Vision-language model |
| `DIYPLAN_PLANNER_MODEL` | *(empty)* | Optional separate text LLM for planning |
| `DIYPLAN_EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | Embedding model |
| `DIYPLAN_RETRIEVAL_TOP_K` | `4` | Retrieved snippets per plan |
| `DIYPLAN_MAX_TOKENS` | `2200` | Generation budget |
| `DIYPLAN_TEMPERATURE` | `0.3` | Sampling temperature |

## Roadmap inside this layer

- Swap the VLM perception → constrained text planner into a true two-model
  route and benchmark cost/latency/quality vs the single-VLM path.
- LoRA fine-tune the planner on bootstrapped + hand-corrected `image → JSON`
  pairs (MLX-LM) and measure how well a small local student matches a frontier
  teacher.
- Add a reranker and hybrid (dense + sparse) retrieval for the knowledge base.
