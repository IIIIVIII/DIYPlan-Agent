---
name: context-token-audit
description: Keep skill context small, prioritized, and measurable for local models.
---

# Context Token Audit

Use when adding many skills or when latency increases.

Rules:
- Every skill must have a narrow trigger and priority.
- Prefer many small skills over one giant skill, but load only the relevant subset.
- Always include source-grounding and verifier skills before style-only skills.
- Truncate low-priority skills first.
- Add a loader self-test for common categories: known source manual, generic round table, unrelated bookshelf.
- Track selected skill IDs in the response so the UI can prove which skills were used.
- Do not load prompt-gallery-scale references into the VLM prompt; search/select snippets first.
