// all new functions will live here for now until reorganization

function syncGameState() {
    if (!currentRoomCode) return;

    const gameRef = ref(db, `rooms/${currentRoomCode}/game`);
    update(gameRef, {
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

function applyEndGame() {
    game.state = "results";

    if (roomActive && myPlayerId === hostId) {
        syncGameState();
    }
}

function startGame() {
    if (game.state !== "setup") return;
    if (!game.stat) return;

    // Reset core state
    game.state = "playing";
    game.currentPlayerIndex = 0;
    game.globalGuessed = [];

    // Reset players
    game.players = game.players.map((p, i) => ({
        ...p,
        guesses: [],
        score: 0,
        name: p.name || `Player ${i + 1}`
    }));

    // Host syncs
    if (roomActive && myPlayerId === hostId) {
        syncGameState();
    }
}

function resetGame() {
    game.state = "setup";
    game.currentPlayerIndex = 0;
    game.globalGuessed = [];
    game.stat = null;

    game.players = game.players.map((p, i) => ({
        ...p,
        guesses: [],
        score: 0,
        name: p.name || `Player ${i + 1}`
    }));

    if (roomActive && myPlayerId === hostId) {
        syncGameState();
    }
}

function maybeLoadData() {

    if (!game.sport) return;
    if (game.sport === "mlb" && !game.category) return;
    if (!game.year) return;

    loadSport();
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

    // Local mode
    if (!roomActive) {
        game.stat = selected;
        if (selected) startGame();
        return;
    }

    // Multiplayer — only host can set stat and start game
    if (myPlayerId === hostId) {
        update(ref(db, `rooms/${currentRoomCode}/game`), { stat: selected });
        if (selected) startGame();
    }
});



/* ============================================================
   TOP 10 — CORE GUESS LOGIC FUNCTIONS
   ============================================================ */

function applyWrongGuess(game) {
    game.currentPlayerIndex =
        (game.currentPlayerIndex + 1) % game.players.length;
}

function applyCorrectGuess(game, matchedAnswer) {
    const normalized = normalize(matchedAnswer.name);

    game.globalGuessed.push(normalized);

    const player = game.players[game.currentPlayerIndex];
    player.guesses.push(matchedAnswer);
    player.score++;

    game.currentPlayerIndex =
        (game.currentPlayerIndex + 1) % game.players.length;

    const totalAnswers = game.data[game.stat].players.length;
    return game.globalGuessed.length === totalAnswers;
}

function playGuessAnimation(type) {
    const inputEl = ui && ui.input;
    if (!inputEl) return;

    const playerCols = ui.playersContainer.querySelectorAll(".player-column");
    const playerCol = playerCols && playerCols[game.currentPlayerIndex];

    const map = {
        correct: { input: "correct-flash", player: "player-correct" },
        duplicate: { input: "duplicate-flash", player: "player-duplicate" },
        wrong: { input: "wrong-flash", player: "player-wrong" }
    };

    const classes = map[type];
    if (!classes) return;

    try {
        inputEl.classList.remove(classes.input);
        void inputEl.offsetWidth;
        inputEl.classList.add(classes.input);
        setTimeout(() => inputEl.classList.remove(classes.input), 700);
    } catch (e) {
        console.warn("input animation failed", e);
    }

    if (playerCol) {
        try {
            playerCol.classList.remove(classes.player);
            void playerCol.offsetWidth;
            playerCol.classList.add(classes.player);
            setTimeout(() => playerCol.classList.remove(classes.player), 700);
        } catch (e) {
            console.warn("player animation failed", e);
        }
    }
}

function handleLocalGuess(rawGuess) {
    const guess = normalize(rawGuess);
    if (!guess) return;

    const answers = game.data[game.stat].players;
    const matches = answers.filter(a => isMatch(guess, a.name));

    // Wrong
    if (matches.length === 0) {
        playGuessAnimation("wrong");
        applyWrongGuess(game);
        syncGameState();
        return;
    }

    // Multiple
    if (matches.length > 1) {
        alert("Multiple players match:\n\n" + matches.map(m => m.name).join("\n"));
        return;
    }

    const matched = matches[0];
    const normalizedAnswer = normalize(matched.name);

    // Duplicate
    if (game.globalGuessed.includes(normalizedAnswer)) {
        playGuessAnimation("duplicate");
        return;
    }

    // Correct
    const isComplete = applyCorrectGuess(game, matched);
    playGuessAnimation("correct");

    if (isComplete) {
        applyEndGame();
        syncGameState();
        return;
    }

    syncGameState();
}

async function sendGuessToHost(rawGuess) {
    if (!currentRoomCode) return;
    if (!rawGuess) return;

    const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);

    try {
        await set(pendingRef, {
            playerId: myPlayerId,
            guess: rawGuess,
            timestamp: Date.now()
        });
    } catch (e) {
        console.error("sendGuessToHost failed:", e);
        return;
    }

    if (ui && ui.input) {
        ui.input.value = "";
    }
}

function listenToPendingGuess(roomCode) {
    const pendingRef = ref(db, `rooms/${roomCode}/pendingGuess`);

    onValue(pendingRef, (snapshot) => {
        const pending = snapshot.val();
        if (!pending) return;

        if (game.state === "results") return;
        if (myPlayerId !== hostId) return;

        const currentPlayer = game.players[game.currentPlayerIndex];
        if (!currentPlayer || currentPlayer.id !== pending.playerId) return;

        hostProcessGuess(pending);
    });
}

async function hostProcessGuess(pending) {
    const rawGuess = pending?.guess;
    if (!rawGuess) return;

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== pending.playerId) {
        const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);
        await set(pendingRef, null);
        return;
    }

    handleLocalGuess(rawGuess);

    const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);
    await set(pendingRef, null);
}

function onGuessSubmit() {
    const rawGuess = ui.input.value.trim();
    if (!rawGuess) return;

    ui.input.value = "";

    if (game.state !== "playing") return;

    const myIndex = game.players.findIndex(p => p.id === myPlayerId);
    if (myIndex !== game.currentPlayerIndex) return;

    if (myPlayerId === hostId) {
        handleLocalGuess(rawGuess);
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


/* ============================================================
   TOP 10 — INITIAL LOAD
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

loadSport();