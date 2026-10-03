/* ============================================================
   TOP 10 — RENDERER
   Everything that touches the page. render() redraws the screen from
   state after any change; button handlers call actions in
   top10-logic.js and never change state themselves.
   ============================================================ */

let _uiReady = false;
let _lastSeenGuessAt = 0;      // so only brand-new guesses animate
let _wasMyTurn = false;        // so the guess box gets focus when your turn starts
let _highlight = -1;           // guess result picked with the arrow keys, -1 = none
let _yearOptionsKey = null;    // which season list the dropdown currently holds
let _statOptionsKey = null;    // which stat list the dropdown currently holds
let _playerPillsKey = null;    // which players the pills currently show

const STAT_HINTS = {
    loading: "Loading stats…",
    empty: "No stats for this pick yet.",
    error: "Couldn't load stats for this pick."
};


/* ============================================================
   1. HELPERS
   ============================================================ */

// A team code as a colored tag, for the current game's sport
function teamTag(team, extraClass = "") {
    return teamTagFor(game.sport, team, extraClass);
}

function gameContextLabel() {
    return game.sport ? boardContextLabel(game) : "";
}

function timesLabel(n) {
    return n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
}

function isFreshGuess() {
    return !!game.lastGuess && game.lastGuess.at > _lastSeenGuessAt;
}

// Replay a CSS animation class on an element
function replayAnimation(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
}


/* ============================================================
   2. SETUP SCREEN
   ============================================================ */

// Era, random, sport / category / season, timer: highlight the current pick,
// grey out options with no data in the era, and lock them unless you're choosing
function renderPickers() {
    const locked = !canEditSetup();

    for (const btn of ui.eraChips) {
        btn.classList.toggle("active", game.era === btn.dataset.era);
        btn.disabled = locked;
    }

    // Random: any sport, plus one for the picked sport
    ui.randomAnyBtn.disabled = locked || !hasData();
    ui.randomSportBtn.classList.toggle("hidden", !game.sport);
    ui.randomSportBtn.textContent = `Random ${SPORT_LABELS[game.sport] || ""}`;
    ui.randomSportBtn.disabled = locked || !hasData({ sport: game.sport });

    for (const btn of ui.sportChips) {
        const available = hasData({ sport: btn.dataset.sport });
        btn.classList.toggle("active", game.sport === btn.dataset.sport);
        btn.disabled = locked || !available;
        btn.title = available ? "" : "No seasons in this era";
    }

    ui.categoryRow.classList.toggle("hidden", game.sport !== "mlb");
    for (const btn of ui.categoryChips) {
        btn.classList.toggle("active", game.category === btn.dataset.category);
        btn.disabled = locked || !hasData({ sport: game.sport, category: btn.dataset.category });
    }

    renderYearPicker(locked);
    renderStatPicker(locked);

    for (const btn of ui.timerChips) {
        btn.classList.toggle("active", game.timerSeconds === Number(btn.dataset.timer));
        btn.disabled = locked;
    }
}

// Seasons in the era with data for the picked sport (and category), newest first
function renderYearPicker(locked) {
    const years = availableYears({ sport: game.sport, category: game.category });
    const optionsKey = `${game.sport}:${years.join("|")}`;

    if (optionsKey !== _yearOptionsKey) {
        _yearOptionsKey = optionsKey;
        const prompt = game.sport && years.length === 0 ? "No seasons in this era" : "Pick a season";
        ui.yearSelect.innerHTML = `<option value="">${prompt}</option>` +
            years.map(year => `<option value="${year}">${formatSeason(game.sport, year)}</option>`).join("");
    }

    ui.yearSelect.value = game.year ? String(game.year) : "";
    ui.yearSelect.disabled = locked || years.length === 0;
}

// Stats in sections (Passing, Rushing, …), in the file's order
function renderStatPicker(locked) {
    const stats = Object.values(game.data);
    const optionsKey = stats.map(stat => stat.label).join("|");

    if (optionsKey !== _statOptionsKey) {
        _statOptionsKey = optionsKey;
        const groups = new Map();
        for (const stat of stats) {
            const group = stat.group || "Stats";
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group).push(`<option>${escapeHTML(stat.label)}</option>`);
        }
        ui.statSelect.innerHTML = `<option value="">Pick a stat</option>` +
            [...groups].map(([group, options]) => `<optgroup label="${escapeHTML(group)}">${options.join("")}</optgroup>`).join("");
    }

    ui.statSelect.value = game.stat || "";
    ui.statSelect.disabled = locked || game.dataStatus !== "ready";
    ui.statHint.textContent = STAT_HINTS[game.dataStatus] || "";
    renderBestHint();
}

