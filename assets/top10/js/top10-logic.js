// all new functions will live here for now until reorganization

function syncGameState() {
    if (!currentRoomCode) return;

    const gameRef = ref(db, `rooms/${currentRoomCode}/game`);
    set(gameRef, {
        state: game.state,
        players: game.players,
        currentPlayerIndex: game.currentPlayerIndex,
        globalGuessed: game.globalGuessed,
        sport: game.sport,
        category: game.category,
        year: game.year,
        stat: game.stat
    });
}

function applyWrongGuess(game) {
    // Rotate turn
    game.currentPlayerIndex =
        (game.currentPlayerIndex + 1) % game.players.length;
}

function applyCorrectGuess(game, matchedAnswer) {
    const normalized = normalize(matchedAnswer.name);

    // Add to global guessed list
    game.globalGuessed.push(normalized);

    // Add to player's guesses
    const player = game.players[game.currentPlayerIndex];
    player.guesses.push(matchedAnswer);

    // Increment score
    player.score++;

    // Rotate turn
    game.currentPlayerIndex =
        (game.currentPlayerIndex + 1) % game.players.length;

    // Determine if the game is now complete
    const totalAnswers = game.data[game.stat].players.length;
    return game.globalGuessed.length === totalAnswers;
}

function applyEndGame(game) {
    game.state = "results";
}

function startGame() {
    // Only start if we are in setup mode
    if (game.state !== "setup") return;

    // Must have a valid stat
    if (!game.stat) return;

    // Reset core game state
    game.state = "playing";
    game.currentPlayerIndex = 0;
    game.globalGuessed = [];

    // Reset each player's guesses and score
    for (let p of game.players) {
        p.guesses = [];
        p.score = 0;
    }

    // Host syncs the new state
    if (roomActive && myPlayerId === hostId) {
        syncGameState();
    }

    // Update UI
    renderList();
    updateActionButton();
    updateGuessInputLock();
}

function resetGame() {
    // Return to setup mode
    game.state = "setup";

    // Reset gameplay state
    game.currentPlayerIndex = 0;
    game.globalGuessed = [];

    for (let p of game.players) {
        p.guesses = [];
        p.score = 0;
    }

    // Clear stat selection (required for next round)
    game.stat = null;
    ui.statSelect.value = "";
    ui.statTitle.textContent = "Select a stat to begin";

    // UI: return to setup mode
    ui.resultsSection.classList.add("hidden");
    ui.currentPlayerDisplay.classList.add("hidden");
    ui.playersContainer.classList.remove("hidden");

    // Local-only: show add/remove buttons again
    if (!roomActive) {
        document.getElementById("addPlayerBtn").classList.remove("hidden");
        document.getElementById("removePlayerBtn").classList.remove("hidden");
    }

    // Clear input
    const input = ui.input;
    input.value = "";
    input.blur();

    // Re-render setup UI
    renderPlayerSetup();
    renderList();
    updateActionButton();
    updateGuessInputLock();

    // Host syncs the reset state
    if (roomActive && myPlayerId === hostId) {
        syncGameState();
    }
}

function updateActionButton() {
    const btn = ui.actionButton;

    // SETUP MODE — hide the button entirely
    if (game.state === "setup") {
        btn.classList.add("hidden");
        btn.onclick = null;
        return;
    }

    // PLAYING MODE — show "Give Up"
    if (game.state === "playing") {
        btn.textContent = "Give Up";
        btn.classList.remove("hidden");

        btn.onclick = () => {
            // Only host can trigger end-game logic
            if (roomActive && myPlayerId !== hostId) return;

            applyEndGame(game);

            if (roomActive && myPlayerId === hostId) {
                syncGameState();
            }

            renderResults();
            updateActionButton();
        };

        return;
    }

    // RESULTS MODE — show "Play Again"
    if (game.state === "results") {
        btn.textContent = "Play Again";
        btn.classList.remove("hidden");

        btn.onclick = () => {
            // Only host can reset the game
            if (roomActive && myPlayerId !== hostId) return;

            resetGame();

            if (roomActive && myPlayerId === hostId) {
                syncGameState();
            }

            updateActionButton();
        };

        return;
    }
}










/* ============================================================
   TOP 10 — EVENT LISTENERS
   ============================================================ */

/* Handle Enter key for submitting guesses */
ui.input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
        onGuessSubmit();
    }
});

/* Handle Submit Guess button */
document.getElementById("submitGuessBtn").addEventListener("click", () => {
    onGuessSubmit();
});

ui.statSelect.addEventListener("change", () => {
    const selected = ui.statSelect.value || null;

    // SINGLE‑PLAYER
    if (!roomActive) {
        game.stat = selected;

        if (!selected) {
            ui.statTitle.textContent = "Select a stat to begin";
            return;
        }

        ui.statTitle.textContent =
            ui.statSelect.options[ui.statSelect.selectedIndex].text;

        // NEW: start the game formally
        startGame();
        return;
    }

    // MULTIPLAYER — only host can start the game
    if (myPlayerId === hostId) {
        update(ref(db, `rooms/${currentRoomCode}/game`), {
            stat: selected
        });

        // NEW: host starts the game once stat is chosen
        if (selected) startGame();
    }

    updateGuessInputLock();
});

