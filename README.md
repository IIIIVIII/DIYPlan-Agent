# DIYPlan Agent

DIYPlan Agent is a local demo for a multimodal agent workflow that turns a furniture inspiration image into a safer, simplified DIY build plan.

The product surface is intentionally narrow: side tables, coffee tables, bookshelves, and nightstands. The research surface is broader: routing, evaluation, structured generation, local verification, and cloud-vs-local inference tradeoffs for real agent workloads.

## Demo Scope

- Upload a furniture inspiration image.
- Generate a structured DIY plan with materials, tools, steps, cost estimate, and safety checks.
- Add store search links for Home Depot, Lowe's, and local hardware stores.
- Show a stage-by-stage execution trace.
- Expose a routing policy for future small-model and local-inference experiments.

The app runs without dependencies. If `OPENAI_API_KEY` is configured, it uses the OpenAI Responses API with image input and JSON schema output. If not, it runs in deterministic mock mode so the UI and workflow can still be reviewed.

## Run Locally

```bash
cp .env.example .env
# Add OPENAI_API_KEY to .env for cloud mode.
npm run dev
```

Open:

```text
http://localhost:5173
```

## Useful Commands

```bash
npm run check
npm run dev
```

## Technical Framing

This is not meant to be just a consumer app wrapper. The furniture task acts as a concrete workload for:

- multimodal image understanding
- structured plan generation
- retrieval-aware material selection
- agent tool use
- local safety and consistency verification
- model routing between strong cloud models, cheaper models, and local rules
- evaluation across quality, latency, and cost

## Next Research Directions

1. Split the current single cloud call into explicit stages: image understanding, planner, material retriever, verifier, and formatter.
2. Add a small benchmark set of furniture images and human-readable expected constraints.
3. Compare routing strategies: all-frontier model, small-model-first with fallback, and local verifier plus cloud planner.
4. Add live or semi-live catalog adapters if official store APIs or data feeds are available.
5. Measure per-stage latency, token cost, failure rate, and plan buildability.

## Safety and IP Notes

The app should generate inspired-by alternatives rather than copying branded furniture. It should avoid electrical work, structural work, and high-risk furniture categories unless reviewed by a qualified person.

## References

- OpenAI vision/image input docs: https://platform.openai.com/docs/guides/images-vision
- OpenAI structured outputs docs: https://platform.openai.com/docs/guides/structured-outputs
