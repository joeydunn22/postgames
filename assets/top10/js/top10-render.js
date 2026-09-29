/* ============================================================
   TOP 10 — RENDERER (UI MODULE)
   Everything that touches the page lives here. renderUIForState()
   redraws the screen from `game` after any change.
   ============================================================ */

/* ============================================================
   1. RENDERER STATE
   ============================================================ */
let _uiInitialized = false;
let _lastSeenGuessAt = 0;   // so only brand-new guesses animate
let _wasMyTurn = false;     // so we focus the guess box when your turn starts
let _prevRoomActive = false; // so player pills redraw when you join/leave a room

const SPORT_LABELS = { mlb: "MLB", nba: "NBA", nfl: "NFL" };


/* ============================================================
   2. SMALL HELPERS
   ============================================================ */

// Names and guesses come from players (and Firebase), so never
// put them into innerHTML without escaping
function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
}

function formatValue(value, isPercent) {
    if (value == null) return "";
    return isPercent ? (value * 100).toFixed(1) + "%" : value;
}

function gameContextLabel() {
    const category = game.sport === "mlb" && game.category
        ? game.category[0].toUpperCase() + game.category.slice(1)
        : null;
    return [SPORT_LABELS[game.sport], category, game.year].filter(Boolean).join(" · ");
}

// answer name -> name of the player who got it
function guessersByAnswer() {
    const map = {};
    game.players.forEach(player => {
        (player.guesses || []).forEach(g => {
            if (g.correct) map[g.name] = player.name;
        });
    });
    return map;
}

function isFreshGuess() {
    return !!game.lastGuess && game.lastGuess.at > _lastSeenGuessAt;
}


/* ============================================================
   3. SETUP SCREEN
   ============================================================ */
function resetStatUI() {
    game.stat = null;

    if (Object.keys(game.data || {}).length > 0) {
        populateStatDropdown();
    } else if (ui.statSelect) {
        ui.statSelect.disabled = true;
        ui.statSelect.innerHTML = `<option value="">Pick a stat</option>`;
    }

    if (ui.statHint) ui.statHint.textContent = "";
}

function populateStatDropdown() {
    if (!ui.statSelect) return;

    ui.statSelect.innerHTML = `<option value="">Pick a stat</option>`;
    Object.keys(game.data).forEach(stat => {
        const option = document.createElement("option");
        option.value = stat;
        option.textContent = stat;
        ui.statSelect.appendChild(option);
    });
    ui.statSelect.value = game.stat || "";
}

// Sport / category / season chips: highlight the current pick, grey out
// options with no data, and lock them unless you're the one choosing
function renderSelectionButtons(isHost) {
    const canChoose = isHost && game.state === window.GAME_STATES.SETUP;

    document.querySelectorAll("#sport-buttons .chip").forEach(btn => {
        const sport = btn.dataset.sport;
        btn.classList.toggle("active", game.sport === sport);
        btn.disabled = !canChoose || !hasData({ sport });
        btn.title = hasData({ sport }) ? "" : "No data yet";
    });

    document.getElementById("mlb-category-wrapper")
        ?.classList.toggle("hidden", game.sport !== "mlb");
    document.querySelectorAll("#mlb-category-buttons .chip").forEach(btn => {
        const category = btn.dataset.category;
        btn.classList.toggle("active", game.category === category);
        btn.disabled = !canChoose || !hasData({ sport: game.sport, category });
    });

    document.querySelectorAll("#year-buttons .chip").forEach(btn => {
        const year = btn.dataset.year;
        const available = hasData({ sport: game.sport, category: game.category, year });
        btn.classList.toggle("active", String(game.year) === year);
        btn.disabled = !canChoose || !available;
        btn.title = available ? "" : "No data yet";
    });
}

