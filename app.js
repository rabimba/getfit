// GetFit — science-based recommendation engine
// Every rule below is grounded in peer-reviewed evidence (see fact-check report).
// Myths from the source PDF (somatotypes, water-burns-fat, ZMA->testosterone,
// cortisol/LISS myth, ice-cream metabolism myth) are deliberately excluded.

const ACTIVITY_LABELS = {
  "1.2": "Sedentary",
  "1.375": "Light",
  "1.55": "Moderate",
  "1.725": "Active",
  "1.9": "Very active",
};

const DEFICIT = { mild: 0.10, moderate: 0.18, aggressive: 0.25 };
const SURPLUS = { mild: 0.10, moderate: 0.15, aggressive: 0.20 };
const PROTEIN_PER_KG = { loss: 2.0, maintain: 1.8, gain: 1.8 };
const FAT_FRACTION = 0.25;

function round(n, p = 0) {
  const f = Math.pow(10, p);
  return Math.round(n * f) / f;
}

function computeBMR(u) {
  const w = u.weight, h = u.height, age = u.age;
  if (u.bodyfat && u.bodyfat > 0) {
    const lbm = w * (1 - u.bodyfat / 100);
    // Katch-McArdle (lean-mass based) — preferred when body-fat is known
    return { bmr: 370 + 21.6 * lbm, method: "Katch–McArdle (lean-mass)" };
  }
  // Mifflin–St Jeor — current gold-standard estimator
  const base = 10 * w + 6.25 * h - 5 * age;
  const bmr = u.sex === "male" ? base + 5 : base - 161;
  return { bmr, method: "Mifflin–St Jeor" };
}

function compute(user) {
  const { bmr, method } = computeBMR(user);
  const tdee = bmr * parseFloat(user.activity);

  let adjust = 0;
  if (user.goal === "loss") adjust = -DEFICIT[user.aggressiveness];
  else if (user.goal === "gain") adjust = SURPLUS[user.aggressiveness];

  let target = tdee * (1 + adjust);

  // Macros (total bodyweight basis — evidence: ISSN 1.6–2.2 g/kg)
  let proteinPerKg = PROTEIN_PER_KG[user.goal];
  let proteinG = proteinPerKg * user.weight;
  let proteinCal = proteinG * 4;

  // Safety clamp: if protein alone eats the whole budget, trim protein to 1.2 g/kg
  if (proteinCal > target * 0.55) {
    proteinPerKg = 1.2;
    proteinG = proteinPerKg * user.weight;
    proteinCal = proteinG * 4;
  }

  const fatCal = FAT_FRACTION * target;
  const fatG = fatCal / 9;
  let carbCal = target - proteinCal - fatCal;
  if (carbCal < 0) carbCal = 0;
  const carbG = carbCal / 4;

  const lbm = user.bodyfat ? user.weight * (1 - user.bodyfat / 100) : null;

  return {
    bmr: round(bmr),
    method,
    tdee: round(tdee),
    target: round(target),
    adjustPct: Math.round(adjust * 100),
    proteinG: round(proteinG),
    carbG: round(carbG),
    fatG: round(fatG),
    lbm: lbm ? round(lbm, 1) : null,
  };
}

function dietSuggestions(user, c) {
  const items = [];
  items.push(`Target <b>${c.target} kcal/day</b> (a ${Math.abs(c.adjustPct)}% ${user.goal === "loss" ? "deficit" : user.goal === "gain" ? "surplus" : "maintenance"} from your TDEE of ${c.tdee}).`);
  items.push(`Protein: <b>${c.proteinG} g/day</b> (~${PROTEIN_PER_KG[user.goal]} g/kg). This is the single most important macro for preserving muscle while losing fat.`);
  items.push(`Carbs: <b>${c.carbG} g</b> and Fat: <b>${c.fatG} g</b> fill the rest. No need to fear carbs — fat loss is driven by total calories, not "insulin spikes stopping fat burn" (a myth).`);

  const tips = {
    loss: "Keep the deficit moderate (10–20%). Crash diets slow your metabolism and the weight comes back; a slower cut preserves muscle and is more sustainable.",
    maintain: "Hold at maintenance and keep protein high. Sustainability — not the perfect macro split — predicts long-term success.",
    gain: "Use a modest surplus (10–15%). A bigger surplus mostly adds fat, not muscle. Pair with progressive overload.",
  };
  items.push(tips[user.goal]);

  // Food sources by preference
  let sources;
  if (user.diet === "mixed")
    sources = "chicken/fish/eggs, whey or blended protein, paneer, Greek yogurt, legumes, rice/oats, nuts, vegetables.";
  else if (user.diet === "veg")
    sources = "paneer, Greek yogurt, milk, eggs (optional), legumes/dal, tofu, soy chunks, whey (if not strict), oats/rice, nuts, vegetables.";
  else
    sources = "tofu, tempeh, soy chunks, legumes/dal, vegan protein powder, nutritional yeast, oats/rice, nuts/seeds, vegetables (add algae-based omega-3).";
  items.push(`<b>Staple foods:</b> ${sources}`);

  items.push("Eat <b>fibre-rich vegetables</b> for satiety at a deficit — they help you feel full on fewer calories and aid digestion.");
  items.push("<b>Hydrate well</b> for kidney/liver function and performance — but water does not itself 'burn fat' (another myth). Drink to thirst + with meals.");
  items.push("<b>Creatine monohydrate</b> (3–5 g/day) is the most evidence-backed supplement and safely increases training capacity. A multivitamin covers common gaps. <b>BCAAs are unnecessary</b> if total protein is adequate.");
  items.push("<b>Sleep 7–9 h</b> and manage stress — chronic cortisol (from poor sleep/stress) is what harms muscle, not ordinary cardio.");
  return items;
}

