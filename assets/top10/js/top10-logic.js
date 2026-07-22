/* ============================================================
   TOP 10 — LOGIC (Organized)
   ============================================================ */

let _listenersInitialized = false;

/* ============================================================
   1. AUTH & IDENTITY
   ============================================================ */
onAuthStateChanged(auth, (user) => {
    if (!user) {
        signInAnonymously(auth).catch(err => console.error("Auth failed:", err));
        return;
    }

    setAuthState(user);
    renderUIForState(game);
    onAuthUIUpdate();
});

function generateRoomCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

async function leaveCurrentRoom() {
    if (!currentRoomCode || !currentUser) return;

    const playerRef = ref(db, `rooms/${currentRoomCode}/players/${currentUser.uid}`);
    await remove(playerRef);

    currentRoomCode = null;
    roomActive = false;
    _listenersInitialized = false;

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
        alert("Already in a room. Leave first.");
        return;
    }

    await leaveCurrentRoom();

    const roomCode = generateRoomCode();

    // Host ID
    await set(ref(db, `rooms/${roomCode}/host`), currentUser.uid);

    // Identity entry
    await set(ref(db, `rooms/${roomCode}/players/${currentUser.uid}`), {
        uid: currentUser.uid,
        name: game.players[0]?.name || "Host"
    });

    window.currentRoomCode = roomCode;
    window.roomActive = true;
    window.hostId = currentUser.uid;

    document.getElementById("roomCodeDisplay").textContent = `Room Code: ${roomCode}`;
    document.getElementById("roomStatus").textContent = "Room created.";
    document.getElementById("createRoomBtn").style.display = "none";
    document.getElementById("leaveRoomBtn").style.display = "block";

    if (!_listenersInitialized) {
        listenToRoom(roomCode);
        listenToPlayers(roomCode);
        listenToGame(roomCode);
        listenToPendingGuess(roomCode);
        _listenersInitialized = true;
    }
}

async function joinRoom(roomCode) {
    if (!roomCode) {
        alert("Please enter a room code.");
        return;
    }

    if (roomActive) {
        alert("Already in a room.");
        return;
    }

    const roomRef = ref(db, `rooms/${roomCode}`);
    const snapshot = await get(roomRef);

    if (!snapshot.exists()) {
        alert("Room not found.");
        return;
    }

    // Join as player
    await set(ref(db, `rooms/${roomCode}/players/${currentUser.uid}`), {
        uid: currentUser.uid,
        name: game.players[0]?.name || "Player"
    });

    window.currentRoomCode = roomCode;
    window.roomActive = true;
    window.hostId = snapshot.val().host;

    document.getElementById("roomCodeDisplay").textContent = `Room Code: ${roomCode}`;
    document.getElementById("roomStatus").textContent = "Joined room.";
    document.getElementById("createRoomBtn").style.display = "none";
    document.getElementById("leaveRoomBtn").style.display = "block";

    if (!_listenersInitialized) {
        listenToRoom(roomCode);
        listenToPlayers(roomCode);
        listenToGame(roomCode);
        listenToPendingGuess(roomCode);
        _listenersInitialized = true;
    }
}

async function leaveRoom() {
    await leaveCurrentRoom();
}

async function sendGuessToHost(rawGuess) {
    if (!roomActive || !currentRoomCode) return;

    await set(ref(db, `rooms/${currentRoomCode}/pendingGuess/${currentUser.uid}`), {
        playerId: currentUser.uid,
        rawGuess: rawGuess,
        timestamp: Date.now()
    });
}

/* ============================================================
   3. FIREBASE LISTENERS
   ============================================================ */
function listenToRoom(roomCode) {
    const roomRef = ref(db, `rooms/${roomCode}`);
    onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            console.warn("Room was deleted");
            leaveCurrentRoom();
        }
    });
}

function listenToPlayers(roomCode) {
    const playersRef = ref(db, `rooms/${roomCode}/players`);
    onValue(playersRef, (snapshot) => {
        game.playerNames = snapshot.val() || {};
        renderPlayerNames();
    });
}

function listenToGame(roomCode) {
    const gameRef = ref(db, `rooms/${roomCode}/gameState`);
    onValue(gameRef, (snapshot) => {
        const remoteState = snapshot.val();
        if (remoteState) {
            Object.assign(game, remoteState);
            renderUIForState(game);
        }
    });
}

function listenToPendingGuess(roomCode) {
    const guessRef = ref(db, `rooms/${roomCode}/pendingGuess`);
    onValue(guessRef, (snapshot) => {
        const pending = snapshot.val();
        if (pending && myPlayerId === hostId) {
            Object.entries(pending).forEach(([uid, guessData]) => {
                hostProcessGuess(guessData);
            });
            // Clear pending
            update(ref(db, `rooms/${roomCode}`), { pendingGuess: null });
        }
    });
}

/* ============================================================
   4. GAME FLOW (START / END / RESET)
   ============================================================ */
async function startGame() {
    if (game.state !== GAME_STATES.SETUP) return;
    if (!game.stat) return;

    // Reset core state
    transition(GAME_STATES.PLAYING);
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

    renderUIForState(game);
}

function applyEndGame() {
    transition(GAME_STATES.RESULTS);
    if (roomActive && myPlayerId === hostId) {
        syncGameState();
    }
    renderUIForState(game);
}

