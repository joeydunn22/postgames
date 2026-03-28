/* ============================================================
   TOP 10 — RENDER HELPERS
   ============================================================ */

/* Render player name input fields */
function renderPlayerSetup() {
    ui.playerNameInputs.innerHTML = "";

    game.players.forEach((player, index) => {
        const input = document.createElement("input");
        input.type = "text";
        input.value = player.name;
        input.className = "player-name-input";

        input.addEventListener("input", () => {
            player.name = input.value.trim() || `Player ${index + 1}`;
            updateDisplayedNames();
            renderList();
        });

        ui.playerNameInputs.appendChild(input);
    });
}

/* Reset stat dropdown and title */
function resetStatUI() {
    game.stat = null;

    ui.statSelect.disabled = true;
    ui.statSelect.innerHTML = `<option value="">Select a stat...</option>`;

    const titleEl = ui.statTitle;
    if (titleEl) {
        titleEl.textContent = "Select a stat to begin";
    }
}

/* Populate stat dropdown with loaded stats */
function populateStatDropdown() {
    ui.statSelect.disabled = false;
    ui.statSelect.innerHTML = `<option value="">Select a stat...</option>`;

    const stats = Object.keys(game.data);

    stats.forEach(stat => {
        const option = document.createElement("option");
        option.value = stat;
        option.textContent = stat.replace(/_/g, " ").toUpperCase();
        ui.statSelect.appendChild(option);
    });
}

/* Update displayed player names across UI */
function updateDisplayedNames() {
    const currentPlayerDisplay = ui.currentPlayerDisplay;
    if (currentPlayerDisplay) {
        currentPlayerDisplay.textContent =
            `Current Turn: ${game.players[game.currentPlayerIndex].name}`;
    }

    ui.playersContainer.querySelectorAll(".player-column h3")
        .forEach((header, index) => {
            if (game.players[index]) {
                header.textContent = game.players[index].name;
            }
        });

    ui.resultsSection.querySelectorAll(".player-column h3")
        .forEach((header, index) => {
            if (game.players[index]) {
                header.textContent = game.players[index].name;
            }
        });
}


/* ============================================================
   TOP 10 — MAIN RENDER FUNCTIONS
   ============================================================ */

/* Render a single player column */
function renderPlayerColumn(col, player, index, isPercent) {
    col.classList.remove("current-player");
    if (index === game.currentPlayerIndex) {
        col.classList.add("current-player");
    }

    const guesses = player.guesses;

    const guessesHTML = guesses.map(g => {
        const displayValue = isPercent ? g.value + "%" : g.value;
        return `<li>${g.name} — ${g.team} — ${displayValue}</li>`;
    }).join("");

    col.innerHTML = `
        <h3>${player.name}</h3>
        <ul>${guessesHTML}</ul>
        <div class="player-score">Score: ${player.score ?? 0}</div>
    `;
}

/* Render the full Top 10 list */
function renderList() {
    if (!game.stat || !game.data[game.stat]) {
        return;
    }

    const stat = game.data[game.stat];
    const list = stat.players;
    const isPercent = stat.isPercent;

    let html = "<ol>";
    for (let i = 0; i < list.length; i++) {
        const normalized = normalize(list[i].name);
        const displayValue = isPercent ? list[i].value + "%" : list[i].value;

        if (game.globalGuessed.includes(normalized)) {
            html += `<li class="revealed">${list[i].name} — ${list[i].team} — ${displayValue}</li>`;
        } else {
            html += "<li>__________</li>";
        }
    }
    html += "</ol>";
    ui.top10List.innerHTML = html;

    // At this point, listenToGame() guarantees game.players is an array with length > 0
    let idx = game.currentPlayerIndex;
    if (typeof idx !== "number" || idx < 0 || idx >= game.players.length) {
        idx = 0;
    }

    const currentPlayer = game.players[idx];

    ui.currentPlayerDisplay.textContent =
        "Current Turn: " + (currentPlayer?.name || "Player");

    const container = ui.playersContainer;

    container.style.justifyContent =
        game.players.length === 1 ? "center" : "space-between";

    container.classList.toggle("single-player", game.players.length === 1);

    while (container.children.length < game.players.length) {
        const col = document.createElement("div");
        col.classList.add("player-column");
        container.appendChild(col);
    }
    while (container.children.length > game.players.length) {
        container.removeChild(container.lastChild);
    }

    game.players.forEach((player, index) => {
        const col = container.children[index];
        renderPlayerColumn(col, player, index, isPercent);
    });
}


