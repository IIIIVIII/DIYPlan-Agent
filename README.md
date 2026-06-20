# DIYPlan Agent

DIYPlan Agent is a local-first demo for a multimodal agent workflow that turns a furniture inspiration image into a safer, simplified DIY build plan.

The user-facing idea is simple: upload a photo of a table, shelf, coffee table, or nightstand, then get a material list, tool list, build steps, rough cost estimate, safety notes, and hardware-store search links.

The technical framing is the more important part: this project treats DIY furniture planning as a realistic multimodal agent workload for studying model routing, structured generation, verification, latency, and cost.

## Why This Project Exists

Many furniture products are expensive, while many people in the US are comfortable with basic home improvement work. The hard part is not finding inspiration. The hard part is turning a visual reference into a buildable plan:

- What object is in the image?
- Which visible parts matter structurally?
- What materials are realistic for a beginner?
- Which dimensions need to be confirmed?
- Which steps are safe, and which should be avoided?
- What can be bought at common hardware stores?
- Which agent stages actually need an expensive multimodal model?

This makes the product a useful sandbox for both a consumer AI workflow and an ML systems / inference research direction.

## Current Demo

The current MVP supports a narrow low-risk furniture scope:

- side tables
- coffee tables
- bookshelves
- nightstands

It intentionally avoids high-risk work such as electrical wiring, ceiling-mounted structures, complex load-bearing furniture, plumbing, gas, or anything that should require a qualified professional.

The demo can run in two modes:

- **Cloud mode**: if `OPENAI_API_KEY` is configured, the server calls the OpenAI Responses API with image input and structured JSON output.
- **Mock mode**: if no API key is configured, the app returns a deterministic sample plan so the UI, trace, and routing concepts can still be reviewed locally.

## Features

- Image upload with preview
- Sample furniture image for quick testing
- Structured DIY plan generation
- Material list with quantities, rough costs, alternatives, and store search queries
- Tool list and step-by-step build instructions
- Safety and feasibility checks
- Zip-code-aware local hardware search links
- Home Depot and Lowe's search links
- Execution trace for each workflow stage
- Routing policy showing which stages could move to strong cloud models, cheaper models, local models, or deterministic rules
- Built-in routing strategies: cost optimized, quality first, cascade, and local first
- Offline benchmark harness for comparing quality, latency, cost units, and escalation triggers
- Raw JSON output for future evaluation and benchmark work

## Quick Start

This project has no npm package dependencies. It uses Node's built-in HTTP server and browser APIs.

```bash
cd ~/Desktop/DIYPlan-Agent
npm run dev
```

Open:

```text
http://localhost:5173
```

On macOS, you can also double-click:

```text
START_DEMO.command
```

That script opens the local URL and starts the dev server from the project folder.

## Cloud Mode Setup

Create a `.env` file:

```bash
cp .env.example .env
```

Add your API key:

```env
OPENAI_API_KEY=your_api_key_here
```

Optional model configuration:

```env
OPENAI_MODEL=gpt-4.1-mini
OPENAI_STRONG_MODEL=gpt-4.1
OPENAI_ROUTER_MODEL=gpt-4.1-mini
PORT=5173
```

Then run:

```bash
npm run dev
```

If `OPENAI_API_KEY` is missing, the app still works in mock mode.

## Useful Commands

```bash
npm run check
npm run benchmark
npm run dev
```

`npm run check` performs syntax checks on the server-side JavaScript files.

`npm run benchmark` runs deterministic benchmark fixtures from `data/benchmark_cases.json` and writes:

```text
reports/benchmark-latest.json
reports/benchmark-summary.md
```

## Product Flow

1. User uploads a furniture inspiration image.
2. User optionally provides category, target size, budget, skill level, zip code, and available tools.
3. The system generates a simplified inspired-by plan instead of copying the original design.
4. The local verifier flags missing inputs, unsafe work, and cost inconsistencies.
5. The material linker produces store search links.
6. The UI displays the plan, trace, routing policy, and structured output.

## System Architecture

```text
Browser UI
  |
  | image + constraints
  v
Node local server
  |
  |-- input normalization
  |-- multimodal planning call, when API key is available
  |-- deterministic fallback plan, when API key is not available
  |-- routing strategy selection
  |-- local safety and feasibility verifier
  |-- material-to-store search linking
  |-- quality evaluator and escalation trigger detector
  |-- routing policy trace
  v
Structured DIY plan JSON
  |
  v
Results UI
```

## Repository Structure

```text
.
├── START_DEMO.command        # macOS double-click launcher
├── README.md                 # project overview and setup
├── docs/
│   ├── product-brief.md      # product and research framing
│   └── routing-survey.md     # routing and agent benchmark survey
├── data/
│   └── benchmark_cases.json  # deterministic benchmark fixtures
├── public/
│   ├── index.html            # app shell
│   ├── styles.css            # responsive UI styling
│   └── app.js                # browser-side interaction and rendering
├── src/
│   ├── materialCatalog.js    # small local material catalog and store links
│   ├── openai.js             # OpenAI Responses API call
│   ├── planner.js            # workflow orchestration and verifier
│   ├── routing.js            # routing strategies, model profiles, cost units
│   ├── evaluator.js          # plan quality scoring
│   └── schema.js             # structured output schema
├── scripts/
│   └── run-benchmark.js      # offline benchmark harness
├── reports/
│   ├── benchmark-latest.json # generated benchmark output
│   └── benchmark-summary.md  # generated benchmark summary
├── server.js                 # local HTTP server and API routes
├── package.json              # scripts
└── .env.example              # local environment template
```

