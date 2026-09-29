/* ============================================================
   TOP 10 — LOGIC
   Game rules, rooms (Firebase) and data loading. This file never
   touches the page: it changes state, then calls render().
   ============================================================ */

let _roomUnsubscribers = [];   // Firebase listeners to switch off on leaving
let _dataRequestId = 0;        // ignore stat files that arrive after a newer pick
let _autoEndTimer = null;


/* ============================================================
   1. SIGN-IN
   Everyone gets an anonymous Firebase account, used as their
   player id in rooms.
   ============================================================ */
onAuthStateChanged(auth, user => {
    if (!user) {
        signInAnonymously(auth).catch(err => console.error("Sign-in failed:", err));
        return;
    }
    currentUser = user;
    render();
});


/* ============================================================
   2. ROOMS
   rooms/{code}/
     host          uid of the player running the game
     players       uid -> display name
     gameState     mirror of the synced parts of `game` (host writes)
     pendingGuess  uid -> { guess } from non-hosts, host processes
     endVotes      uid -> true
     session       the "Tonight" leaderboard (host writes)
   ============================================================ */
function roomRef(path = "") {
    return ref(db, `rooms/${currentRoomCode}${path ? "/" + path : ""}`);
}

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I lookalikes
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function createRoom() {
    if (inRoom() || !currentUser) return;

    let code;
    do {
        code = generateRoomCode();
    } while ((await get(ref(db, `rooms/${code}`))).exists());

    const myName = game.players[0]?.name || "Player 1";
    await set(ref(db, `rooms/${code}`), {
        host: currentUser.uid,
        players: { [currentUser.uid]: myName }
    });

    enterRoom(code, currentUser.uid);
    roomStatus = "Share this code with your friends.";
    await syncGameState(); // carry the current picks into the room
    render();
}

async function joinRoom(rawCode) {
    const code = rawCode.trim().toUpperCase();
    if (!code || inRoom() || !currentUser) return;

    const snapshot = await get(ref(db, `rooms/${code}`));
    if (!snapshot.exists()) {
        roomStatus = `No room with code ${code}.`;
        render();
        return;
    }

    const members = snapshot.val().players || {};
    if (!members[currentUser.uid]) {
        if (Object.keys(members).length >= MAX_PLAYERS) {
            roomStatus = `Room ${code} is full (${MAX_PLAYERS} players max).`;
            render();
            return;
        }
        const name = `Player ${Object.keys(members).length + 1}`;
        await set(ref(db, `rooms/${code}/players/${currentUser.uid}`), name);
    }

    enterRoom(code, snapshot.val().host);
    roomStatus = "You're in. The host picks the game.";
    render();
}

function enterRoom(code, host) {
    currentRoomCode = code;
    hostId = host;
    endVotes = {};
    session = emptySession();

    // The host brings their current picks; everyone else waits for the room's game
    if (!isHost()) {
        Object.assign(game, structuredClone(SYNCED_DEFAULTS), { data: {}, dataStatus: "idle" });
    }
    game.players = [];

    _roomUnsubscribers = [
        onValue(roomRef("host"), onHostChange),
        onValue(roomRef("players"), onMembersChange),
        onValue(roomRef("gameState"), onGameStateChange),
        onValue(roomRef("pendingGuess"), onPendingGuess),
        onValue(roomRef("endVotes"), onEndVotesChange),
        onValue(roomRef("session"), onSessionChange)
    ];
}

async function leaveRoom() {
    if (!inRoom()) return;

    const code = currentRoomCode;
    stopListening();
    resetToLocalGame("Left the room.");

    await remove(ref(db, `rooms/${code}/players/${currentUser.uid}`));

    // Last one out deletes the room
    const remaining = await get(ref(db, `rooms/${code}/players`));
    if (!remaining.exists()) await remove(ref(db, `rooms/${code}`));
}

function stopListening() {
    _roomUnsubscribers.forEach(unsubscribe => unsubscribe());
    _roomUnsubscribers = [];
}