function workoutHTML(user) {
  const { plan, cardio } = generateWorkout(user);
  const days = plan.map(d => `
    <div class="metric" style="margin-top:10px">
      <div class="k">${d.day}</div>
      <ul style="margin:6px 0 0;padding-left:18px">${d.ex.map(e => `<li>${e[0]} — <b>${e[1]}</b></li>`).join("")}</ul>
    </div>`).join("");
  return `<h3>Weekly workout</h3>${days}<div class="note">${cardio} Train near failure; progressive overload (add reps/weight over time). Allow 48–72 h between same-muscle sessions.</div>`;
}

function trainingSuggestions(user) {
  const items = [];
  const split = {
    beginner: "Full-body routine <b>3×/week</b> (e.g., Mon/Wed/Fri). Master compound lifts: squat, hinge, press, row.",
    intermediate: "Upper/Lower or Push/Pull/Legs split, <b>4–5×/week</b>. ~10–20 hard sets per muscle group per week.",
    advanced: "Specialised 5–6×/week split with periodization (vary reps/loads across blocks).",
  }[user.experience];

  items.push(`<b>Structure:</b> ${split}`);
  items.push("Priority #1 for fat loss is <b>resistance training</b> — it preserves muscle so the weight you lose is fat. Cardio is optional; both LISS and HIIT are fine for heart health.");
  items.push("Train <b>near failure</b> across a range of reps (≈6–15). Muscle grows from progressive overload and effort, not a magic tempo or 'fiber-type rep prescription'.");
  items.push("Allow <b>48–72 h recovery</b> per muscle group. You do not need (and should not do) maximal sets daily.");
  items.push("For women: lifting 'tones' by building muscle and losing fat — not through extra aerobics. The same progressive plan applies.");

  if (user.goal === "gain")
    items.push("Push for small, consistent load/reps increases. Eat in the modest surplus above and keep protein high.");
  if (user.goal === "loss")
    items.push("Keep lifting heavy even in a deficit — this is what tells your body to spare muscle and burn fat.");

  return items;
}