/* ============================================================
   TOP 10 — RESULTS RENDERING
   ============================================================ */

/* Render final results screen */
function renderResults() {
    // Reconcile globalGuessed from players' guesses (authoritative source)
    const guessedSet = new Set();
    if (Array.isArray(game.players)) {
        for (const p of game.players) {
            if (!Array.isArray(p.guesses)) continue;
            for (const g of p.guesses) {
                if (g && g.name) guessedSet.add(normalize(g.name));
            }
        }
    }
    game.globalGuessed = Array.from(guessedSet);

    // If host, persist corrected globalGuessed (use update to avoid clobbering)
    if (myPlayerId === hostId && currentRoomCode) {
        const gameRef = ref(db, `rooms/${currentRoomCode}/game`);
        update(gameRef, {
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

    // Require stat data to render the canonical Top 10; bail if missing
    const statKey = game.stat;
    const statData = statKey && game.data && game.data[statKey] ? game.data[statKey] : null;
    if (!statData || !Array.isArray(statData.players)) {
        // If stat data is not present, do not attempt to render results list.
        // The listener should ensure stat snapshot is available; return early.
        return;
    }

    // Ensure result elements are placed inside the visible resultsSection
    if (ui && ui.resultsSection) {
        const rs = ui.resultsSection;
        if (ui.top10List && ui.top10List.parentElement !== rs) rs.appendChild(ui.top10List);
        if (ui.resultsWinner && ui.resultsWinner.parentElement !== rs) rs.appendChild(ui.resultsWinner);
        if (ui.resultsPlayers && ui.resultsPlayers.parentElement !== rs) rs.appendChild(ui.resultsPlayers);
    }

    // Use existing renderList when possible (keeps behavior consistent)
    if (typeof renderList === "function") {
        renderList();
    } else {
        // Minimal top10 fallback rendering
        const list = statData.players;
        const isPercent = !!statData.isPercent;
        const total = list.length;
        let html = "<ol>";
        for (let i = 0; i < total; i++) {
            const item = list[i];
            const norm = normalize(item.name);
            const revealed = game.globalGuessed.includes(norm);
            const displayValue = isPercent ? (item.value + "%") : item.value;
            html += revealed
                ? `<li class="revealed">${item.name}${item.team ? " — " + item.team : ""}${displayValue ? " — " + displayValue : ""}</li>`
                : "<li>__________</li>";
        }
        html += "</ol>";
        if (ui && ui.top10List) ui.top10List.innerHTML = html;
    }

    // Compute winners from player scores
    const players = Array.isArray(game.players) ? game.players : [];
    const scores = players.map(p => (typeof p.score === "number" ? p.score : 0));
    const highest = scores.length ? Math.max(...scores) : 0;
    const winners = players.filter(p => (p.score ?? 0) === highest);

    const winnerText = winners.length === 1
        ? `${winners[0].name} wins!`
        : winners.length > 1
            ? "It's a tie!"
            : "No winners";

    if (ui && ui.resultsWinner) ui.resultsWinner.textContent = winnerText;

    // Render per-player results
    if (ui && ui.resultsPlayers) {
        ui.resultsPlayers.innerHTML = "";
        const isPercent = !!statData.isPercent;
        for (const p of players) {
            const div = document.createElement("div");
            div.className = "player-column";

            const guesses = Array.isArray(p.guesses) ? p.guesses : [];
            const guessesHTML = guesses.map(g => {
                const displayValue = (g && g.value !== undefined && g.value !== "") ? (isPercent ? g.value + "%" : g.value) : "";
                return `<li>${g.name}${g.team ? " — " + g.team : ""}${displayValue ? " — " + displayValue : ""}</li>`;
            }).join("");

            div.innerHTML = `
                <h3>${p.name}</h3>
                <div class="player-score">${p.score ?? 0} correct</div>
                <ul>${guessesHTML}</ul>
            `;
            ui.resultsPlayers.appendChild(div);
        }
    }

    // Show results, hide gameplay UI
    if (ui && ui.resultsSection) ui.resultsSection.classList.remove("hidden");
    if (ui && ui.currentPlayerDisplay) ui.currentPlayerDisplay.classList.add("hidden");
    if (ui && ui.playersContainer) ui.playersContainer.classList.add("hidden");

    // Restore local add/remove buttons for non-room play
    const addBtn = document.getElementById("addPlayerBtn");
    const removeBtn = document.getElementById("removePlayerBtn");
    if (addBtn) addBtn.style.display = "inline-block";
    if (removeBtn) removeBtn.style.display = "inline-block";
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

    // Phase visibility
    if (ui.resultsSection) ui.resultsSection.classList.toggle("hidden", phase !== "results");
    if (ui.playersContainer) ui.playersContainer.classList.toggle("hidden", phase === "results");
    if (ui.currentPlayerDisplay) ui.currentPlayerDisplay.classList.toggle("hidden", phase !== "playing");

    // Stat UI
    if (ui.statSelect) ui.statSelect.value = s.stat || "";
    if (ui.statTitle) ui.statTitle.textContent = s.stat ? s.stat.replace(/_/g, " ").toUpperCase() : "Select a stat to begin";

    // Sport / category / year highlights (reuse existing selectors)
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
        if (s.sport === "mlb") {
            catWrapper.classList.remove("hidden");
            catButtons.classList.remove("hidden");
        } else {
            catWrapper.classList.add("hidden");
            catButtons.classList.add("hidden");
        }
    }
    if (s.year) {
        document.querySelectorAll('#year-buttons .pg-button')
            .forEach(btn => btn.classList.toggle('active', btn.dataset.year === s.year));
    }

    // Action button / guess input logic
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
        } else { // results
            ui.actionButton.textContent = "Play Again";
            ui.actionButton.disabled = false;
        }
    }

    if (ui.input) ui.input.disabled = isGuessLocked || phase !== "playing";

    // Players list / top10 rendering
    // Prefer your existing renderList() to keep behavior identical
    if (typeof renderList === "function") {
        // renderList expects game and game.data to be present; guard briefly
        try { renderList(); } catch (e) { /* swallow render errors to avoid breaking UI */ }
    } else {
        // Minimal fallback: update current player display and players container
        if (ui.currentPlayerDisplay) {
            const idx = (typeof game.currentPlayerIndex === "number") ? game.currentPlayerIndex : 0;
            ui.currentPlayerDisplay.textContent = "Current Turn: " + (game.players[idx]?.name || "Player");
        }
        if (ui.playersContainer) {
            ui.playersContainer.innerHTML = "";
            (game.players || []).forEach((p, i) => {
                const col = document.createElement("div");
                col.className = "player-column" + (i === game.currentPlayerIndex ? " current-player" : "");
                col.innerHTML = `<h3>${p.name}</h3><div class="player-score">Score: ${p.score ?? 0}</div>`;
                ui.playersContainer.appendChild(col);
            });
        }
    }

    // Results rendering
    if (phase === "results") {
        if (typeof renderResults === "function") {
            try { renderResults(); } catch (e) { /* ignore */ }
        } else {
            // fallback: show a simple results summary
            if (ui.resultsSection) {
                ui.resultsSection.innerHTML = `<div class="results-fallback">Results</div>`;
                ui.resultsSection.classList.remove("hidden");
            }
        }
    } else {
        // ensure results cleared when not in results
        if (ui.resultsSection && ui.resultsSection.innerHTML) {
            ui.resultsSection.innerHTML = "";
        }
    }

    // Add/remove player buttons visibility (local-only)
    const addBtn = document.getElementById("addPlayerBtn");
    const removeBtn = document.getElementById("removePlayerBtn");
    if (addBtn && removeBtn) {
        const hidden = !!s.roomActive; // if in a room, hide add/remove
        addBtn.classList.toggle("hidden", hidden);
        removeBtn.classList.toggle("hidden", hidden);
    }

    // Call small UI helpers to ensure locks/buttons are consistent
    if (typeof updateActionButton === "function") {
        try { updateActionButton(); } catch (e) { /* ignore */ }
    }
    if (typeof updateGuessInputLock === "function") {
        try { updateGuessInputLock(); } catch (e) { /* ignore */ }
    }

    // Phase change hook (useful for CSS transitions)
    if (_prevPhase !== phase) {
        _prevPhase = phase;
        // document.body.dataset.phase = phase; // uncomment if you want a global hook
    }
}