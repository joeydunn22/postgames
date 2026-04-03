/* ============================================================
   TOP 10 — LOGIC (Organized)
   ============================================================ */

import { GAME_STATES } from './top10-state.js';

/* ============================================================
   1. AUTH & IDENTITY
   ============================================================ */
onAuthStateChanged(auth, (user) => {
    if (!user) return;

    setAuthState(user);
    renderUIForState(game);
    onAuthUIUpdate();
});

function generateRoomCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

async function leaveCurrentRoom() {
    if (!currentRoomCode || !currentUser) return;

    const playerRef = ref(db, `rooms/${currentRoomCode}/players/${currentUser.uid}`);
    await remove(playerRef);

    currentRoomCode = null;
    roomActive = false;

    // Renderer handles button visibility
    renderUIForState(game);

    document.getElementById("roomCodeDisplay").textContent = "";
    document.getElementById("roomStatus").textContent = "Left room.";
}

/* ============================================================
   2. ROOM & MULTIPLAYER LOGIC
   ============================================================ */
async function createRoom() {

    if (roomActive) {
        document.getElementById("roomStatus").textContent = "You are already in a room.";
        setTimeout(() => {
            document.getElementById("roomStatus").textContent = "";
        }, 2000);
        return;
    }

    await leaveCurrentRoom();

    const roomCode = generateRoomCode();

    // Host ID
    await set(ref(db, `rooms/${roomCode}/host`), currentUser.uid);

    // Identity entry
    await set(ref(db, `rooms/${roomCode}/players/${currentUser.uid}`), {
        id: currentUser.uid,
        name: "Player 1",
        guesses: [],
        score: 0
    });

    // GAME STATE ENTRY
    await set(ref(db, `rooms/${roomCode}/game`), {
        players: [
            {
                id: currentUser.uid,
                name: "Player 1",
                guesses: [],
                score: 0
            }
        ],
        currentPlayerIndex: 0,
        globalGuessed: [],
        state: "setup",
        sport: null,
        category: null,
        year: null,
        stat: null
    });

    currentRoomCode = roomCode;
    roomActive = true;

    // Renderer handles UI visibility
    renderUIForState(game);

    document.getElementById("roomCodeDisplay").textContent = "Room Code: " + roomCode;
    document.getElementById("roomStatus").textContent = "Room created successfully.";

    listenToRoom(roomCode);
    listenToPlayers(roomCode);
    listenToGame(roomCode);
    listenToPendingGuess(roomCode);
}

async function joinRoom(roomCode) {
    roomCode = roomCode.trim().toUpperCase();
    if (!roomCode) {
        document.getElementById("roomStatus").textContent = "Please enter a room code.";
        return;
    }

    const roomRef = ref(db, "rooms/" + roomCode);

    onValue(roomRef, async (snapshot) => {
        const roomData = snapshot.val();

        if (!roomData) {
            document.getElementById("roomStatus").textContent = "Room not found.";
            return;
        }

        await leaveCurrentRoom();

        // Add identity entry
        const playersRef = ref(db, `rooms/${roomCode}/players`);
        await update(playersRef, {
            [currentUser.uid]: {
                id: currentUser.uid,
                name: "Player",
                guesses: [],
                score: 0
            }
        });

        currentRoomCode = roomCode;
        roomActive = true;

        // Renderer handles UI visibility
        renderUIForState(game);

        document.getElementById("roomCodeDisplay").textContent = "Room Code: " + roomCode;
        document.getElementById("roomStatus").textContent = "Joined room successfully.";

        listenToRoom(roomCode);
        listenToPlayers(roomCode);
        listenToGame(roomCode);
        listenToPendingGuess(roomCode);
    }, { onlyOnce: true });
}

async function leaveRoom() {
    await leaveCurrentRoom();

    // Clear UI and reset local players
    document.getElementById("playerNameInputs").innerHTML = "";
    resetLocalPlayersToOne();

    renderUIForState(game);
}