// Solo: your best on the picked board, from the games saved on this phone
function renderBestHint() {
    const stat = isSolo() ? game.data[game.stat] : null;
    if (!stat) {
        ui.bestHint.textContent = "";
        return;
    }
    const best = bestOnBoard({ sport: game.sport, category: game.category, year: game.year, stat: game.stat });
    ui.bestHint.textContent = best
        ? `Your best: ${best.best} of ${stat.players.length} · played ${timesLabel(best.plays)}`
        : "You haven't played this one solo yet.";
}

// The daily challenge cards: hidden in a room, and say when today's are done
function renderDailyLink() {
    ui.dailyLinks.classList.toggle("hidden", inRoom());
    const today = localDateKey();

    const missing = loadDailyDays()[today];
    if (missing?.done) {
        const { streak } = dailySummary();
        ui.dailyLinkStatus.textContent = (missing.solved ? `Solved in ${missing.marks.length}` : "Done for today") +
            (streak ? ` · ${streak}-day streak` : "");
    }
    const shelfDay = loadDailyDays(SHELF_KEY)[today];
    if (shelfDay?.done) {
        const { streak } = shelfSummary(loadDailyDays(SHELF_KEY));
        ui.shelfLinkStatus.textContent = `Scored ${shelfPoints(shelfDay)} today` + (streak ? ` · ${streak}-day streak` : "");
    }
}

// How the players listed will play
function renderModeHint() {
    ui.modeHint.textContent = inRoom()
        ? "Everyone plays on their own phone."
        : isSolo()
            ? "Solo: three strikes and you're out, and your scores are saved on this phone. Add a player to pass the phone around."
            : "Pass this phone around. Miss and it's the next player's turn.";
}

// Player names as pills. One device: add, remove and rename anyone.
// Room: one pill per person; you can only rename yourself.
function renderPlayerPills() {
    // Rebuilding would kick the cursor out of a name being typed,
    // so only rebuild when the players themselves change
    const pillsKey = JSON.stringify([inRoom(), hostId, game.players.map(p => [p.id, p.name])]);
    if (pillsKey === _playerPillsKey) return;
    _playerPillsKey = pillsKey;

    const container = ui.playerPills;
    container.innerHTML = "";

    for (const player of game.players) {
        const isMe = !inRoom() || player.id === currentUser?.uid;
        const pill = document.createElement("span");
        pill.className = "player-pill" + (inRoom() && isMe ? " me" : "");

        const input = document.createElement("input");
        input.type = "text";
        input.value = player.name;
        input.readOnly = !isMe;
        input.maxLength = 16;
        input.setAttribute("aria-label", "Player name");
        input.addEventListener("keydown", e => { if (e.key === "Enter") input.blur(); });
        input.addEventListener("blur", () => {
            if (input.value.trim() && input.value !== player.name) renamePlayer(player.id, input.value);
            else input.value = player.name;
        });
        pill.appendChild(input);

        if (inRoom() && (isMe || player.id === hostId)) {
            const tag = document.createElement("span");
            tag.className = "pill-tag";
            tag.textContent = isMe ? "you" : "host";
            pill.appendChild(tag);
        }

        if (!inRoom() && game.players.length > 1) {
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "pill-remove";
            removeBtn.textContent = "×";
            removeBtn.setAttribute("aria-label", `Remove ${player.name}`);
            removeBtn.addEventListener("click", () => removeLocalPlayer(player.id));
            pill.appendChild(removeBtn);
        }

        container.appendChild(pill);
    }

    if (!inRoom() && game.players.length < MAX_PLAYERS) {
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "pill-add";
        addBtn.textContent = "+ Add player";
        addBtn.addEventListener("click", () => {
            addLocalPlayer();
            container.querySelector(".player-pill:last-of-type input")?.select();
        });
        container.appendChild(addBtn);
    }
}

