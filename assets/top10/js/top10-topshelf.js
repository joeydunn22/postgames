/* ============================================================
   TOP 10 — DAILY CHALLENGE: TOP SHELF (pages/top10-topshelf.html)
   A top-10 board with the season, the top 3 names and every value
   hidden; the sport, the stat and ranks 4-10 (names and teams) are
   shown. Four rounds:
     1. The season: pick it, 3 tries, no hints.
     2. The top 3: name them in any order, 3 misses allowed. Found
        names go in a tray, not their slots, so the order stays hidden.
        Misses unlock hints: their teams, then their initials (listed
        alphabetically, so they don't give the order away).
     3. The order: tap the three (all revealed now) into #1, #2, #3.
     4. The number: guess #1's value blind, scored by how close.
   The day's board comes from data/daily.json (top_shelf, built by
   scripts/build_daily.py). Progress is saved after every step
   (top10-records.js), so closing the app never resets the day.
   Test mode works as on Who's Missing (see top10-common.js).
   ============================================================ */

const SHARE_URL = "https://joeydunn22.github.io/postgames/pages/top10-topshelf.html";
const TIER_EMOJI = { exact: "🎯", close: "🟩", near: "🟨", far: "🟥" };
const TIER_LABEL = { exact: "bullseye", close: "within 3%", near: "within 10%", far: "not close" };
const STAGES = ["season", "players", "order", "value", "done"];

const shelf = {
    status: "loading",   // loading | ready | none | error
    date: null,          // "YYYY-MM-DD"
    number: 0,           // Daily #N
    puzzle: null,        // the day's entry from daily.json's top_shelf
    board: null,         // { label, players: [...] }
    roster: [],          // everyone who played that season (the guess list)
    years: [],           // the sport's seasons, newest first (the season round's choices)
    day: null,           // saved progress (see top10-records.js)
    picking: [],         // order round: ids tapped so far, #1 first (saved on lock)
    lastAction: null,    // { kind, value, at }: the line under the current round
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
    return { v: 2, number, stage: "season", seasonGuesses: [], seasonSolved: false, playerGuesses: [],
             order: [], orderCorrect: 0, valueGuess: null, valueTier: null, done: false, at: Date.now() };
}