async function sendGuessToHost(rawGuess) {
    if (!currentRoomCode) return;
    if (!rawGuess) return;

    // NEW: don't send if a guess is already pending
    if (game.isGuessLocked) return;

    const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);

    try {
        game.isGuessLocked = true;
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

/* ============================================================
   3. FIREBASE LISTENERS
   ============================================================ */
function listenToRoom(roomCode) {
    // Listen for players joining/leaving
    const playersRef = ref(db, `rooms/${roomCode}/players`);
    onValue(playersRef, (snapshot) => {
        const players = snapshot.val() || {};
        // No UI logic here — renderer handles everything
    });

    // Listen for host ID
    const hostRef = ref(db, `rooms/${roomCode}/host`);
    onValue(hostRef, (snapshot) => {
        hostId = snapshot.val();
    });
}

function listenToPlayers(roomCode) {
    const playersRef = ref(db, `rooms/${roomCode}/players`);

    onValue(playersRef, (snapshot) => {
        const playersObj = snapshot.val() || {};

        game.playerNames = playersObj;

        // ⭐ HOST syncs game.players from playersObj
        if (myPlayerId === hostId) {
            const syncedPlayers = Object.values(playersObj).map(p => ({
                id: p.id,
                name: p.name || "Player",
                guesses: [],
                score: 0
            }));

            game.players = syncedPlayers;
            syncGameState();
        }

        renderUIForState(game);
    });
}

function listenToGame(roomCode) {
    const gameRef = ref(db, `rooms/${roomCode}/game`);

    onValue(gameRef, (snapshot) => {
        const fb = snapshot.val() || {};

        // --- CORE GAME STATE ---
        game.state = fb.state ?? "setup";
        game.currentPlayerIndex = fb.currentPlayerIndex ?? 0;

        game.globalGuessed = Array.isArray(fb.globalGuessed)
            ? fb.globalGuessed
            : [];

        game.sport = fb.sport ?? null;
        game.category = fb.category ?? null;
        game.year = fb.year ?? null;
        game.stat = fb.stat ?? null;
        game.isGuessLocked = fb.isGuessLocked ?? false;

        // --- SYNC PLAYERS ---
        if (Array.isArray(fb.players)) {
            game.players = fb.players.map(p => ({
                id: p.id,
                name: p.name ?? "Player",
                guesses: Array.isArray(p.guesses) ? p.guesses : [],
                score: typeof p.score === "number" ? p.score : 0
            }));
        }

        // --- OPTIONAL: STAT SNAPSHOT HYDRATION ---
        if (fb.stat && Array.isArray(fb.statPlayers)) {
            if (!game.data) game.data = {};
            if (!game.data[fb.stat] || !Array.isArray(game.data[fb.stat].players)) {
                game.data[fb.stat] = {
                    players: fb.statPlayers,
                    isPercent: !!fb.statIsPercent
                };
            }
        }

        // --- LOAD STAT DATA IF READY ---
        const readyForData =
            game.sport &&
            (game.sport !== "mlb" || game.category) &&
            game.year;

        if (readyForData) {
            try { maybeLoadData(); } catch (e) { console.error(e); }
        }

        // --- DELEGATE ALL UI UPDATES TO RENDERER ---
        try {
            renderUIForState(game);
        } catch (e) {
            console.error("renderUIForState error:", e);
        }
    });
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

/* ============================================================
   4. GAME FLOW (START / END / RESET)
   ============================================================ */
// function startGame() {
//     if (game.state !== "setup") return;
//     if (!game.stat) return;

//     // Reset core state
//     transition(GAME_STATES.PLAYING);
//     game.currentPlayerIndex = 0;
//     game.globalGuessed = [];

//     // Reset players
//     game.players = game.players.map((p, i) => ({
//         ...p,
//         guesses: [],
//         score: 0,
//         name: p.name || `Player ${i + 1}`
//     }));

//     // Host syncs
//     if (roomActive && myPlayerId === hostId) {
//         syncGameState();
//     }
// }

function applyEndGame() {
    transition(GAME_STATES.RESULTS);

    if (roomActive && myPlayerId === hostId) {
        syncGameState();
    }
}

function resetGame() {
    transition(GAME_STATES.SETUP);
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
        stat: game.stat,
        isGuessLocked: game.isGuessLocked
    });
}

// NEW //
export function transition(nextState) {
    const prev = game.state;

    const allowed = {
        setup: ["playing"],   // first guess triggers this
        playing: ["results"],   // game ends
        results: ["setup"]      // play again
    };

    if (!allowed[prev] || !allowed[prev].includes(nextState)) {
        console.warn(`Invalid transition: ${prev} → ${nextState}`);
        return false;
    }

    game.state = nextState;

    // Host syncs
    if (roomActive && myPlayerId === hostId) {
        syncGameState();
    }

    return true;
}

/* ============================================================
   5. GUESS FLOW (LOCAL + HOST)
   ============================================================ */
function onGuessSubmit() {
    const rawGuess = ui.input.value.trim();
    if (!rawGuess) return;

    // Must be in PLAYING
    if (game.state !== GAME_STATES.PLAYING) {
        console.warn("Guess ignored — game not in PLAYING state.");
        return;
    }

    // Guess lock (host is processing)
    if (game.isGuessLocked) return;

    // Turn enforcement
    const myIndex = game.players.findIndex(p => p.id === myPlayerId);
    if (myIndex !== game.currentPlayerIndex) return;

    // Clear input immediately for UX
    ui.input.value = "";

    // Host processes locally
    if (myPlayerId === hostId) {
        handleLocalGuess(rawGuess);
    }
    // Clients send to host
    else {
        sendGuessToHost(rawGuess);
    }
}