// Back to a fresh one-device game with its own leaderboard
function resetToLocalGame(message) {
    currentRoomCode = null;
    hostId = null;
    roomMembers = {};
    endVotes = {};
    session = emptySession();
    Object.assign(game, structuredClone(SYNCED_DEFAULTS), { data: {}, dataStatus: "idle" });
    game.players = [newLocalPlayer("Player 1")];
    roomStatus = message;
    render();
}

// Room players in the room's order, keeping each one's score
function roomPlayers(previous) {
    return Object.entries(roomMembers).map(([id, name]) => ({
        id,
        name,
        score: previous.find(p => p.id === id)?.score ?? 0
    }));
}


/* ============================================================
   3. ROOM LISTENERS
   ============================================================ */
function onHostChange(snapshot) {
    if (!snapshot.exists()) {
        stopListening();
        resetToLocalGame("The room was closed.");
        return;
    }
    hostId = snapshot.val();
    render();
}

function onMembersChange(snapshot) {
    roomMembers = snapshot.val() || {};
    game.players = roomPlayers(game.players);

    // If the host left, the first player in the room takes over
    const members = Object.keys(roomMembers);
    if (members.length > 0 && !roomMembers[hostId] && members[0] === currentUser.uid) {
        set(roomRef("host"), currentUser.uid);
    }

    render();
    checkEndVotes();
}

function onGameStateChange(snapshot) {
    const remote = snapshot.val() || {};
    const selectionChanged = ["sport", "category", "year"]
        .some(key => (remote[key] ?? null) !== game[key]);

    for (const [key, fallback] of Object.entries(SYNCED_DEFAULTS)) {
        game[key] = remote[key] ?? structuredClone(fallback);
    }
    game.players = roomPlayers(game.players);

    if (selectionChanged) loadStats();
    render();
}

// Host only: run guesses sent by other players, if it's their turn
function onPendingGuess(snapshot) {
    const pending = snapshot.val();
    if (!pending || !isHost()) return;

    for (const [playerId, { guess }] of Object.entries(pending)) {
        const current = game.players[game.currentPlayerIndex];
        if (game.state === GAME_STATES.PLAYING && current?.id === playerId) {
            applyGuess(guess);
        }
    }
    remove(roomRef("pendingGuess"));
    syncGameState();
}

function onEndVotesChange(snapshot) {
    endVotes = snapshot.val() || {};
    render();
    checkEndVotes();
}

function onSessionChange(snapshot) {
    const remote = snapshot.val() || {};
    session = { gamesPlayed: remote.gamesPlayed || 0, players: remote.players || {} };
    render();
}

// Host only: push the synced parts of `game` to the room
async function syncGameState() {
    if (!inRoom() || !isHost()) return;

    const synced = Object.fromEntries(Object.keys(SYNCED_DEFAULTS).map(key => [key, game[key]]));
    try {
        await set(roomRef("gameState"), synced);
    } catch (error) {
        console.error("Room sync failed:", error);
        roomStatus = "Lost connection to the room.";
        render();
    }
}


/* ============================================================
   4. SETUP: picking the game and players
   ============================================================ */
function canEditSetup() {
    return isHost() && game.state === GAME_STATES.SETUP;
}

function selectSport(sport) {
    if (!canEditSetup()) return;
    game.sport = sport;
    game.category = null;
    onSelectionChanged();
}

function selectCategory(category) {
    if (!canEditSetup()) return;
    game.category = category;
    onSelectionChanged();
}

function selectYear(year) {
    if (!canEditSetup()) return;
    game.year = year;
    onSelectionChanged();
}

function onSelectionChanged() {
    // A season with no data for the new sport/category can't stay picked
    if (game.year && !hasData({ sport: game.sport, category: game.category, year: game.year })) {
        game.year = null;
    }
    game.stat = null;
    loadStats();
    syncGameState();
    render();
}

function selectStat(stat) {
    if (!canEditSetup()) return;
    game.stat = stat || null;
    syncGameState();
    render();
}

function addLocalPlayer() {
    if (inRoom() || game.players.length >= MAX_PLAYERS) return;
    game.players.push(newLocalPlayer());
    render();
}

function removeLocalPlayer(id) {
    if (inRoom() || game.players.length <= 1) return;
    game.players = game.players.filter(p => p.id !== id);
    render();
}