// ---------- Workout generator (evidence-based, experience + goal driven) ----------
function generateWorkout(user) {
  const loss = user.goal === "loss";
  const gain = user.goal === "gain";
  const mainReps = loss ? "10–15" : gain ? "6–10" : "8–12";
  const cardio = loss
    ? "Add 2–3 sessions/week of LISS (walk, cycle) or HIIT (optional, for heart health — not required for fat loss)."
    : "Optional 1–2 LISS sessions/week for general health.";

  let plan;
  if (user.experience === "beginner") {
    plan = [
      { day: "Day A (e.g. Mon)", ex: [["Goblet / back squat", "3×8–12"], ["Push-up or bench press", "3×8–12"], ["Dumbbell row", "3×8–12"], ["Plank", "3×30–45s"]] },
      { day: "Day B (e.g. Wed)", ex: [["Romanian deadlift", "3×8–12"], ["Overhead press", "3×8–12"], ["Lat pulldown", "3×8–12"], ["Reverse lunge", "3×10–12"]] },
      { day: "Day C (e.g. Fri)", ex: [["Front squat", "3×8–12"], ["Incline push-up/press", "3×8–12"], ["Chest-supported row", "3×8–12"], ["Hanging/lying leg raise", "3×12–15"]] },
    ];
  } else if (user.experience === "intermediate") {
    plan = [
      { day: "Upper A", ex: [["Bench press", `4×${mainReps}`], ["Barbell row", `4×${mainReps}`], ["Overhead press", `3×${mainReps}`], ["Lat pulldown", `3×10–12`], ["Face pull", "3×15"]] },
      { day: "Lower A", ex: [["Squat", `4×${mainReps}`], ["Romanian deadlift", `3×${mainReps}`], ["Leg press", `3×10–12`], ["Standing calf raise", "4×12–15"]] },
      { day: "Upper B", ex: [["Incline press", `4×${mainReps}`], ["Cable row", `4×${mainReps}`], ["Lateral raise", "3×12–15"], ["Bicep curl + triceps ext.", "3×10–12"]] },
      { day: "Lower B", ex: [["Deadlift", `3×${mainReps}`], ["Bulgarian split squat", `3×10–12`], ["Leg curl", `3×10–12`], ["Seated calf raise", "4×12–15"]] },
    ];
  } else {
    plan = [
      { day: "Push A", ex: [["Overhead press", `4×${mainReps}`], ["Incline bench", `4×${mainReps}`], ["Cable fly", `3×12–15`], ["Lateral raise", "4×12–15"], ["Triceps pushdown", "3×10–12"]] },
      { day: "Pull A", ex: [["Deadlift / heavy row", `4×${mainReps}`], ["Lat pulldown", `4×${mainReps}`], ["Chest-supported row", `3×10–12`], ["Face pull", "4×15"], ["Bicep curl", "3×10–12"]] },
      { day: "Legs A", ex: [["Squat", `4×${mainReps}`], ["Romanian deadlift", `3×${mainReps}`], ["Leg press", `3×10–12`], ["Leg curl", `3×10–12`], ["Calf raise", "5×12–15"]] },
      { day: "Push B", ex: [["Flat bench", `4×${mainReps}`], ["Dumbbell shoulder press", `3×${mainReps}`], ["Dips", `3×8–12`], ["Triceps ext.", "3×10–12"]] },
      { day: "Pull B", ex: [["Weighted pull-up", `4×${mainReps}`], ["Barbell row", `4×${mainReps}`], ["Reverse pec deck", "3×15"], ["Hammer curl", "3×10–12"]] },
      { day: "Legs B", ex: [["Front squat", `4×${mainReps}`], ["Hip thrust / RDL", `3×${mainReps}`], ["Lunge", `3×10–12`], ["Leg extension", `3×12–15`], ["Calf raise", "5×12–15"]] },
    ];
  }
  return { plan, cardio };
}

