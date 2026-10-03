/* ============================================================
   TOP 10 — DAILY CHALLENGE: WHO'S MISSING? (pages/top10-daily.html)
   One top-10 board a day with one player hidden; everyone gets the
   same one. The day's board and hidden player come from
   data/daily.json (built by scripts/build_daily.py). Five guesses:
   each miss, or a hint taken, uses one and unlocks the next hint.
   Progress is saved after every guess (top10-records.js), so closing
   the app never resets the day.
   ============================================================ */

const SHARE_URL = "https://joeydunn22.github.io/postgames/pages/top10-daily.html";
const MARK_EMOJI = { miss: "❌", hint: "💡", correct: "✅" };
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

const daily = {
    status: "loading",   // loading | ready | none | error
    date: null,          // "YYYY-MM-DD", the phone's local date
    number: 0,           // Daily #N
    puzzle: null,        // the day's entry from daily.json
    board: null,         // { label, players: [...] } from the stat file
    roster: [],          // everyone who played that season (the guess list)
    answer: null,        // the hidden player: { id, name, team, pos, rank, value }
    day: null            // saved progress: { number, marks, missIds, done, solved, at }
};

const ui = {};
let _highlight = -1;     // guess result picked with the arrow keys


/* ============================================================
   1. LOADING TODAY'S PUZZLE
   ============================================================ */
