# AI DIY Furniture Planning Agent

## One-line Pitch

An efficient multimodal agent that converts a furniture inspiration image into a safer, buildable DIY plan while exposing the routing, verification, and serving tradeoffs behind the workflow.

## Why This Is Interesting

The consumer pain point is concrete: furniture can be expensive, and many people in the US are comfortable with basic DIY projects but do not know how to translate an image into materials, dimensions, and steps.

The technical angle is the stronger project framing. DIY furniture planning is a realistic multimodal agent workload with visible failure modes: wrong dimensions, unsafe structures, hallucinated materials, vague steps, and expensive model calls. That makes it a useful sandbox for studying model routing and agent evaluation.

## MVP

The MVP focuses on low-risk furniture categories:

- side tables
- coffee tables
- bookshelves
- nightstands

Inputs:

- inspiration image
- desired furniture category
- target size
- budget
- skill level
- available tools
- zip code

Outputs:

- structured project summary
- detected furniture parts and likely materials
- suggested dimensions
- material list
- tool list
- build steps
- safety checks
- purchase search links
- execution trace
- routing policy
- JSON output for evaluation

## Research Questions

- Which stages need a strong multimodal model?
- Which stages can be routed to a smaller model or local rules?
- How much does structured output reduce downstream parsing failures?
- Can local verification catch practical safety and consistency issues?
- How should buildability be evaluated for a multimodal planning task?
- What is the latency and token-cost profile of a realistic agent workflow?

## Planned System Architecture

1. Image understanding: detect furniture type, visible components, style, and likely materials.
2. Planner: generate a simplified inspired-by design rather than an exact copy.
3. Retrieval: match generated material needs to a small catalog or hardware-store search terms.
4. Verifier: flag missing dimensions, unsafe categories, cost inconsistency, and risky steps.
5. Router: decide which stages run on a strong cloud model, cheaper cloud model, local model, or deterministic rules.
6. Evaluation harness: run the same image set through different routing strategies and compare quality, cost, and latency.

## Current Demo

The first local demo uses a single cloud model call when `OPENAI_API_KEY` is present, then local material linking and verification. If no key is present, it falls back to a deterministic sample plan.

This keeps the demo easy to run while leaving clear extension points for the research project.
