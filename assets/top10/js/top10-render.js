/* ============================================================
   TOP 10 — RENDER HELPERS
   ============================================================ */

function renderPlayerNames() {
    const container = ui.playerNameInputs;
    if (!container) return;

    container.innerHTML = "";

    const isMultiplayer = !!roomActive;

    let entries = [];

    if (isMultiplayer && game.playerNames) {
        // Multiplayer: Firebase stores players keyed by UID
        entries = Object.entries(game.playerNames).map(([uid, data]) => ({
            uid,
            name: data.name || "Player"
        }));
    } else {
        // Single-player: use local game.players array
        entries = (game.players || []).map((p, index) => ({
            uid: p.id || index,
            name: p.name || `Player ${index + 1}`
        }));
    }

    entries.forEach(({ uid, name }) => {
        const wrapper = document.createElement("div");
        wrapper.className = "player-name-row";

        const input = document.createElement("input");
        input.type = "text";
        input.value = name;
        input.className = "player-name-input";

        const isMe = uid === myPlayerId;

        if (isMultiplayer) {
            // Multiplayer: only your own input is editable
            if (isMe) {
                input.classList.add("me");
                input.disabled = false;

                // Blur → Firebase sync
                input.addEventListener("blur", () => {
                    const nameRef = ref(db, `rooms/${currentRoomCode}/players/${uid}/name`);
                    set(nameRef, input.value.trim() || "Player");
                });

                const badge = document.createElement("span");
                badge.className = "you-badge";
                badge.textContent = "You";
                wrapper.appendChild(badge);
            } else {
                input.disabled = true;
            }
        } else {
            // Single-player: update local state
            input.addEventListener("input", () => {
                const index = entries.findIndex(e => e.uid === uid);
                if (index !== -1) {
                    game.players[index].name = input.value.trim() || `Player ${index + 1}`;
                    renderUIForState(game);
                }
            });
        }

        wrapper.appendChild(input);
        container.appendChild(wrapper);
    });
}

function resetStatUI() {
    game.stat = null;

    ui.statSelect.disabled = true;
    ui.statSelect.innerHTML = `<option value="">Select a stat...</option>`;

    ui.statTitle.textContent = "Select a stat to begin";
}

function populateStatDropdown() {
    ui.statSelect.disabled = false;
    ui.statSelect.innerHTML = `<option value="">Select a stat...</option>`;

    Object.keys(game.data).forEach(stat => {
        const option = document.createElement("option");
        option.value = stat;
        option.textContent = stat.replace(/_/g, " ").toUpperCase();
        ui.statSelect.appendChild(option);
    });
}

function resetLocalPlayersToOne() {
    const container = ui.playerNameInputs;
    if (!container) return;

    container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "player-name-row";

    const input = document.createElement("input");
    input.className = "player-name-input";
    input.type = "text";
    input.value = "Player 1";

    wrapper.appendChild(input);
    container.appendChild(wrapper);
}


/* ============================================================
   TOP 10 — MAIN RENDER FUNCTIONS
   ============================================================ */

function renderPlayerColumn(col, player, index, isPercent) {
    col.classList.toggle("current-player", index === game.currentPlayerIndex);

    const guessesHTML = player.guesses.map(g => {
        const displayValue = isPercent ? g.value + "%" : g.value;
        return `<li>${g.name} — ${g.team} — ${displayValue}</li>`;
    }).join("");

    col.innerHTML = `
        <h3>${player.name}</h3>
        <ul>${guessesHTML}</ul>
        <div class="player-score">Score: ${player.score ?? 0}</div>
    `;
}

