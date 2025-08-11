// Archi-Quiz – Vanilla JS
const UI = {
  questionText: document.getElementById("questionText"),
  image: document.getElementById("buildingImage"),
  credit: document.getElementById("imageCredit"),
  mcContainer: document.getElementById("mcContainer"),
  inputForm: document.getElementById("inputForm"),
  textInput: document.getElementById("textInput"),
  feedback: document.getElementById("feedback"),
  nextBtn: document.getElementById("nextBtn"),
  revealBtn: document.getElementById("revealBtn"),
  score: document.getElementById("score"),
  total: document.getElementById("total"),
  streak: document.getElementById("streak"),
  modeBtn: document.getElementById("modeBtn"),
  resetBtn: document.getElementById("resetBtn"),
};

const QUESTION_TYPES = [
  { key: "architect", prompt: "Wie heißt der Architekt?" },
  { key: "name", prompt: "Wie heißt dieses Gebäude?" },
  { key: "era", prompt: "Welcher Epoche kann man das Gebäude zuordnen?" },
];

const MODE = {
  RANDOM: "ZUFALL",
  MC_ONLY: "MC",
  INPUT_ONLY: "INPUT",
};

let state = {
  data: [],
  current: null, // {building, qType, mode: 'mc'|'input', options: []}
  stats: { score: 0, total: 0, streak: 0 },
  mode: MODE.RANDOM,
};

// ---------- Utilities ----------
const rnd = (n) => Math.floor(Math.random() * n);
const choice = (arr) => arr[rnd(arr.length)];
const shuffle = (arr) => arr.map(v => [Math.random(), v]).sort((a,b)=>a[0]-b[0]).map(([_,v])=>v);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/** Normalize: case-insensitive, strip accents/diacritics, punctuation, collapse spaces, handle ß→ss */
function normalize(str) {
  if (!str) return "";
  return str
    .toString()
    .trim()
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[.\-_,;:!?()[\]{}'"`´^~]/g, "") // strip punctuation
    .replace(/\s*&\s*/g, " und ") // & ↔ "und"
    .replace(/\s+/g, " "); // collapse whitespace
}

/** Levenshtein distance for fuzzy match */
function levenshtein(a, b) {
  a = normalize(a); b = normalize(b);
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = tmp;
    }
  }
  return dp[n];
}

/** Flexible matcher:
 *  - accepts exact normalized matches
 *  - accepts distance <= max(1, floor(0.15 * length)) for short typos
 *  - checks against aliases (if provided)
 */
function flexibleMatch(input, correct, aliases = []) {
  const candidates = [correct, ...(aliases || [])].filter(Boolean);
  const normIn = normalize(input);

  for (const cand of candidates) {
    const normCand = normalize(cand);
    if (normIn === normCand) return true;
    const d = levenshtein(normIn, normCand);
    const threshold = clamp(Math.floor(normCand.length * 0.15), 1, 3);
    if (d <= threshold) return true;
    // allow "st peter" vs "st. peter" etc. handled in normalize already
    // allow partial if input covers ≥80% and is contained
    if (normCand.includes(normIn) && normIn.length >= Math.floor(normCand.length * 0.8)) {
      return true;
    }
  }
  return false;
}

function fieldFor(typeKey) {
  if (typeKey === "architect") return { value: "architect", alias: "architectAliases" };
  if (typeKey === "name") return { value: "name", alias: "nameAliases" };
  if (typeKey === "era") return { value: "era", alias: "eraAliases" };
  throw new Error("Unknown type");
}

function buildOptions(data, building, qType, count = 4) {
  const { value, alias } = fieldFor(qType.key);
  const correct = building[value];
  const options = [correct];

  // distractors: different items’ same field
  const pool = shuffle(data.filter(b => b.id !== building.id).map(b => b[value]));
  for (const p of pool) {
    if (!options.includes(p)) options.push(p);
    if (options.length >= count) break;
  }
  return shuffle(options.slice(0, count));
}

// ---------- Rendering ----------
function setFeedback(msg, ok=false) {
  UI.feedback.textContent = msg || "";
  UI.feedback.classList.toggle("ok", !!ok);
  UI.feedback.classList.toggle("err", !!msg && !ok);
}

function updateScore() {
  UI.score.textContent = state.stats.score;
  UI.total.textContent = state.stats.total;
  UI.streak.textContent = state.stats.streak;
}

