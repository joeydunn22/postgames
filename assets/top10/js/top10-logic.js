/* ============================================================
   TOP 10 — LOGIC (Organized)
   ============================================================ */

let _listenersInitialized = false;
let dataLoadRequest = 0;

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
    endVotes = {};
    _listenersInitialized = false;

    setRoomStatus("Left room.");
    renderUIForState(game);
}

function setRoomStatus(message) {
    const el = document.getElementById("roomStatus");
    if (el) el.textContent = message;
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

    // Initialize game state
    await set(ref(db, `rooms/${roomCode}/gameState`), {
        state: window.GAME_STATES.SETUP,
        currentPlayerIndex: 0,
        globalGuessed: [],
        players: [],
        sport: null,
        category: null,
        year: null,
        stat: null
    });

    // Identity entry
    await set(ref(db, `rooms/${roomCode}/players/${currentUser.uid}`), currentUser.displayName || "Host");

    window.currentRoomCode = roomCode;
    window.roomActive = true;
    window.hostId = currentUser.uid;

    setRoomStatus("Share this code with your friends.");

    if (!_listenersInitialized) {
        listenToRoom(roomCode);
        listenToPlayers(roomCode);
        listenToGame(roomCode);
        listenToPendingGuess(roomCode);
        listenToEndVotes(roomCode);
        _listenersInitialized = true;
    }

    renderUIForState(game);
}

async function joinRoom(roomCode) {
    roomCode = (roomCode || "").trim().toUpperCase();
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
    await set(ref(db, `rooms/${roomCode}/players/${currentUser.uid}`), currentUser.displayName || "Player");
    const joinCodeInput = document.getElementById("joinCodeInput");
    if (joinCodeInput) joinCodeInput.value = "";

    window.currentRoomCode = roomCode;
    window.roomActive = true;
    window.hostId = snapshot.val().host;

    setRoomStatus("You're in. The host picks the game.");

    if (!_listenersInitialized) {
        listenToRoom(roomCode);
        listenToPlayers(roomCode);
        listenToGame(roomCode);
        listenToPendingGuess(roomCode);
        listenToEndVotes(roomCode);
        _listenersInitialized = true;
    }

    renderUIForState(game);
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
        const playersData = snapshot.val() || {};
        game.playerNames = playersData;

        // Sync game.players array with remote players
        const remotePlayersList = Object.entries(playersData).map(([uid, data], index) => {
            const existingPlayer = game.players.find(player => player.id === uid) || game.players[index] || {};
            return {
                ...existingPlayer,
                id: uid,
                name: typeof data === "string" ? data : data.name || "Player",
                guesses: existingPlayer.guesses || [],
                score: existingPlayer.score || 0
            };
        });

        game.players = remotePlayersList;

        renderPlayerNames();
        renderUIForState(game);
        checkEndVotes();
    });
}

