// ai/worker.js — module worker for LiteRT-based Gemma 4 (with mock fallback for tests).
// Runs off main thread. Tries, in order:
//  1) LiteRT-LM.js (.litertlm) if self.LiteRTLM injected
//  2) Transformers.js ONNX (Gemma 4 E2B q4f16) via WebGPU
//  3) mock rule-based (so agentic flow is testable without 3 GB download).

const MODEL = {
  // LiteRT path (your ask)
  litertUrl: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/model.litertlm",
  // Transformers.js path — same Gemma 4, well-documented (PyImageSearch July 2026)
  onnxId: "onnx-community/gemma-4-E2B-it-ONNX",
  lightOnnxId: "onnx-community/gemma-3-270m-it-ONNX", // ~300 MB fallback for phones
};

let engine = null;
let mode = "mock";
let transformers = null;

async function hasWebGPU() {
  try { return !!navigator.gpu && !!(await navigator.gpu.requestAdapter()); }
  catch { return false; }
}

// Mock Gemma-4-style tool routing (keeps agentic flow testable without download)
function mockToolCalls(prompt) {
  const p = (prompt || "").toLowerCase();
  if (p.includes("stall") || p.includes("plateau") || p.includes("not losing") || p.includes("stuck")) {
    return [{ name: "retrieveEvidence", args: { topic: "plateau" } }, { name: "adjustPlan", args: {} }];
  }
  if (p.includes("hungry")) return [{ name: "retrieveEvidence", args: { topic: "protein" } }, { name: "adjustPlan", args: {} }];
  if (p.includes("tired") || p.includes("fatigue") || p.includes("sleep")) return [{ name: "retrieveEvidence", args: { topic: "plateau" } }];
  if (p.includes("workout") || p.includes("training") || p.includes("exercise")) return [{ name: "generateWorkout", args: {} }];
  if (p.includes("protein") || p.includes("creatine") || p.includes("supplement")) {
    const topic = p.includes("creatine") ? "creatine" : "protein";
    return [{ name: "retrieveEvidence", args: { topic } }];
  }
  return [{ name: "computeTargets", args: {} }];
}

