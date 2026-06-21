"""Build the RAG index from rag/knowledge.jsonl.

Usage:
  python -m ml.ingest          # build LanceDB index (downloads embed model)
  python -m ml.ingest --memory # build in-memory only (skip LanceDB)
"""

from __future__ import annotations

import sys

from .rag.store import KnowledgeStore


def main() -> None:
    use_lancedb = "--memory" not in sys.argv
    store = KnowledgeStore()
    if not store.rows:
        print("No knowledge rows found in rag/knowledge.jsonl")
        return
    backend = store.build(use_lancedb=use_lancedb)
    print(f"Indexed {len(store.rows)} knowledge snippets via: {backend}")


if __name__ == "__main__":
    main()