function renderList() {
    if (!game.stat || !game.data[game.stat]) return;

    const stat = game.data[game.stat];
    const list = stat.players;
    const isPercent = stat.isPercent;

    // Render Top 10 list
    ui.top10List.innerHTML = `
        <ol>
            ${list.map(item => {
        const norm = normalize(item.name);
        const revealed = game.globalGuessed.includes(norm);
        const value = isPercent ? item.value + "%" : item.value;
        return revealed
            ? `<li class="revealed">${item.name} — ${item.team} — ${value}</li>`
            : `<li>__________</li>`;
    }).join("")}
        </ol>
    `;

    // Current player display
    const currentPlayer = game.players[game.currentPlayerIndex];
    ui.currentPlayerDisplay.textContent =
        "Current Turn: " + (currentPlayer?.name || "Player");

    // Player columns
    const container = ui.playersContainer;
    container.style.justifyContent =
        game.players.length === 1 ? "center" : "space-between";
    container.classList.toggle("single-player", game.players.length === 1);

    // Ensure correct number of columns
    while (container.children.length < game.players.length) {
        const col = document.createElement("div");
        col.classList.add("player-column");
        container.appendChild(col);
    }
    while (container.children.length > game.players.length) {
        container.removeChild(container.lastChild);
    }

    // Render each column
    game.players.forEach((player, index) => {
        renderPlayerColumn(container.children[index], player, index, isPercent);
    });
}

function renderResults() {
    // Rebuild globalGuessed from authoritative player guesses
    const guessedSet = new Set();
    for (const p of game.players) {
        for (const g of p.guesses || []) {
            if (g?.name) guessedSet.add(normalize(g.name));
        }
    }
    game.globalGuessed = [...guessedSet];

    // Host syncs corrected state
    if (myPlayerId === hostId && currentRoomCode) {
        update(ref(db, `rooms/${currentRoomCode}/game`), {
            globalGuessed: game.globalGuessed,
            players: game.players,
            currentPlayerIndex: game.currentPlayerIndex,
            state: game.state,
            sport: game.sport,
            category: game.category,
            year: game.year,
            stat: game.stat
        }).catch(() => { });
    }

    const statData = game.data?.[game.stat];
    if (!statData?.players) return;

    // Render Top 10 list
    renderList();

    // Winner calculation
    const scores = game.players.map(p => p.score ?? 0);
    const highest = Math.max(...scores);
    const winners = game.players.filter(p => (p.score ?? 0) === highest);

    ui.resultsWinner.textContent =
        winners.length === 1
            ? `${winners[0].name} wins!`
            : winners.length > 1
                ? "It's a tie!"
                : "No winners";

    // Render per-player results
    ui.resultsPlayers.innerHTML = "";
    const isPercent = !!statData.isPercent;

    for (const p of game.players) {
        const div = document.createElement("div");
        div.className = "player-column";

        const guessesHTML = (p.guesses || []).map(g => {
            const value = g.value !== undefined
                ? (isPercent ? g.value + "%" : g.value)
                : "";
            return `<li>${g.name}${g.team ? " — " + g.team : ""}${value ? " — " + value : ""}</li>`;
        }).join("");

        div.innerHTML = `
            <h3>${p.name}</h3>
            <div class="player-score">${p.score ?? 0} correct</div>
            <ul>${guessesHTML}</ul>
        `;
        ui.resultsPlayers.appendChild(div);
    }

    // Show results UI
    ui.resultsSection.classList.remove("hidden");
    ui.currentPlayerDisplay.classList.add("hidden");
    ui.playersContainer.classList.add("hidden");

    // Restore local add/remove buttons
    document.getElementById("addPlayerBtn").style.display = "inline-block";
    document.getElementById("removePlayerBtn").style.display = "inline-block";
}






// new renderer

/* ============================================================
   TOP 10 — DECLARATIVE RENDERER
   ============================================================ */

/**
 * initRenderer(optionalDom)
 * Optional: call if you want to pass explicit DOM refs instead of relying on global `ui`.
 * Example: initRenderer({ input: document.getElementById('guessInput') })
 */
function initRenderer(domRefs = {}) {
    if (typeof domRefs !== "object" || domRefs === null) return;
    Object.keys(domRefs).forEach(k => {
        if (domRefs[k]) ui[k] = domRefs[k];
    });
}

let _prevPhase = null;

/**
 * renderUIForState(state)
 * Idempotent renderer that drives visibility and high-level UI from `game` state.
 * - Uses existing helpers: renderList(), renderResults(), updateActionButton(), updateGuessInputLock()
 * - Safe if some helpers are missing (falls back to minimal behavior)
 */