async function fetchJSON(path) {
    const response = await fetch(`../data/${path}`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function loadToday() {
    daily.date = localDateKey();
    daily.status = "loading";
    render();

    try {
        const schedule = await fetchJSON("daily.json");
        const index = daysBetween(schedule.start, daily.date);
        const puzzle = schedule.puzzles[index];
        if (!puzzle) {
            daily.status = "none";
            render();
            return;
        }

        const folder = `${puzzle.sport}/${puzzle.year}`;
        const [stats, roster] = await Promise.all([
            fetchJSON(`${folder}/${puzzle.category || "stats"}.json`),
            fetchJSON(`${folder}/players.json`)
        ]);
        const board = stats.find(s => s.label === puzzle.stat);
        const hidden = board?.players.find(p => p.id === puzzle.id);
        if (!hidden) throw new Error(`Daily #${index + 1}: hidden player not on the board`);

        const rosterEntry = roster.find(p => p.id === hidden.id);
        Object.assign(daily, {
            status: "ready",
            number: index + 1,
            puzzle,
            board,
            roster: roster.map(withSearchWords),
            answer: { ...hidden, pos: rosterEntry?.pos || "" },
            day: loadDailyDays()[daily.date] || { number: index + 1, marks: [], missIds: [], done: false, solved: false }
        });
    } catch (error) {
        console.error("Couldn't load the daily:", error);
        daily.status = "error";
    }
    render();
}


/* ============================================================
   2. RULES
   ============================================================ */
function hintsShown() {
    const used = daily.day.marks.filter(m => m !== "correct").length;
    return daily.day.done ? 4 : Math.min(used, 4);
}

// What a player in the guess list is to you: on the board already
// (visible, so no use guessing), a miss you already made, or pickable
function guessStatus(playerId) {
    if (playerId !== daily.answer.id && daily.board.players.some(p => p.id === playerId)) return "board";
    if (daily.day.missIds.includes(playerId)) return "wrong";
    return null;
}

function useGuess(mark) {
    const day = daily.day;
    day.marks.push(mark);
    day.solved = mark === "correct";
    day.done = day.solved || day.marks.length >= DAILY_GUESSES;
    day.at = Date.now();
    saveDailyDay(daily.date, day);
}

function submitGuess(playerId) {
    if (daily.status !== "ready" || daily.day.done) return;
    if (!daily.roster.some(p => p.id === playerId) || guessStatus(playerId)) return;

    if (playerId === daily.answer.id) {
        useGuess("correct");
    } else {
        daily.day.missIds.push(playerId);
        useGuess("miss");
    }
    daily.lastGuess = { id: playerId, at: Date.now() };
    render();
}

// A hint costs a guess. Not offered once every hint is out, since it
// would only throw away the last guess.
function takeHint() {
    if (daily.status !== "ready" || daily.day.done || hintsShown() >= 4) return;
    useGuess("hint");
    daily.lastGuess = null;
    render();
}


/* ============================================================
   3. HINTS AND SHARING
   ============================================================ */

// "Amon-Ra St. Brown" -> "A.S.B.", "Ken Griffey Jr." -> "K.G."
function initials(name) {
    return name.split(/\s+/)
        .filter(word => !NAME_SUFFIXES.has(normalize(word)))
        .map(word => word[0].toUpperCase() + ".")
        .join("");
}

function hintRows() {
    const { puzzle, answer } = daily;
    const team = teamTagFor(puzzle.sport, answer.team) +
        (answer.pos ? ` <span class="daily-hint-pos">${escapeHTML(answer.pos)}</span>` : "");
    return [
        [puzzle.sport === "nba" ? "Conference" : "League", escapeHTML(puzzle.league)],
        ["Division", escapeHTML(puzzle.division)],
        [answer.pos ? "Team · Position" : "Team", team],
        ["Initials", escapeHTML(initials(answer.name))]
    ];
}

function shareText() {
    const { puzzle, day } = daily;
    const title = `Postgames Daily #${daily.number} · ${SPORT_LABELS[puzzle.sport]} ${formatSeason(puzzle.sport, puzzle.year)} ${puzzle.stat}`;
    const score = day.solved ? `${day.marks.length}/${DAILY_GUESSES}` : `X/${DAILY_GUESSES}`;
    return `${title}\n${day.marks.map(m => MARK_EMOJI[m]).join("")} ${score}\n${SHARE_URL}`;
}

// The phone's share sheet where there is one, else copy to the clipboard
async function shareResult() {
    const text = shareText();
    try {
        if (navigator.share) {
            await navigator.share({ text });
            return;
        }
        await navigator.clipboard.writeText(text);
        ui.shareStatus.textContent = "Copied. Paste it in the group chat.";
    } catch (error) {
        if (error?.name !== "AbortError") ui.shareStatus.textContent = "Couldn't share. Try again.";
    }
}

function timeToNextPuzzle() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const minutes = Math.max(1, Math.ceil((midnight - now) / 60000));
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}


/* ============================================================
   4. RENDERING
   ============================================================ */
function renderMarks() {
    const marks = daily.day.marks;
    ui.marks.innerHTML = Array.from({ length: DAILY_GUESSES }, (_, i) =>
        `<span class="daily-mark ${marks[i] || ""}">${marks[i] ? MARK_EMOJI[marks[i]] : ""}</span>`).join("");
}

function renderHints() {
    const shown = hintsShown();
    ui.hints.innerHTML = hintRows().map(([label, value], i) => i < shown
        ? `<li class="daily-hint"><span class="daily-hint-label">${label}</span><span class="daily-hint-value">${value}</span></li>`
        : `<li class="daily-hint locked"><span class="daily-hint-label">Hint ${i + 1}</span><span class="daily-hint-value">Unlocks after a miss</span></li>`
    ).join("");
}

function renderFeedback() {
    const last = daily.lastGuess;
    const missed = last && daily.day.missIds.includes(last.id);
    ui.feedback.className = "feedback";
    if (!missed) {
        ui.feedback.innerHTML = "";
        return;
    }
    const name = daily.roster.find(p => p.id === last.id)?.name;
    ui.feedback.innerHTML = `<span class="feedback-main">✗ “${escapeHTML(name)}” <span class="feedback-note">isn't the one</span></span>`;
    ui.feedback.classList.add("wrong");
    if (last.at > (daily.lastDrawnAt || 0)) {
        daily.lastDrawnAt = last.at;
        ui.guessForm.classList.remove("shake");
        void ui.guessForm.offsetWidth;
        ui.guessForm.classList.add("shake");
    }
}

// The board: everyone shown but the hidden player, whose value is a clue.
// Once the day's done the answer fills in, green if you got it.
function renderBoard() {
    const { board, answer, day } = daily;
    ui.board.innerHTML = board.players.map(player => {
        const isAnswer = player.id === answer.id;
        const revealed = !isAnswer || day.done;
        const classes = ["slot", isAnswer && "daily-answer", isAnswer && day.done && (day.solved ? "solved" : "failed")]
            .filter(Boolean).join(" ");
        const main = revealed
            ? `<span class="slot-line"><span class="slot-name">${escapeHTML(player.name)}</span>${teamTagFor(daily.puzzle.sport, player.team, "slot-team")}</span>`
            : `<span class="daily-unknown">???</span>`;
        return `
            <li class="${classes}">
                <span class="slot-rank">${player.rank}</span>
                <span class="slot-main">${main}</span>
                <span class="slot-value">${escapeHTML(player.value)}</span>
            </li>`;
    }).join("");
}

const GUESS_STATUS_LABELS = { board: "On the board", wrong: "✗ You missed" };

function renderGuessResults() {
    const found = daily.day.done ? null : matchPlayers(daily.roster, ui.guessInput.value);
    ui.guessResults.classList.toggle("hidden", !found);
    ui.guessInput.setAttribute("aria-expanded", String(!!found));
    if (!found) {
        ui.guessResults.innerHTML = "";
        _highlight = -1;
        return;
    }
    if (_highlight >= found.players.length) _highlight = found.players.length - 1;

    const rows = found.players.map((player, idx) => {
        const status = guessStatus(player.id);
        const meta = status
            ? `<span class="guess-status">${GUESS_STATUS_LABELS[status]}</span>`
            : teamTagFor(daily.puzzle.sport, player.team) + (player.pos ? `<span class="guess-option-pos">${escapeHTML(player.pos)}</span>` : "");
        return `
            <li role="option" aria-selected="${idx === _highlight}">
                <button class="guess-option ${status === "wrong" ? "wrong" : ""} ${idx === _highlight ? "active" : ""}" type="button"
                    data-id="${escapeHTML(player.id)}" ${status ? "disabled" : ""}>
                    <span class="guess-option-name">${escapeHTML(player.name)}</span>
                    <span class="guess-option-meta">${meta}</span>
                </button>
            </li>`;
    });
    if (found.players.length === 0) rows.push(`<li class="guess-none">No players match</li>`);
    if (found.more > 0) rows.push(`<li class="guess-more">… ${found.more} more</li>`);
    ui.guessResults.innerHTML = rows.join("");
}

function renderDone() {
    const { day, answer } = daily;
    const used = day.marks.length;
    ui.doneTitle.textContent = day.solved
        ? (used === 1 ? "First try!" : `Got it in ${used}`)
        : "Not today";
    ui.doneSub.textContent = day.solved
        ? `${answer.name}. ${["Ice cold.", "Sharp.", "Nice work.", "Close call.", "Just made it."][used - 1]}`
        : `It was ${answer.name}.`;
    ui.summary.innerHTML = dailySummaryHTML(dailySummary(), day.solved ? used : null);
    ui.nextPuzzle.textContent = `Next puzzle in ${timeToNextPuzzle()}`;
}

function render() {
    if (!ui.status) return;
    const ready = daily.status === "ready";
    ui.game.classList.toggle("hidden", !ready);
    ui.status.textContent = {
        loading: "Loading today's puzzle…",
        none: "No puzzle scheduled for today. Check back soon.",
        error: "Couldn't load today's puzzle. Check your connection and reopen the page."
    }[daily.status] || "";
    if (!ready) return;

    const { puzzle, day } = daily;
    ui.eyebrow.textContent = `Daily #${daily.number}`;
    ui.context.textContent = boardContextLabel(puzzle);
    ui.stat.textContent = puzzle.stat;

    renderMarks();
    renderHints();
    renderBoard();

    ui.play.classList.toggle("hidden", day.done);
    ui.done.classList.toggle("hidden", !day.done);
    if (day.done) {
        renderDone();
    } else {
        ui.hintBtn.disabled = hintsShown() >= 4;
        renderFeedback();
        renderGuessResults();
    }
}


/* ============================================================
   5. STARTUP
   ============================================================ */
function pickGuess(playerId) {
    submitGuess(playerId);
    ui.guessInput.value = "";
    _highlight = -1;
    if (!daily.day.done) {
        renderGuessResults();
        ui.guessInput.focus();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const byId = id => document.getElementById(id);
    Object.assign(ui, {
        eyebrow: byId("dailyEyebrow"), status: byId("dailyStatus"), game: byId("dailyGame"),
        context: byId("dailyContext"), stat: byId("dailyStat"), marks: byId("dailyMarks"), hints: byId("dailyHints"),
        play: byId("dailyPlay"), guessForm: byId("guessForm"), guessInput: byId("guessInput"),
        guessResults: byId("guessResults"), feedback: byId("dailyFeedback"), hintBtn: byId("hintBtn"),
        done: byId("dailyDone"), doneTitle: byId("doneTitle"), doneSub: byId("doneSub"),
        shareBtn: byId("shareBtn"), shareStatus: byId("shareStatus"), summary: byId("dailySummary"),
        nextPuzzle: byId("nextPuzzle"), board: byId("dailyBoard")
    });

    ui.guessInput.addEventListener("input", () => {
        _highlight = -1;
        renderGuessResults();
    });
    // Arrow keys move through the results; Enter guesses the highlighted
    // one, or the only one when just one can be picked
    ui.guessInput.addEventListener("keydown", e => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const count = ui.guessResults.querySelectorAll(".guess-option").length;
        if (count === 0) return;
        _highlight = e.key === "ArrowDown" ? (_highlight + 1) % count : (_highlight - 1 + count) % count;
        renderGuessResults();
    });
    ui.guessForm.addEventListener("submit", e => {
        e.preventDefault();
        const highlighted = ui.guessResults.querySelectorAll(".guess-option")[_highlight];
        const pickable = [...ui.guessResults.querySelectorAll(".guess-option:not(:disabled)")];
        const choice = highlighted && !highlighted.disabled ? highlighted : pickable.length === 1 ? pickable[0] : null;
        if (choice) pickGuess(choice.dataset.id);
    });
    ui.guessResults.addEventListener("pointerdown", e => e.preventDefault());
    ui.guessResults.addEventListener("click", e => {
        const option = e.target.closest(".guess-option");
        if (option && !option.disabled) pickGuess(option.dataset.id);
    });
    ui.hintBtn.addEventListener("click", takeHint);
    ui.shareBtn.addEventListener("click", shareResult);

    // The installed app resumes rather than reloading: pick up a new day
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && localDateKey() !== daily.date) loadToday();
    });

    loadToday();
});
