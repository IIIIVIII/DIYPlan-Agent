# Routing and Agent Evaluation Survey

This note summarizes routing-related work that can guide the next version of DIYPlan Agent. The goal is not to reproduce these systems yet, but to turn the current demo into a realistic multimodal agent serving benchmark.

## Core Problem

Industrial LLM applications face a cost-quality-latency tradeoff:

- Strong multimodal models are more reliable but expensive.
- Smaller models and local rules are cheaper but may fail on ambiguous tasks.
- Real workflows contain heterogeneous stages; not every stage needs the same model.
- A practical agent system needs measurement, not just subjective demo quality.

DIYPlan Agent can turn this into a concrete research question:

> For a multimodal furniture-planning workflow, which stages should use a strong model, which can use cheaper/local inference, and how much cost can be saved before plan quality drops?

## Representative Work

### FrugalGPT

[FrugalGPT](https://arxiv.org/abs/2305.05176) frames LLM cost reduction around prompt adaptation, LLM approximation, and LLM cascades. The key idea for this project is the cascade: start with cheaper models and call stronger models only when needed.

Project mapping:

- Start with `cost_optimized` routing.
- Use local verifier signals as the cascade gate.
- Escalate only when buildability, safety, or consistency scores are weak.

### RouteLLM

[RouteLLM](https://arxiv.org/abs/2406.18665) learns routers that dynamically choose between stronger and weaker LLMs using preference data. The accompanying [RouteLLM framework](https://github.com/lm-sys/RouteLLM) focuses on serving and evaluating routers.

Project mapping:

- Treat each DIY request as a routing decision.
- Collect labels such as "mini model was enough" vs. "strong model needed."
- Compare `quality_first`, `cost_optimized`, `local_first`, and `cascade` strategies.
- Eventually train a lightweight router from benchmark outcomes.

### Speculative Decoding

[Fast Inference from Transformers via Speculative Decoding](https://arxiv.org/abs/2211.17192) shows that a smaller approximation model can draft tokens that a larger model verifies in parallel, accelerating decoding without changing output distribution.

Project mapping:

- This is lower-level than the current app, but it connects to serving/inference.
- If the project later uses local models, speculative decoding could reduce latency for long plan generation.

### Big Little Decoder

[BiLD](https://arxiv.org/abs/2302.07863) uses a small model for cheap generation and occasionally falls back to a large model with rollback/refinement policies.

Project mapping:

- The current `cascade` strategy is a workflow-level analogue of BiLD.
- The verifier decides whether to keep the cheap output or ask a stronger model to repair it.

### LLM-Blender

[LLM-Blender](https://arxiv.org/abs/2306.02561) uses ranking and fusion to combine candidate outputs from multiple models.

Project mapping:

- Generate two candidate DIY plans from different strategies.
- Rank them with a small verifier/judge.
- Fuse the best material list and safest steps.

## Agent and Tool-Use Benchmarks

### AgentBench

[AgentBench](https://arxiv.org/abs/2308.03688) evaluates LLMs as agents across interactive environments. It emphasizes reasoning, decision-making, and instruction following rather than single-turn NLP quality.

Project mapping:

- DIYPlan should be evaluated as a multi-stage agent workflow, not a single model answer.
- Metrics should include task completion, safety, and consistency.

### Tau-Bench

[$\\tau$-bench](https://arxiv.org/abs/2406.12045) evaluates agents in realistic tool/user interaction settings and checks final database state against the target state.

Project mapping:

- A future DIYPlan benchmark can simulate user follow-up questions and tool calls.
- Instead of only judging text, evaluate whether the final structured plan satisfies constraints.

### Berkeley Function Calling Leaderboard

[BFCL](https://gorilla.cs.berkeley.edu/leaderboard.html) evaluates tool/function calling accuracy and is useful for thinking about material search, cost calculators, and verifier tools.

Project mapping:

- Add explicit tool-call traces for material matching, store search, cost estimation, and safety checks.
- Score whether the right tools were called with correct arguments.

### SWE-bench

[SWE-bench](https://arxiv.org/abs/2310.06770) is not a furniture benchmark, but it is a strong example of grounding evaluation in real tasks with objective validation.

Project mapping:

- Build small fixtures with expected constraints.
- Move beyond "looks good" into pass/fail criteria for material completeness, risk flags, and cost consistency.

## Proposed Research Milestones

### Milestone 1: Offline Benchmark Harness

Implemented in the current repo:

- `data/benchmark_cases.json`
- `scripts/run-benchmark.js`
- `src/routing.js`
- `src/evaluator.js`

This compares routing strategies on deterministic fixtures and reports quality, cost, latency, and escalation signals.

### Milestone 2: Cloud-vs-Local Routing Runs

Next:

- Run the same benchmark with `OPENAI_API_KEY`.
- Store per-stage latency and token estimates.
- Compare cloud strategies against deterministic/local baselines.

### Milestone 3: Verifier-Driven Escalation

Next:

- Let the cheap model produce a first plan.
- Run a verifier.
- Re-run only failed stages with a stronger model.
- Compare cost savings vs. quality loss.

### Milestone 4: Learned Router

Later:

- Collect examples where strong model output is materially better.
- Train or simulate a simple router using prompt features and verifier features.
- Compare learned routing against fixed strategies.

## Metrics for DIYPlan Agent

- Plan completeness
- Buildability
- Safety and risk detection
- Material realism
- Cost consistency
- Store-link coverage
- Workflow latency
- Relative model cost
- Escalation rate
- Invalid structured-output rate

## What Makes This More Than a Wrapper

The app is only the visible shell. The research project is the serving loop behind it:

1. Decompose a multimodal task into stages.
2. Assign stages to strong models, cheaper models, or local rules.
3. Evaluate each plan with structured metrics.
4. Use verifier signals to decide whether to escalate.
5. Measure quality-cost-latency tradeoffs across routing strategies.
