/* ============================================================
   TOP 10 — DAILY CHALLENGE: TOP SHELF (pages/top10-topshelf.html)
   A top-10 board with the stat name, the top 2-3 names and every value
   hidden; the sport and season are shown. Three rounds:
     1. The stat: pick from the sport's daily stats, 3 tries. Misses
        unlock hints: the stat's group, then #10's value.
     2. The top players: name the hidden ones in any order, 3 misses
        allowed. Values show from here on, except #1's. Misses unlock
        hints on the board: their teams, then their initials.
     3. The number: guess #1's value, scored by how close.
   The day's board comes from data/daily.json (top_shelf, built by
   scripts/build_daily.py). Progress is saved after every step
   (top10-records.js), so closing the app never resets the day.
   Test mode works as on Who's Missing (see top10-common.js).
   ============================================================ */

const SHARE_URL = "https://joeydunn22.github.io/postgames/pages/top10-topshelf.html";
const TIER_EMOJI = { exact: "🎯", close: "🟩", near: "🟨", far: "🟥" };
const TIER_LABEL = { exact: "Bullseye!", close: "Within 2%", near: "Within 5%", far: "Not close" };
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

const shelf = {
    status: "loading",   // loading | ready | none | error
    date: null,          // "YYYY-MM-DD"
    number: 0,           // Daily #N
    puzzle: null,        // the day's entry from daily.json's top_shelf
    board: null,         // { label, group, players: [...] }
    roster: [],          // everyone who played that season (the guess list)
    day: null,           // saved progress (see top10-records.js)
    lastAction: null,    // { round, kind, value, at }: the line under the current round
    lastDrawnAt: 0,
    test: false,
    testOffset: 0
};

const ui = {};
let _highlight = -1;


/* ============================================================
   1. LOADING
   ============================================================ */
function storeKey() {
    return shelf.test ? SHELF_TEST_KEY : SHELF_KEY;
}

function setTestMode(on) {
    shelf.test = on;
    shelf.testOffset = 0;
    writeDailyTestFlag(on);
    loadToday();
}

function newDay(number) {
    return { number, stage: "stat", statGuesses: [], statSolved: false, playerGuesses: [],
             valueGuess: null, valueTier: null, done: false, at: Date.now() };
}

async function loadToday() {
    shelf.date = shelf.test ? addDays(localDateKey(), shelf.testOffset) : localDateKey();
    shelf.status = "loading";
    shelf.lastAction = null;
    render();

    try {
        const schedule = await fetchData("daily.json");
        const index = daysBetween(schedule.start, shelf.date);
        const puzzle = schedule.top_shelf?.[index];
        if (!puzzle) {
            shelf.status = "none";
            render();
            return;
        }
        const folder = `${puzzle.sport}/${puzzle.year}`;
        const [stats, roster] = await Promise.all([
            fetchData(`${folder}/${puzzle.category || "stats"}.json`),
            fetchData(`${folder}/players.json`)
        ]);
        const board = stats.find(s => s.label === puzzle.stat);
        if (!board) throw new Error(`Top Shelf #${index + 1}: no ${puzzle.stat} board`);

        Object.assign(shelf, {
            status: "ready",
            number: index + 1,
            puzzle,
            board,
            roster: roster.map(withSearchWords),
            day: loadDailyDays(storeKey())[shelf.date] || newDay(index + 1)
        });
    } catch (error) {
        console.error("Couldn't load Top Shelf:", error);
        shelf.status = "error";
    }
    render();
}


/* ============================================================
   2. RULES
   ============================================================ */
function hiddenPlayers() {
    return shelf.board.players.slice(0, shelf.puzzle.hidden);
}

function statMisses() {
    return shelf.day.statGuesses.filter(label => label !== shelf.puzzle.stat).length;
}

function playerMisses() {
    return shelf.day.playerGuesses.filter(g => !g.hit).length;
}

function foundIds() {
    return shelf.day.playerGuesses.filter(g => g.hit).map(g => g.id);
}

function save() {
    shelf.day.at = Date.now();
    saveDailyDay(shelf.date, shelf.day, storeKey());
}

function act(round, kind, value = null) {
    shelf.lastAction = { round, kind, value, at: Date.now() };
}

// Round 1
function guessStat(label) {
    const day = shelf.day;
    if (day.stage !== "stat" || day.statGuesses.includes(label) || !shelf.puzzle.options.includes(label)) return;

    day.statGuesses.push(label);
    if (label === shelf.puzzle.stat) {
        day.statSolved = true;
        day.stage = "players";
        act("players", "statRight");
    } else if (statMisses() >= SHELF_STAT_TRIES) {
        day.stage = "players";
        act("players", "statMissed");
    } else {
        act("stat", "wrong", label);
    }
    save();
    render();
}