// ---------- Progress tracking (localStorage) ----------
const PROG_KEY = "getfit_progress";
const INPUT_KEY = "getfit_inputs";

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROG_KEY)) || []; }
  catch { return []; }
}
function saveProgress(list) {
  localStorage.setItem(PROG_KEY, JSON.stringify(list));
}
function renderProgress() {
  const list = loadProgress().sort((a, b) => new Date(a.date) - new Date(b.date));
  const out = document.getElementById("progressOut");
  if (!list.length) { out.innerHTML = "No entries yet."; return; }

  const weights = list.map(e => e.weight);
  const min = Math.min(...weights), max = Math.max(...weights);
  const range = max - min || 1;
  const W = 320, H = 80, pad = 6;
  const pts = list.map((e, i) => {
    const x = pad + (i * (W - 2 * pad)) / Math.max(1, list.length - 1);
    const y = H - pad - ((e.weight - min) / range) * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const first = list[0].weight, last = list[list.length - 1].weight;
  const delta = (last - first).toFixed(1);
  const deltaColor = delta < 0 ? "var(--accent)" : delta > 0 ? "var(--warn)" : "var(--muted)";

  const rows = list.slice().reverse().map(e =>
    `<li><b>${e.date}</b> — ${e.weight} kg</li>`).join("");

  out.innerHTML = `
    <div class="cards" style="grid-template-columns:1fr 1fr">
      <div class="metric"><div class="k">Entries</div><div class="v">${list.length}</div></div>
      <div class="metric"><div class="k">Net change</div><div class="v" style="color:${deltaColor}">${delta > 0 ? "+" : ""}${delta} <small>kg</small></div></div>
    </div>
    <svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="background:var(--panel-2);border:1px solid var(--border);border-radius:10px;margin-top:12px">
      <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts}" />
    </svg>
    <ul style="margin-top:12px">${rows}</ul>
    <div class="note">Trend is what matters, not any single weigh-in. Adjust intake by ~100–200 kcal if the trend stalls or moves faster than ~0.5–1% of body weight per week.</div>
  `;
}

function logEntry() {
  const date = document.getElementById("progDate").value;
  const w = parseFloat(document.getElementById("progWeight").value);
  if (!date || !w) { alert("Enter a date and weight."); return; }
  const list = loadProgress().filter(e => e.date !== date);
  list.push({ date, weight: w });
  saveProgress(list);
  document.getElementById("progWeight").value = "";
  renderProgress();
}

function saveInputs(user) { localStorage.setItem(INPUT_KEY, JSON.stringify(user)); }
function restoreInputs() {
  try {
    const u = JSON.parse(localStorage.getItem(INPUT_KEY));
    if (!u) return;
    for (const k of ["sex", "age", "height", "weight", "bodyfat", "activity", "goal", "aggressiveness", "diet", "experience"]) {
      const el = document.getElementById(k);
      if (el && u[k] !== undefined && u[k] !== null) el.value = u[k];
    }
  } catch {}
}

const MYTHS = [
  "<b>Somatotypes</b> (ecto/endo/meso) decide your plan — no predictive power for training response.",
  "<b>Water burns fat</b> — hydration helps function, but does not directly oxidise fat.",
  "<b>LISS cardio raises cortisol → eats muscle; HIIT spares muscle</b> — false; muscle loss comes from deficit + no lifting + low protein.",
  "<b>Ice-cream diet lowers metabolism at equal calories</b> — false; calories are calories for fat loss.",
  "<b>ZMA boosts testosterone</b> — only fixes a real deficiency; no effect in healthy users.",
  "<b>Chromium fixes metabolism</b> — essential in theory, useless as a supplement for fed people.",
  "<b>Urine strips measure ketosis reliably</b> — blood β-hydroxybutyrate is accurate; strips lag and mislead.",
  "<b>'Liver does kidneys' work when dehydrated → starvation</b> — mechanistically false.",
];

function render(user) {
  const c = compute(user);
  const results = document.getElementById("results");

  const pPct = round((c.proteinG * 4 / c.target) * 100);
  const cPct = round((c.carbG * 4 / c.target) * 100);
  const fPct = round((c.fatG * 9 / c.target) * 100);

  results.innerHTML = `
    <div class="cards">
      <div class="metric"><div class="k">BMR (${c.method})</div><div class="v">${c.bmr} <small>kcal</small></div></div>
      <div class="metric"><div class="k">TDEE (${ACTIVITY_LABELS[user.activity]})</div><div class="v">${c.tdee} <small>kcal</small></div></div>
      <div class="metric"><div class="k">Daily target</div><div class="v">${c.target} <small>kcal (${c.adjustPct}%)</small></div></div>
      ${c.lbm ? `<div class="metric"><div class="k">Lean body mass</div><div class="v">${c.lbm} <small>kg</small></div></div>` : ""}
    </div>

    <div class="macro-bar">
      <div class="seg-p" style="width:${pPct}%">P ${c.proteinG}g</div>
      <div class="seg-c" style="width:${cPct}%">C ${c.carbG}g</div>
      <div class="seg-f" style="width:${fPct}%">F ${c.fatG}g</div>
    </div>
    <div class="note">Macro split by calories — Protein ${pPct}% · Carbs ${cPct}% · Fat ${fPct}%.</div>

    <div class="sugg">
      <h3>Nutrition</h3>
      <ul>${dietSuggestions(user, c).map(t => `<li>${t}</li>`).join("")}</ul>
      <h3>Training</h3>
      <ul>${trainingSuggestions(user).map(t => `<li>${t}</li>`).join("")}</ul>
      ${workoutHTML(user)}
      <div class="note">BMR formulas are estimates (±10–15%). Track weight &amp; intake weekly and adjust by ~100–200 kcal if the trend stalls or moves too fast. For educational use, not medical advice.</div>
    </div>
  `;
}

function readUser() {
  return {
    sex: document.getElementById("sex").value,
    age: +document.getElementById("age").value,
    height: +document.getElementById("height").value,
    weight: +document.getElementById("weight").value,
    bodyfat: document.getElementById("bodyfat").value ? +document.getElementById("bodyfat").value : null,
    activity: document.getElementById("activity").value,
    goal: document.getElementById("goal").value,
    aggressiveness: document.getElementById("aggressiveness").value,
    diet: document.getElementById("diet").value,
    experience: document.getElementById("experience").value,
  };
}

document.getElementById("fitForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const user = readUser();
  saveInputs(user);
  render(user);
});

document.getElementById("logBtn").addEventListener("click", logEntry);

document.getElementById("mythList").innerHTML = MYTHS.map(m => `<li>${m}</li>`).join("");

// initialise: restore saved inputs, default date, render, show progress
restoreInputs();
document.getElementById("progDate").value = new Date().toISOString().slice(0, 10);
render(readUser());
renderProgress();