## API Endpoints

### `GET /api/health`

Returns server status and whether cloud mode is configured.

Example:

```json
{
  "ok": true,
  "cloudModelConfigured": false,
  "defaultModel": "gpt-4.1-mini"
}
```

### `POST /api/generate-plan`

Generates a DIY plan.

Example request:

```json
{
  "imageDataUrl": "data:image/png;base64,...",
  "furnitureType": "side table",
  "targetSize": "24 W x 18 D x 24 H in",
  "budget": "$80 - $140",
  "skillLevel": "beginner",
  "zipcode": "90024",
  "tools": ["drill", "saw"]
}
```

Example response shape:

```json
{
  "mode": "cloud",
  "metrics": {
    "total_latency_ms": 1200,
    "cloud_latency_ms": 1130,
    "model": "gpt-4.1-mini",
    "estimated_call_count": 1,
    "relative_cost_units": 7.4,
    "cloud_stage_count": 2
  },
  "routing_strategy": {},
  "routing_policy": [],
  "routing_cost": {},
  "evaluation_report": {},
  "triggered_escalations": [],
  "trace": [],
  "plan": {},
  "purchase_links": []
}
```

## Technical Framing

This project is deliberately scoped as more than a consumer app wrapper. The furniture task becomes a concrete workload for:

- multimodal image understanding
- structured output generation
- retrieval-aware material selection
- agent tool use
- local safety and consistency verification
- cost-aware model routing
- cloud-vs-local inference tradeoffs
- workflow-level evaluation

The key research question is:

> How can a multimodal agent complete a practical real-world planning task while keeping quality high, latency acceptable, and model cost low?

## Routing Research Direction

The first demo uses one cloud call for simplicity. A stronger research version would split the workflow into explicit stages:

1. **Image understanding**
   - Strong multimodal model.
   - Extract furniture type, visible components, style, and likely materials.

2. **Planner**
   - Medium or strong model.
   - Convert extracted visual features and user constraints into a buildable plan.

3. **Material matcher**
   - Retrieval plus local rules.
   - Map required parts to common hardware-store materials.

4. **Verifier**
   - Local rules plus small judge model.
   - Catch missing dimensions, unsafe tasks, high-risk categories, and cost inconsistencies.

5. **Formatter**
   - Small model or deterministic renderer.
   - Produce user-friendly steps and structured JSON.

This would allow experiments such as:

- all-strong-model baseline
- small-model-first with strong-model fallback
- local verifier plus cloud planner
- local material matcher plus cloud image understanding
- cached retrieval and repeated-stage reuse

The current repo already includes the first version of this research layer:

- `src/routing.js` defines fixed routing policies and relative cost units.
- `src/evaluator.js` scores plan quality across completeness, safety, materials, cost consistency, and observability.
- `scripts/run-benchmark.js` compares routing strategies across deterministic benchmark cases.
- `docs/routing-survey.md` summarizes routing and agent-evaluation papers that inform the roadmap.

## Evaluation Plan

A useful next step is to build a small benchmark set of furniture images and compare different model-routing policies.

Possible metrics:

- **Buildability**: can a beginner reasonably follow the plan?
- **Completeness**: are materials, tools, steps, dimensions, and safety notes present?
- **Material accuracy**: are suggested materials realistic and purchasable?
- **Safety**: does the agent avoid electrical, structural, or high-risk work?
- **Cost realism**: are rough estimates aligned with itemized materials?
- **Latency**: how long does the full workflow take?
- **Model cost**: how much does each routing strategy cost per generated plan?
- **Failure rate**: how often does the workflow produce invalid JSON or unusable output?

## Safety and IP Notes

This project should generate inspired-by alternatives, not exact copies of branded furniture designs.

The system should not be treated as professional engineering, electrical, or structural advice. It is a prototype for low-risk DIY planning. Real builds should be reviewed by a qualified person when safety matters.

The current MVP intentionally avoids:

- electrical wiring
- ceiling-mounted structures
- large load-bearing furniture
- plumbing or gas work
- child safety furniture
- furniture intended to hold heavy dynamic loads

## Roadmap

- Add screenshots or a short demo video to the README.
- Add a real image-understanding stage separate from plan generation.
- Add a small furniture image benchmark.
- Add per-stage token and latency instrumentation.
- Add model-routing policies as selectable experiments.
- Add a local retrieval index for materials and DIY constraints.
- Add a stronger verifier for unsafe or unbuildable plans.
- Add optional live catalog adapters if reliable store APIs or feeds are available.

## Current Status

This is an early local demo. It is useful for showing the product concept and the research framing, but it is not yet a production DIY planning system.
