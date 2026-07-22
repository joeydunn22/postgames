/* ============================================================
   TOP 10 — RENDERER (UI MODULE)
   ============================================================ */

/* ============================================================
   1. RENDERER STATE
   ============================================================ */
let _prevPhase = null;
let _listenersInitialized = false;

/* ============================================================
   2. UI RESET / SETUP HELPERS
   ============================================================ */
function resetStatUI() {
    game.stat = null;

    ui.statSelect.disabled = true;
    ui.statSelect.innerHTML = `<option value="">Select a stat...</option>`;

    ui.statTitle.textContent = "Select a stat to begin";
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

function populateStatDropdown() {
    ui.statSelect.disabled = false;
    ui.statSelect.innerHTML = `<option value="">Select a stat...</option>`;

    Object.keys(game.data).forEach(stat => {
        const option = document.createElement("option");
        option.value = stat;
        option.textContent = stat;
        ui.statSelect.appendChild(option);
    });
}

/* ============================================================
   3. RENDER HELPERS (SMALL PIECES)
   ============================================================ */
function renderPlayerColumn(col, player, index, isPercent) {
    col.classList.toggle("current-player", index === game.currentPlayerIndex);

    const guessesHTML = player.guesses.map(g => {
        const className = g.correct ? "guess-correct" : "guess-wrong";
        return `<li class="${className}">${g.name}</li>`;
    }).join("");

    col.innerHTML = `
        <h3>${player.name}</h3>
        <ul>${guessesHTML}</ul>
        <div class="player-score">Score: ${player.score ?? 0}</div>
    `;
}

function renderPlayerNames() {
    const container = ui.playerNameInputs;
    if (!container) return;

    container.innerHTML = "";

    const isMultiplayer = !!roomActive;

    let entries = [];

    if (isMultiplayer && game.playerNames) {
        entries = Object.entries(game.playerNames).map(([uid, name]) => ({ uid, name }));
    } else {
        entries = game.players.map((p, i) => ({
            uid: i,
            name: p.name || `Player ${i + 1}`
        }));
    }

    entries.forEach(({ uid, name }) => {
        const wrapper = document.createElement("div");
        wrapper.className = "player-name-row";

        const input = document.createElement("input");
        input.className = "player-name-input";
        input.type = "text";
        input.value = name;

        // Check if this is the current user's player
        const isMyPlayer = isMultiplayer ? (uid === currentUser?.uid) : true;

        // Mark current user's input
        if (isMyPlayer) {
            input.classList.add("me");
            input.readOnly = false;
        } else {
            input.readOnly = true;
            input.style.opacity = "0.7";
        }

        input.addEventListener("blur", () => {
            if (isMultiplayer && currentUser && isMyPlayer) {
                update(ref(db, `rooms/${currentRoomCode}/playerNames/${currentUser.uid}`), input.value);
            } else if (!isMultiplayer && isMyPlayer) {
                game.players[uid].name = input.value;
            }
        });

        wrapper.appendChild(input);
        container.appendChild(wrapper);
    });

    // Update add/remove button visibility
    const addBtn = document.getElementById("addPlayerBtn");
    const removeBtn = document.getElementById("removePlayerBtn");
    if (isMultiplayer) {
        if (addBtn) addBtn.style.display = "none";
        if (removeBtn) removeBtn.style.display = "none";
    } else {
        if (addBtn) addBtn.style.display = "block";
        if (removeBtn) removeBtn.style.display = "block";
    }
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
        const value = isPercent ? (item.value * 100).toFixed(1) + "%" : item.value;
        const guessed = game.globalGuessed.includes(item.name);
        const guessedClass = guessed ? "guessed" : "";
        return `<li class="${guessedClass}"><strong>${item.name}</strong> - ${value}</li>`;
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

    while (container.children.length < game.players.length) {
        const col = document.createElement("div");
        col.className = "player-column";
        container.appendChild(col);
    }
    while (container.children.length > game.players.length) {
        container.removeChild(container.lastChild);
    }

    // Update each column
    game.players.forEach((player, idx) => {
        renderPlayerColumn(container.children[idx], player, idx, isPercent);
    });
}

function renderResults() {
    if (!ui.resultsSection) return;

    ui.resultsSection.classList.remove("hidden");
    ui.statSection.classList.add("hidden");

    const scores = [...game.players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const winner = scores[0];

    ui.resultsWinner.textContent = `🏆 ${winner?.name || "Player"} wins with ${winner?.score ?? 0} points!`;

    const container = ui.resultsPlayers;
    container.innerHTML = "";

    scores.forEach((player, idx) => {
        const col = document.createElement("div");
        col.className = "player-column";
        renderPlayerColumn(col, player, idx, false);
        container.appendChild(col);
    });
}

/* ============================================================
   4. MAIN RENDER FUNCTION
   ============================================================ */
function renderUIForState(state = {}) {
    if (!state || typeof state !== "object") return;

    const phase = state.state || window.GAME_STATES.SETUP;

    // Calculate derived state
    const myIndex = Array.isArray(game.players)
        ? game.players.findIndex(p => p.id === myPlayerId)
        : -1;
    const isYourTurn = myIndex !== -1 && myIndex === game.currentPlayerIndex;

    const canStart = !!(game.sport &&
        (game.sport !== "mlb" || game.category) &&
        game.year &&
        game.stat &&
        game.players.length > 0);

    const isHost = myPlayerId === hostId;

    // Render based on phase
    if (phase === window.GAME_STATES.SETUP) {
        ui.statSection.classList.add("hidden");
        ui.resultsSection.classList.add("hidden");
        ui.startGameBtn.style.display = isHost ? "block" : "none";
        ui.startGameBtn.disabled = !canStart;

        // Only host can select stat
        if (ui.statSelect) {
            ui.statSelect.disabled = !isHost || !game.sport || !game.year ||
                (game.sport === "mlb" && !game.category);
        }
    } else if (phase === window.GAME_STATES.PLAYING) {
        ui.statSection.classList.remove("hidden");
        ui.resultsSection.classList.add("hidden");
        ui.userGuess.disabled = !isYourTurn;
        ui.submitGuessBtn.disabled = !isYourTurn || game.isGuessLocked;
        renderList();
    } else if (phase === window.GAME_STATES.RESULTS) {
        renderResults();
    }

    _prevPhase = phase;
}

/* ============================================================
   5. EVENT HANDLERS
   ============================================================ */
function onAuthUIUpdate() {
    if (!window.currentUser) {
        signInAnonymously(auth).catch(err => console.error("Auth failed:", err));
    }
}

function initEventHandlers() {
    document.getElementById("sport-buttons")?.addEventListener("click", (e) => {
        if (e.target.dataset.sport) {
            // Remove active class from all sport buttons
            document.querySelectorAll("#sport-buttons .pg-button").forEach(btn => {
                btn.classList.remove("active");
            });
            // Add active class to clicked button
            e.target.classList.add("active");

            game.sport = e.target.dataset.sport;
            game.category = null;
            game.stat = null;
            resetStatUI();

            // Show MLB category buttons if MLB selected
            const mlbCategoryWrapper = document.getElementById("mlb-category-wrapper");
            const mlbCategoryButtons = document.getElementById("mlb-category-buttons");
            if (game.sport === "mlb") {
                mlbCategoryButtons.classList.remove("hidden");
            } else {
                mlbCategoryButtons.classList.add("hidden");
            }

            maybeLoadData();
            renderUIForState(game);
        }
    });

    document.getElementById("mlb-category-buttons")?.addEventListener("click", (e) => {
        if (e.target.dataset.category) {
            // Remove active class from all category buttons
            document.querySelectorAll("#mlb-category-buttons .pg-button").forEach(btn => {
                btn.classList.remove("active");
            });
            // Add active class to clicked button
            e.target.classList.add("active");

            game.category = e.target.dataset.category;
            game.stat = null;
            resetStatUI();
            maybeLoadData();
            renderUIForState(game);
        }
    });

    document.getElementById("year-buttons")?.addEventListener("click", (e) => {
        if (e.target.dataset.year) {
            // Remove active class from all year buttons
            document.querySelectorAll("#year-buttons .pg-button").forEach(btn => {
                btn.classList.remove("active");
            });
            // Add active class to clicked button
            e.target.classList.add("active");

            game.year = e.target.dataset.year;
            game.stat = null;
            resetStatUI();
            maybeLoadData();
            renderUIForState(game);
        }
    });

    ui.statSelect?.addEventListener("change", (e) => {
        game.stat = e.target.value;
        if (game.stat) {
            game.globalGuessed = [];
            renderList();
        }
    });

    ui.submitGuessBtn?.addEventListener("click", () => {
        onGuessSubmit();
    });

    ui.userGuess?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            onGuessSubmit();
        }
    });

    ui.startGameBtn?.addEventListener("click", () => {
        if (startGame) {
            startGame();
        }
    });

    document.getElementById("addPlayerBtn")?.addEventListener("click", () => {
        const container = ui.playerNameInputs;
        const newPlayer = { name: `Player ${game.players.length + 1}`, guesses: [], score: 0 };
        game.players.push(newPlayer);
        renderPlayerNames();
    });

    document.getElementById("removePlayerBtn")?.addEventListener("click", () => {
        if (game.players.length > 1) {
            game.players.pop();
            renderPlayerNames();
        }
    });
}