function renderUIForState(state = {}) {
    // Accept either the full game object or a partial state object
    const s = state.state ? state : game;

    const phase = s.state || s.phase || "setup";

    // --- PHASE VISIBILITY ---
    ui.resultsSection?.classList.toggle("hidden", phase !== "results");
    ui.playersContainer?.classList.toggle("hidden", phase === "results");
    ui.currentPlayerDisplay?.classList.toggle("hidden", phase !== "playing");

    // --- PLAYER NAME INPUTS (single + multiplayer unified) ---
    if (typeof renderPlayerNames === "function") {
        try { renderPlayerNames(); } catch (e) { console.error(e); }
    }

    // --- STAT UI ---
    if (ui.statSelect) ui.statSelect.value = s.stat || "";
    if (ui.statTitle) {
        ui.statTitle.textContent = s.stat
            ? s.stat.replace(/_/g, " ").toUpperCase()
            : "Select a stat to begin";
    }

    // --- SPORT / CATEGORY / YEAR HIGHLIGHTS ---
    if (s.sport) {
        document.querySelectorAll('#sport-buttons .pg-button')
            .forEach(btn => btn.classList.toggle('active', btn.dataset.sport === s.sport));
    }

    if (s.category) {
        document.querySelectorAll('#mlb-category-buttons .pg-button')
            .forEach(btn => btn.classList.toggle('active', btn.dataset.category === s.category));
    }

    const catWrapper = document.getElementById("mlb-category-wrapper");
    const catButtons = document.getElementById("mlb-category-buttons");
    if (catWrapper && catButtons) {
        const show = s.sport === "mlb";
        catWrapper.classList.toggle("hidden", !show);
        catButtons.classList.toggle("hidden", !show);
    }

    if (s.year) {
        document.querySelectorAll('#year-buttons .pg-button')
            .forEach(btn => btn.classList.toggle('active', btn.dataset.year === s.year));
    }

    // --- ACTION BUTTON / GUESS INPUT LOGIC ---
    const isYourTurn = !!s.isYourTurn;
    const isGuessLocked = !!s.isGuessLocked;
    const canStart = !!s.canStart;

    if (ui.actionButton) {
        if (phase === "setup") {
            ui.actionButton.textContent = canStart ? "Start Game" : "Waiting";
            ui.actionButton.disabled = !canStart;
        } else if (phase === "playing") {
            ui.actionButton.textContent = isYourTurn ? "Submit Guess" : "Waiting";
            ui.actionButton.disabled = isGuessLocked || !isYourTurn;
        } else {
            ui.actionButton.textContent = "Play Again";
            ui.actionButton.disabled = false;
        }
    }

    if (ui.input) {
        let disabled = false;

        if (phase !== "playing") {
            disabled = true;
        } else if (roomActive) {
            // Multiplayer: only current player may type
            const myIndex = Array.isArray(game.players)
                ? game.players.findIndex(p => p.id === myPlayerId)
                : -1;

            const isMyTurn = myIndex !== -1 && myIndex === game.currentPlayerIndex;
            disabled = !isMyTurn;
        }

        ui.input.disabled = disabled;
        ui.input.setAttribute("aria-disabled", String(disabled));
    }

    // --- TOP 10 LIST RENDERING ---
    if (typeof renderList === "function") {
        try { renderList(); } catch (e) { console.error(e); }
    }

    // --- RESULTS RENDERING ---
    if (phase === "results") {
        if (typeof renderResults === "function") {
            try { renderResults(); } catch (e) { console.error(e); }
        }
    } else {
        // Only hide results; do NOT clear content
        ui.resultsSection?.classList.add("hidden");
    }

    // --- ADD/REMOVE PLAYER BUTTONS (local-only) ---
    const addBtn = document.getElementById("addPlayerBtn");
    const removeBtn = document.getElementById("removePlayerBtn");
    if (addBtn && removeBtn) {
        const hidden = !!s.roomActive;
        addBtn.classList.toggle("hidden", hidden);
        removeBtn.classList.toggle("hidden", hidden);
    }

    // --- LEAVE ROOM BUTTON ---
    const leaveBtn = document.getElementById("leaveRoomBtn");
    if (leaveBtn) {
        leaveBtn.classList.toggle("hidden", !roomActive);
    }

    // --- PHASE CHANGE HOOK ---
    if (_prevPhase !== phase) {
        _prevPhase = phase;
        // document.body.dataset.phase = phase;
    }
}