function renderRoomBar() {
    ui.roomJoin.classList.toggle("hidden", inRoom());
    ui.roomInfo.classList.toggle("hidden", !inRoom());
    ui.roomCode.textContent = currentRoomCode || "";
    ui.roomStatus.textContent = roomStatus;
    if (inRoom()) ui.joinCodeInput.value = "";
}

function renderSetup() {
    renderRoomBar();
    renderPickers();
    renderPlayerPills();
    renderModeHint();
    renderSessionBoard(ui.sessionSetup);
    ui.statsLink.classList.toggle("hidden", inRoom());
    renderDailyLink();

    ui.startGameBtn.classList.toggle("hidden", !isHost());
    ui.startGameBtn.disabled = !canStartGame();
    ui.setupWaiting.classList.toggle("hidden", isHost());
}


/* ============================================================
   3. PLAYING SCREEN
   ============================================================ */
// Solo also shows strikes: a red ✗ per strike used, faint ones still left
function renderScoreboard() {
    const scores = game.players.map((player, idx) => `
        <div class="score ${idx === game.currentPlayerIndex && !roundOver() ? "is-turn" : ""}">
            <span class="score-name">${escapeHTML(player.name)}</span>
            <span class="score-num">${player.score}</span>
        </div>
    `);
    if (isSolo()) {
        const marks = Array.from({ length: SOLO_STRIKES }, (_, i) =>
            `<span class="strike ${i < game.strikes ? "used" : ""}">✗</span>`).join("");
        scores.push(`
            <div class="score strikes" aria-label="${game.strikes} of ${SOLO_STRIKES} strikes">
                <span class="score-name">Strikes</span>
                <span class="strike-marks">${marks}</span>
            </div>`);
    }
    ui.scoreboard.innerHTML = scores.join("");
}

function renderTurn() {
    const name = escapeHTML(game.players[game.currentPlayerIndex]?.name || "Player");

    if (game.roundComplete) {
        ui.turn.textContent = "Board cleared!";
    } else if (struckOut()) {
        ui.turn.textContent = "Three strikes";
    } else if (inRoom() && !isMyTurn()) {
        ui.turn.innerHTML = `<span class="waiting">Waiting on</span> ${name}`;
    } else if (!inRoom() && game.players.length > 1) {
        ui.turn.innerHTML = `${name}'s turn`;
    } else {
        ui.turn.textContent = "Your turn";
    }
}

// Who guessed (small label), then the guess itself on its own line
function renderFeedback() {
    const last = game.lastGuess;
    ui.feedback.className = "feedback";
    if (!last) {
        ui.feedback.innerHTML = "";
        return;
    }

    const who = game.players.length > 1
        ? `<span class="feedback-who">${escapeHTML(last.playerName)}</span>`
        : "";
    const [main, note] = {
        correct: [`✓ ${escapeHTML(last.answer)}`, ""],
        wrong: [`✗ “${escapeHTML(last.guess)}”`, "not on the list"],
        timeout: ["Time's up", ""]
    }[last.result];

    ui.feedback.innerHTML = `${who}<span class="feedback-main">${main}` +
        (note ? ` <span class="feedback-note">${note}</span>` : "") + `</span>`;
    ui.feedback.classList.add(last.result);

    if (isFreshGuess()) {
        replayAnimation(ui.feedback, "fresh");
        if (last.result !== "correct") replayAnimation(ui.guessForm, "shake");
    }
}