/* ============================================================
   6. RENDERER INITIALIZATION
   ============================================================ */

function initUI() {
    ui.statSelect = document.getElementById("statSelect");
    ui.statTitle = document.getElementById("statTitle");
    ui.userGuess = document.getElementById("userGuess");
    ui.submitGuessBtn = document.getElementById("submitGuessBtn");
    ui.currentPlayerDisplay = document.getElementById("currentPlayerDisplay");
    ui.playersContainer = document.querySelector(".players-container");
    ui.top10List = document.getElementById("top10List");
    ui.playerNameInputs = document.getElementById("playerNameInputs");
    ui.startGameBtn = document.getElementById("startGameBtn");
    ui.resultsSection = document.getElementById("resultsSection");
    ui.resultsWinner = document.getElementById("resultsWinner");
    ui.resultsPlayers = document.getElementById("resultsPlayers");
    ui.statSection = document.getElementById("statSection");
}

function initActionButtonHandlers() {
    const actionBtn = document.getElementById("actionButton");
    if (!actionBtn) return;

    actionBtn.addEventListener("click", () => {
        if (game.state === GAME_STATES.RESULTS) {
            resetGame();
        } else if (game.state === GAME_STATES.PLAYING) {
            renderList();
        }
    });
}

function initLocalPlayerButtons() {
    // Initialize with one player
    if (game.players.length === 0) {
        game.players.push({ name: "Player 1", guesses: [], score: 0 });
    }
    renderPlayerNames();
}

function initRenderer() {
    initUI();
    initEventHandlers();
    initActionButtonHandlers();
    if (!roomActive) {
        initLocalPlayerButtons();
    }
}

function applyDomRefs(domRefs = {}) {
    Object.assign(ui, domRefs);
}

initRenderer();

/* ============================================================
   7. PUBLIC RENDER API EXPORT
   ============================================================ */
const PUBLIC_RENDER_API = {
    renderUIForState,
    renderPlayerNames,
    renderList,
    renderResults,
    resetStatUI,
    populateStatDropdown,
    resetLocalPlayersToOne,
    renderPlayerColumn,
    initRenderer,
    applyDomRefs,
    onAuthUIUpdate
};

Object.entries(PUBLIC_RENDER_API).forEach(([name, fn]) => {
    if (typeof fn === "function" || typeof fn === "object") {
        window[name] = fn;
    }
});