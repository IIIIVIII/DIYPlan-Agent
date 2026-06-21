"""RAG knowledge store: embed the DIY knowledge base and retrieve by query.

Design goals:
- Lazy, single-load embedding model (shared across requests).
- LanceDB on disk so the index survives restarts and is cheap to rebuild.
- A pure in-memory fallback so the service still retrieves in mock mode or if
  LanceDB is unavailable, keeping the pipeline runnable everywhere.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import List, Optional

import numpy as np

from .. import config


def load_knowledge() -> List[dict]:
    rows: List[dict] = []
    if not config.KNOWLEDGE_FILE.exists():
        return rows
    with config.KNOWLEDGE_FILE.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


@lru_cache(maxsize=1)
def _embedder():
    """Load the sentence-transformers embedding model once."""
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(config.EMBED_MODEL)


def embed(texts: List[str]) -> np.ndarray:
    model = _embedder()
    vectors = model.encode(
        texts, normalize_embeddings=True, convert_to_numpy=True
    )
    return np.asarray(vectors, dtype=np.float32)


class KnowledgeStore:
    """Wraps either a LanceDB table or an in-memory matrix of embeddings."""

    def __init__(self) -> None:
        self.rows = load_knowledge()
        self._matrix: Optional[np.ndarray] = None
        self._table = None

    # --- index building -------------------------------------------------
    def build(self, use_lancedb: bool = True) -> str:
        if not self.rows:
            return "no-knowledge"
        vectors = embed([r["text"] for r in self.rows])
        if use_lancedb:
            try:
                return self._build_lancedb(vectors)
            except Exception:
                # Fall through to in-memory if LanceDB is unhappy.
                pass
        self._matrix = vectors
        return "in-memory"

    def _build_lancedb(self, vectors: np.ndarray) -> str:
        import lancedb

        config.LANCE_DIR.mkdir(parents=True, exist_ok=True)
        db = lancedb.connect(str(config.LANCE_DIR))
        data = [
            {
                "id": row["id"],
                "topic": row.get("topic", ""),
                "text": row["text"],
                "vector": vectors[i].tolist(),
            }
            for i, row in enumerate(self.rows)
        ]
        db.drop_table("knowledge", ignore_missing=True)
        self._table = db.create_table("knowledge", data=data)
        return "lancedb"

    # --- retrieval ------------------------------------------------------
    def _ensure_ready(self) -> None:
        if self._table is not None or self._matrix is not None:
            return
        # Try to open an existing LanceDB table; otherwise build in-memory.
        try:
            import lancedb

            db = lancedb.connect(str(config.LANCE_DIR))
            self._table = db.open_table("knowledge")
            return
        except Exception:
            self.build(use_lancedb=False)

    def retrieve(self, query: str, top_k: int = 4) -> List[dict]:
        if not self.rows:
            return []
        self._ensure_ready()
        query_vec = embed([query])[0]

        if self._table is not None:
            hits = (
                self._table.search(query_vec.tolist())
                .limit(top_k)
                .to_list()
            )
            return [
                {"id": h["id"], "topic": h.get("topic", ""), "text": h["text"]}
                for h in hits
            ]

        # In-memory cosine similarity (vectors are already normalized).
        scores = self._matrix @ query_vec
        order = np.argsort(-scores)[:top_k]
        return [
            {
                "id": self.rows[i]["id"],
                "topic": self.rows[i].get("topic", ""),
                "text": self.rows[i]["text"],
            }
            for i in order
        ]


@lru_cache(maxsize=1)
def get_store() -> KnowledgeStore:
    return KnowledgeStore()


def keyword_retrieve(query: str, top_k: int = 4) -> List[dict]:
    """Embedding-free retrieval used in mock mode (no model download)."""
    rows = load_knowledge()
    if not rows:
        return []
    terms = {t for t in query.lower().split() if len(t) > 2}
    scored = []
    for row in rows:
        text = row["text"].lower()
        score = sum(text.count(term) for term in terms)
        scored.append((score, row))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    picked = [row for score, row in scored if score > 0][:top_k]
    if not picked:
        picked = rows[:top_k]
    return [
        {"id": r["id"], "topic": r.get("topic", ""), "text": r["text"]}
        for r in picked
    ]