// The top 10 board. While playing, unguessed slots are blank; with
// `final` everything is revealed and misses are dimmed.
function renderBoard(listEl, { final = false } = {}) {
    const stat = game.data[game.stat];
    if (!stat) {
        listEl.innerHTML = "";
        return;
    }

    const guessedBy = Object.fromEntries(game.guessed.map(g => [g.id, g.by]));
    const nameOf = id => game.players.find(p => p.id === id)?.name;
    const freshId = !final && isFreshGuess() && game.lastGuess.result === "correct"
        ? game.lastGuess.id
        : null;

    const slots = stat.players.map(item => {
        const guessed = item.id in guessedBy;
        const revealed = guessed || final;
        const classes = ["slot", revealed && "filled", final && !guessed && "missed", item.id === freshId && "fresh"]
            .filter(Boolean).join(" ");

        const by = guessed && game.players.length > 1
            ? `<span class="slot-by">${escapeHTML(nameOf(guessedBy[item.id]))}</span>`
            : "";
        const main = revealed
            ? `<span class="slot-line"><span class="slot-name">${escapeHTML(item.name)}</span>` +
              `${teamTag(item.team, "slot-team")}</span>${by}`
            : `<span class="slot-blank"></span>`;

        return `
            <li class="${classes}">
                <span class="slot-rank">${item.rank}</span>
                <span class="slot-main">${main}</span>
                <span class="slot-value">${revealed ? escapeHTML(item.value) : ""}</span>
            </li>`;
    });

    // The source only lists some of a big tie for 10th
    if (stat.more_tied) {
        slots.push(`<li class="slot-note hint">+${stat.more_tied} more tied at ${escapeHTML(stat.players.at(-1).value)}, not in play</li>`);
    }
    listEl.innerHTML = slots.join("");
}

// Countdown for timed turns. Also runs on its own every 250ms
// (see startup), since time passes without any state changing.
function renderTurnClock() {
    const timed = game.state === GAME_STATES.PLAYING && !!game.turnEndsAt && !roundOver();
    ui.turnClock.classList.toggle("hidden", !timed);
    ui.turnBar.classList.toggle("hidden", !timed);
    if (!timed) return;

    const total = game.timerSeconds * 1000;
    const left = Math.max(0, Math.min(total, game.turnEndsAt - serverNow()));
    const seconds = Math.ceil(left / 1000);
    const low = seconds <= 10;

    ui.turnClock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    ui.turnClock.classList.toggle("low", low);
    ui.turnBar.classList.toggle("low", low);
    ui.turnBarFill.style.transform = `scaleX(${total ? left / total : 0})`;
}

// Players matching what's typed: tap one to guess them. Players already
// found (green, with who found them) or already missed by whoever's turn
// it is (red) are shown with that label in place of their team, and
// can't be picked.
const GUESS_STATUS_LABELS = { correct: "✓ On the board", wrong: "✗ You missed" };

function renderGuessResults() {
    const canGuess = game.state === GAME_STATES.PLAYING && isMyTurn() && !roundOver();
    const found = canGuess ? searchRoster(ui.guessInput.value) : null;

    ui.guessResults.classList.toggle("hidden", !found);
    ui.guessInput.setAttribute("aria-expanded", String(!!found));
    if (!found) {
        ui.guessResults.innerHTML = "";
        _highlight = -1;
        return;
    }

    if (_highlight >= found.players.length) _highlight = found.players.length - 1;

    const nameOf = id => game.players.find(p => p.id === id)?.name;
    const rows = found.players.map((player, idx) => {
        let meta = teamTag(player.team) + (player.pos ? `<span class="guess-option-pos">${escapeHTML(player.pos)}</span>` : "");
        if (player.status) {
            const by = game.players.length > 1 && nameOf(player.by) ? ` · ${escapeHTML(nameOf(player.by))}` : "";
            meta = `<span class="guess-status">${GUESS_STATUS_LABELS[player.status]}${by}</span>`;
        }
        return `
            <li role="option" aria-selected="${idx === _highlight}">
                <button class="guess-option ${player.status || ""} ${idx === _highlight ? "active" : ""}" type="button"
                    data-id="${escapeHTML(player.id)}" ${player.status ? "disabled" : ""}>
                    <span class="guess-option-name">${escapeHTML(player.name)}</span>
                    <span class="guess-option-meta">${meta}</span>
                </button>
            </li>`;
    });
    if (found.players.length === 0) rows.push(`<li class="guess-none">No players match</li>`);
    if (found.more > 0) rows.push(`<li class="guess-more">… ${found.more} more</li>`);
    ui.guessResults.innerHTML = rows.join("");
}

// Results that can be guessed (not already on the board)
function pickableResults() {
    return [...ui.guessResults.querySelectorAll(".guess-option:not(:disabled)")];
}

function pickGuess(playerId) {
    submitGuess(playerId);
    ui.guessInput.value = "";
    _highlight = -1;
    renderGuessResults();
    ui.guessInput.focus();
}

