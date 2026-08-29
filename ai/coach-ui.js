// ai/coach-ui.js — chat UI for the LiteRT Gemma 4 coach.
// Lazy-loaded: index.html loads this only when the user opens the Coach panel.

(function () {
  const $ = (id) => document.getElementById(id);

  function appendBubble(role, html) {
    const log = $("coachLog");
    const div = document.createElement("div");
    div.className = "bubble " + role;
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function renderToolTrace(calls, results) {
    if (!calls.length) return "";
    const rows = calls.map((c, i) => {
      const obs = results[i]?.observation;
      const obsStr = obs ? JSON.stringify(obs).slice(0, 220) : "";
      return `<div class="tool-row"><b>${c.tool}</b><code>${c.raw}</code><div class="obs">${obsStr}</div></div>`;
    }).join("");
    return `<div class="trace">${rows}</div>`;
  }

  async function onSend() {
    const input = $("coachInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    $("coachSend").disabled = true;

    appendBubble("user", text);
    appendBubble("assistant", `<span class="typing">Gemma 4 (LiteRT) is thinking… <small>agentic workflow running via LiteRT worker</small></span>`);

    const log = $("coachLog");
    const thinking = log.lastElementChild;

    const events = [];
    const proposalHolder = { proposal: null, evidence: [] };

    // Intercept agent events to show streaming tool calls
    const origOnEvent = (e) => {
      if (e.kind === "tool_call") {
        const row = document.createElement("div");
        row.className = "tool-row live";
        row.innerHTML = `<b>→ ${e.tool}</b> <code>${e.raw}</code>`;
        thinking.appendChild(row);
      }
      if (e.kind === "tool_result") {
        const obs = document.createElement("div");
        obs.className = "obs";
        obs.textContent = JSON.stringify(e.observation).slice(0, 260);
        thinking.lastElementChild?.appendChild(obs);
      }
    };

    // Monkey-patch agent to expose events (our agent already calls onEvent)
    const { text: finalText, toolCalls, toolResults, proposal, evidence } =
      await window.GetFitAgent.runAgent(text, origOnEvent);

    proposalHolder.proposal = proposal;
    proposalHolder.evidence = evidence;

    // Replace typing with final grounded answer
    let html = `<div>${finalText}</div>`;
    html += renderToolTrace(toolCalls, toolResults);

    if (proposal) {
      html += `<div class="proposal"><div class="k">Proposed adjustment</div>
        <div class="v">${proposal.deltaKcal > 0 ? "+" : ""}${proposal.deltaKcal} kcal → new target <b>${proposal.target} kcal</b></div>
        <div class="note">${proposal.note}</div>
        ${proposal.evidence ? `<div class="note"><b>Evidence:</b> ${proposal.evidence}</div>` : ""}
        <button class="cta small" id="applyProposal">Apply to planner</button>
      </div>`;
    } else if (evidence && evidence.length) {
      html += `<div class="note"><b>Evidence:</b> ${evidence.map(e=>`${e.claim} — ${e.verdict}`).join(" · ")}</div>`;
    }

    thinking.innerHTML = html;
    thinking.classList.remove("typing");

    const applyBtn = $("applyProposal");
    if (applyBtn && proposal) {
      applyBtn.addEventListener("click", () => {
        // Apply delta to the planner: store adjusted target as an override
        const u = window.GetFit.readUser();
        const c = window.GetFit.compute(u);
        const newTarget = c.target + proposal.deltaKcal;
        // Persist as a user-visible note + update the form's aggressiveness hint
        localStorage.setItem("getfit_ai_adjustment", JSON.stringify({ deltaKcal: proposal.deltaKcal, at: new Date().toISOString(), reason: proposal.note }));
        // Re-render planner with the new target highlighted
        window.GetFit.renderWithOverride(newTarget, proposal.note);
        appendBubble("system", `Applied: new target <b>${newTarget} kcal</b>. Change is clamped (≤200 kcal) and grounded in evidence. Continue logging weekly to refine.`);
      });
    }

    // Show worker mode badge
    const w = window.GetFitAgent.getWorker();
    // (mode already reported via worker ready; no extra UI needed)

    $("coachSend").disabled = false;
  }

  function init() {
    if (!$("coachPanel")) return;
    $("coachSend").addEventListener("click", onSend);
    $("coachInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } });
    $("coachOpen").addEventListener("click", () => {
      $("coachPanel").classList.toggle("open");
      // init worker on first open (lazy)
      window.GetFitAgent.getWorker();
    });
    // Support mock → real LiteRT swap: if host injects LiteRTLM, worker will pick it up
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
