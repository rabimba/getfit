# GetFit AI Coach — On-Device Agentic Plan (v2, re-checked 2026-08-29)

Goal: an in-browser AI that reads the user's logged progress + chat, and **adjusts
diet and workout** via tool calls + agentic workflows, grounding every plan in the
peer-reviewed evidence base from our fact-check. Fully local — no server, no data
leaving the browser — via a **LiteRT-based** runtime.

> Re-check vs v1: **Gemma 4 does exist** (released July 2025, multimodal, MoE, 256K
> context), and **MediaPipe LLM Inference is now maintenance-only** — new work is
> on **LiteRT-LM / LiteRT.js**. This plan corrects both points.

---

## 1. Re-check: what changed

| v1 claim | Re-checked reality (2025–2026) |
|---|---|
| "No Gemma 4" | **Gemma 4 exists** — E2B/E4B with text+image+audio, long context, MoE routing. ONNX and `.litertlm`/`.task` builds available (`onnx-community/gemma-4-*`, `litert-community/Gemma4-*`). |
| MediaPipe LLM Inference = current | **Maintenance-only** — Google directs new work to **LiteRT-LM** (LLMs) + **LiteRT.js** (classical `.tflite`). See `ai.google.dev/edge/mediapipe/solutions/genai/llm_inference` banner + `developers.google.com/edge/litert`. |
| "LiteRT = generic" | **LiteRT** is the successor to TFLite. **LiteRT.js** = `.tflite` in browser (WebGPU/WASM/WebNN). **LiteRT-LM.js** = LLMs in browser (`.litertlm`/`.task`). Both are the LiteRT-based browser path you asked for. |
| Gemma 3 1B via Transformers.js = broken | Fixed for `q4f16` on WebGPU after ONNX re-export (`omn-community/gemma-3-1b-it-ONNX-GQA`, issues #1239/#1469 resolved). |

---

## 2. Model + runtime survey (browser, mid-2026)

### Models that run in-browser

| Model | Effective size | Download (q4/q4f16) | Notes |
|---|---|---|---|
| **Gemma 4 E2B Instruct** | ~2B active (MoE) | ~1.2–1.8 GB (ONNX), ~1 GB (`.litertlm` int4) | Multimodal (image/audio→text), best "Gemma 4" LiteRT path you asked for. Heavy but state-of-art. |
| **Gemma 3 1B IT** | 1B | ~0.6–1 GB | Lightest Gemini-derived model; fastest cold load; ideal for low-end devices. |
| **Gemma 3 4B IT** | 4B | ~2–2.5 GB | Stronger reasoning; noticeably slower load. |
| **Llama-3.2-3B-Instruct** | 3B | ~1.8 GB | Most mature browser tool-calling template; great WebLLM support. |
| **Qwen2.5-1.5B / Phi-3.5-mini** | 1–4B | ~0.8–2 GB | Alternatives with good tool-calling. |

### Runtimes (LiteRT-based → your requirement)

| Runtime | Handles | Backends | Model format | Agentic fit |
|---|---|---|---|---|
| **LiteRT-LM.js** (`@litert/lm`) | LLMs only | WASM (XNNPACK) + WebGPU (ML Drift) | `.litertlm` / `.task` (Gemma 3/4) | Prompt-based tool calling via chat template; Google-native for Gemma 4 |
| **LiteRT.js** (`@litertjs/core`) | Classical `.tflite` | WASM / WebGPU / WebNN | `.tflite` | For non-LLM tasks (pose, segmentation) — not the LLM runtime |
| **Transformers.js v3** (`@huggingface/transformers`) | LLMs (ONNX) | WebGPU / WASM (ONNX Runtime Web) | ONNX quantized (`onnx-community/*`) | Manual JSON tool-call extraction; works well with Gemma 4 ONNX |
| **WebLLM** (`@mlc-ai/web-llm`) | LLMs (MLC) | WebGPU | MLC-compiled | Best native `tools`/`tool_choice` support today (OpenAI-compatible). Not LiteRT but strongest agentic out-of-box. |

**Verdict for your "LiteRT + agentic + browser + Gemma 4" ask:**

- **Primary (LiteRT-based, as requested):** **LiteRT-LM.js + Gemma 4 E2B (or Gemma 3 1B for lite devices)** via `.litertlm`/`.task`. This satisfies "LiteRT, local, browser".
- **Runner-up / fallback:** **Transformers.js + `onnx-community/gemma-4-e2b-it-ONNX` (q4f16, WebGPU)** — same Gemma 4 weights, widely documented, PyImageSearch July 2026 tutorial shows working end-to-end (HTML + `AutoProcessor` + `Gemma4ForConditionalGeneration` + `TextStreamer`).
- **Agentic reference:** **WebLLM + Llama-3.2-3B** as the benchmark for tool-calling ergonomics (use to measure Gemma 4 agent quality against).

All three share the same requirement: **WebGPU** (Chrome 113+/Edge 113+, Firefox needs `dom.webgpu.workers.enabled`, Safari 18+ with enough `maxStorageBufferBindingSize`). No WASM fallback for LLMs in MediaPipe/LiteRT-LM — unlike classical LiteRT.js — so we must feature-detect and degrade to "manual mode" when WebGPU is missing.

---

## 3. Architecture (LiteRT-based)

```
Browser (GetFit — single origin, no server)
│
├── Planner engine (existing app.js: computeBMR/TDEE/macros, generateWorkout)
├── Progress store (localStorage: getfit_progress + getfit_inputs, later IndexedDB)
├── Evidence KB (read-only JSON: fact-check verdicts, ISSN/ACSM rules)
│
└── AI Coach (lazy-loaded bundle, ~50–100 KB + model)
    ├── Chat UI + "Apply plan" button + progress chart
    ├── Agent loop (JS, in Worker)  ← ReAct: thought → tool_call → observation → ...
    │   ├── System prompt = evidence rules + tool schemas + safety clamps
    │   ├── Model inference (LiteRT-LM.js OR Transformers.js OR WebLLM, WebGPU)
    │   └── Tool executor (calls real app functions, never lets model write calories directly)
    └── Tools (see §4) — every plan is *computed*, not hallucinated
```

Model is fetched once via HTTP Range requests, cached via **Cache API / IndexedDB**, and loaded in a **Web Worker** so the UI stays responsive. Model load shows progress (as in the Gemma-4 Transformers.js demo).

---

## 4. Tools (LiteRT/Transformers tool-calling contract)

We enforce JSON-only tool calls (model outputs `{"tool":"name","args":{...}}`; JS validates against schemas before execution).

| Tool | Purpose | Inputs | Returns |
|---|---|---|---|
| `computeTargets` | Re-compute BMR/TDEE/target | sex, age, height, weight, bodyfat, activity, goal, aggressiveness | {bmr, method, tdee, target, adjustPct} |
| `recommendMacros` | Evidence macros | weight, goal | {proteinG, carbG, fatG} via ISSN 1.6–2.2 g/kg, fat 25% |
| `generateWorkout` | Weekly plan | experience, goal | {plan:[{day, ex:[[name,setsReps]]}], cardioNote} |
| `adjustPlan` | Nudge current plan by progress | currentPlan, progress[], feedback | {deltaKcal, deltaProtein, deltaVolume, rationale} — clamped |
| `logProgress` | Persist weigh-in | date, weight | {ok, progress[]} |
| `retrieveEvidence` | Grounding | topic ("plateau","protein","creatine",...) | {verdicts:[{claim, verdict, citation}]} |

**Safety clamps (enforced in executor, not just prompt):**
protein ≥1.6 g/kg (≥2.0 on cut), deficit ≤25%, surplus ≤20%, single weigh-in never triggers >200 kcal change, weekly loss >1% bodyweight → warn.

**Prompting for Gemma 4 (LiteRT-LM / Transformers.js):** Gemma 4's prompt format (`<start_of_turn>`) is used; tool schemas are injected as `toolsJson` (see `gemma-webgpu`'s `toolsJson` param). We parse with a strict regex and reject any free-form calorie numbers emitted outside a tool call.

