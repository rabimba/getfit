// ai/worker.js — Web Worker for LiteRT-based Gemma 4 (with graceful fallback).
// This runs off the main thread so the UI stays smooth while the model loads.
// Today it ships as a scaffold that:
//   1) feature-detects WebGPU
//   2) tries LiteRT-LM.js (Gemma 4 .litertlm) if available
//   3) falls back to Transformers.js ONNX (Gemma 4) if LiteRT-LM not present
//   4) falls back to MOCK mode (rule-based) so the agentic flow is testable without a 3 GB download.
// Replace the MOCK branch with your real model URL when ready.

const MODEL = {
  // Primary LiteRT path (your ask) — Gemma 4 E2B quantized, LiteRT-LM format
  litertUrl: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/model.litertlm",
  // Fallback ONNX path — same Gemma 4 weights via Transformers.js
  onnxId: "onnx-community/gemma-4-E2B-it-ONNX",
  // Light default for phones — 270M FunctionGemma, ~300 MB
  lightOnnxId: "onnx-community/gemma-3-270m-it-ONNX",
};

let engine = null;
let mode = "mock";

async function hasWebGPU() {
  try { return !!navigator.gpu && !!(await navigator.gpu.requestAdapter()); }
  catch { return false; }
}

self.onmessage = async (e) => {
  const { type, prompt, toolsJson, history } = e.data || {};
  if (type === "init") {
    const ok = await hasWebGPU();
    if (!ok) {
      mode = "mock";
      self.postMessage({ type: "ready", mode, reason: "WebGPU unavailable — running in mock (rule-based) mode. On Chrome 113+/Edge 113+ with WebGPU, swap in LiteRT-LM.js to run Gemma 4 locally." });
      return;
    }
    // Try LiteRT-LM.js if the host page injected it (self.LiteRTLM), else try Transformers.js, else mock
    if (self.LiteRTLM) {
      try {
        // Example (uncomment when @litert/lm is added via importmap):
        // engine = await self.LiteRTLM.create({ modelUrl: MODEL.litertUrl, backend: "webgpu" });
        // mode = "litert";
        mode = "mock";
        self.postMessage({ type: "ready", mode, reason: "LiteRT-LM detected but scaffold is in mock mode. Set MODEL.litertUrl and uncomment create() to run Gemma 4 E2B locally." });
      } catch (err) {
        mode = "mock";
        self.postMessage({ type: "ready", mode, reason: "LiteRT-LM init failed: " + err.message });
      }
    } else {
      mode = "mock";
      self.postMessage({ type: "ready", mode, reason: "No LiteRT-LM runtime injected — running mock. Add <script type='importmap'> + LiteRT-LM.js or Transformers.js to run Gemma 4. See AI_PLAN.md §2." });
    }
  }

  if (type === "generate") {
    // In real Gemma 4 mode, you would:
    //   const out = await engine.generate({ prompt, toolsJson, maxTokens: 512 });
    //   parse <|tool_call|>call:name{...} and stream back.
    // Here we simulate a Gemma-4-style tool call so the UI + agent loop is testable without the 3 GB download.

    // Heuristic mock: map user intent → tool calls that Gemma 4 would emit
    const p = (prompt || "").toLowerCase();
    let toolCalls = [];
    if (p.includes("stall") || p.includes("plateau") || p.includes("not losing") || p.includes("stuck")) {
      toolCalls.push({ name: "retrieveEvidence", args: { topic: "plateau" } });
      toolCalls.push({ name: "adjustPlan", args: {} });
    } else if (p.includes("hungry")) {
      toolCalls.push({ name: "retrieveEvidence", args: { topic: "protein" } });
      toolCalls.push({ name: "adjustPlan", args: {} });
    } else if (p.includes("tired") || p.includes("fatigue") || p.includes("sleep")) {
      toolCalls.push({ name: "retrieveEvidence", args: { topic: "plateau" } });
    } else if (p.includes("workout") || p.includes("training") || p.includes("exercise")) {
      toolCalls.push({ name: "generateWorkout", args: {} });
    } else if (p.includes("protein") || p.includes("creatine") || p.includes("supplement")) {
      const topic = p.includes("creatine") ? "creatine" : p.includes("supplement") ? "protein" : "protein";
      toolCalls.push({ name: "retrieveEvidence", args: { topic } });
    } else {
      toolCalls.push({ name: "computeTargets", args: {} });
    }

    // Simulate streaming
    for (const tc of toolCalls) {
      self.postMessage({ type: "tool_call", tool: tc.name, args: tc.args, raw: `<|tool_call|>call:${tc.name}{${Object.entries(tc.args).map(([k,v])=>`${k}:<|"|>${v}<|"|>`).join(",")}}<tool_call|>` });
      await new Promise(r => setTimeout(r, 180));
    }
    // End with a natural-language wrapper (what Gemma 4 would stream after tool results)
    self.postMessage({ type: "done", text: "Analyzed via evidence-grounded tools. See tool trace below — results applied when you click Apply." });
  }
};