function renderEndGameButton() {
    ui.endGameBtn.disabled = roundOver();

    if (!inRoom()) {
        ui.endGameBtn.textContent = "End Game";
        ui.endGameBtn.classList.remove("voted");
        ui.endVoteStatus.classList.add("hidden");
        return;
    }

    const members = Object.keys(roomMembers);
    const votes = members.filter(uid => endVotes[uid]).length;
    const iVoted = !!endVotes[currentUser?.uid];

    ui.endGameBtn.textContent = `${iVoted ? "Cancel My Vote" : "Vote to End Game"} (${votes}/${members.length})`;
    ui.endGameBtn.classList.toggle("voted", iVoted);

    const waitingOn = game.players.filter(p => !endVotes[p.id]).map(p => p.name);
    ui.endVoteStatus.textContent = votes > 0 && waitingOn.length > 0 ? `Waiting on ${waitingOn.join(", ")}` : "";
    ui.endVoteStatus.classList.toggle("hidden", !ui.endVoteStatus.textContent);
}

function renderPlaying() {
    ui.playContext.textContent = gameContextLabel();
    ui.playStat.textContent = game.stat || "";
    ui.playQualifier.textContent = statQualifier(game.sport, game.stat, game.year);

    const canGuess = isMyTurn() && !roundOver();
    ui.guessInput.disabled = !canGuess;
    ui.guessInput.placeholder = canGuess ? "Type a player's name" : "Not your turn";
    if (!canGuess) ui.guessInput.value = "";
    renderGuessResults();

    renderScoreboard();
    renderTurn();
    renderTurnClock();
    renderFeedback();
    renderBoard(ui.board);
    renderEndGameButton();

    if (canGuess && !_wasMyTurn) ui.guessInput.focus();
    _wasMyTurn = canGuess;
}


/* ============================================================
   4. SESSION ("TONIGHT") LEADERBOARD
   Shown between games and on results once 2+ people have played.
   Sorted by wins, then total points; exact ties share a place.
   ============================================================ */
function renderSessionBoard(container, { justPlayed = false } = {}) {
    const rows = Object.entries(session.players)
        .map(([id, record]) => ({ id, ...record }))
        .sort((a, b) => (b.wins - a.wins) || (b.points - a.points));

    container.classList.toggle("hidden", rows.length < 2 || !session.gamesPlayed);
    if (rows.length < 2) return;

    rows.forEach((row, idx) => {
        const prev = rows[idx - 1];
        row.place = prev && prev.wins === row.wins && prev.points === row.points ? prev.place : idx + 1;
    });

    // Current names for people still here, saved names for anyone who left
    const nameOf = row => game.players.find(p => p.id === row.id)?.name || row.name;
    const topWins = rows[0].wins;
    const games = session.gamesPlayed;

    container.innerHTML = `
        <div class="session-head">
            <h2 class="section-label">Tonight</h2>
            <span class="hint">${games} ${games === 1 ? "game" : "games"}${justPlayed ? "" : " so far"}</span>
        </div>
        <div class="session-cols" aria-hidden="true"><span></span><span></span><span>Wins</span><span>Pts</span></div>
        <ol class="session-list">
            ${rows.map(row => `
                <li class="session-row ${topWins > 0 && row.wins === topWins ? "leader" : ""}">
                    <span class="session-place">${row.place}</span>
                    <span class="session-name">${escapeHTML(nameOf(row))}</span>
                    <span class="session-wins">${row.wins}</span>
                    <span class="session-points">${row.points}</span>
                </li>`).join("")}
        </ol>
    `;
}


/* ============================================================
   5. RESULTS SCREEN
   ============================================================ */