---

## 5. Grounding — why this won't become bro-science

- Evidence KB is the **fact-check verdicts** (52 claims: TRUE/PARTIALLY TRUE/MYTH) — injected as system context and retrievable via `retrieveEvidence`.
- Model is **forbidden by executor** from emitting somatotypes, water-burns-fat, ZMA→T, chromium-fix, cortisol/LISS, ice-cream metabolism. Those tool calls are not in the schema — it literally cannot call a debunked rule.
- Every UI plan shows a "Why?" disclosure with citations (ISSN, Cochrane, Schoenfeld 2015, etc.).

---

## 6. UX flow

1. User logs weight + chat: "Stalled 3 weeks at 74 kg, tired".
2. Coach calls `retrieveEvidence("plateau")` + `adjustPlan({currentPlan, progress, feedback})`.
3. Tools return: adaptive thermogenesis is modest; suggest +100 kcal refeed or volume deload, not crash cut.
4. Coach streams a grounded proposal; user clicks **Apply** → planner inputs + chart update.

---

## 7. File structure (proposed)

```
getfit/
├── index.html
├── styles.css
├── app.js                  # planner + progress (already shipped)
├── ai/
│   ├── coach-ui.js         # chat panel, streaming, "Apply plan"
│   ├── agent.js            # ReAct loop, schema validation, LiteRT-LM/Transformers/WebLLM adapter
│   ├── tools.js            # thin wrappers around app.js functions + clamps
│   ├── evidence-kb.json    # curated fact-check (read-only)
│   └── worker.js           # model loader (Range requests, Cache API, WebGPU detect)
└── models/  (not committed — fetched at runtime and cached)
```