// Round 2. What a roster player is to you: one of the visible names on
// the board, a top player you've found, a miss you made, or pickable.
function playerStatus(id) {
    if (shelf.board.players.slice(shelf.puzzle.hidden).some(p => p.id === id)) return "board";
    if (foundIds().includes(id)) return "correct";
    if (shelf.day.playerGuesses.some(g => g.id === id)) return "wrong";
    return null;
}

function guessPlayer(id) {
    const day = shelf.day;
    if (day.stage !== "players" || !shelf.roster.some(p => p.id === id) || playerStatus(id)) return;

    const hit = hiddenPlayers().some(p => p.id === id);
    day.playerGuesses.push({ id, hit });
    const allFound = foundIds().length === shelf.puzzle.hidden;
    if (allFound || playerMisses() >= SHELF_PLAYER_MISSES) {
        day.stage = "value";
        act("value", allFound ? "allFound" : "playersMissed", id);
    } else {
        act("players", hit ? "hit" : "miss", id);
    }
    save();
    render();
}

// Round 3. Values are display text (".331", "2.45", "68.5%", "4,624").
// Batting averages can be typed as ".331" or "331".
function parseValue(text) {
    const n = parseFloat(String(text).replace(/[%,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
}

function valueTier(guessText, answerText) {
    const answer = parseValue(answerText);
    let guess = parseValue(guessText);
    if (guess === null || answer === null) return null;
    if (answer < 1 && guess >= 1 && answerText.trim().startsWith(".")) guess /= 1000;

    const decimals = (answerText.replace(/[^0-9.]/g, "").split(".")[1] || "").length;
    if (Math.abs(guess - answer) <= 0.5 * 10 ** -decimals + 1e-9) return "exact";
    const off = Math.abs(guess - answer) / Math.abs(answer || 1);
    return off <= 0.02 ? "close" : off <= 0.05 ? "near" : "far";
}

function guessValue(text) {
    const day = shelf.day;
    if (day.stage !== "value") return;
    const tier = valueTier(text, shelf.board.players[0].value);
    if (!tier) {
        act("value", "notNumber");
        render();
        return;
    }
    day.valueGuess = text.trim();
    day.valueTier = tier;
    day.stage = "done";
    day.done = true;
    save();
    render();
}


/* ============================================================
   3. HINTS AND SHARING
   ============================================================ */
function initials(name) {
    return name.split(/\s+/)
        .filter(word => !NAME_SUFFIXES.has(normalize(word)))
        .map(word => word[0].toUpperCase() + ".")
        .join("");
}

// The stat round's hints, unlocked one per miss
function statHints() {
    const { puzzle, board } = shelf;
    const category = puzzle.category ? puzzle.category[0].toUpperCase() + puzzle.category.slice(1) + " · " : "";
    return [
        `It's a <strong>${escapeHTML(category + (puzzle.group || board.group || ""))}</strong> stat`,
        `#${board.players.at(-1).rank} had <strong>${escapeHTML(board.players.at(-1).value)}</strong>`
    ].slice(0, statMisses());
}

function shareText() {
    const { puzzle, day } = shelf;
    const statMarks = day.statSolved
        ? day.statGuesses.map(l => (l === puzzle.stat ? "✅" : "❌")).join("")
        : "❌".repeat(SHELF_STAT_TRIES);
    const playerMarks = day.playerGuesses.map(g => (g.hit ? "✅" : "❌")).join("") || "—";
    const points = `${shelfPoints(day)}/${shelfMaxPoints(puzzle.hidden)}`;
    return `Postgames Top Shelf #${shelf.number} · ${SPORT_LABELS[puzzle.sport]} ${formatSeason(puzzle.sport, puzzle.year)}\n` +
        `Stat ${statMarks} · Top ${puzzle.hidden} ${playerMarks} · #1 ${TIER_EMOJI[day.valueTier]}\n` +
        `${points} · ${SHARE_URL}`;
}


/* ============================================================
   4. RENDERING
   ============================================================ */
const STAGE_ORDER = ["stat", "players", "value", "done"];

function stageIndex() {
    return STAGE_ORDER.indexOf(shelf.day.stage);
}

function isFresh() {
    return !!shelf.lastAction && shelf.lastAction.at > shelf.lastDrawnAt;
}

// The three rounds across the top: done (with how it went), now, or next
function renderRounds() {
    const { day, puzzle } = shelf;
    const current = stageIndex();
    const found = foundIds().length;
    const rounds = [
        ["The stat", day.statSolved ? `✓ in ${day.statGuesses.length}` : current > 0 ? "✗" : ""],
        [`Top ${puzzle.hidden}`, current > 1 ? `${found} of ${puzzle.hidden}` : ""],
        ["#1's number", day.done ? TIER_EMOJI[day.valueTier] : ""]
    ];
    ui.rounds.innerHTML = rounds.map(([label, result], i) => {
        const state = i < current ? "done" : i === current ? "now" : "next";
        return `<li class="shelf-round ${state}"><span class="shelf-round-num">${i + 1}</span>` +
            `<span class="shelf-round-label">${label}</span><span class="shelf-round-result">${result}</span></li>`;
    }).join("");
}

// The board. Hidden top rows show ??? (plus teams after a round-2 miss,
// initials after two) until found or the round ends. Values stay hidden
// in round 1 (but #10's, as a hint), then show for everyone but #1.
function renderBoard() {
    const { board, puzzle, day } = shelf;
    const stage = stageIndex();
    const found = foundIds();
    const misses = playerMisses();

    ui.board.innerHTML = board.players.map((player, i) => {
        const isHidden = i < puzzle.hidden;
        const isFound = found.includes(player.id);
        const nameShown = !isHidden || isFound || stage > 1;
        let main;
        if (nameShown) {
            main = `<span class="slot-line"><span class="slot-name">${escapeHTML(player.name)}</span>${teamTagFor(puzzle.sport, player.team, "slot-team")}</span>`;
        } else {
            const clues = stage === 1
                ? (misses >= 1 ? teamTagFor(puzzle.sport, player.team, "slot-team") : "") +
                  (misses >= 2 ? `<span class="shelf-initials">${escapeHTML(initials(player.name))}</span>` : "")
                : "";
            main = `<span class="slot-line"><span class="daily-unknown">???</span>${clues}</span>`;
        }

        const lastRowHint = stage === 0 && i === board.players.length - 1 && statMisses() >= 2;
        const valueShown = day.done || (stage >= 1 && i > 0) || lastRowHint;
        const value = valueShown ? escapeHTML(player.value) : i === 0 && stage >= 1 ? "?" : "";

        const classes = ["slot",
            isHidden && "shelf-hidden",
            isHidden && isFound && "solved",
            isHidden && !isFound && stage > 1 && "failed",
            i === 0 && day.done && `tier-${day.valueTier}`
        ].filter(Boolean).join(" ");
        return `
            <li class="${classes}">
                <span class="slot-rank">${player.rank}</span>
                <span class="slot-main">${main}</span>
                <span class="slot-value">${value}</span>
            </li>`;
    }).join("");
}

function renderStatRound() {
    const { puzzle, day } = shelf;
    ui.statOptions.innerHTML = puzzle.options.map(label => {
        const tried = day.statGuesses.includes(label);
        return `<button class="chip shelf-option ${tried ? "wrong" : ""}" type="button" data-stat="${escapeHTML(label)}" ${tried ? "disabled" : ""}>${escapeHTML(label)}</button>`;
    }).join("");

    const last = shelf.lastAction?.round === "stat" ? shelf.lastAction : null;
    const left = SHELF_STAT_TRIES - statMisses();
    const lines = [];
    if (last?.kind === "wrong") {
        lines.push(`<span class="feedback-main">✗ Not ${escapeHTML(last.value)} <span class="feedback-note">${left} ${left === 1 ? "try" : "tries"} left</span></span>`);
    }
    for (const hint of statHints()) lines.push(`<span class="daily-new-hint">Hint · ${hint}</span>`);
    ui.statFeedback.innerHTML = lines.join("");
    ui.statFeedback.className = "feedback" + (last ? " wrong" : "");
    if (last && isFresh()) replayClass(ui.statFeedback, "fresh");
}

function renderPlayerRound() {
    const { puzzle, day } = shelf;
    const left = SHELF_PLAYER_MISSES - playerMisses();
    const remaining = puzzle.hidden - foundIds().length;
    const intro = shelf.lastAction?.kind === "statMissed"
        ? `It was <strong>${escapeHTML(puzzle.stat)}</strong>. `
        : shelf.lastAction?.kind === "statRight" ? "Got it. " : "";
    ui.playerPrompt.innerHTML = `${intro}Now name the top ${puzzle.hidden}: ${remaining} to go, ` +
        `${left} ${left === 1 ? "miss" : "misses"} left.`;

    const last = shelf.lastAction?.round === "players" && ["hit", "miss"].includes(shelf.lastAction.kind) ? shelf.lastAction : null;
    ui.playerFeedback.className = "feedback";
    ui.playerFeedback.innerHTML = "";
    if (last) {
        const name = escapeHTML(shelf.roster.find(p => p.id === last.value)?.name);
        const misses = playerMisses();
        const hint = last.kind === "miss" && misses <= 2
            ? `<span class="daily-new-hint">Hint · ${misses === 1 ? "their <strong>teams</strong>" : "their <strong>initials</strong>"} are now on the board</span>`
            : "";
        ui.playerFeedback.innerHTML = last.kind === "hit"
            ? `<span class="feedback-main">✓ ${name}</span>`
            : `<span class="feedback-main">✗ “${name}” <span class="feedback-note">isn't up top</span></span>${hint}`;
        ui.playerFeedback.classList.add(last.kind === "hit" ? "correct" : "wrong");
        if (isFresh()) {
            replayClass(ui.playerFeedback, "fresh");
            if (last.kind === "miss") replayClass(ui.guessForm, "shake");
        }
    }
    renderGuessResults();
}

const STATUS_LABELS = { board: "On the board", correct: "✓ Found", wrong: "✗ You missed" };

function renderGuessResults() {
    const found = shelf.day.stage === "players" ? matchPlayers(shelf.roster, ui.guessInput.value) : null;
    ui.guessResults.classList.toggle("hidden", !found);
    ui.guessInput.setAttribute("aria-expanded", String(!!found));
    if (!found) {
        ui.guessResults.innerHTML = "";
        _highlight = -1;
        return;
    }
    if (_highlight >= found.players.length) _highlight = found.players.length - 1;

    const rows = found.players.map((player, idx) => {
        const status = playerStatus(player.id);
        const meta = status
            ? `<span class="guess-status">${STATUS_LABELS[status]}</span>`
            : teamTagFor(shelf.puzzle.sport, player.team) + (player.pos ? `<span class="guess-option-pos">${escapeHTML(player.pos)}</span>` : "");
        return `
            <li role="option" aria-selected="${idx === _highlight}">
                <button class="guess-option ${status === "board" ? "" : status || ""} ${idx === _highlight ? "active" : ""}" type="button"
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

function renderValueRound() {
    const { board, puzzle } = shelf;
    const top = board.players[0];
    const intro = { allFound: "All found. ", playersMissed: "Out of misses. " }[shelf.lastAction?.kind] || "";
    ui.valuePrompt.innerHTML = `${intro}Last one: what was <strong>${escapeHTML(top.name)}</strong>'s ${escapeHTML(puzzle.stat)}?`;
    const second = board.players[1];
    ui.valueHint.textContent = shelf.lastAction?.kind === "notNumber"
        ? "Type a number."
        : `#${second.rank} had ${second.value}. Exact is 3 points, within 2% is 2, within 5% is 1.`;
}

function renderDone() {
    const { day, puzzle, board } = shelf;
    const points = shelfPoints(day);
    const max = shelfMaxPoints(puzzle.hidden);
    ui.doneTitle.textContent = `${points} / ${max}`;
    const statPart = day.statSolved ? `Stat in ${day.statGuesses.length}` : "Missed the stat";
    ui.doneSub.textContent = `${statPart} · ${foundIds().length} of ${puzzle.hidden} up top · ` +
        `#1: ${board.players[0].value} (you said ${day.valueGuess}, ${TIER_LABEL[day.valueTier].toLowerCase()})`;

    const summary = shelfSummary(loadDailyDays(storeKey()));
    const tiles = [["Played", summary.played], ["Avg pts", summary.average.toFixed(1)], ["Best", summary.best], ["Streak", summary.streak]];
    ui.summary.innerHTML = `<div class="stats-totals">${tiles.map(([label, value]) =>
        `<div class="stats-total"><span class="stats-total-num">${value}</span><span class="stats-total-label">${label}</span></div>`).join("")}</div>`;
    ui.nextPuzzle.textContent = `Next puzzle in ${timeToNextPuzzle()}`;
}

function render() {
    if (!ui.status) return;
    ui.testBar.classList.toggle("hidden", !shelf.test);
    if (shelf.test) ui.testDay.textContent = testDayLabel(shelf.number, shelf.testOffset);

    const ready = shelf.status === "ready";
    ui.game.classList.toggle("hidden", !ready);
    ui.status.textContent = {
        loading: "Loading today's puzzle…",
        none: "No puzzle scheduled for today. Check back soon.",
        error: "Couldn't load today's puzzle. Check your connection and reopen the page."
    }[shelf.status] || "";
    if (!ready) return;

    const { puzzle, day } = shelf;
    const statKnown = stageIndex() >= 1;
    ui.eyebrow.textContent = `Daily #${shelf.number}`;
    ui.context.textContent = boardContextLabel({ sport: puzzle.sport, year: puzzle.year });
    ui.stat.textContent = statKnown ? puzzle.stat : "???";
    ui.stat.classList.toggle("shelf-unknown", !statKnown);
    ui.qualifier.textContent = statKnown ? statQualifier(puzzle.sport, puzzle.stat, puzzle.year) : "";

    renderRounds();
    renderBoard();
    ui.statRound.classList.toggle("hidden", day.stage !== "stat");
    ui.playerRound.classList.toggle("hidden", day.stage !== "players");
    ui.valueRound.classList.toggle("hidden", day.stage !== "value");
    ui.done.classList.toggle("hidden", !day.done);

    if (day.stage === "stat") renderStatRound();
    if (day.stage === "players") renderPlayerRound();
    if (day.stage === "value") renderValueRound();
    if (day.done) renderDone();

    if (shelf.lastAction) shelf.lastDrawnAt = Math.max(shelf.lastDrawnAt, shelf.lastAction.at);
}


/* ============================================================
   5. STARTUP
   ============================================================ */
function pickGuess(id) {
    guessPlayer(id);
    ui.guessInput.value = "";
    _highlight = -1;
    if (shelf.day.stage === "players") {
        renderGuessResults();
        ui.guessInput.focus();
    } else {
        ui.guessInput.blur();
        if (shelf.day.stage === "value") ui.valueInput.focus();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const byId = id => document.getElementById(id);
    Object.assign(ui, {
        eyebrow: byId("dailyEyebrow"), status: byId("dailyStatus"), game: byId("dailyGame"),
        testBar: byId("testBar"), testDay: byId("testDay"),
        context: byId("shelfContext"), stat: byId("shelfStat"), qualifier: byId("shelfQualifier"),
        rounds: byId("shelfRounds"), board: byId("dailyBoard"),
        statRound: byId("statRound"), statOptions: byId("statOptions"), statFeedback: byId("statFeedback"),
        playerRound: byId("playerRound"), playerPrompt: byId("playerPrompt"), guessForm: byId("guessForm"),
        guessInput: byId("guessInput"), guessResults: byId("guessResults"), playerFeedback: byId("playerFeedback"),
        valueRound: byId("valueRound"), valuePrompt: byId("valuePrompt"), valueForm: byId("valueForm"),
        valueInput: byId("valueInput"), valueHint: byId("valueHint"),
        done: byId("dailyDone"), doneTitle: byId("doneTitle"), doneSub: byId("doneSub"),
        shareBtn: byId("shareBtn"), shareStatus: byId("shareStatus"), summary: byId("dailySummary"),
        nextPuzzle: byId("nextPuzzle")
    });

    ui.statOptions.addEventListener("click", e => {
        const option = e.target.closest(".shelf-option");
        if (option && !option.disabled) guessStat(option.dataset.stat);
    });

    ui.guessInput.addEventListener("input", () => {
        _highlight = -1;
        renderGuessResults();
    });
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

    ui.valueForm.addEventListener("submit", e => {
        e.preventDefault();
        guessValue(ui.valueInput.value);
        if (shelf.day.done) {
            ui.valueInput.blur();
            ui.rounds.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });

    ui.shareBtn.addEventListener("click", () => shareOrCopy(shareText(), ui.shareStatus));
    ui.eyebrow.addEventListener("click", fiveTaps(() => setTestMode(!shelf.test)));
    byId("testPrev").addEventListener("click", () => { shelf.testOffset -= 1; loadToday(); });
    byId("testNext").addEventListener("click", () => { shelf.testOffset += 1; loadToday(); });
    byId("testReset").addEventListener("click", () => { saveDailyDay(shelf.date, null, SHELF_TEST_KEY); loadToday(); });
    byId("testExit").addEventListener("click", () => setTestMode(false));

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && !shelf.test && localDateKey() !== shelf.date) loadToday();
    });

    shelf.test = readDailyTestFlag();
    loadToday();
});
