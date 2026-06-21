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
    preferences: dict = {}


class UnderstandRequest(BaseModel):
    imageDataUrl: str | None = None
    preferences: dict = {}


class RetrieveRequest(BaseModel):
    query: str
    top_k: int | None = None


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


@app.post("/plan")
def plan(req: PlanRequest) -> dict:
    return pipeline.generate(
        {"imageDataUrl": req.imageDataUrl, "preferences": req.preferences}
    )


@app.post("/understand")
def understand(req: UnderstandRequest) -> dict:
    if config.MOCK_MODE:
        result = pipeline.generate(
            {"imageDataUrl": req.imageDataUrl, "preferences": req.preferences}
        )
        return {"perception": result["perception"], "stages": result["stages"][:1]}

    from . import models, prompts

    image_path = (
        models.data_url_to_tempfile(req.imageDataUrl) if req.imageDataUrl else None
    )
    perception = pipeline._run_perception(models, prompts, req.preferences, image_path)
    return {"perception": perception}


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