Core planner stays **zero-dependency** and fast on first paint; `ai/*` loads only when user opens the Coach (dynamic `import()`).

---

## 8. Build phases & effort

| Phase | Deliverable | Est. |
|---|---|---|
| **P0 POC** | Worker + Gemma 4 E2B (LiteRT-LM or Transformers.js) streaming in a hidden panel; WebGPU detect + fallback message | 1–2 days |
| **P1 Tools** | Wire 6 tools with JSON-schema validation; reuse `app.js` engine | 1 day |
| **P2 Agent** | ReAct loop (≤4 steps), `toolsJson` injection, JSON extraction, citation rendering | 2–3 days |
| **P3 Grounding** | Embed evidence-kb.json into system prompt + `retrieveEvidence` | 0.5 day |
| **P4 Integrate** | Read/write `localStorage`, "Apply plan" writes back into planner, sparkline reflects adjustment | 1 day |
| **P5 Harden** | Offline caching, lazy bundle, OOM handling (>2 GB model on 4 GB phones), privacy copy, E2E tests | 1–2 days |

---

## 9. Performance & risks

- **Download:** Gemma 4 E2B ~1–1.8 GB (q4f16); Gemma 3 1B ~0.6–1 GB. First load is minutes on slow links — cached thereafter. Show progress bar (as in PyImageSearch demo).
- **Memory:** need ~1.5× model size in GPU memory; iPhone 15 needs the Range-request streaming path (see `gemma-webgpu` 34 tok/s on iPhone 17 Pro). Add an explicit "light model" toggle (Gemma 3 270M, ~300 MB, ~100 tok/s on phone).
- **WebGPU gaps:** Firefox without flag, Safari pre-18, low-end Android → "manual mode" (engine without LLM) rather than a crash.
- **Tool-calling fidelity:** WebLLM/Llama is more reliable than Gemma 4 + manual JSON today. Ship WebLLM/Llama as the Agentic benchmark to catch regressions; keep Gemma 4 as the LiteRT-primary.
- **LiteRT-LM.js maturity:** newer than WebLLM — expect breakage across versions; pin dependency and test against both `.litertlm` and ONNX paths.

---

## 10. Open decisions (need your call)

1. **Primary LiteRT model:** Gemma 4 E2B (richer, heavier) vs Gemma 3 1B (lighter, faster) as the default? Recommend E2B with auto-fallback to 1B on <6 GB devices.
2. **Runtime priority:** LiteRT-LM.js (pure LiteRT, as requested) vs Transformers.js ONNX (more tutorial/docs today)? Recommend LiteRT-LM first, Transformers.js fallback — both Gemma 4.
3. **Bundle strategy:** lazy-load Coach (recommended) or eager?
4. **Progress storage:** keep `localStorage` for MVP or move to IndexedDB now (needed if we store >5 MB of history/images later)?

Tell me your picks and I will scaffold the P0 worker + Coach panel next.
