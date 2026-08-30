// ai/coach-ui.js — chat UI for the LiteRT Gemma 4 coach (human-friendly).

(function () {
  const $ = (id) => document.getElementById(id);

  function appendBubble(role, html) {
    const log = $("coachLog");
    const div = document.createElement("div");
    div.className = "bubble " + role;
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function fmtEvidence(list) {
    if (!list || !list.length) return "";
    return list.map(e => {
      const badge = e.verdict === "TRUE" ? "✓" : e.verdict === "MYTH" || e.verdict === "FALSE" ? "✕" : "≈";
      const color = e.verdict === "TRUE" ? "#065f46" : e.verdict === "MYTH" ? "#9a3412" : "#475569";
      return `<div style="display:flex;gap:8px;margin:6px 0;font-size:13px"><span style="color:${color};font-weight:800">${badge} ${e.verdict}</span><span><b>${e.claim}</b> — ${e.note} <span style="color:#64748b">(${e.cite})</span></span></div>`;
    }).join("");
  }

  function fmtCompute(o) {
    if (!o || o.error) return `<div class="note">Error: ${o?.error || "unknown"}</div>`;
    return `<div class="cards" style="margin-top:10px">
      <div class="metric"><div class="k">BMR (${o.method})</div><div class="v">${o.bmr} <small>kcal</small></div></div>
      <div class="metric"><div class="k">TDEE</div><div class="v">${o.tdee} <small>kcal</small></div></div>
      <div class="metric"><div class="k">Target</div><div class="v">${o.target} <small>kcal (${o.adjustPct}%)</small></div></div>
      <div class="metric"><div class="k">Macros</div><div class="v" style="font-size:14px">${o.proteinG}P · ${o.carbG}C · ${o.fatG}F <small>g</small></div></div>
    </div>`;
  }

  function fmtWorkout(o) {
    if (!o || !o.plan) return "";
    const days = o.plan.map(d => `<div class="metric" style="margin-top:8px"><div class="k">${d.day}</div><ul style="margin:6px 0 0;padding-left:18px">${d.ex.map(e=>`<li>${e[0]} — <b>${e[1]}</b></li>`).join("")}</ul></div>`).join("");
    return `<div style="margin-top:10px"><div style="font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:0.06em">Weekly workout</div>${days}<div class="note" style="margin-top:10px">${o.cardio || ""}</div></div>`;
  }

  async function onSend() {
    const input = $("coachInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    $("coachSend").disabled = true;

    appendBubble("user", text);
    const thinking = appendBubble("assistant", `<span class="typing">Gemma 4 is thinking… <small>agentic workflow via LiteRT worker</small></span>`);
    let liveBox = null;

    const onEvent = (e) => {
      if (e.kind === "tool_call") {
        if (!liveBox) {
          liveBox = document.createElement("div");
          liveBox.className = "tool-row";
          liveBox.innerHTML = `<div style="font-weight:700;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#64748b">Evidence-grounded tools</div>`;
          thinking.appendChild(liveBox);
        }
        const row = document.createElement("div");
        row.style.cssText = "margin-top:6px;font-size:12px;color:#0f172a";
        row.textContent = `→ ${e.tool}`;
        liveBox.appendChild(row);
      }
      if (e.kind === "tool_result") {
        // live streaming not needed — final render will show formatted cards
      }
    };

    const { text: finalText, toolResults, proposal, evidence } = await window.GetFitAgent.runAgent(text, onEvent);

    // Build human-friendly final answer
    let html = "";
    // Friendly intro based on what was called
    const hasCompute = toolResults.some(r => r.tool === "computeTargets");
    const hasWorkout = toolResults.some(r => r.tool === "generateWorkout");
    const hasAdjust = toolResults.some(r => r.tool === "adjustPlan");

    if (hasAdjust && proposal) {
      html += `<div style="font-weight:700">Here's your adjustment — grounded in evidence:</div>
        <div class="proposal"><div class="k">Proposed change</div>
          <div class="v" style="font-size:18px;font-weight:800">${proposal.deltaKcal > 0 ? "+" : ""}${proposal.deltaKcal} kcal → <b>${proposal.target} kcal/day</b></div>
          <div class="note" style="margin-top:8px">${proposal.note}</div>
          <button class="cta small" id="applyProposal" style="margin-top:10px">Apply to planner</button>
        </div>`;
    } else if (hasCompute) {
      const obs = toolResults.find(r=>r.tool==="computeTargets")?.observation;
      html += `<div style="font-weight:700">Your current targets (evidence-based):</div>${fmtCompute(obs)}<div class="note" style="margin-top:10px">Based on Mifflin–St Jeor (or Katch–McArdle if body-fat given) × activity, with protein 1.6–2.2 g/kg. Log weekly weight to let the coach auto-adjust.</div>`;
    } else if (hasWorkout) {
      const obs = toolResults.find(r=>r.tool==="generateWorkout")?.observation;
      html += `<div style="font-weight:700">Here's a weekly plan for you:</div>${fmtWorkout(obs)}`;
    } else {
      html += `<div>${finalText}</div>`;
    }

    if (evidence && evidence.length) {
      html += `<details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;font-weight:700;color:#64748b">Evidence trace (${evidence.length})</summary><div style="margin-top:8px">${fmtEvidence(evidence)}</div></details>`;
    }
    // Technical trace collapsed by default (for debugging)
    if (toolResults.length) {
      const raw = toolResults.map(r=> `${r.tool}: ${JSON.stringify(r.observation).slice(0,180)}`).join(" · ");
      html += `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:11px;color:#94a3b8">Technical trace</summary><code style="display:block;margin-top:6px;font-size:11px;word-break:break-all;background:#f1f5f9;padding:8px;border-radius:8px">${raw}</code></details>`;
      html += `<div class="note" style="margin-top:10px">Running in <b>mock mode</b> (no WebGPU/model) — same grounded tools, same clamps. On Chrome 113+ with WebGPU, Gemma 4 runs locally via LiteRT (see AI_PLAN.md §2). All adjustments stay ≤200 kcal and cite evidence.</div>`;
    }

    thinking.innerHTML = html;

    const applyBtn = document.getElementById("applyProposal");
    if (applyBtn && proposal) {
      applyBtn.addEventListener("click", () => {
        const u = window.GetFit.readUser();
        const c = window.GetFit.compute(u);
        const newTarget = c.target + proposal.deltaKcal;
        localStorage.setItem("getfit_ai_adjustment", JSON.stringify({ deltaKcal: proposal.deltaKcal, at: new Date().toISOString(), reason: proposal.note }));
        window.GetFit.renderWithOverride(newTarget, proposal.note);
        appendBubble("system", `Applied: new target <b>${newTarget} kcal</b>. Change is clamped (≤200 kcal) and grounded in evidence. Keep logging weekly.`);
      });
    }
    $("coachSend").disabled = false;
  }

  function init() {
    if (!$("coachPanel")) return;
    $("coachSend").addEventListener("click", onSend);
    $("coachInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } });
    $("coachOpen").addEventListener("click", () => {
      const p = $("coachPanel");
      const open = p.classList.toggle("open");
      $("coachOpen").textContent = open ? "Close" : "Open coach";
      window.GetFitAgent.getWorker();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