function renderQuestion() {
  const { building, qType, mode, options } = state.current;

  UI.questionText.textContent = qType.prompt;
  UI.image.src = building.image;
  UI.image.alt = `${building.name} – Bild`;
  UI.credit.textContent = building.credit || "";

  setFeedback("");
  UI.nextBtn.disabled = true;

  // modes
  if (mode === "mc") {
    UI.inputForm.classList.add("hidden");
    UI.mcContainer.classList.remove("hidden");
    UI.mcContainer.innerHTML = "";
    options.forEach(opt => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "answer";
      btn.textContent = opt;
      btn.addEventListener("click", () => onMCClick(opt, btn));
      UI.mcContainer.appendChild(btn);
    });
  } else {
    UI.mcContainer.classList.add("hidden");
    UI.inputForm.classList.remove("hidden");
    UI.textInput.value = "";
    UI.textInput.focus();
  }
}

function revealSolution() {
  const { building, qType } = state.current;
  const { value } = fieldFor(qType.key);
  const correct = building[value];
  setFeedback(`Lösung: ${correct}`, true);
}

// ---------- Game flow ----------
function nextQuestion() {
  const building = choice(state.data);
  const qType = choice(QUESTION_TYPES);

  const modeDecider = (state.mode === MODE.RANDOM)
    ? (Math.random() < 0.5 ? "mc" : "input")
    : (state.mode === MODE.MC_ONLY ? "mc" : "input");

  const options = modeDecider === "mc" ? buildOptions(state.data, building, qType, 4) : [];
  state.current = { building, qType, mode: modeDecider, options };
  renderQuestion();
}

function markResult(ok, detailsMsg = "") {
  state.stats.total += 1;
  if (ok) {
    state.stats.score += 1;
    state.stats.streak += 1;
    setFeedback(detailsMsg || "Richtig! ✅", true);
  } else {
    state.stats.streak = 0;
    setFeedback(detailsMsg || "Leider falsch. ❌", false);
  }
  updateScore();
  UI.nextBtn.disabled = false;
}

// ---------- Handlers ----------
function onMCClick(selected, btnEl) {
  const { building, qType } = state.current;
  const { value } = fieldFor(qType.key);
  const correct = building[value];

  const allBtns = [...UI.mcContainer.querySelectorAll(".answer")];
  allBtns.forEach(b => {
    const isCorrect = normalize(b.textContent) === normalize(correct);
    b.classList.toggle("correct", isCorrect);
    if (!isCorrect && b.textContent === selected) b.classList.add("wrong");
    b.disabled = true;
  });

  const ok = normalize(selected) === normalize(correct);
  const msg = ok ? "Richtig! ✅" : `Falsch. Richtige Antwort: ${correct}`;
  markResult(ok, msg);
}

function onInputSubmit(e) {
  e.preventDefault();
  const user = UI.textInput.value;
  const { building, qType } = state.current;
  const { value, alias } = fieldFor(qType.key);
  const correct = building[value];
  const aliases = building[alias] || [];

  const ok = flexibleMatch(user, correct, aliases);
  const msg = ok
    ? "Richtig! ✅"
    : `Falsch. Richtige Antwort: ${correct}`;
  markResult(ok, msg);
}

function toggleMode() {
  if (state.mode === MODE.RANDOM) state.mode = MODE.MC_ONLY;
  else if (state.mode === MODE.MC_ONLY) state.mode = MODE.INPUT_ONLY;
  else state.mode = MODE.RANDOM;

  UI.modeBtn.textContent = `Modus: ${state.mode === MODE.RANDOM ? "Zufall" : state.mode}`;
  // Starte neue Frage im neuen Modus
  nextQuestion();
}

function resetStats() {
  state.stats = { score: 0, total: 0, streak: 0 };
  updateScore();
  setFeedback("Punktestand zurückgesetzt.", true);
}

// ---------- Init ----------
async function init() {
  try {
    // Lade Daten
    const res = await fetch("./data/buildings.json");
    state.data = await res.json();

    // Preload images (best effort)
    state.data.forEach(b => { const im = new Image(); im.src = b.image; });

    // Restore score (optional)
    const saved = JSON.parse(localStorage.getItem("archiQuizStats") || "null");
    if (saved) state.stats = saved;

    updateScore();

    // Events
    UI.inputForm.addEventListener("submit", onInputSubmit);
    UI.nextBtn.addEventListener("click", nextQuestion);
    UI.revealBtn.addEventListener("click", revealSolution);
    UI.modeBtn.addEventListener("click", toggleMode);
    UI.resetBtn.addEventListener("click", resetStats);

    // Persist stats on change
    const persist = () => localStorage.setItem("archiQuizStats", JSON.stringify(state.stats));
    ["click", "submit"].forEach(evt =>
      document.addEventListener(evt, () => persist(), { capture: true })
    );

    nextQuestion();
  } catch (err) {
    console.error(err);
    UI.questionText.textContent = "Fehler beim Laden der Daten.";
    setFeedback("Bitte prüfe den Pfad zu data/buildings.json und den Browser-Konsolen-Log.", false);
  }
}

init();
