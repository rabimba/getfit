# GetFit AI Coach — On-Device, Agentic Plan

Goal: an in-browser AI that reads the user's logged progress + chat, and **adjusts
diet and workout** using tool calls, grounded in the peer-reviewed evidence base
from our fact-check. Everything runs locally (no servers, no data leaving the browser).

---

## 1. Model choice — browser + agentic

> Note: there is **no "Gemma 4"** yet. The current on-device Google model family is
> **Gemma 3 / Gemma 3n** (2025). Use that, or a peer with strong function-calling.

| Option | Size (quantized) | Browser runtime | Agentic/tool-calling |
|---|---|---|---|
| **Gemma 3 1B / 4B** or **Gemma 3n 2B/4B** | ~0.5–2.5 GB (int4) | **MediaPipe LLM Inference (GenAI)** or **Transformers.js (WebGPU)** | MediaPipe supports in-context function calling; Transformers.js needs a JS agent loop |
| **Llama-3.2-3B-Instruct** | ~1.8 GB (int4) | **WebLLM (MLC)** | Reliable tool-call chat template; easiest agentic path today |
| Phi-3-mini / Qwen2.5-3B | ~1.5–2 GB (int4) | WebLLM / Transformers.js | Good tool-calling, smaller |

**Recommendation:** start with **WebLLM + Llama-3.2-3B-Instruct (int4)** for the most
reliable in-browser tool-calling today; offer **Gemma 3n 4B via MediaPipe** as the
"fully on-device Google" path. Both run on **WebGPU**; fall back to **WASM** (slower)
when WebGPU is unavailable, and degrade gracefully to "manual mode" if neither works.

"LiteRT" = TensorFlow Lite / Google's on-device runtime; the browser-facing piece is
**MediaPipe GenAI + LiteRT Web**, which is the correct route for Gemma 3n.

---

## 2. Architecture

```
┌─────────────────────────────────────────────┐
│  Browser (GetFit app)                         │
│                                               │
│  Progress tracker (localStorage)  ──┐         │
│  Planner engine (BMR/TDEE/macros)  ──┤        │
│                                     │         │
│  ┌─────────────── AI Coach ────────┐│         │
│  │  Chat UI + "Apply plan" button   ││         │
│  │       │                          ││         │
│  │  ┌────▼─────┐   tool calls       ││         │
│  │  │ Agent    │ ─────────────┐     ││         │
│  │  │ loop     │              │     ││         │
│  │  └────┬─────┘ ◄───────────┘     ││         │
│  │       │ executes                 ││         │
│  │  ┌────▼─────────────────────┐   ││         │
│  │  │ Tools (JS functions)     │   ││         │
│  │  │  computeTargets()        │   ││         │
│  │  │  recommendMacros()       │   ││         │
│  │  │  generateWorkout()       │   ││         │
│  │  │  adjustPlan()            │   ││         │
│  │  │  logProgress()           │   ││         │
│  │  │  retrieveEvidence()      │   ││         │
│  │  └──────────────────────────┘   ││         │
│  └─────────────────────────────────┘│         │
│                                     │         │
│  ┌────────── Evidence KB ──────────┐│         │
│  │ fact-check verdicts (read-only) │◄┘         │
│  └─────────────────────────────────┘           │
│                                               │
│  On-device model (WebGPU/WASM)  ← no network  │
└─────────────────────────────────────────────┘
```

---

## 3. The agent loop (how agentic works)

1. System prompt = **evidence rules** (protein 1.6–2.2 g/kg, deficit ≤25%,
   CICO is king, no somatotypes/water-fat/ZMA-myth, etc.) + tool schemas.
2. User sends a message (e.g. "I stalled at 74 kg for 3 weeks, feel tired").
3. Agent decides to call `retrieveEvidence("plateau")` and `adjustPlan(...)`.
4. Tools run **real app code** (reuse `compute`, `generateWorkout`) and return JSON.
5. Agent produces a revised diet + workout, citing the evidence it used.
6. "Apply plan" writes the new targets/workout back into the planner UI.

This keeps the model **grounded**: it can only emit plans through our validated
functions and within safe bounds, so it cannot drift into bro-science.

---

## 4. Tools (initial set)

| Tool | Inputs | Action |
|---|---|---|
| `computeTargets` | sex, age, height, weight, bodyfat, activity, goal, aggressiveness | returns BMR/TDEE/target (reuses engine) |
| `recommendMacros` | goal, weight | returns protein/carb/fat grams |
| `generateWorkout` | experience, goal | returns weekly plan (reuses generator) |
| `adjustPlan` | currentPlan, progress[], feedback | nudges calories ±100–200, macros, training volume |
| `logProgress` | date, weight | writes to localStorage |
| `retrieveEvidence` | topic | returns curated verdict snippets from our fact-check |

---

## 5. Grounding & safety (critical)

- System prompt **forbids** the debunked claims (somatotypes, water-burns-fat,
  LISS/cortisol myth, ZMA→testosterone, ice-cream metabolism, chromium fix).
- `adjustPlan` clamps: protein ≥1.6 g/kg, deficit ≤25%, surplus ≤20%.
- All plans cite an evidence note; user can expand "why".
- Fully local: no telemetry. Optional "export plan (JSON/PDF)" for a clinician.

---

## 6. Build phases

1. **POC** — load Gemma 3n / Llama-3.2-3B in a Web Worker; chat box in a new
   "AI Coach" panel; stream tokens.
2. **Tool layer** — expose the 6 functions above with enforced JSON schemas.
3. **Agent loop** — parse tool calls, execute, feed back, iterate ≤4 steps.
4. **Grounding KB** — embed fact-check verdicts as system context.
5. **Integrate** — agent reads `localStorage` progress, proposes adjustments,
   "Apply" writes back into the planner.
6. **Hardening** — WebGPU/WASM fallback, offline model caching (Cache API),
   privacy notice, input sanitization.

## 7. Open questions for you
- Prefer **WebLLM/Llama** (smoothest tool-calling now) or **Gemma 3n/MediaPipe**
  (Google-native, "LiteRT") as the primary path?
- First model size budget: 1B/2B (fast, weaker reasoning) vs 3B/4B (slower load,
  better agentic)?
- Should the AI Coach be a separate lazy-loaded bundle (so the core planner stays
  light on first paint)?