self.onmessage = async (e) => {
  const { type, prompt, toolsJson } = e.data || {};

  if (type === "init") {
    const ok = await hasWebGPU();
    if (!ok) {
      mode = "mock";
      self.postMessage({ type: "ready", mode, reason: "WebGPU unavailable — mock mode. Use Chrome 113+/Edge 113+ with WebGPU to run Gemma 4 locally." });
      return;
    }

    // 1) LiteRT-LM.js (if host injected self.LiteRTLM — e.g., via importmap + dynamic import)
    if (self.LiteRTLM) {
      try {
        // Uncomment to enable real LiteRT Gemma 4:
        // engine = await self.LiteRTLM.create({ modelUrl: MODEL.litertUrl, backend: "webgpu" });
        // mode = "litert";
        mode = "mock";
        self.postMessage({ type: "ready", mode, reason: "LiteRT-LM detected but scaffold in mock (enable MODEL.litertUrl). See AI_PLAN.md §2." });
        return;
      } catch (err) {
        mode = "mock";
        self.postMessage({ type: "ready", mode, reason: "LiteRT-LM init failed: " + err.message });
        return;
      }
    }

    // 2) Transformers.js ONNX — try to load (will cache; first load minutes)
    // We attempt a lightweight feature-check; if transformers not available, stay mock.
    // In production, the main thread can set self.TRANSFORMERS_READY = true after import.
    if (self.TRANSFORMERS_READY && transformers) {
      try {
        mode = "transformers";
        self.postMessage({ type: "ready", mode, reason: `Transformers.js ready — ${MODEL.onnxId} (q4f16, WebGPU). First load ~1–3 GB, cached after.` });
        return;
      } catch (err) {
        mode = "mock";
        self.postMessage({ type: "ready", mode, reason: "Transformers.js init failed: " + err.message });
        return;
      }
    }

    // 3) Mock (default — keeps tests fast)
    mode = "mock";
    self.postMessage({ type: "ready", mode, reason: "Mock mode — no runtime injected. Add LiteRT-LM.js or Transformers.js via importmap to run Gemma 4. See AI_PLAN.md §2." });
  }

  if (type === "loadTransformers") {
    // Main thread asks worker to initialize Transformers.js Gemma 4 (called when user clicks "Enable AI")
    const ok = await hasWebGPU();
    if (!ok) { self.postMessage({ type: "error", error: "WebGPU required for Gemma 4" }); return; }
    try {
      // Dynamic import inside worker (module worker)
      // This will download ~1–3 GB on first run; subsequent loads hit Cache API.
      transformers = await import("@huggingface/transformers");
      const { pipeline } = transformers;
      self.postMessage({ type: "progress", status: "loading", pct: 0, note: `Downloading ${MODEL.onnxId} (q4f16)…` });
      engine = await pipeline("text-generation", MODEL.onnxId, {
        dtype: "q4f16",
        device: "webgpu",
        progress_callback: (p) => self.postMessage({ type: "progress", status: "downloading", pct: Math.round(p.progress || 0), note: p.status }),
      });
      mode = "transformers";
      self.TRANSFORMERS_READY = true;
      self.postMessage({ type: "ready", mode, reason: `Loaded ${MODEL.onnxId} via Transformers.js (WebGPU).` });
    } catch (err) {
      mode = "mock";
      self.postMessage({ type: "error", error: err.message, fallback: "mock" });
    }
  }

  if (type === "generate") {
    if (mode === "transformers" && engine) {
      // Real Gemma 4 generation with tool-calling template
      try {
        const messages = [
          { role: "system", content: "You are GetFit Coach. Use tools when needed. Never hallucinate calories — always call a tool. Evidence: protein 1.6-2.2 g/kg, deficit ≤25%, CICO is king." },
          { role: "user", content: prompt },
        ];
        // Transformers.js Gemma 4 expects tools via chat template
        const tools = toolsJson ? JSON.parse(toolsJson) : [];
        const out = await engine(messages, { max_new_tokens: 256, tools, do_sample: false });
        const text = out[0]?.generated_text?.at(-1)?.content || "";
        // Parse <|tool_call|>call:name{...}<tool_call|> (Gemma 4 format)
        const calls = [...text.matchAll(/<\|tool_call\|>call:(\w+)\{(.*?)\}<tool_call\|>/gs)].map(m => {
          const name = m[1];
          const argsStr = m[2];
          const args = {};
          for (const [, k, v1, v2] of argsStr.matchAll(/(\w+):(?:<\|"\|>(.*?)<\|"\|>|([^,}]*))/g)) args[k] = (v1 ?? v2 ?? "").trim().replace(/^"|"$/g, "");
          return { name, args, raw: m[0] };
        });
        if (calls.length) {
          for (const tc of calls) self.postMessage({ type: "tool_call", tool: tc.name, args: tc.args, raw: tc.raw });
          self.postMessage({ type: "done", text: "Gemma 4 tool calls executed. See trace." });
        } else {
          self.postMessage({ type: "done", text: text || "No tool call — answer directly from context." });
        }
      } catch (err) {
        self.postMessage({ type: "error", error: err.message });
        // Fallback to mock so UI stays usable
        for (const tc of mockToolCalls(prompt)) {
          self.postMessage({ type: "tool_call", tool: tc.name, args: tc.args, raw: `<|tool_call|>call:${tc.name}{${Object.entries(tc.args).map(([k,v])=>`${k}:<|"|>${v}<|"|>`).join(",")}}<tool_call|>` });
        }
        self.postMessage({ type: "done", text: "Gemma 4 error — fell back to mock tools. See trace." });
      }
      return;
    }

    // Mock path (used in tests + when WebGPU/model unavailable)
    for (const tc of mockToolCalls(prompt)) {
      self.postMessage({ type: "tool_call", tool: tc.name, args: tc.args, raw: `<|tool_call|>call:${tc.name}{${Object.entries(tc.args).map(([k,v])=>`${k}:<|"|>${v}<|"|>`).join(",")}}<tool_call|>` });
      await new Promise(r => setTimeout(r, 120));
    }
    self.postMessage({ type: "done", text: "Analyzed via evidence-grounded tools (mock Gemma 4). See trace — Apply to update planner." });
  }
};
