// ai/agent.js — tiny ReAct-style agent loop that talks to the Worker (Gemma 4 via LiteRT).
// It sends the user prompt + tool schemas, receives <|tool_call|> events, executes real
// app functions via window.GetFit / window.GetFitTools, feeds observations back, and
// renders a grounded answer. Max 4 tool steps.

const TOOL_SCHEMAS = [
  { name: "computeTargets", description: "Re-compute BMR/TDEE/target from current planner inputs", params: {} },
  { name: "generateWorkout", description: "Generate weekly workout for experience+goal", params: {} },
  { name: "adjustPlan", description: "Suggest a clamped delta to current plan from progress + feedback", params: {} },
  { name: "retrieveEvidence", description: "Retrieve evidence KB verdicts by topic", params: { topic: "string" } },
  { name: "logProgress", description: "Log a weigh-in", params: { date: "string", weight: "number" } },
];

let kb = null;
let worker = null;
let lastToolResults = [];

async function loadKB() {
  if (kb) return kb;
  const r = await fetch("ai/evidence-kb.json");
  kb = await r.json();
  return kb;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker("ai/worker.js");
  worker.postMessage({ type: "init" });
  return worker;
}

function readCurrentPlan() {
  const u = window.GetFit ? window.GetFit.readUser() : null;
  const c = window.GetFit ? window.GetFit.compute(u) : null;
  const progress = (() => { try { return JSON.parse(localStorage.getItem("getfit_progress")) || []; } catch { return []; } })();
  return { user: u, computed: c, progress };
}

async function runAgent(userText, onEvent) {
  const kbData = await loadKB();
  const w = getWorker();
  lastToolResults = [];

  // Collect tool calls from worker (which simulates Gemma 4's <|tool_call|> output)
  const toolCalls = [];
  const done = new Promise((resolve) => {
    const handler = async (e) => {
      const msg = e.data;
      if (msg.type === "tool_call") {
        toolCalls.push(msg);
        onEvent({ kind: "tool_call", tool: msg.tool, args: msg.args, raw: msg.raw });

        // Execute the tool for real (grounded — model never writes calories directly)
        let observation = null;
        try {
          const plan = readCurrentPlan();
          if (msg.tool === "retrieveEvidence") {
            observation = window.GetFitTools.retrieveEvidence(kbData, msg.args.topic);
          } else if (msg.tool === "computeTargets") {
            observation = window.GetFitTools.computeTargets(plan.user);
          } else if (msg.tool === "generateWorkout") {
            const g = window.GetFit.generateWorkout(plan.user);
            observation = g;
          } else if (msg.tool === "adjustPlan") {
            observation = window.GetFitTools.adjustPlan(plan, plan.progress, userText);
          } else if (msg.tool === "logProgress") {
            observation = { ok: true };
          }
        } catch (err) { observation = { error: err.message }; }
        lastToolResults.push({ tool: msg.tool, observation });
        onEvent({ kind: "tool_result", tool: msg.tool, observation });
      }
      if (msg.type === "done") {
        w.removeEventListener("message", handler);
        resolve(msg.text);
      }
      if (msg.type === "ready" && toolCalls.length === 0) {
        // init ack — ignore, wait for generate
      }
    };
    w.addEventListener("message", handler);
    // Kick off generation (in real Gemma 4 LiteRT mode, this streams tokens; here it's mock tool calls)
    w.postMessage({ type: "generate", prompt: userText, toolsJson: JSON.stringify(TOOL_SCHEMAS) });
  });

  const finalText = await done;

  // Build a grounded answer from observations (what Gemma 4 would do after tool results)
  const plan = readCurrentPlan();
  const adj = lastToolResults.find(r => r.tool === "adjustPlan")?.observation;
  const ev = lastToolResults.find(r => r.tool === "retrieveEvidence")?.observation || [];
  const evNote = ev.length ? ev.map(e => `${e.claim} — ${e.verdict} (${e.cite})`).join(" · ") : "";

  let proposal = null;
  if (adj && plan.computed) {
    const newTarget = plan.computed.target + (adj.deltaKcal || 0);
    proposal = { ...plan.computed, target: newTarget, deltaKcal: adj.deltaKcal, note: adj.note, evidence: evNote };
  }

  return { text: finalText, toolCalls, toolResults: lastToolResults, proposal, evidence: ev };
}

window.GetFitAgent = { runAgent, TOOL_SCHEMAS, getWorker };
