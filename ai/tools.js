// ai/tools.js — thin wrappers around app.js engine + evidence KB, with safety clamps.
// All AI plans MUST go through these tools — model never writes calories/macros directly.
// Runs as a plain script (no bundler). Uses window.GetFit if available, else no-op.

function retrieveEvidence(kb, topic) {
  const t = (topic || "").toLowerCase();
  return kb.filter(e =>
    e.id.includes(t) ||
    e.claim.toLowerCase().includes(t) ||
    e.verdict.toLowerCase().includes(t)
  ).slice(0, 4);
}

function computeTargets(user) {
  if (!window.GetFit || !window.GetFit.compute) throw new Error("Engine not ready");
  if (user.weight < 35 || user.weight > 250) throw new Error("weight out of range");
  if (user.height < 120 || user.height > 230) throw new Error("height out of range");
  return window.GetFit.compute(user);
}

// Safety-clamped adjustment (used by agent's adjustPlan)
function adjustPlan(currentPlan, progress, feedback) {
  const fb = (feedback || "").toLowerCase();
  let deltaKcal = 0, note = "";
  const last = progress.at(-1), first = progress[0];
  const delta = last && first ? last.weight - first.weight : 0;

  if (fb.includes("stall") || fb.includes("plateau") || (progress.length >= 14 && Math.abs(delta) < 0.3)) {
    if (Math.abs(delta) < 0.4) {
      if (fb.includes("tired") || fb.includes("hungry") || fb.includes("sleep")) {
        deltaKcal = 120; note = "Plateau + fatigue → small refeed/diet break (+120 kcal, mostly carbs) to restore leptin/NEAT. ";
      } else {
        deltaKcal = -150; note = "Plateau with good energy → tighten deficit by ~150 kcal and audit NEAT/tracking. ";
      }
    }
  }
  if (fb.includes("hungry") && deltaKcal === 0) { deltaKcal = 100; note += "Hunger → add fibre + protein, +100 kcal if needed for adherence. "; }
  if (fb.includes("gain") && currentPlan.goal === "gain" && fb.includes("fat")) { deltaKcal = -150; note += "Gain phase adding fat → trim surplus to ~10%. "; }

  deltaKcal = Math.max(-200, Math.min(200, deltaKcal));
  return { deltaKcal, note: note || "Trend looks on track — hold and keep tracking weekly." };
}

window.GetFitTools = { retrieveEvidence, computeTargets, adjustPlan };