function resetGame() {
    game.state = GAME_STATES.SETUP;
    game.globalGuessed = [];
    game.players = game.players.map(p => ({
        ...p,
        guesses: [],
        score: 0
    }));
    resetStatUI();
    if (roomActive && myPlayerId === hostId) {
        syncGameState();
    }
    renderUIForState(game);
}

async function syncGameState() {
    if (!roomActive || !currentRoomCode) return;

    const stateToSync = {
        state: game.state,
        currentPlayerIndex: game.currentPlayerIndex,
        globalGuessed: game.globalGuessed,
        players: game.players.map(p => ({
            name: p.name,
            guesses: p.guesses,
            score: p.score
        })),
        sport: game.sport,
        category: game.category,
        year: game.year,
        stat: game.stat
    };

    await update(ref(db, `rooms/${currentRoomCode}/gameState`), stateToSync);
}

function transition(nextState) {
    game.state = nextState;
}

/* ============================================================
   5. GUESS FLOW (LOCAL + HOST)
   ============================================================ */
function onGuessSubmit() {
    if (game.state !== GAME_STATES.PLAYING) return;

    const rawGuess = ui.userGuess?.value?.trim() || "";
    if (!rawGuess) return;

    ui.userGuess.value = "";

    if (roomActive) {
        sendGuessToHost(rawGuess);
    } else {
        handleLocalGuess(rawGuess);
    }
}

function handleLocalGuess(rawGuess) {
    processGuess(rawGuess, myPlayerId);
}

async function hostProcessGuess(pending) {
    if (!myPlayerId === hostId) return;

    const result = processGuess(pending.rawGuess, pending.playerId);

    if (result.ok) {
        syncGameState();
    }
}

function applyCorrectGuess(gameInstance, matchedAnswer) {
    const currentPlayer = gameInstance.players[gameInstance.currentPlayerIndex];
    if (!currentPlayer) return;

    currentPlayer.guesses.push({
        name: matchedAnswer,
        correct: true
    });
    currentPlayer.score = (currentPlayer.score ?? 0) + 1;

    gameInstance.globalGuessed.push(matchedAnswer);

    playGuessAnimation("correct");
}

function applyWrongGuess(gameInstance) {
    const currentPlayer = gameInstance.players[gameInstance.currentPlayerIndex];
    if (!currentPlayer) return;

    currentPlayer.guesses.push({
        name: "?",
        correct: false
    });

    gameInstance.currentPlayerIndex = (gameInstance.currentPlayerIndex + 1) % gameInstance.players.length;

    playGuessAnimation("wrong");
}

function playGuessAnimation(type) {
    const element = document.querySelector(type === "correct" ? ".guess-correct" : ".guess-wrong");
    if (element) {
        element.style.animation = "fadeIn 0.3s";
    }
}

function processGuess(rawGuess, playerId) {
    if (!game.stat || !game.data[game.stat]) {
        return { ok: false, reason: "no-data" };
    }

    const answers = game.data[game.stat].players;
    const normalized = normalize(rawGuess);

    let match = null;
    for (const ans of answers) {
        if (isMatch(normalized, ans.name)) {
            match = ans.name;
            break;
        }
    }

    if (match) {
        applyCorrectGuess(game, match);
    } else {
        applyWrongGuess(game);
    }

    renderList();

    return { ok: true };
}

/* ============================================================
   6. DATA & UTILITIES
   ============================================================ */
function maybeLoadData() {
    if (!game.sport || !game.year) return;

    const key = game.sport === "mlb"
        ? `mlb-${game.category}-${game.year}`
        : `${game.sport}-${game.year}`;

    // TODO: Fetch from API or local JSON
    // For now, stub data
    game.data = {
        "Home Runs": {
            players: [
                { name: "Aaron Judge", value: 58 },
                { name: "Juan Soto", value: 41 }
            ],
            isPercent: false
        }
    };

    populateStatDropdown();
}

function loadSport() {
    maybeLoadData();
}

function normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, "");
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
    const normGuess = normalize(guess);
    const normAnswer = normalize(answer);

    if (normGuess === normAnswer) return true;

    const distance = levenshtein(normGuess, normAnswer);
    const threshold = Math.max(2, Math.floor(normAnswer.length * 0.2));

    return distance <= threshold;
}

/* ============================================================
   7. PUBLIC API EXPORT
   ============================================================ */
const PUBLIC_API = {
    createRoom,
    joinRoom,
    leaveRoom,
    listenToRoom,
    listenToPlayers,
    listenToGame,
    listenToPendingGuess,
    applyEndGame,
    resetGame,
    syncGameState,
    applyWrongGuess,
    applyCorrectGuess,
    playGuessAnimation,
    handleLocalGuess,
    sendGuessToHost,
    hostProcessGuess,
    onGuessSubmit,
    maybeLoadData,
    loadSport,
    normalize,
    levenshtein,
    isMatch,
    startGame,
    transition,
    processGuess
};

// Attach everything automatically
Object.entries(PUBLIC_API).forEach(([name, fn]) => {
    if (typeof fn === "function") {
        window[name] = fn;
    } else {
        console.warn(`PUBLIC_API: ${name} is not a function`);
    }
});