function renderResults() {
    const total = game.data[game.stat]?.players.length ?? 10;
    const standings = [...game.players].sort((a, b) => b.score - a.score);
    const topScore = standings[0]?.score ?? 0;
    const leaders = standings.filter(p => p.score === topScore);
    const points = n => `${n} ${n === 1 ? "point" : "points"}`;

    let title, sub;
    if (standings.length === 1) {
        title = `${topScore} of ${total}`;
        sub = soloResultLine(topScore, total);
    } else if (leaders.length > 1) {
        title = "It's a tie";
        sub = `${leaders.map(p => p.name).join(" & ")} with ${points(topScore)} each.`;
    } else {
        title = `${standings[0].name} wins`;
        sub = `${points(topScore)} out of ${total}.`;
    }

    ui.resultsContext.textContent = `Final · ${game.stat || ""}`;
    ui.resultsTitle.textContent = title;
    ui.resultsSub.textContent = sub;

    ui.standings.classList.toggle("hidden", standings.length < 2);
    ui.standings.innerHTML = standings.map((player, idx) => `
        <li class="standing ${player.score === topScore ? "leader" : ""}">
            <span class="standing-place">${idx + 1}</span>
            <span class="standing-name">${escapeHTML(player.name)}</span>
            <span class="standing-score">${player.score}</span>
        </li>
    `).join("");

    renderSessionBoard(ui.sessionResults, { justPlayed: true });
    renderBoard(ui.resultsBoard, { final: true });
    renderMisses();

    ui.resultsStatsLink.classList.toggle("hidden", !isSolo());
    ui.newGameBtn.classList.toggle("hidden", !isHost());
    ui.newGameWaiting.classList.toggle("hidden", isHost());
}

// Solo results: how it ended, then how it compares with your best here
function soloResultLine(score, total) {
    const parts = [];
    if (score === total) parts.push("Perfect. Every single one.");
    else if (struckOut()) parts.push("Three strikes.");

    const saved = game.soloResult;
    if (saved?.newBest) parts.push("New personal best!");
    else if (saved?.previousBest === score) parts.push("Tied your best.");
    else if (saved?.previousBest != null) parts.push(`Your best here: ${saved.previousBest} of ${total}.`);
    else if (saved) parts.push("First time on this board.");

    return parts.join(" ") || "Your final score.";
}


// Everyone's wrong guesses this game, one row per player guessed, with who
// guessed them (when 2+ played). Most-guessed first, then in guess order.
function renderMisses() {
    const nameOf = id => game.players.find(p => p.id === id)?.name;
    const byPlayer = new Map();
    for (const miss of game.misses) {
        if (!byPlayer.has(miss.id)) byPlayer.set(miss.id, { name: miss.name, by: [] });
        byPlayer.get(miss.id).by.push(nameOf(miss.by));
    }
    const rows = [...byPlayer.values()].sort((a, b) => b.by.length - a.by.length);

    ui.misses.classList.toggle("hidden", rows.length === 0);
    ui.missesList.innerHTML = rows.map(row => {
        const names = row.by.filter(Boolean);
        const by = game.players.length > 1 && names.length
            ? `<span class="miss-by">${names.map(escapeHTML).join(" · ")}</span>`
            : "";
        return `<li class="miss"><span class="miss-name">${escapeHTML(row.name)}</span>${by}</li>`;
    }).join("");
}


/* ============================================================
   6. MAIN RENDER
   ============================================================ */
function render() {
    if (!_uiReady) return;

    ui.setup.classList.toggle("hidden", game.state !== GAME_STATES.SETUP);
    ui.playing.classList.toggle("hidden", game.state !== GAME_STATES.PLAYING);
    ui.results.classList.toggle("hidden", game.state !== GAME_STATES.RESULTS);

    if (game.state === GAME_STATES.SETUP) renderSetup();
    if (game.state === GAME_STATES.PLAYING) renderPlaying();
    else _wasMyTurn = false;
    if (game.state === GAME_STATES.RESULTS) renderResults();

    if (game.lastGuess) _lastSeenGuessAt = Math.max(_lastSeenGuessAt, game.lastGuess.at);
}


/* ============================================================
   7. STARTUP
   Runs on DOMContentLoaded, after all the scripts have loaded,
   because rendering uses helpers from top10-logic.js.
   ============================================================ */