// Player names as pills. Solo: add/remove/rename freely.
// Room: one pill per person in the room; you can only rename yourself.
function renderPlayerNames() {
    const container = ui.playerNameInputs;
    if (!container) return;

    container.innerHTML = "";

    const entries = roomActive
        ? Object.entries(game.playerNames || {}).map(([uid, name]) => ({
            key: uid,
            name: typeof name === "string" ? name : name?.name || "Player",
            isMe: uid === currentUser?.uid,
            isHost: uid === hostId
        }))
        : game.players.map((p, i) => ({
            key: i,
            name: p.name || `Player ${i + 1}`,
            isMe: true,
            isHost: false
        }));

    entries.forEach(({ key, name, isMe, isHost }) => {
        const pill = document.createElement("span");
        pill.className = "player-pill" + (roomActive && isMe ? " me" : "");

        const input = document.createElement("input");
        input.type = "text";
        input.value = name;
        input.readOnly = !isMe;
        input.maxLength = 16;
        input.setAttribute("aria-label", "Player name");
        pill.appendChild(input);

        if (roomActive && (isMe || isHost)) {
            const tag = document.createElement("span");
            tag.className = "pill-tag";
            tag.textContent = isMe ? "you" : "host";
            pill.appendChild(tag);
        }

        const save = async () => {
            const newName = input.value.trim();
            if (!newName) {
                input.value = name;
                return;
            }
            if (newName === name) return;

            if (roomActive) {
                try {
                    await set(ref(db, `rooms/${currentRoomCode}/players/${currentUser.uid}`), newName);
                } catch (err) {
                    console.error("Failed to update name:", err);
                    input.value = name;
                }
            } else {
                game.players[key].name = newName;
            }
        };
        input.addEventListener("blur", save);
        input.addEventListener("keydown", e => {
            if (e.key === "Enter") input.blur();
        });

        if (!roomActive && game.players.length > 1) {
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "pill-remove";
            removeBtn.textContent = "×";
            removeBtn.setAttribute("aria-label", `Remove ${name}`);
            removeBtn.addEventListener("click", () => {
                game.players.splice(key, 1);
                renderPlayerNames();
            });
            pill.appendChild(removeBtn);
        }

        container.appendChild(pill);
    });

    if (!roomActive) {
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "pill-add";
        addBtn.textContent = "+ Add player";
        addBtn.addEventListener("click", () => {
            game.players.push({ name: `Player ${game.players.length + 1}`, guesses: [], score: 0 });
            renderPlayerNames();
            container.querySelectorAll(".player-pill input")[game.players.length - 1]?.select();
        });
        container.appendChild(addBtn);
    }
}

function renderRoomBar() {
    // Joining or leaving a room swaps whose names show in the player pills
    if (!!roomActive !== _prevRoomActive) {
        _prevRoomActive = !!roomActive;
        renderPlayerNames();
    }

    ui.roomJoin?.classList.toggle("hidden", !!roomActive);
    ui.roomInfo?.classList.toggle("hidden", !roomActive);
    if (ui.roomCodeDisplay) ui.roomCodeDisplay.textContent = roomActive ? currentRoomCode : "";
}


/* ============================================================
   4. PLAYING SCREEN
   ============================================================ */
function renderScoreboard() {
    if (!ui.scoreboard) return;

    ui.scoreboard.innerHTML = game.players.map((player, idx) => `
        <div class="score ${idx === game.currentPlayerIndex && !game.roundComplete ? "is-turn" : ""}">
            <span class="score-name">${escapeHTML(player.name)}</span>
            <span class="score-num">${player.score ?? 0}</span>
        </div>
    `).join("");
}

function renderTurn(isYourTurn) {
    if (!ui.currentPlayerDisplay) return;

    const current = game.players[game.currentPlayerIndex];
    const name = escapeHTML(current?.name || "Player");

    if (game.roundComplete) {
        ui.currentPlayerDisplay.textContent = "Board cleared!";
    } else if (!roomActive) {
        ui.currentPlayerDisplay.innerHTML = game.players.length > 1 ? `${name}'s turn` : "Your turn";
    } else if (isYourTurn) {
        ui.currentPlayerDisplay.textContent = "Your turn";
    } else {
        ui.currentPlayerDisplay.innerHTML = `<span class="waiting">Waiting on</span> ${name}`;
    }
}

