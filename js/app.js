// Archi-Quiz – verbesserte Antwortlogik (Aliasse, Mehrfach-Architekten/Epochen)

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

const MODE = { RANDOM: "ZUFALL", MC_ONLY: "MC", INPUT_ONLY: "INPUT" };

let state = {
  data: [],
  current: null,
  stats: { score: 0, total: 0, streak: 0 },
  mode: MODE.RANDOM,
  awaitingCheck: true, // true = „Überprüfen“, false = „Weiter“
};

// ---------- Utilities ----------
const rnd = (n) => Math.floor(Math.random() * n);
const choice = (arr) => arr[rnd(arr.length)];
const shuffle = (arr) => arr.map(v => [Math.random(), v]).sort((a,b)=>a[0]-b[0]).map(([_,v])=>v);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/** Entfernt Zusätze wie " – XYZ" oder "(Stadt)" */
function stripQualifiers(s) {
  if (!s) return "";
  return s
    .replace(/\s*[–—-]\s*.*$/, "")  // alles nach Gedankenstrich
    .replace(/\s*\(.*?\)\s*/g, "")  // Klammerzusätze
    .trim();
}

/** Normalize: case-insensitive, strip accents/diacritics, punctuation, collapse spaces, ß→ss, Sankt→St */
function normalize(str) {
  if (!str) return "";
  return str
    .toString()
    .trim()
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[.\-_,;:!?()[\]{}'"`´^~]/g, " ")        // punctuation -> space
    .replace(/\s*&\s*/g, " und ")                     // & ↔ "und"
    .replace(/\bsankt\b/g, "st")
    .replace(/\s+/g, " ");                            // collapse whitespace
}

/** Levenshtein distance (auf normalisierten Strings) */
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
 *  - exakte normalisierte Übereinstimmung
 *  - Tippfehler: distance <= ~15% (1..3)
 *  - Start-mit (ab 4 Zeichen)
 *  - Token-Match ("zwinger" ∈ "zwinger dresden")
 *  - Enthält (ab 6 Zeichen)
 */
function flexibleMatch(input, correct, aliases = []) {
  const normIn = normalize(input);
  if (!normIn) return false;

  const rawCandidates = [correct, ...(aliases || [])].filter(Boolean);
  const candidates = [];
  rawCandidates.forEach(c => {
    candidates.push(c);
    const stripped = stripQualifiers(c);
    if (stripped && stripped !== c) candidates.push(stripped);
  });

  for (const cand of candidates) {
    const normCand = normalize(cand);

    if (normIn === normCand) return true;

    const d = levenshtein(normIn, normCand);
    const threshold = clamp(Math.floor(normCand.length * 0.15), 1, 3);
    if (d <= threshold) return true;

    if (normCand.startsWith(normIn) && normIn.length >= 4) return true;

    const tokens = normCand.split(" ").filter(Boolean);
    if (tokens.includes(normIn)) return true;
    if (tokens.some(t => t.startsWith(normIn)) && normIn.length >= 4) return true;

    if (normIn.length >= 6 && normCand.includes(normIn)) return true;
  }
  return false;
}

/** Prädikate pro Fragetyp */
function fieldFor(typeKey) {
  if (typeKey === "architect") return { key: "architect" };
  if (typeKey === "name") return { key: "name" };
  if (typeKey === "era") return { key: "era" };
  throw new Error("Unknown type");
}

/** Hilfen */
function splitList(str = "") {
  // trennt bei ; , / und deutschen Konjunktionen
  return String(str)
    .split(/[/;,]| und | sowie | & | \+ /gi)
    .map(s => s.trim())
    .filter(Boolean);
}
function uniq(arr) {
  return Array.from(new Set((arr || []).map(v => v).filter(Boolean)));
}

/** Pretty-Joins für Anzeige */
function joinWith(arr, sep = "; ") {
  return (arr || []).filter(Boolean).join(sep);
}

/** erzeugt pro Gebäude ein „rich“ Objekt mit Answer-Sets */
function enrichBuilding(raw) {
  const b = JSON.parse(JSON.stringify(raw));

  // NAME
  const nameAliases = uniq([
    ...(b.nameAliases || []),
    stripQualifiers(b.name)
  ]);
  b._nameAnswers = uniq([b.name, ...nameAliases]);

  // ARCHITEKTEN
  const architectsFromString = splitList(b.architect);
  const architects = uniq([
    ...(b.architects || []),
    ...architectsFromString
  ]);
  const architectAliases = uniq([
    ...(b.architectAliases || []),
    ...architectsFromString, // einzelne Namen auch als Alias
  ]);
  b._architectAnswers = uniq([...architects, ...architectAliases]);
  b._architectDisplay = architects.length ? joinWith(architects) : b.architect || "";

  // EPOCHEN
  const eraTokens = splitList(b.era);
  const eras = uniq([
    ...(b.eras || []),
    ...eraTokens
  ]);
  const eraAliases = uniq([
    ...(b.eraAliases || [])
  ]);
  b._eraAnswers = uniq([...eras, ...eraAliases]);
  b._eraDisplay = eras.length ? joinWith(eras, " / ") : (b.era || "");

  // Feedback zur Epoche
  if (!b.eraFeedback) {
    const list = eras.length ? eras : (b.era ? [b.era] : []);
    b.eraFeedback = eraFeedbackSentence(b.name, list);
  }

  return b;
}

/** Erzeugt einen Satz wie gewünscht */
function eraFeedbackSentence(name, erasList) {
  const e = (erasList || []).filter(Boolean);
  if (e.length === 0) return `Bei dem Gebäude handelt es sich um ${name}.`;
  if (e.length === 1) return `Bei dem Gebäude handelt es sich um ${name} aus der ${e[0]}.`;
  if (e.length === 2) return `Bei dem Gebäude handelt es sich um ${name} aus sowohl der ${e[0]} als auch der ${e[1]}.`;
  // 3+ -> aufzählen
  const last = e[e.length - 1];
  const rest = e.slice(0, -1).join(", ");
  return `Bei dem Gebäude handelt es sich um ${name} aus ${rest} und ${last}.`;
}

/** Antwortmöglichkeiten (MC) bauen – Anzeige-Strings */
function buildOptions(data, building, qType, count = 4) {
  const opts = [];
  if (qType.key === "name") {
    opts.push(building.name);
    const pool = shuffle(data.filter(x => x.id !== building.id).map(x => x.name));
    pool.forEach(p => { if (!opts.includes(p)) opts.push(p); });
  } else if (qType.key === "architect") {
    const correct = building._architectDisplay || building.architect || "";
    opts.push(correct);
    const pool = shuffle(
      data.filter(x => x.id !== building.id)
          .map(x => x._architectDisplay || x.architect || "")
    );
    pool.forEach(p => { if (p && !opts.includes(p)) opts.push(p); });
  } else if (qType.key === "era") {
    const correct = building._eraDisplay || building.era || "";
    opts.push(correct);
    const pool = shuffle(
      data.filter(x => x.id !== building.id)
          .map(x => x._eraDisplay || x.era || "")
    );
    pool.forEach(p => { if (p && !opts.includes(p)) opts.push(p); });
  }
  return shuffle(opts.slice(0, count));
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

  // Ein-Button-Flow vorbereiten
  UI.nextBtn.textContent = "Überprüfen";
  state.awaitingCheck = true;

  if (mode === "mc") {
    UI.inputForm.classList.add("hidden");
    UI.mcContainer.classList.remove("hidden");
    UI.mcContainer.innerHTML = "";
    UI.nextBtn.disabled = true; // erst aktiv nach Auswahl
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
    UI.nextBtn.disabled = true; // aktiv, sobald Text vorhanden
  }
}

function revealSolution() {
  // bleibt vorhanden, aber UI-seitig ausgeblendet
  const { building, qType } = state.current;
  if (qType.key === "architect") {
    const s = building._architectDisplay || building.architect || "";
    setFeedback(`Lösung: ${s}`, true);
  } else if (qType.key === "era") {
    setFeedback(building.eraFeedback || ("Lösung: " + (building._eraDisplay || building.era || "")), true);
  } else {
    setFeedback(`Lösung: ${building.name}`, true);
  }
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
  UI.nextBtn.textContent = "Weiter";
  state.awaitingCheck = false;
}

// ---------- Handlers ----------
function onMCClick(selected) {
  // Nur Auswahl markieren; auswerten erst bei „Überprüfen“
  const buttons = [...UI.mcContainer.querySelectorAll(".answer")];
  buttons.forEach(b => b.classList.remove("selected", "correct", "wrong"));
  const clicked = buttons.find(b => b.textContent === selected);
  if (clicked) clicked.classList.add("selected");
  UI.nextBtn.disabled = false;
}

function onInputSubmit(e) {
  // Enter im Textfeld: wie Button
  e.preventDefault();
  if (state.awaitingCheck) evaluateCurrent();
  else nextQuestion();
}

function toggleMode() {
  if (state.mode === MODE.RANDOM) state.mode = MODE.MC_ONLY;
  else if (state.mode === MODE.MC_ONLY) state.mode = MODE.INPUT_ONLY;
  else state.mode = MODE.RANDOM;

  UI.modeBtn.textContent = `Modus: ${state.mode === MODE.RANDOM ? "Zufall" : state.mode}`;
  nextQuestion();
}
function resetStats() {
  state.stats = { score: 0, total: 0, streak: 0 };
  updateScore();
  setFeedback("Punktestand zurückgesetzt.", true);
}

// Zusätzliche Auswertung (neu, aber keine bestehende Funktion gelöscht)
function evaluateCurrent() {
  const { building, qType, mode } = state.current;

  if (mode === "mc") {
    const selectedBtn = UI.mcContainer.querySelector(".answer.selected");
    if (!selectedBtn) {
      setFeedback("Bitte eine Antwort auswählen.", false);
      return;
    }

    let correctDisplay = "";
    if (qType.key === "name") correctDisplay = building.name;
    if (qType.key === "architect") correctDisplay = building._architectDisplay || building.architect || "";
    if (qType.key === "era") correctDisplay = building._eraDisplay || building.era || "";

    const ok = normalize(selectedBtn.textContent) === normalize(correctDisplay);

    const buttons = [...UI.mcContainer.querySelectorAll(".answer")];
    buttons.forEach(b => {
      const isCorrect = normalize(b.textContent) === normalize(correctDisplay);
      b.classList.toggle("correct", isCorrect);
      b.classList.toggle("wrong", !isCorrect && b === selectedBtn);
    });

    const msg = ok
      ? "Richtig! ✅"
      : (qType.key === "era"
          ? building.eraFeedback
          : `Falsch. Richtige Antwort: ${correctDisplay}`);
    markResult(ok, msg);
  } else {
    const user = UI.textInput.value;
    let ok = false;
    let msg = "";

    if (qType.key === "name") {
      ok = building._nameAnswers.some(ans => flexibleMatch(user, ans));
      msg = ok ? "Richtig! ✅" : `Falsch. Richtige Antwort: ${building.name}`;
    } else if (qType.key === "architect") {
      const anyArchitect = (building._architectAnswers || []).some(ans => flexibleMatch(user, ans));
      ok = anyArchitect;
      msg = ok
        ? `Richtig! ✅ (${building._architectDisplay || building.architect})`
        : `Falsch. Richtige Antwort: ${building._architectDisplay || building.architect}`;
    } else if (qType.key === "era") {
      const anyEra = (building._eraAnswers || []).some(ans => flexibleMatch(user, ans));
      ok = anyEra;
      msg = ok
        ? building.eraFeedback
        : `Falsch. Richtige Antwort: ${building._eraDisplay || building.era}`;
    }

    markResult(ok, msg);
  }
}

// Ein-Button-Handler
function onNextCheckClick() {
  if (state.awaitingCheck) evaluateCurrent();
  else nextQuestion();
}

// ---------- Init ----------
async function init() {
  try {
    // *** Originaler, funktionierender Loader beibehalten ***
    const res = await fetch("./data/buildings.json");
    let rawData = await res.json();

    // Auto-Enrichment (Aliasse, Mehrfach-Antworten, Feedback)
    state.data = rawData.map(enrichBuilding);

    // Preload images (best effort)
    state.data.forEach(b => { const im = new Image(); im.src = b.image; });

    // Restore score
    const saved = JSON.parse(localStorage.getItem("archiQuizStats") || "null");
    if (saved) state.stats = saved;

    updateScore();

    // Events
    UI.inputForm.addEventListener("submit", onInputSubmit);
    UI.nextBtn.addEventListener("click", onNextCheckClick);

    // „Lösung zeigen“ ausblenden (Funktion bleibt vorhanden)
    if (UI.revealBtn) UI.revealBtn.classList.add("hidden");

    UI.modeBtn.addEventListener("click", toggleMode);
    UI.resetBtn.addEventListener("click", resetStats);

    // Persist stats
    const persist = () => localStorage.setItem("archiQuizStats", JSON.stringify(state.stats));
    ["click", "submit"].forEach(evt =>
      document.addEventListener(evt, () => persist(), { capture: true })
    );

    // Eingabe aktiviert Button im Input-Modus
    UI.textInput.addEventListener("input", () => {
      if (state.current && state.current.mode === "input" && state.awaitingCheck) {
        UI.nextBtn.disabled = UI.textInput.value.trim().length === 0;
      }
    });

    nextQuestion();
  } catch (err) {
    console.error(err);
    UI.questionText.textContent = "Fehler beim Laden der Daten.";
    setFeedback("Bitte prüfe den Pfad zu ./data/buildings.json (GitHub Pages) und den Browser-Konsolen-Log.", false);
  }
}

init();