function findElements() {
    const byId = id => document.getElementById(id);
    const chips = id => document.querySelectorAll(`#${id} .chip`);

    Object.assign(ui, {
        // Setup
        setup: byId("setupSection"),
        roomJoin: byId("roomJoin"),
        roomInfo: byId("roomInfo"),
        roomCode: byId("roomCode"),
        roomStatus: byId("roomStatus"),
        createRoomBtn: byId("createRoomBtn"),
        leaveRoomBtn: byId("leaveRoomBtn"),
        joinForm: byId("joinForm"),
        joinCodeInput: byId("joinCodeInput"),
        eraChips: chips("eraChips"),
        sportChips: chips("sportChips"),
        categoryRow: byId("categoryRow"),
        categoryChips: chips("categoryChips"),
        yearSelect: byId("yearSelect"),
        statSelect: byId("statSelect"),
        statHint: byId("statHint"),
        bestHint: byId("bestHint"),
        modeHint: byId("modeHint"),
        statsLink: byId("statsLink"),
        dailyLinks: byId("dailyLinks"),
        dailyLinkStatus: byId("dailyLinkStatus"),
        shelfLinkStatus: byId("shelfLinkStatus"),
        randomAnyBtn: byId("randomAnyBtn"),
        randomSportBtn: byId("randomSportBtn"),
        timerChips: chips("timerChips"),
        playerPills: byId("playerPills"),
        sessionSetup: byId("sessionSetup"),
        startGameBtn: byId("startGameBtn"),
        setupWaiting: byId("setupWaiting"),

        // Playing
        playing: byId("playSection"),
        playContext: byId("playContext"),
        playStat: byId("playStat"),
        playQualifier: byId("playQualifier"),
        scoreboard: byId("scoreboard"),
        turn: byId("turn"),
        turnClock: byId("turnClock"),
        turnBar: byId("turnBar"),
        turnBarFill: byId("turnBarFill"),
        guessForm: byId("guessForm"),
        guessInput: byId("guessInput"),
        guessResults: byId("guessResults"),
        feedback: byId("guessFeedback"),
        board: byId("board"),
        endGameBtn: byId("endGameBtn"),
        endVoteStatus: byId("endVoteStatus"),

        // Results
        results: byId("resultsSection"),
        resultsContext: byId("resultsContext"),
        resultsTitle: byId("resultsTitle"),
        resultsSub: byId("resultsSub"),
        resultsStatsLink: byId("resultsStatsLink"),
        standings: byId("standings"),
        sessionResults: byId("sessionResults"),
        resultsBoard: byId("resultsBoard"),
        misses: byId("misses"),
        missesList: byId("missesList"),
        newGameBtn: byId("newGameBtn"),
        newGameWaiting: byId("newGameWaiting")
    });
}

function wireEvents() {
    ui.createRoomBtn.addEventListener("click", createRoom);
    ui.leaveRoomBtn.addEventListener("click", leaveRoom);
    ui.joinForm.addEventListener("submit", e => {
        e.preventDefault();
        joinRoom(ui.joinCodeInput.value);
    });

    ui.eraChips.forEach(btn => btn.addEventListener("click", () => selectEra(btn.dataset.era)));
    ui.sportChips.forEach(btn => btn.addEventListener("click", () => selectSport(btn.dataset.sport)));
    ui.categoryChips.forEach(btn => btn.addEventListener("click", () => selectCategory(btn.dataset.category)));
    ui.yearSelect.addEventListener("change", () => selectYear(ui.yearSelect.value));
    ui.statSelect.addEventListener("change", () => selectStat(ui.statSelect.value));
    ui.randomAnyBtn.addEventListener("click", () => pickRandomBoard());
    ui.randomSportBtn.addEventListener("click", () => pickRandomBoard(game.sport));
    ui.timerChips.forEach(btn => btn.addEventListener("click", () => selectTimer(Number(btn.dataset.timer))));

    ui.startGameBtn.addEventListener("click", startGame);
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
        const pickable = pickableResults();
        const choice = highlighted && !highlighted.disabled ? highlighted : pickable.length === 1 ? pickable[0] : null;
        if (choice) pickGuess(choice.dataset.id);
    });
    // Keep the keyboard up while tapping a result
    ui.guessResults.addEventListener("pointerdown", e => e.preventDefault());
    ui.guessResults.addEventListener("click", e => {
        const option = e.target.closest(".guess-option");
        if (option && !option.disabled) pickGuess(option.dataset.id);
    });
    ui.endGameBtn.addEventListener("click", voteToEndGame);
    ui.newGameBtn.addEventListener("click", newGame);
}

document.addEventListener("DOMContentLoaded", () => {
    findElements();
    wireEvents();
    game.players = [newLocalPlayer("Player 1")];
    _uiReady = true;
    render();
    setInterval(renderTurnClock, 250);
});