/* ============================================================
   TOP 10 — CORE LOGIC FUNCTIONS
   ============================================================ */

/* Animate input + player column based on guess type */
function playGuessAnimation(type) {
    const inputEl = ui.input;
    const playerCol =
        document.querySelectorAll(".player-column")[game.currentPlayerIndex];

    const map = {
        correct: { input: "correct-flash", player: "player-correct" },
        duplicate: { input: "duplicate-flash", player: "player-duplicate" },
        wrong: { input: "wrong-flash", player: "player-wrong" }
    };

    const classes = map[type];
    if (!classes) return;

    inputEl.classList.remove(classes.input);
    void inputEl.offsetWidth;
    inputEl.classList.add(classes.input);
    setTimeout(() => inputEl.classList.remove(classes.input), 700);

    if (playerCol) {
        playerCol.classList.remove(classes.player);
        void playerCol.offsetWidth;
        playerCol.classList.add(classes.player);
        setTimeout(() => playerCol.classList.remove(classes.player), 700);
    }
}

function updateGuessInputLock() {
    // Always lock input during results
    if (game.state === "results") {
        ui.input.disabled = true;
        return;
    }

    if (!roomActive) {
        ui.input.disabled = false;
        return;
    }

    const myIndex = game.players.findIndex(p => p.id === myPlayerId);
    const isMyTurn = myIndex === game.currentPlayerIndex;

    ui.input.disabled = !isMyTurn;
}

/* Handle guess submission, scoring, and turn rotation */
function submitGuess() {
    const input = ui.input;
    const rawGuess = input.value;
    const guess = normalize(rawGuess);
    if (!guess) return;

    // Hide add/remove buttons once guessing begins (local only)
    document.getElementById("addPlayerBtn").classList.add("hidden");
    document.getElementById("removePlayerBtn").classList.add("hidden");

    const answers = game.data[game.stat].players;

    // Find matches
    let matches = [];
    for (let a of answers) {
        if (isMatch(guess, a.name)) matches.push(a);
    }

    // WRONG GUESS
    if (matches.length === 0) {
        playGuessAnimation("wrong");

        applyWrongGuess(game);

        if (roomActive && myPlayerId === hostId) {
            syncGameState();
        }

        renderList();
        updateGuessInputLock();
        updateActionButton();

        input.value = "";
        return;
    }

    // MULTIPLE MATCHES
    if (matches.length > 1) {
        alert("Multiple players match:\n\n" +
            matches.map(m => m.name).join("\n"));
        input.value = "";
        return;
    }

    const matchedAnswer = matches[0];
    const normalizedAnswer = normalize(matchedAnswer.name);

    // DUPLICATE GUESS
    if (game.globalGuessed.includes(normalizedAnswer)) {
        playGuessAnimation("duplicate");
        renderList();
        input.value = "";
        return;
    }

    // CORRECT GUESS
    const isComplete = applyCorrectGuess(game, matchedAnswer);

    playGuessAnimation("correct");

    // END GAME?
    if (isComplete) {
        applyEndGame(game);

        if (roomActive && myPlayerId === hostId) {
            syncGameState();
        }

        input.value = "";
        input.blur();

        setTimeout(() => {
            renderResults();
            updateActionButton();
            updateGuessInputLock();
        }, 50);

        return;
    }

    // NORMAL TURN CONTINUES
    if (roomActive && myPlayerId === hostId) {
        syncGameState();
    }

    renderList();
    updateGuessInputLock();
    updateActionButton();

    input.value = "";
}

async function sendGuessToHost(rawGuess) {
    const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);
    await set(pendingRef, {
        playerId: myPlayerId,
        guess: rawGuess,
        timestamp: Date.now()
    });

    ui.input.value = "";
}

function listenToPendingGuess(roomCode) {
    const pendingRef = ref(db, `rooms/${roomCode}/pendingGuess`);

    onValue(pendingRef, (snapshot) => {
        const pending = snapshot.val();
        if (!pending) return;

        // 🚨 Prevent overwriting the results state
        if (game.state === "results") return;

        // Only host processes guesses
        if (myPlayerId !== hostId) return;

        // Must be the correct player's turn
        const currentPlayer = game.players[game.currentPlayerIndex];
        if (!currentPlayer || currentPlayer.id !== pending.playerId) return;

        hostProcessGuess(pending);
    });
}