function handleLocalGuess(rawGuess) {
    const result = processGuess(rawGuess, myPlayerId);

    // --- INVALID GUESS CASES ---
    if (!result.ok) {
        if (result.reason === "duplicate") {
            playGuessAnimation("duplicate");
        } else if (result.reason === "ambiguous") {
            alert(
                "Multiple players match:\n\n" +
                result.matches.map(m => m.name).join("\n")
            );
        } else {
            // empty, no-data, not-your-turn, etc.
            playGuessAnimation("wrong");
        }
        return;
    }

    // --- VALID GUESS ---
    if (result.correct) {
        playGuessAnimation("correct");
    } else {
        playGuessAnimation("wrong");
    }

    // --- END GAME ---
    if (result.isComplete) {
        applyEndGame();
        syncGameState();
        return;
    }

    // --- NORMAL TURN ROTATION ---
    syncGameState();
}

async function hostProcessGuess(pending) {
    const rawGuess = pending?.guess;
    if (!rawGuess) return;

    if (game.state !== "playing") return;

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== pending.playerId) {
        const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);
        await set(pendingRef, null);
        return;
    }

    game.isGuessLocked = true;

    const result = processGuess(rawGuess, pending.playerId);

    // Handle UI‑side effects separately (next step)
    if (result.correct) {
        playGuessAnimation("correct");
    } else if (result.reason === "duplicate") {
        playGuessAnimation("duplicate");
    } else if (result.ok === true && result.correct === false) {
        playGuessAnimation("wrong");
    }

    if (result.isComplete) {
        applyEndGame();
    }

    syncGameState();

    const pendingRef = ref(db, `rooms/${currentRoomCode}/pendingGuess`);
    await set(pendingRef, null);

    game.isGuessLocked = false;
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

function applyWrongGuess(game) {
    game.currentPlayerIndex =
        (game.currentPlayerIndex + 1) % game.players.length;
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

// NEW //
function processGuess(rawGuess, playerId) {
    const guess = normalize(rawGuess);
    if (!guess) return { ok: false, reason: "empty" };

    const answers = game.data[game.stat]?.players;
    if (!answers) return { ok: false, reason: "no-data" };

    const matches = answers.filter(a => isMatch(guess, a.name));

    // Wrong
    if (matches.length === 0) {
        return { ok: true, correct: false };
    }

    // Multiple matches
    if (matches.length > 1) {
        return { ok: false, reason: "ambiguous", matches };
    }

    const matched = matches[0];
    const normalizedAnswer = normalize(matched.name);

    // Duplicate
    if (game.globalGuessed.includes(normalizedAnswer)) {
        return { ok: false, reason: "duplicate" };
    }

    // Correct
    const player = game.players[game.currentPlayerIndex];
    if (!player || player.id !== playerId) {
        return { ok: false, reason: "not-your-turn" };
    }

    // Apply correct guess
    game.globalGuessed.push(normalizedAnswer);
    player.guesses.push(matched);
    player.score++;

    const totalAnswers = answers.length;
    const isComplete = game.globalGuessed.length === totalAnswers;

    // Rotate turn
    game.currentPlayerIndex =
        (game.currentPlayerIndex + 1) % game.players.length;

    return { ok: true, correct: true, matched, isComplete };
}

/* ============================================================
   6. DATA & UTILITIES
   ============================================================ */
function maybeLoadData() {

    if (!game.sport) return;
    if (game.sport === "mlb" && !game.category) return;
    if (!game.year) return;

    loadSport();
}

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
            }
        })
        .catch(err => console.error("Error loading data:", err));
}

function normalize(str) {
    return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

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
   7. PUBLIC API EXPORT
   ============================================================ */
const PUBLIC_API = {
    // Room / multiplayer controls
    createRoom,
    joinRoom,
    leaveRoom,

    // Firebase listeners
    listenToRoom,
    listenToPlayers,
    listenToGame,
    listenToPendingGuess,

    // Game flow
    applyEndGame,
    resetGame,
    syncGameState,

    // Guess handling
    applyWrongGuess,
    applyCorrectGuess,
    playGuessAnimation,
    handleLocalGuess,
    sendGuessToHost,
    hostProcessGuess,
    onGuessSubmit,

    // Data loading / stat loading
    maybeLoadData,
    loadSport,

    // Utility functions used across modules
    normalize,
    levenshtein,
    isMatch
};

// Attach everything automatically
Object.entries(PUBLIC_API).forEach(([name, fn]) => {
    if (typeof fn === "function") {
        window[name] = fn;
    } else {
        console.warn(`PUBLIC_API: ${name} is not a function`);
    }
});