async function renamePlayer(id, rawName) {
    const name = rawName.trim().slice(0, 16);
    if (!name) return;

    if (inRoom()) {
        if (id === currentUser.uid) await set(roomRef(`players/${id}`), name);
    } else {
        const player = game.players.find(p => p.id === id);
        if (player) player.name = name;
    }
    render();
}


/* ============================================================
   5. GAME FLOW: start, end, new game
   ============================================================ */
function canStartGame() {
    return canEditSetup() && !!game.data[game.stat] && game.players.length > 0;
}

function startGame() {
    if (!canStartGame()) return;

    Object.assign(game, {
        state: GAME_STATES.PLAYING,
        currentPlayerIndex: 0,
        guessed: [],
        roundComplete: false,
        lastGuess: null
    });
    game.players = game.players.map(p => ({ ...p, score: 0 }));
    clearEndVotes();
    syncGameState();
    render();
}

function endGame() {
    if (!isHost() || game.state !== GAME_STATES.PLAYING) return;

    clearTimeout(_autoEndTimer);
    game.state = GAME_STATES.RESULTS;
    clearEndVotes();
    recordGameResult();
    syncGameState();
    render();
}

// Keep the sport and season, pick a new stat
function newGame() {
    if (!isHost()) return;

    Object.assign(game, {
        state: GAME_STATES.SETUP,
        stat: null,
        currentPlayerIndex: 0,
        guessed: [],
        roundComplete: false,
        lastGuess: null
    });
    game.players = game.players.map(p => ({ ...p, score: 0 }));
    clearEndVotes();
    syncGameState();
    render();
}

// Add the finished game to the session leaderboard. A win goes to the
// outright top scorer only; ties (and one-player games) award no win.
function recordGameResult() {
    const players = game.players;
    if (players.length === 0) return;

    const topScore = Math.max(...players.map(p => p.score));
    const leaders = players.filter(p => p.score === topScore);
    const winner = players.length > 1 && leaders.length === 1 && topScore > 0 ? leaders[0] : null;

    session.gamesPlayed += 1;
    for (const p of players) {
        const record = session.players[p.id] || { wins: 0, points: 0, games: 0 };
        record.name = p.name;
        record.games += 1;
        record.points += p.score;
        if (p === winner) record.wins += 1;
        session.players[p.id] = record;
    }

    if (inRoom()) set(roomRef("session"), session);
}


/* ============================================================
   6. ENDING A GAME EARLY
   One device: End Game ends immediately. Room: each player toggles
   a vote; once everyone in the room has voted, the host ends it.
   ============================================================ */
function voteToEndGame() {
    if (game.state !== GAME_STATES.PLAYING) return;

    if (!inRoom()) {
        endGame();
    } else if (endVotes[currentUser.uid]) {
        remove(roomRef(`endVotes/${currentUser.uid}`));
    } else {
        set(roomRef(`endVotes/${currentUser.uid}`), true);
    }
}

function checkEndVotes() {
    if (!inRoom() || !isHost() || game.state !== GAME_STATES.PLAYING) return;

    const members = Object.keys(roomMembers);
    if (members.length > 0 && members.every(uid => endVotes[uid])) {
        endGame();
    }
}

function clearEndVotes() {
    endVotes = {};
    if (inRoom() && isHost()) remove(roomRef("endVotes"));
}


/* ============================================================
   7. GUESSING
   ============================================================ */
function isMyTurn() {
    if (!inRoom()) return true;
    return game.players[game.currentPlayerIndex]?.id === currentUser?.uid;
}

function submitGuess(rawGuess) {
    const guess = rawGuess.trim();
    if (!guess || game.state !== GAME_STATES.PLAYING || !isMyTurn()) return;

    if (isHost()) {
        applyGuess(guess);
        syncGameState();
    } else {
        set(roomRef(`pendingGuess/${currentUser.uid}`), { guess });
    }
}