async function hostProcessGuess(pending) {
    const rawGuess = pending.guess;
    const guess = normalize(rawGuess);
    if (!guess) return;

    const answers = game.data[game.stat].players;

    // Find matches
    let matches = [];
    for (let a of answers) {
        if (isMatch(guess, a.name)) matches.push(a);
    }

    // WRONG GUESS
    if (matches.length === 0) {
        applyWrongGuess(game);
        syncGameState();

        const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);
        await set(pendingRef, null);
        return;
    }

    // MULTIPLE MATCHES
    if (matches.length > 1) {
        // Host cannot show alerts to remote players
        const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);
        await set(pendingRef, null);
        return;
    }

    const matchedAnswer = matches[0];
    const normalizedAnswer = normalize(matchedAnswer.name);

    // DUPLICATE GUESS
    if (game.globalGuessed.includes(normalizedAnswer)) {
        const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);
        await set(pendingRef, null);
        return;
    }

    // CORRECT GUESS
    applyCorrectGuess(game, matchedAnswer);

    // END GAME?
    if (game.state === "results") {
        syncGameState();

        const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);
        await set(pendingRef, null);
        return;
    }

    // NORMAL CASE
    syncGameState();

    const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);
    await set(pendingRef, null);
}

function onGuessSubmit() {
    const rawGuess = ui.input.value.trim();
    if (!rawGuess) return;

    // Block guessing unless the game is actively being played
    if (game.state !== "playing") return;

    // Turn check — always correct because UI is already updated
    const myIndex = game.players.findIndex(p => p.id === myPlayerId);
    if (myIndex !== game.currentPlayerIndex) return;

    if (myPlayerId === hostId) {
        submitGuess();
        syncGameState();
    } else {
        sendGuessToHost(rawGuess);
    }
}

/* ============================================================
   TOP 10 — MATCHING + NORMALIZATION
   ============================================================ */

/* Normalize strings for matching */
function normalize(str) {
    return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/* Determine if a guess matches an answer */
function isMatch(guess, answer) {
    const g = normalize(guess);
    const a = normalize(answer);

    if (g === a) return true;

    const parts = a.split(" ");
    const last = parts[parts.length - 1];
    const first = parts[0];

    if (g === last) return true;
    if (g === first) return true;

    if (levenshtein(g, a) <= 2) return true;
    if (levenshtein(g, last) <= 1) return true;

    return false;
}

/* Compute Levenshtein distance */
function levenshtein(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
}


/* ============================================================
   TOP 10 — GAME FLOW HELPERS
   ============================================================ */

/* Load data only when sport/category/year are selected */
function maybeLoadData() {
    const listEl = ui.top10List;
    if (listEl) listEl.innerHTML = "";

    if (!game.sport) return;

    if (game.sport === "mlb" && !game.category) return;

    if (!game.year) return;

    loadSport();
}


/* ============================================================
   TOP 10 — STAT LOADING
   ============================================================ */

/* Load sport/year/category JSON file */
function loadSport() {
    let file = "";

    if (game.sport === "mlb") {
        file = `../data/mlb/${game.year}/processed/${game.category}_${game.year}_enriched.json`;
    }
    if (game.sport === "nba") {
        file = `../data/nba/${game.year}/processed/stats_${game.year}_enriched.json`;
    }
    if (game.sport === "nfl") {
        file = `../data/nfl/${game.year}/processed/stats_${game.year}_enriched.json`;
    }

    fetch(file)
        .then(response => response.json())
        .then(data => {
            game.data = {};

            data.forEach(statBlock => {
                const statName =
                    statBlock.stat_label.toLowerCase().replace(/ /g, "_");

                game.data[statName] = {
                    players: statBlock.players.map(p => ({
                        name: `${p.first_name} ${p.player}`,
                        team: p.team,
                        value: p.value
                    })),
                    isPercent: statBlock.is_percent_stat,
                    label: statBlock.stat_label
                };
            });

            populateStatDropdown();

            if (game.stat) {
                ui.statSelect.value = game.stat;
            } else {
                ui.statSelect.value = "";
            }

            // 🔥 NEW: If we are already in results, re-render now that data is loaded
            if (game.state === "results" && game.data[game.stat]) {
                renderResults();
                updateGuessInputLock();
            }
        })
        .catch(err => console.error("Error loading data:", err));
}


/* ============================================================
   TOP 10 — INITIAL LOAD
   ============================================================ */

/* Load initial sport data (if any) */
loadSport();

/* Initialize game and UI once DOM is ready */
document.addEventListener("DOMContentLoaded", () => {
    const addBtn = document.getElementById("addPlayerBtn");
    const removeBtn = document.getElementById("removePlayerBtn");

    // --- LOCAL MODE ONLY ---
    // These buttons must NEVER modify game.players during multiplayer.
    addBtn.addEventListener("click", () => {
        if (roomActive) return;                 // ⬅️ HARD BLOCK
        if (game.players.length >= 4) return;

        game.players.push({
            id: crypto.randomUUID(),            // ⬅️ Give local players stable IDs
            name: `Player ${game.players.length + 1}`,
            guesses: [],
            score: 0
        });

        renderPlayerSetup();
        renderList();
    });

    removeBtn.addEventListener("click", () => {
        if (roomActive) return;                 // ⬅️ HARD BLOCK
        if (game.players.length <= 1) return;

        game.players.pop();

        if (game.currentPlayerIndex >= game.players.length) {
            game.currentPlayerIndex = 0;
        }

        renderPlayerSetup();
        renderList();
    });
});