function renderFeedback() {
    const el = ui.guessFeedback;
    if (!el) return;

    const last = game.lastGuess;
    el.className = "feedback";
    if (!last) {
        el.textContent = "";
        return;
    }

    const who = game.players.length > 1 ? `${last.playerName}: ` : "";
    if (last.result === "correct") {
        el.textContent = `✓ ${who}${last.answer}`;
    } else if (last.result === "repeat") {
        el.textContent = `${who}${last.answer} is already on the board`;
    } else {
        el.textContent = `✗ ${who}“${last.guess}” isn't on the list`;
    }
    el.classList.add(last.result);

    if (isFreshGuess()) {
        void el.offsetWidth; // restart the animation
        el.classList.add("fresh");
        if (last.result !== "correct" && ui.guessForm) {
            ui.guessForm.classList.remove("shake");
            void ui.guessForm.offsetWidth;
            ui.guessForm.classList.add("shake");
        }
    }
}

// The top 10 board. During play, unguessed slots are blank.
// With `final`, everything is revealed and misses are dimmed.
function renderBoard(listEl, { final = false } = {}) {
    const stat = game.data[game.stat];
    if (!listEl) return;
    if (!stat) {
        listEl.innerHTML = "";
        return;
    }

    const guessedBy = guessersByAnswer();
    const showWho = game.players.length > 1;
    const freshAnswer = !final && isFreshGuess() && game.lastGuess.result === "correct"
        ? game.lastGuess.answer
        : null;

    listEl.innerHTML = stat.players.map((item, idx) => {
        const guessed = (game.globalGuessed || []).includes(item.name);
        const revealed = guessed || final;
        const classes = [
            "slot",
            revealed ? "filled" : "",
            final && !guessed ? "missed" : "",
            item.name === freshAnswer ? "fresh" : ""
        ].filter(Boolean).join(" ");

        const by = guessed && showWho && guessedBy[item.name]
            ? `<span class="slot-by">${escapeHTML(guessedBy[item.name])}</span>`
            : "";
        const main = revealed
            ? `<span class="slot-name">${escapeHTML(item.name)}</span>${by}`
            : `<span class="slot-blank"></span>`;
        const value = revealed ? escapeHTML(formatValue(item.value, stat.isPercent)) : "";

        return `
            <li class="${classes}">
                <span class="slot-rank">${escapeHTML(item.rank ?? idx + 1)}</span>
                <span class="slot-main">${main}</span>
                <span class="slot-value">${value}</span>
            </li>`;
    }).join("");
}

function renderEndGameButton() {
    if (!ui.endGameBtn) return;

    ui.endGameBtn.disabled = !!game.roundComplete;

    if (!roomActive) {
        ui.endGameBtn.textContent = "End Game";
        ui.endGameBtn.classList.remove("voted");
        ui.endVoteStatus?.classList.add("hidden");
        return;
    }

    const playerIds = Object.keys(game.playerNames || {});
    const votedCount = playerIds.filter(uid => endVotes[uid]).length;
    const iVoted = !!endVotes[myPlayerId];

    ui.endGameBtn.textContent = iVoted
        ? `Cancel My Vote (${votedCount}/${playerIds.length})`
        : `Vote to End Game (${votedCount}/${playerIds.length})`;
    ui.endGameBtn.classList.toggle("voted", iVoted);

    if (ui.endVoteStatus) {
        const waitingOn = game.players
            .filter(p => p.id && !endVotes[p.id])
            .map(p => p.name);
        ui.endVoteStatus.textContent = votedCount > 0 && waitingOn.length > 0
            ? `Waiting on ${waitingOn.join(", ")}`
            : "";
        ui.endVoteStatus.classList.toggle("hidden", !ui.endVoteStatus.textContent);
    }
}


/* ============================================================
   5. RESULTS SCREEN
   ============================================================ */