async function loadToday() {
    shelf.date = shelf.test ? addDays(localDateKey(), shelf.testOffset) : localDateKey();
    shelf.status = "loading";
    shelf.lastAction = null;
    shelf.picking = [];
    render();

    try {
        const [schedule, manifest] = await Promise.all([fetchData("daily.json"), fetchData("manifest.json")]);
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

        const saved = loadDailyDays(storeKey())[shelf.date];
        Object.assign(shelf, {
            status: "ready",
            number: index + 1,
            puzzle,
            board,
            roster: roster.map(withSearchWords),
            years: [...new Set(manifest.available
                .filter(e => e.sport === puzzle.sport && e.year !== ALL_TIME)
                .map(e => e.year))].sort((a, b) => b - a),
            day: saved?.v === 2 ? saved : newDay(index + 1)
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

// Alphabetical, so lists of them never hint at the order
function hiddenAlphabetical() {
    return [...hiddenPlayers()].sort((a, b) => a.name.localeCompare(b.name));
}

function stageIndex() {
    return STAGES.indexOf(shelf.day.stage);
}

function seasonMisses() {
    return shelf.day.seasonGuesses.filter(y => y !== shelf.puzzle.year).length;
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

function act(kind, value = null) {
    shelf.lastAction = { kind, value, at: Date.now() };
}

// Round 1
function guessSeason(year) {
    const day = shelf.day;
    year = Number(year);
    if (day.stage !== "season" || !shelf.years.includes(year) || day.seasonGuesses.includes(year)) return;

    day.seasonGuesses.push(year);
    if (year === shelf.puzzle.year) {
        day.seasonSolved = true;
        day.stage = "players";
        act("seasonRight");
    } else if (seasonMisses() >= SHELF_SEASON_TRIES) {
        day.stage = "players";
        act("seasonMissed");
    } else {
        act("seasonWrong", year);
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
        day.stage = "order";
        act(allFound ? "allFound" : "playersMissed");
    } else {
        act(hit ? "hit" : "miss", id);
    }
    save();
    render();
}

// Round 3: tap players into #1, #2, #3, then lock in
function pickOrder(id) {
    if (shelf.day.stage !== "order" || shelf.picking.includes(id) || shelf.picking.length >= shelf.puzzle.hidden) return;
    shelf.picking.push(id);
    render();
}

function undoOrder() {
    shelf.picking.pop();
    render();
}

function lockOrder() {
    const day = shelf.day;
    if (day.stage !== "order" || shelf.picking.length !== shelf.puzzle.hidden) return;
    day.order = [...shelf.picking];
    day.orderCorrect = day.order.filter((id, i) => id === hiddenPlayers()[i].id).length;
    day.stage = "value";
    act("ordered");
    save();
    render();
}

// Round 4. Values are display text (".331", "2.45", "68.5%", "4624").
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
    return off <= 0.03 ? "close" : off <= 0.1 ? "near" : "far";
}

function guessValue(text) {
    const day = shelf.day;
    if (day.stage !== "value") return;
    const tier = valueTier(text, shelf.board.players[0].value);
    if (!tier) {
        act("notNumber");
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
function playerName(id) {
    return shelf.roster.find(p => p.id === id)?.name || shelf.board.players.find(p => p.id === id)?.name || "";
}

function shareText() {
    const { puzzle, day } = shelf;
    const marks = list => list.map(ok => (ok ? "✅" : "❌")).join("");
    const season = day.seasonSolved
        ? marks(day.seasonGuesses.map(y => y === puzzle.year))
        : "❌".repeat(SHELF_SEASON_TRIES);
    const players = marks(day.playerGuesses.map(g => g.hit));
    const order = marks(day.order.map((id, i) => id === hiddenPlayers()[i].id));
    return `Postgames Top Shelf #${shelf.number} · ${SPORT_LABELS[puzzle.sport]} ${puzzle.stat}\n` +
        `Season ${season} · Top ${puzzle.hidden} ${players} · Order ${order} · #1 ${TIER_EMOJI[day.valueTier]}\n` +
        `${shelfPoints(day)}/${shelfMaxPoints(puzzle.hidden)} · ${SHARE_URL}`;
}


/* ============================================================
   4. RENDERING
   ============================================================ */
function isFresh() {
    return !!shelf.lastAction && shelf.lastAction.at > shelf.lastDrawnAt;
}

// The four rounds across the top: done (with how it went), now, or next
function renderRounds() {
    const { day, puzzle } = shelf;
    const current = stageIndex();
    const rounds = [
        ["Season", day.seasonSolved ? `✓ in ${day.seasonGuesses.length}` : current > 0 ? "✗" : ""],
        [`Top ${puzzle.hidden}`, current > 1 ? `${foundIds().length}/${puzzle.hidden}` : ""],
        ["Order", current > 2 ? `${day.orderCorrect}/${puzzle.hidden}` : ""],
        ["#1's number", day.done ? TIER_EMOJI[day.valueTier] : ""]
    ];
    ui.rounds.innerHTML = rounds.map(([label, result], i) => {
        const state = i < current ? "done" : i === current ? "now" : "next";
        return `<li class="shelf-round ${state}"><span class="shelf-round-num">${i + 1}</span>` +
            `<span class="shelf-round-label">${label}</span><span class="shelf-round-result">${result}</span></li>`;
    }).join("");
}

// The board. The top rows stay ??? until the order is locked in, then
// show the real top 3 (green where your order was right). Values show
// only once the day's done.
function renderBoard() {
    const { board, puzzle, day } = shelf;
    const revealed = stageIndex() >= STAGES.indexOf("value");

    ui.board.innerHTML = board.players.map((player, i) => {
        const isHidden = i < puzzle.hidden;
        const nameShown = !isHidden || revealed;
        const main = nameShown
            ? `<span class="slot-line"><span class="slot-name">${escapeHTML(player.name)}</span>${teamTagFor(puzzle.sport, player.team, "slot-team")}</span>`
            : `<span class="slot-line"><span class="daily-unknown">???</span></span>`;
        const classes = ["slot",
            isHidden && "shelf-hidden",
            isHidden && revealed && (day.order[i] === player.id ? "solved" : "failed"),
            i === 0 && day.done && `tier-${day.valueTier}`
        ].filter(Boolean).join(" ");
        return `
            <li class="${classes}">
                <span class="slot-rank">${player.rank}</span>
                <span class="slot-main">${main}</span>
                <span class="slot-value">${day.done ? escapeHTML(player.value) : ""}</span>
            </li>`;
    }).join("");
}

function renderSeasonRound() {
    const { puzzle, day } = shelf;
    const tried = new Set(day.seasonGuesses);
    const options = shelf.years.filter(y => !tried.has(y));
    const key = options.join(",");
    if (ui.seasonSelect.dataset.key !== key) {
        ui.seasonSelect.dataset.key = key;
        ui.seasonSelect.innerHTML = `<option value="">Pick a season</option>` +
            options.map(y => `<option value="${y}">${formatSeason(puzzle.sport, y)}</option>`).join("");
    }

    const last = shelf.lastAction?.kind === "seasonWrong" ? shelf.lastAction : null;
    const left = SHELF_SEASON_TRIES - seasonMisses();
    ui.seasonFeedback.className = "feedback";
    ui.seasonFeedback.innerHTML = last
        ? `<span class="feedback-main">✗ Not ${formatSeason(puzzle.sport, last.value)} <span class="feedback-note">${left} ${left === 1 ? "try" : "tries"} left</span></span>`
        : "";
    if (last) {
        ui.seasonFeedback.classList.add("wrong");
        if (isFresh()) replayClass(ui.seasonFeedback, "fresh");
    }
}

function renderPlayerRound() {
    const { puzzle } = shelf;
    const left = SHELF_PLAYER_MISSES - playerMisses();
    const remaining = puzzle.hidden - foundIds().length;
    const season = formatSeason(puzzle.sport, puzzle.year);
    const intro = { seasonRight: "Got it. ", seasonMissed: `It was <strong>${season}</strong>. ` }[shelf.lastAction?.kind] || "";
    ui.playerPrompt.innerHTML = `${intro}Name the top ${puzzle.hidden}, in any order: ${remaining} to go, ` +
        `${left} ${left === 1 ? "miss" : "misses"} left.`;

    const last = ["hit", "miss"].includes(shelf.lastAction?.kind) ? shelf.lastAction : null;
    ui.playerFeedback.className = "feedback";
    ui.playerFeedback.innerHTML = "";
    if (last) {
        const name = escapeHTML(playerName(last.value));
        const misses = playerMisses();
        const hint = last.kind === "miss" && misses <= 2
            ? `<span class="daily-new-hint">Hint · their <strong>${misses === 1 ? "teams" : "initials"}</strong> are now below</span>`
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

    // Found so far, then the hints (alphabetical, so no order is given away)
    const found = foundIds();
    const misses = playerMisses();
    const rows = found.map(id => {
        const player = hiddenPlayers().find(p => p.id === id);
        return `<li class="shelf-tray-found">✓ ${escapeHTML(player.name)} ${teamTagFor(puzzle.sport, player.team)}</li>`;
    });
    if (misses >= 1) {
        rows.push(`<li class="shelf-tray-hint"><span class="daily-hint-label">Their teams</span> ` +
            hiddenAlphabetical().map(p => teamTagFor(puzzle.sport, p.team)).join(" ") + `</li>`);
    }
    if (misses >= 2) {
        rows.push(`<li class="shelf-tray-hint"><span class="daily-hint-label">Their initials</span> ` +
            hiddenAlphabetical().map(p => `<strong>${escapeHTML(initials(p.name))}</strong>`).join(" · ") + `</li>`);
    }
    ui.playerTray.innerHTML = rows.join("");
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

function renderOrderRound() {
    const { puzzle } = shelf;
    const intro = { allFound: "All three found. ", playersMissed: "Out of misses. Here they are. " }[shelf.lastAction?.kind] || "";
    const next = shelf.picking.length < puzzle.hidden ? `Tap who was #${shelf.picking.length + 1}.` : "Lock it in when you're sure.";
    ui.orderPrompt.innerHTML = `${intro}Now put them in order. ${next}`;

    ui.orderChoices.innerHTML = hiddenAlphabetical().map(p => {
        const used = shelf.picking.includes(p.id);
        return `<button class="chip shelf-order-choice" type="button" data-id="${escapeHTML(p.id)}" ${used ? "disabled" : ""}>` +
            `${escapeHTML(p.name)}</button>`;
    }).join("");
    ui.orderPicked.innerHTML = Array.from({ length: puzzle.hidden }, (_, i) => {
        const id = shelf.picking[i];
        return `<li class="shelf-order-slot ${id ? "filled" : ""}"><span class="slot-rank">${i + 1}</span>` +
            `<span>${id ? escapeHTML(playerName(id)) : ""}</span></li>`;
    }).join("");
    ui.orderUndo.disabled = shelf.picking.length === 0;
    ui.orderLock.disabled = shelf.picking.length !== puzzle.hidden;
}

function renderValueRound() {
    const { board, puzzle, day } = shelf;
    const right = day.orderCorrect;
    const intro = shelf.lastAction?.kind === "ordered"
        ? `${right === puzzle.hidden ? "Perfect order. " : `${right} of ${puzzle.hidden} in the right spot. `}`
        : "";
    ui.valuePrompt.innerHTML = `${intro}Last one: what was <strong>${escapeHTML(board.players[0].name)}</strong>'s ${escapeHTML(puzzle.stat)}?`;
    ui.valueHint.textContent = shelf.lastAction?.kind === "notNumber"
        ? "Type a number."
        : "Exact is 3 points, within 3% is 2, within 10% is 1.";
}

function renderDone() {
    const { day, puzzle, board } = shelf;
    ui.doneTitle.textContent = `${shelfPoints(day)} / ${shelfMaxPoints(puzzle.hidden)}`;
    const season = formatSeason(puzzle.sport, puzzle.year);
    const seasonPart = day.seasonSolved ? `${season} in ${day.seasonGuesses.length}` : `Missed the season (${season})`;
    ui.doneSub.textContent = `${seasonPart} · ${foundIds().length} of ${puzzle.hidden} named · ` +
        `${day.orderCorrect} of ${puzzle.hidden} in order · #1: ${board.players[0].value} ` +
        `(you said ${day.valueGuess}, ${TIER_LABEL[day.valueTier]})`;

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
    const seasonKnown = stageIndex() >= 1;
    ui.eyebrow.textContent = `Daily #${shelf.number}`;
    ui.context.textContent = `${SPORT_LABELS[puzzle.sport]} · ${seasonKnown ? formatSeason(puzzle.sport, puzzle.year) : "Season ?"}`;
    ui.stat.textContent = puzzle.stat;
    ui.qualifier.textContent = statQualifier(puzzle.sport, puzzle.stat, puzzle.year);

    renderRounds();
    renderBoard();
    for (const stage of ["season", "players", "order", "value"]) {
        ui[`${stage}Round`].classList.toggle("hidden", day.stage !== stage);
    }
    ui.done.classList.toggle("hidden", !day.done);

    if (day.stage === "season") renderSeasonRound();
    if (day.stage === "players") renderPlayerRound();
    if (day.stage === "order") renderOrderRound();
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
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const byId = id => document.getElementById(id);
    Object.assign(ui, {
        eyebrow: byId("dailyEyebrow"), status: byId("dailyStatus"), game: byId("dailyGame"),
        testBar: byId("testBar"), testDay: byId("testDay"),
        context: byId("shelfContext"), stat: byId("shelfStat"), qualifier: byId("shelfQualifier"),
        rounds: byId("shelfRounds"), board: byId("dailyBoard"),
        seasonRound: byId("seasonRound"), seasonForm: byId("seasonForm"), seasonSelect: byId("seasonSelect"),
        seasonFeedback: byId("seasonFeedback"),
        playersRound: byId("playerRound"), playerPrompt: byId("playerPrompt"), guessForm: byId("guessForm"),
        guessInput: byId("guessInput"), guessResults: byId("guessResults"), playerFeedback: byId("playerFeedback"),
        playerTray: byId("playerTray"),
        orderRound: byId("orderRound"), orderPrompt: byId("orderPrompt"), orderChoices: byId("orderChoices"),
        orderPicked: byId("orderPicked"), orderUndo: byId("orderUndo"), orderLock: byId("orderLock"),
        valueRound: byId("valueRound"), valuePrompt: byId("valuePrompt"), valueForm: byId("valueForm"),
        valueInput: byId("valueInput"), valueHint: byId("valueHint"),
        done: byId("dailyDone"), doneTitle: byId("doneTitle"), doneSub: byId("doneSub"),
        shareBtn: byId("shareBtn"), shareStatus: byId("shareStatus"), summary: byId("dailySummary"),
        nextPuzzle: byId("nextPuzzle")
    });

    ui.seasonForm.addEventListener("submit", e => {
        e.preventDefault();
        if (ui.seasonSelect.value) guessSeason(ui.seasonSelect.value);
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

    ui.orderChoices.addEventListener("click", e => {
        const choice = e.target.closest(".shelf-order-choice");
        if (choice && !choice.disabled) pickOrder(choice.dataset.id);
    });
    ui.orderUndo.addEventListener("click", undoOrder);
    ui.orderLock.addEventListener("click", lockOrder);

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
