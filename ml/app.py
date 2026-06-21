"""FastAPI service exposing the local agent pipeline to the Node server.

Endpoints:
  GET  /health        -> readiness + active model ids
  POST /plan          -> full pipeline: perception + retrieval + planning
  POST /understand    -> perception only (image -> structured tags)
  POST /retrieve      -> RAG retrieval only (query -> knowledge snippets)

Run:
  uvicorn ml.app:app --host 127.0.0.1 --port 8000
  # or: python -m ml.app
"""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

from . import config, pipeline

app = FastAPI(title="DIYPlan Agent ML Backend", version="0.1.0")


class PlanRequest(BaseModel):
    imageDataUrl: str | None = None
    imageDataUrls: list[str] | None = None
    preferences: dict = {}


class UnderstandRequest(BaseModel):
    imageDataUrl: str | None = None
    imageDataUrls: list[str] | None = None
    preferences: dict = {}


class RetrieveRequest(BaseModel):
    query: str
    top_k: int | None = None


class TranslateRequest(BaseModel):
    texts: list[str] = []
    target_lang: str = "en"


@app.on_event("startup")
def _warmup() -> None:
    """Pre-load the segmentation models so the first /plan is not slow."""
    if config.MOCK_MODE or not config.SEG_ENABLED:
        return
    try:
        from . import segmentation

        segmentation.warmup()
    except Exception as exc:  # never block startup on warmup
        print(f"[startup] segmentation warmup skipped: {exc}")


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "mock": config.MOCK_MODE,
        "model": config.model_label(),
        "vlm_model": config.VLM_MODEL,
        "planner_model": config.PLANNER_MODEL or None,
        "embed_model": config.EMBED_MODEL,
    }


def _image_urls(req) -> list[str]:
    urls = list(req.imageDataUrls or [])
    if not urls and req.imageDataUrl:
        urls = [req.imageDataUrl]
    return urls


@app.post("/plan")
def plan(req: PlanRequest) -> dict:
    return pipeline.generate(
        {"imageDataUrls": _image_urls(req), "preferences": req.preferences}
    )


@app.post("/understand")
def understand(req: UnderstandRequest) -> dict:
    urls = _image_urls(req)
    if config.MOCK_MODE:
        result = pipeline.generate(
            {"imageDataUrls": urls, "preferences": req.preferences}
        )
        return {"perception": result["perception"], "stages": result["stages"][:1]}

    from . import models, prompts

    image_paths = [
        p for p in (models.data_url_to_tempfile(u) for u in urls) if p
    ]
    perception = pipeline._run_perception(
        models, prompts, req.preferences, image_paths
    )
    return {"perception": perception}


@app.post("/translate")
def translate(req: TranslateRequest) -> dict:
    return {"translations": pipeline.translate_texts(req.texts, req.target_lang)}


@app.post("/retrieve")
def retrieve(req: RetrieveRequest) -> dict:
    top_k = req.top_k or config.RETRIEVAL_TOP_K
    if config.MOCK_MODE:
        from .rag.store import keyword_retrieve

        return {"results": keyword_retrieve(req.query, top_k=top_k)}

    from .rag.store import get_store

    return {"results": get_store().retrieve(req.query, top_k=top_k)}


def main() -> None:
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT)


if __name__ == "__main__":
    main()