function renderResults(isHost) {
    const stat = game.data[game.stat];
    const total = stat?.players.length ?? 10;
    const standings = [...game.players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const topScore = standings[0]?.score ?? 0;
    const leaders = standings.filter(p => (p.score ?? 0) === topScore);
    const pts = n => `${n} ${n === 1 ? "point" : "points"}`;

    if (ui.resultsContext) ui.resultsContext.textContent = `Final · ${game.stat || ""}`;

    let title, sub;
    if (standings.length === 1) {
        title = `${topScore} of ${total}`;
        sub = topScore === total ? "Perfect. Every single one." : `${standings[0].name}'s final score.`;
    } else if (leaders.length > 1) {
        title = "It's a tie";
        sub = `${leaders.map(p => p.name).join(" & ")} with ${pts(topScore)} each.`;
    } else {
        title = `${standings[0].name} wins`;
        sub = `${pts(topScore)} out of ${total}.`;
    }
    if (ui.resultsWinner) ui.resultsWinner.textContent = title;
    if (ui.resultsSub) ui.resultsSub.textContent = sub;

    if (ui.resultsPlayers) {
        ui.resultsPlayers.classList.toggle("hidden", standings.length < 2);
        ui.resultsPlayers.innerHTML = standings.map((player, idx) => `
            <li class="standing ${(player.score ?? 0) === topScore ? "leader" : ""}">
                <span class="standing-place">${idx + 1}</span>
                <span class="standing-name">${escapeHTML(player.name)}</span>
                <span class="standing-score">${player.score ?? 0}</span>
            </li>
        `).join("");
    }

    renderBoard(ui.resultsAnswers, { final: true });

    // Only the host can start the next game in a room
    ui.newGameBtn?.classList.toggle("hidden", !isHost);
    ui.newGameWaiting?.classList.toggle("hidden", isHost);
}


/* ============================================================
   6. MAIN RENDER FUNCTION
   ============================================================ */
function renderUIForState(state = {}) {
    if (!state || typeof state !== "object") return;
    if (!_uiInitialized) return;

    const phase = state.state || window.GAME_STATES.SETUP;
    const isHost = !roomActive || myPlayerId === hostId;

    const myIndex = game.players.findIndex(p => p.id === myPlayerId);
    const isYourTurn = !roomActive || (myIndex !== -1 && myIndex === game.currentPlayerIndex);

    const playerCount = roomActive
        ? Object.keys(game.playerNames || {}).length
        : game.players.length;
    const canStart = !!(game.sport &&
        (game.sport !== "mlb" || game.category) &&
        game.year &&
        game.stat &&
        game.data[game.stat] &&
        playerCount > 0);

    ui.statSelectionArea?.classList.toggle("hidden", phase !== window.GAME_STATES.SETUP);
    ui.statSection?.classList.toggle("hidden", phase !== window.GAME_STATES.PLAYING);
    ui.resultsSection?.classList.toggle("hidden", phase !== window.GAME_STATES.RESULTS);

    renderRoomBar();
    renderSelectionButtons(isHost);

    if (phase === window.GAME_STATES.SETUP) {
        if (ui.startGameBtn) {
            ui.startGameBtn.classList.toggle("hidden", !isHost);
            ui.startGameBtn.disabled = !canStart;
        }
        ui.setupWaiting?.classList.toggle("hidden", isHost);

        if (ui.statSelect) {
            ui.statSelect.disabled = !(isHost && game.sport && game.year &&
                (game.sport !== "mlb" || game.category) &&
                Object.keys(game.data).length > 0);
        }
        _wasMyTurn = false;

    } else if (phase === window.GAME_STATES.PLAYING) {
        if (ui.playContext) ui.playContext.textContent = gameContextLabel();
        if (ui.playStat) ui.playStat.textContent = game.stat || "";

        const canGuess = isYourTurn && !game.roundComplete;
        if (ui.userGuess) {
            ui.userGuess.disabled = !canGuess;
            ui.userGuess.placeholder = canGuess ? "Name a player" : "Not your turn";
        }
        if (ui.submitGuessBtn) ui.submitGuessBtn.disabled = !canGuess || game.isGuessLocked;

        renderScoreboard();
        renderTurn(isYourTurn);
        renderFeedback();
        renderBoard(ui.top10List);
        renderEndGameButton();

        if (canGuess && !_wasMyTurn) ui.userGuess?.focus();
        _wasMyTurn = canGuess;

    } else if (phase === window.GAME_STATES.RESULTS) {
        renderResults(isHost);
        _wasMyTurn = false;
    }

    if (game.lastGuess) _lastSeenGuessAt = Math.max(_lastSeenGuessAt, game.lastGuess.at);
}


/* ============================================================
   7. EVENT HANDLERS
   ============================================================ */
function onAuthUIUpdate() {
    if (!window.currentUser) {
        signInAnonymously(auth).catch(err => console.error("Auth failed:", err));
    }
}

// Switching sport/category can leave a season picked that has no data for it
function clearUnavailableYear() {
    if (game.year && !hasData({ sport: game.sport, category: game.category, year: game.year })) {
        game.year = null;
    }
}

function initEventHandlers() {
    document.getElementById("sport-buttons")?.addEventListener("click", (e) => {
        const sport = e.target.closest(".chip")?.dataset.sport;
        if (!sport) return;

        game.sport = sport;
        game.category = null;
        game.stat = null;
        clearUnavailableYear();
        resetStatUI();
        maybeLoadData();
        renderUIForState(game);
    });

    document.getElementById("mlb-category-buttons")?.addEventListener("click", (e) => {
        const category = e.target.closest(".chip")?.dataset.category;
        if (!category) return;

        game.category = category;
        game.stat = null;
        clearUnavailableYear();
        resetStatUI();
        maybeLoadData();
        renderUIForState(game);
    });

    document.getElementById("year-buttons")?.addEventListener("click", (e) => {
        const year = e.target.closest(".chip")?.dataset.year;
        if (!year) return;

        game.year = year;
        game.stat = null;
        resetStatUI();
        maybeLoadData();
        renderUIForState(game);
    });

    ui.statSelect?.addEventListener("change", (e) => {
        game.stat = e.target.value || null;
        game.roundComplete = false;
        game.globalGuessed = [];
        renderUIForState(game);
    });

    ui.guessForm?.addEventListener("submit", (e) => {
        e.preventDefault();
        onGuessSubmit();
        ui.userGuess?.focus();
    });

    ui.startGameBtn?.addEventListener("click", () => startGame());
    ui.endGameBtn?.addEventListener("click", () => onEndGameClick());
    ui.newGameBtn?.addEventListener("click", () => resetGame());
}


/* ============================================================
   8. RENDERER INITIALIZATION
   ============================================================ */
function initUI() {
    const byId = id => document.getElementById(id);

    // Setup
    ui.statSelectionArea = byId("statSelectionArea");
    ui.statSelect = byId("statSelect");
    ui.statHint = byId("statHint");
    ui.playerNameInputs = byId("playerNameInputs");
    ui.startGameBtn = byId("startGameBtn");
    ui.setupWaiting = byId("setupWaiting");
    ui.roomJoin = byId("roomJoin");
    ui.roomInfo = byId("roomInfo");
    ui.roomCodeDisplay = byId("roomCodeDisplay");

    // Playing
    ui.statSection = byId("statSection");
    ui.playContext = byId("playContext");
    ui.playStat = byId("playStat");
    ui.scoreboard = byId("scoreboard");
    ui.currentPlayerDisplay = byId("currentPlayerDisplay");
    ui.guessForm = byId("guessForm");
    ui.userGuess = byId("userGuess");
    ui.submitGuessBtn = byId("submitGuessBtn");
    ui.guessFeedback = byId("guessFeedback");
    ui.top10List = byId("top10List");
    ui.endGameBtn = byId("endGameBtn");
    ui.endVoteStatus = byId("endVoteStatus");

    // Results
    ui.resultsSection = byId("resultsSection");
    ui.resultsContext = byId("resultsContext");
    ui.resultsWinner = byId("resultsWinner");
    ui.resultsSub = byId("resultsSub");
    ui.resultsPlayers = byId("resultsPlayers");
    ui.resultsAnswers = byId("resultsAnswers");
    ui.newGameBtn = byId("newGameBtn");
    ui.newGameWaiting = byId("newGameWaiting");
}

function initRenderer() {
    initUI();
    initEventHandlers();

    if (!roomActive && game.players.length === 0) {
        game.players.push({ name: "Player 1", guesses: [], score: 0 });
    }
    renderPlayerNames();

    _uiInitialized = true;
    renderUIForState(game);
}


/* ============================================================
   9. PUBLIC RENDER API EXPORT
   ============================================================ */
const PUBLIC_RENDER_API = {
    renderUIForState,
    renderPlayerNames,
    renderSelectionButtons,
    renderEndGameButton,
    renderResults,
    renderBoard,
    resetStatUI,
    populateStatDropdown,
    initRenderer,
    onAuthUIUpdate
};

Object.entries(PUBLIC_RENDER_API).forEach(([name, fn]) => {
    window[name] = fn;
});

// Initialize when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRenderer);
} else {
    initRenderer();
}