// Score a guess for the current player, then pass the turn.
// Only ever runs on the host (or the one device).
function applyGuess(rawGuess) {
    const stat = game.data[game.stat];
    const guesser = game.players[game.currentPlayerIndex];
    if (!stat || !guesser || game.roundComplete) return;

    const answer = findAnswerMatch(rawGuess, stat.players);
    const alreadyGuessed = game.guessed.some(g => g.answer === answer);
    const result = !answer ? "wrong" : alreadyGuessed ? "repeat" : "correct";

    game.lastGuess = { playerName: guesser.name, guess: rawGuess, answer, result, at: Date.now() };

    if (result === "correct") {
        guesser.score += 1;
        game.guessed.push({ answer, by: guesser.id });
        game.roundComplete = game.guessed.length === stat.players.length;
    }

    if (game.roundComplete) {
        // Everything's been found: no vote needed, show results after a beat
        _autoEndTimer = setTimeout(endGame, 2500);
    } else {
        game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    }
    render();
}


/* ============================================================
   8. DATA
   data/manifest.json lists every available sport/category/year and
   its file (paths here are relative to pages/top10.html).
   ============================================================ */
async function loadDataManifest() {
    try {
        const response = await fetch("../data/manifest.json");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        dataManifest = (await response.json()).available;
    } catch (error) {
        console.error("Couldn't load the data manifest:", error);
    }
    render();
}

async function loadStats() {
    const requestId = ++_dataRequestId;
    const { sport, category, year } = game;
    const entry = dataManifest.find(e =>
        e.sport === sport &&
        (e.category ?? null) === category &&
        String(e.year) === String(year));

    // MLB (anything with categories in the manifest) also needs a category picked
    const needsCategory = dataManifest.some(e => e.sport === sport && e.category);
    const pickComplete = sport && year && (category || !needsCategory);

    game.data = {};
    if (!entry) {
        game.dataStatus = pickComplete ? "empty" : "idle";
        return;
    }

    game.dataStatus = "loading";
    render();

    try {
        const response = await fetch(`../data/${entry.file}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const stats = await response.json();
        if (requestId !== _dataRequestId) return;

        game.data = Object.fromEntries(stats.map(stat => [stat.label, stat]));
        game.dataStatus = stats.length > 0 ? "ready" : "empty";
    } catch (error) {
        if (requestId !== _dataRequestId) return;
        console.error(`Couldn't load ${entry.file}:`, error);
        game.dataStatus = "error";
    }
    render();
}


/* ============================================================
   9. MATCHING A GUESS TO AN ANSWER
   Accepts the full name, first name alone or last name alone,
   ignoring accents, punctuation and small typos. A guess that fits
   more than one answer equally well counts as a miss.
   ============================================================ */
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

function normalize(text) {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findAnswerMatch(rawGuess, answers) {
    const guess = normalize(rawGuess);
    if (!guess) return null;

    const candidates = answers.map(({ name }) => {
        const parts = name.split(/\s+/).map(normalize).filter(Boolean);
        const lastName = [...parts].reverse().find(part => !NAME_SUFFIXES.has(part));
        return { name, full: normalize(name), aliases: [...new Set([normalize(name), parts[0], lastName])] };
    });

    const exactFull = candidates.find(c => c.full === guess);
    if (exactFull) return exactFull.name;

    const exactAlias = candidates.filter(c => c.aliases.includes(guess));
    if (exactAlias.length > 0) return exactAlias.length === 1 ? exactAlias[0].name : null;

    // Typos: allow ~1 wrong letter per 5, at least 1
    let bestDistance = Infinity;
    let best = [];
    for (const candidate of candidates) {
        for (const alias of candidate.aliases) {
            const distance = levenshtein(guess, alias);
            const allowed = Math.max(1, Math.floor(alias.length * 0.2));
            if (distance > allowed || distance > bestDistance) continue;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = [];
            }
            if (!best.includes(candidate.name)) best.push(candidate.name);
        }
    }
    return best.length === 1 ? best[0] : null;
}

// Number of single-letter edits to turn a into b
function levenshtein(a, b) {
    let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            current[j] = a[i - 1] === b[j - 1]
                ? previous[j - 1]
                : 1 + Math.min(previous[j - 1], previous[j], current[j - 1]);
        }
        previous = current;
    }
    return previous[b.length];
}


loadDataManifest();