function listenToGame(roomCode) {
    const gameRef = ref(db, `rooms/${roomCode}/gameState`);
    onValue(gameRef, (snapshot) => {
        const remoteState = snapshot.val();
        if (remoteState) {
            const currentPlayers = game.players;
            const selectionChanged = game.sport !== remoteState.sport ||
                game.category !== remoteState.category ||
                game.year !== remoteState.year;
            Object.assign(game, remoteState);
            // Firebase drops empty arrays and nulls, so reset those explicitly
            game.roundComplete = !!remoteState.roundComplete;
            game.globalGuessed = remoteState.globalGuessed || [];
            game.stat = remoteState.stat ?? null;
            game.lastGuess = remoteState.lastGuess ?? null;
            if (roomActive) {
                const savedPlayers = Array.isArray(remoteState.players) ? remoteState.players : [];
                game.players = Object.entries(game.playerNames || {}).map(([uid, playerData], index) => {
                    const savedPlayer = savedPlayers.find(player => player.id === uid) || savedPlayers[index] || {};
                    return {
                        ...savedPlayer,
                        id: uid,
                        name: typeof playerData === "string" ? playerData : playerData.name || savedPlayer.name || "Player",
                        guesses: savedPlayer.guesses || [],
                        score: savedPlayer.score || 0
                    };
                });
                if (game.players.length === 0) {
                    game.players = savedPlayers.map((player, index) => ({
                        ...player,
                        id: player.id || currentPlayers[index]?.id
                    }));
                }
            }
            if (selectionChanged) {
                maybeLoadData();
            }
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

function listenToEndVotes(roomCode) {
    const votesRef = ref(db, `rooms/${roomCode}/endVotes`);
    onValue(votesRef, (snapshot) => {
        endVotes = snapshot.val() || {};
        renderUIForState(game);
        checkEndVotes();
    });
}

/* ============================================================
   4. GAME FLOW (START / END / RESET)
   ============================================================ */
async function startGame() {
    if (roomActive && myPlayerId !== hostId) return;
    if (game.state !== window.GAME_STATES.SETUP) return;
    if (!game.stat || !game.data[game.stat]) return;

    if (roomActive) {
        game.players = Object.entries(game.playerNames || {}).map(([uid, playerData], index) => {
            const existingPlayer = game.players.find(player => player.id === uid) || game.players[index] || {};
            return {
                ...existingPlayer,
                id: uid,
                name: typeof playerData === "string" ? playerData : playerData.name || existingPlayer.name || "Player"
            };
        });
    }
    if (game.players.length === 0) return;

    // Reset core state
    clearEndVotes();
    transition(window.GAME_STATES.PLAYING);
    game.currentPlayerIndex = 0;
    game.globalGuessed = [];
    game.roundComplete = false;
    game.lastGuess = null;

    // Reset players
    game.players = game.players.map((p, i) => ({
        ...p,
        guesses: [],
        score: 0,
        name: p.name || `Player ${i + 1}`
    }));

    renderUIForState(game);

    if (roomActive) {
        try {
            await syncGameState();
        } catch (error) {
            console.error("Failed to start room game:", error);
            setRoomStatus("Game started here, but room sync failed.");
        }
    }
}

function applyEndGame() {
    // In a room, only the host ends the game (after everyone votes)
    if (roomActive && myPlayerId !== hostId) return;
    if (game.state !== window.GAME_STATES.PLAYING) return;

    transition(window.GAME_STATES.RESULTS);
    clearEndVotes();
    if (roomActive) {
        syncGameState();
    }
    renderUIForState(game);
}

function resetGame() {
    game.state = window.GAME_STATES.SETUP;
    game.globalGuessed = [];
    game.roundComplete = false;
    game.lastGuess = null;
    game.players = game.players.map(p => ({
        ...p,
        guesses: [],
        score: 0
    }));
    resetStatUI();
    clearEndVotes();
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
        roundComplete: game.roundComplete,
        lastGuess: game.lastGuess,
        players: game.players.map(p => ({
            id: p.id,
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
   4b. END GAME VOTING
   Solo/pass-and-play: End Game ends immediately.
   Room: each player toggles a vote at rooms/{code}/endVotes/{uid};
   once every player in the room has voted, the host ends the game.
   ============================================================ */
function onEndGameClick() {
    if (game.state !== window.GAME_STATES.PLAYING) return;

    if (roomActive) {
        toggleEndVote();
    } else {
        applyEndGame();
    }
}

async function toggleEndVote() {
    if (!roomActive || !currentRoomCode || !currentUser) return;

    const voteRef = ref(db, `rooms/${currentRoomCode}/endVotes/${currentUser.uid}`);
    if (endVotes[currentUser.uid]) {
        await remove(voteRef);
    } else {
        await set(voteRef, true);
    }
}

// Host only: end the game once every player currently in the room has voted
function checkEndVotes() {
    if (!roomActive || myPlayerId !== hostId) return;
    if (game.state !== window.GAME_STATES.PLAYING) return;

    const playerIds = Object.keys(game.playerNames || {});
    if (playerIds.length > 0 && playerIds.every(uid => endVotes[uid])) {
        applyEndGame();
    }
}

function clearEndVotes() {
    endVotes = {};
    if (roomActive && currentRoomCode && myPlayerId === hostId) {
        remove(ref(db, `rooms/${currentRoomCode}/endVotes`));
    }
}

/* ============================================================
   5. GUESS FLOW (LOCAL + HOST)
   ============================================================ */
function onGuessSubmit() {
    if (game.state !== window.GAME_STATES.PLAYING) return;

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
    if (!roomActive || !currentRoomCode || myPlayerId !== hostId) return;

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
}

function advanceTurn(gameInstance) {
    if (gameInstance.players.length === 0) return;
    gameInstance.currentPlayerIndex = (gameInstance.currentPlayerIndex + 1) % gameInstance.players.length;
}

function applyWrongGuess(gameInstance) {
    advanceTurn(gameInstance);
}

function processGuess(rawGuess, playerId) {
    if (!game.stat || !game.data[game.stat]) {
        return { ok: false, reason: "no-data" };
    }
    if (game.roundComplete) {
        return { ok: false, reason: "round-complete" };
    }

    const answers = game.data[game.stat].players;
    const match = findAnswerMatch(rawGuess, answers);
    const guesser = game.players[game.currentPlayerIndex];

    // Shown to everyone as feedback; `at` lets the renderer animate only new guesses
    game.lastGuess = {
        playerName: guesser?.name || "Player",
        guess: rawGuess,
        answer: match || null,
        result: !match ? "wrong" : game.globalGuessed.includes(match) ? "repeat" : "correct",
        at: Date.now()
    };

    if (match && !game.globalGuessed.includes(match)) {
        applyCorrectGuess(game, match);
        game.roundComplete = answers.length > 0 &&
            answers.every(answer => game.globalGuessed.includes(answer.name));
        if (!game.roundComplete) {
            advanceTurn(game);
        }
    } else {
        applyWrongGuess(game);
    }

    renderUIForState(game);

    // Everything's been guessed: no vote needed, show results after a beat
    if (game.roundComplete) {
        setTimeout(applyEndGame, 2500);
    }

    return { ok: true };
}

/* ============================================================
   6. DATA & UTILITIES
   ============================================================ */
async function maybeLoadData() {
    const requestId = ++dataLoadRequest;
    const { sport, category, year } = game;

    game.data = {};
    if (ui.statSelect) {
        ui.statSelect.disabled = true;
        ui.statSelect.innerHTML = `<option value="">Pick a stat</option>`;
    }

    if (!sport || !year || (sport === "mlb" && !category)) {
        if (ui.statHint) ui.statHint.textContent = "";
        return;
    }

    if (ui.statHint) ui.statHint.textContent = "Loading stats…";

    const fileName = sport === "mlb"
        ? `${category}_${year}_enriched.json`
        : `stats_${year}_enriched.json`;
    const dataUrl = new URL(`../../../data/${sport}/${year}/processed/${fileName}`, import.meta.url);

    try {
        const response = await fetch(dataUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} loading ${fileName}`);
        }

        const rawData = await response.json();
        if (requestId !== dataLoadRequest) return;

        if (!Array.isArray(rawData)) {
            throw new Error(`Expected an array of stat records in ${fileName}`);
        }

        game.data = Object.fromEntries(rawData.map(stat => {
            if (!stat.stat_label || !Array.isArray(stat.players)) {
                throw new Error(`Invalid stat record in ${fileName}`);
            }

            const isPercent = stat.is_percent_stat ??
                stat.players.some(player => player.is_percent === true);
            const players = stat.players.map(player => {
                const name = [player.first_name, player.player].filter(Boolean).join(" ");
                if (!name) {
                    throw new Error(`Missing player name for stat "${stat.stat_label}" in ${fileName}`);
                }

                return {
                    name,
                    rank: player.rank,
                    value: isPercent ? player.value / 100 : player.value
                };
            });

            return [stat.stat_label, { players, isPercent }];
        }));

        if (Object.keys(game.data).length > 0) {
            populateStatDropdown();
            if (ui.statHint) ui.statHint.textContent = "";
        } else if (ui.statHint) {
            ui.statHint.textContent = "No stats for this pick yet.";
        }

        renderUIForState(game);
    } catch (error) {
        if (requestId !== dataLoadRequest) return;
        console.warn("Unable to load Top 10 data:", error);
        if (ui.statHint) ui.statHint.textContent = "Couldn't load stats for this pick.";
    }
}

async function loadDataManifest() {
    try {
        const response = await fetch(new URL("../../../data/manifest.json", import.meta.url));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        dataManifest = (await response.json()).available || [];
    } catch (error) {
        console.warn("Unable to load data manifest:", error);
    }
    renderUIForState(game);
}

function loadSport() {
    maybeLoadData();
}

function normalize(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findAnswerMatch(rawGuess, answers) {
    const guess = normalize(rawGuess);
    if (!guess) return null;

    const exactFullMatch = answers.find(answer => normalize(answer.name) === guess);
    if (exactFullMatch) return exactFullMatch.name;

    const candidates = answers.map(answer => {
        const nameParts = answer.name.split(/\s+/).map(normalize).filter(Boolean);
        const suffixes = new Set(["jr", "sr", "ii", "iii", "iv"]);
        const familyName = [...nameParts].reverse().find(part => !suffixes.has(part));
        const aliases = [...new Set([
            normalize(answer.name),
            nameParts[0],
            familyName
        ].filter(Boolean))];

        return { answer, aliases };
    });

    const exactAliasMatches = candidates.filter(({ aliases }) => aliases.includes(guess));
    if (exactAliasMatches.length === 1) return exactAliasMatches[0].answer.name;
    if (exactAliasMatches.length > 1) return null;

    let bestDistance = Infinity;
    let bestMatches = [];

    for (const candidate of candidates) {
        const distance = Math.min(...candidate.aliases.map(alias => levenshtein(guess, alias)));
        const closestAlias = candidate.aliases.find(alias => levenshtein(guess, alias) === distance);
        const threshold = closestAlias.length <= 5
            ? 1
            : Math.max(1, Math.floor(closestAlias.length * 0.2));

        if (distance > threshold) continue;
        if (distance < bestDistance) {
            bestDistance = distance;
            bestMatches = [candidate.answer.name];
        } else if (distance === bestDistance) {
            bestMatches.push(candidate.answer.name);
        }
    }

    const uniqueMatches = [...new Set(bestMatches)];
    return uniqueMatches.length === 1 ? uniqueMatches[0] : null;
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
    handleLocalGuess,
    sendGuessToHost,
    hostProcessGuess,
    onGuessSubmit,
    maybeLoadData,
    loadDataManifest,
    onEndGameClick,
    toggleEndVote,
    listenToEndVotes,
    checkEndVotes,
    clearEndVotes,
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

loadDataManifest();
