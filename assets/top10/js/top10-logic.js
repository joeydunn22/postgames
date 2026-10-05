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

// How far this phone's clock is from Firebase's (see serverNow)
onValue(ref(db, ".info/serverTimeOffset"), snapshot => {
    serverTimeOffset = snapshot.val() || 0;
});


/* ============================================================
   2. ROOMS
   rooms/{code}/
     host          uid of the player running the game
     players       uid -> display name
     gameState     mirror of the synced parts of `game` (host writes)
     pendingGuess  uid -> { guess: player id } from non-hosts, host processes
     endVotes      uid -> true
     hintVotes     uid -> true
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
    hintVotes = {};
    session = emptySession();

    // The host brings their current picks; everyone else waits for the room's game
    if (!isHost()) {
        Object.assign(game, structuredClone(SYNCED_DEFAULTS), emptyGameData());
    }
    game.players = [];

    _roomUnsubscribers = [
        onValue(roomRef("host"), onHostChange),
        onValue(roomRef("players"), onMembersChange),
        onValue(roomRef("gameState"), onGameStateChange),
        onValue(roomRef("pendingGuess"), onPendingGuess),
        onValue(roomRef("endVotes"), onEndVotesChange),
        onValue(roomRef("hintVotes"), onHintVotesChange),
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
    hintVotes = {};
    session = emptySession();
    Object.assign(game, structuredClone(SYNCED_DEFAULTS), emptyGameData());
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
    checkHintVotes();
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

function onHintVotesChange(snapshot) {
    hintVotes = snapshot.val() || {};
    render();
    checkHintVotes();
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
    game.year = year || null;
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

// Seasons outside the new era drop off; a season still inside it stays picked
function selectEra(era) {
    if (!canEditSetup() || !ERAS[era]) return;
    game.era = era;
    if (game.year && !hasData({ sport: game.sport, category: game.category, year: game.year })) {
        onSelectionChanged();
        return;
    }
    syncGameState();
    render();
}

function selectStat(stat) {
    if (!canEditSetup()) return;
    game.stat = stat || null;
    syncGameState();
    render();
}

function selectTimer(seconds) {
    if (!canEditSetup() || !TIMER_OPTIONS.includes(seconds)) return;
    game.timerSeconds = seconds;
    syncGameState();
    render();
}

// Pick a random board in the picked era: any sport, or only `sport`.
// Sports are equally likely (MLB has more files but shouldn't come up
// more), then any season/category, then any stat once that file has loaded.
async function pickRandomBoard(sport = null) {
    if (!canEditSetup()) return;
    const entries = playableEntries();
    const sports = sport ? [sport] : [...new Set(entries.map(e => e.sport))];
    if (sports.length === 0) return;

    const pickedSport = randomItem(sports);
    const entry = randomItem(entries.filter(e => e.sport === pickedSport));
    if (!entry) return;

    Object.assign(game, { sport: entry.sport, category: entry.category ?? null, year: entry.year, stat: null });
    syncGameState();
    render();

    await loadStats();
    const stillPicked = game.sport === entry.sport && game.year === entry.year;
    if (!stillPicked || game.dataStatus !== "ready" || !canEditSetup()) return;

    game.stat = randomItem(Object.keys(game.data));
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
        misses: [],
        roundComplete: false,
        lastGuess: null,
        hintLevel: 0,
        strikes: 0,
        soloResult: null
    });
    game.players = game.players.map(p => ({ ...p, score: 0 }));
    startTurnClock();
    clearEndVotes();
    clearHintVotes();
    syncGameState();
    render();
}

function endGame() {
    if (!isHost() || game.state !== GAME_STATES.PLAYING) return;

    clearTimeout(_autoEndTimer);
    game.state = GAME_STATES.RESULTS;
    game.turnEndsAt = null;
    clearEndVotes();
    clearHintVotes();
    recordGameResult();
    if (isSolo()) recordSoloGame();
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
        turnEndsAt: null,
        guessed: [],
        misses: [],
        roundComplete: false,
        lastGuess: null,
        hintLevel: 0,
        strikes: 0,
        soloResult: null
    });
    game.players = game.players.map(p => ({ ...p, score: 0 }));
    clearEndVotes();
    clearHintVotes();
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

// Save a finished solo game on this phone, noting the board's best before
// this game for the results screen. Not saved: a game quit before any
// guess, or one where hints were used (it wouldn't be a fair best).
function recordSoloGame() {
    const stat = game.data[game.stat];
    const player = game.players[0];
    if (!stat || !player || (player.score === 0 && game.strikes === 0)) return;
    if (game.hintLevel > 0) {
        game.soloResult = { hinted: true };
        return;
    }

    const board = { sport: game.sport, category: game.category, year: game.year, stat: game.stat };
    const previous = bestOnBoard(board);
    addSoloGame({
        ...board,
        score: player.score,
        total: stat.players.length,
        strikes: game.strikes,
        timer: game.timerSeconds,
        at: Date.now()
    });
    game.soloResult = {
        previousBest: previous?.best ?? null,
        newBest: !!previous && player.score > previous.best
    };
}


/* ============================================================
   6. ENDING A GAME EARLY
   One device: End Game ends immediately. Room: each player toggles
   a vote; once everyone in the room has voted, the host ends it.
   ============================================================ */
function voteToEndGame() {
    if (game.state !== GAME_STATES.PLAYING) return;

    if (!inRoom()) endGame();
    else toggleMyVote("endVotes", endVotes);
}

// Room: add or take back this player's vote under rooms/{code}/{path}
function toggleMyVote(path, votes) {
    const voteRef = roomRef(`${path}/${currentUser.uid}`);
    votes[currentUser.uid] ? remove(voteRef) : set(voteRef, true);
}

function everyoneVoted(votes) {
    const members = Object.keys(roomMembers);
    return members.length > 0 && members.every(uid => votes[uid]);
}

function checkEndVotes() {
    if (!inRoom() || !isHost() || game.state !== GAME_STATES.PLAYING) return;

    if (everyoneVoted(endVotes)) endGame();
}

function clearEndVotes() {
    endVotes = {};
    if (inRoom() && isHost()) remove(roomRef("endVotes"));
}


/* ============================================================
   7. HINTS
   One step at a time, for every slot still blank. Season boards:
   league (NBA: conference) → division → team and position → initials.
   All-time boards: career years → team → initials. One device: Hint
   gives the next step at once. Room: everyone votes, like ending the
   game, and the host gives it once all have. Hints cost nothing, but a
   solo game with hints isn't saved to your stats (see recordSoloGame).
   ============================================================ */
const SEASON_HINT_STEPS = ["league", "division", "team", "initials"];
const ALL_TIME_HINT_STEPS = ["years", "team", "initials"];

function hintSteps() {
    return isAllTime() ? ALL_TIME_HINT_STEPS : SEASON_HINT_STEPS;
}

// The next step's name, for the button: "Division", or null when all are out
function nextHintLabel() {
    const step = hintSteps()[game.hintLevel];
    if (!step) return null;
    if (step === "league") return game.sport === "nba" ? "Conference" : "League";
    if (step === "years") return "Career years";
    return step[0].toUpperCase() + step.slice(1);
}

function canTakeHint() {
    return game.state === GAME_STATES.PLAYING && !roundOver() && game.hintLevel < hintSteps().length;
}

function voteForHint() {
    if (!canTakeHint()) return;
    if (!inRoom()) takeHint();
    else toggleMyVote("hintVotes", hintVotes);
}

function checkHintVotes() {
    if (inRoom() && isHost() && canTakeHint() && everyoneVoted(hintVotes)) takeHint();
}

// Host (or the one device) only
function takeHint() {
    if (!isHost() || !canTakeHint()) return;
    game.hintLevel += 1;
    clearHintVotes();
    syncGameState();
    render();
}

function clearHintVotes() {
    hintVotes = {};
    if (inRoom() && isHost()) remove(roomRef("hintVotes"));
}

// What the hints so far say about one board player, the most telling
// piece of each step: { league: "AL" }, { division: "AL East" }, then
// { team, pos }, then initials too. All-time: { years }, then team and
// initials. A season-board player traded mid-season (team "2TM") has no
// single league or division, so those steps show their team ("2 teams").
function slotHint(item) {
    const steps = hintSteps().slice(0, game.hintLevel);
    if (steps.length === 0) return null;

    const listed = rosterPlayer(item.id);
    const hint = {};
    if (steps.includes("initials")) hint.initials = initials(item.name);
    if (steps.includes("years")) hint.years = listed?.years || "";
    if (steps.includes("team")) {
        hint.team = item.team;
        hint.pos = listed?.pos || "";
    } else if (steps.includes("league")) {
        const where = divisionOf(divisionTable, game.sport, item.team, game.year);
        if (!where) hint.team = item.team;
        else if (!steps.includes("division")) hint.league = where.league;
        else hint.division = game.sport === "nba" ? `${where.league} · ${where.division}` : where.division;
    }
    return hint;
}


/* ============================================================
   8. GUESSING
   ============================================================ */
function isMyTurn() {
    if (!inRoom()) return true;
    return game.players[game.currentPlayerIndex]?.id === currentUser?.uid;
}

// How a player has already been guessed this game, from `guesserId`'s side:
// "correct" once anyone has found them (they're on the board), "wrong" if
// this guesser already missed with them, else null. Other people's misses
// don't count: everyone can try a player someone else got wrong.
function guessStatus(playerId, guesserId) {
    if (game.guessed.some(g => g.id === playerId)) return "correct";
    if (game.misses.some(m => m.id === playerId && m.by === guesserId)) return "wrong";
    return null;
}

function currentGuesserId() {
    return game.players[game.currentPlayerIndex]?.id ?? null;
}

// A guess is a player picked from the season's roster, sent as their id.
// A player can't be picked once found, or again by someone who missed with them.
function submitGuess(playerId) {
    if (!rosterPlayer(playerId) || guessStatus(playerId, currentGuesserId()) ||
        game.state !== GAME_STATES.PLAYING || !isMyTurn()) return;

    if (isHost()) {
        applyGuess(playerId);
        syncGameState();
    } else {
        set(roomRef(`pendingGuess/${currentUser.uid}`), { guess: playerId });
    }
}

// Score a guess for the current player, then pass the turn.
// Only ever runs on the host (or the one device).
function applyGuess(playerId) {
    const stat = game.data[game.stat];
    const guesser = game.players[game.currentPlayerIndex];
    const picked = rosterPlayer(playerId);
    // A repeat can only come from a phone that hadn't caught up yet: ignore it, turn and all
    if (!stat || !guesser || !picked || guessStatus(playerId, guesser.id) || roundOver()) return;

    const onBoard = stat.players.find(p => p.id === playerId);
    const result = onBoard ? "correct" : "wrong";

    game.lastGuess = {
        playerName: guesser.name,
        id: playerId,
        guess: picked.name,
        answer: onBoard?.name ?? null,
        result,
        at: Date.now()
    };

    if (result === "correct") {
        guesser.score += 1;
        game.guessed.push({ id: playerId, by: guesser.id });
        game.roundComplete = game.guessed.length === stat.players.length;
    } else {
        game.misses.push({ id: playerId, name: picked.name, by: guesser.id });
        if (isSolo()) game.strikes += 1;
    }

    finishTurn();
    render();
}

// After a guess or a timeout: once the round's over (board cleared, or a
// solo player's third strike) show results after a beat, no vote needed.
// Otherwise it's the next player's turn.
function finishTurn() {
    if (roundOver()) {
        game.turnEndsAt = null;
        _autoEndTimer = setTimeout(endGame, 2500);
    } else {
        nextTurn();
    }
}

function nextTurn() {
    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    startTurnClock();
}


/* ============================================================
   9. TURN TIMER
   With a timer on, each turn gets game.timerSeconds. The deadline is
   synced as server time so every phone counts down together. Only
   the host (or the one device) checks it: running out counts as a
   miss (a strike, solo) and passes the turn.
   ============================================================ */
function startTurnClock() {
    game.turnEndsAt = game.timerSeconds ? serverNow() + game.timerSeconds * 1000 : null;
}

function checkTurnClock() {
    if (!isHost() || game.state !== GAME_STATES.PLAYING || roundOver()) return;
    if (!game.turnEndsAt || serverNow() < game.turnEndsAt) return;

    const player = game.players[game.currentPlayerIndex];
    game.lastGuess = { playerName: player?.name || "", id: null, guess: "", answer: null, result: "timeout", at: Date.now() };
    if (isSolo()) game.strikes += 1;
    finishTurn();
    syncGameState();
    render();
}

setInterval(checkTurnClock, 250);


/* ============================================================
   10. DATA
   Fetched with cache "no-cache": the phone always checks the file is
   current (a quick "not modified" when it is), so new code never runs
   on stale data.
   data/manifest.json lists every available sport/category/year and
   its file (paths here are relative to pages/top10.html). Next to each
   season's stat files is players.json: everyone who played that season,
   which guesses are picked from.
   ============================================================ */
async function loadDataManifest() {
    try {
        dataManifest = (await fetchData("manifest.json")).available;
    } catch (error) {
        console.error("Couldn't load the data manifest:", error);
    }
    render();
}

// Leagues and divisions, for hints. Without them, hints show the team instead.
async function loadDivisions() {
    try {
        divisionTable = await fetchData("divisions.json");
    } catch (error) {
        console.error("Couldn't load the division table:", error);
    }
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
    game.roster = [];
    if (!entry) {
        game.dataStatus = pickComplete ? "empty" : "idle";
        return;
    }

    game.dataStatus = "loading";
    render();

    const fetchJSON = async path => {
        const response = await fetch(`../data/${path}`, { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    };
    const rosterFile = entry.file.replace(/[^/]+$/, "players.json");

    try {
        const [stats, roster] = await Promise.all([fetchJSON(entry.file), fetchJSON(rosterFile)]);
        if (requestId !== _dataRequestId) return;

        game.data = Object.fromEntries(stats.map(stat => [stat.label, stat]));
        game.roster = roster.map(withSearchWords);
        game.dataStatus = stats.length > 0 ? "ready" : "empty";
    } catch (error) {
        if (requestId !== _dataRequestId) return;
        console.error(`Couldn't load ${entry.file}:`, error);
        game.dataStatus = "error";
    }
    render();
}


/* ============================================================
   11. SEARCHING FOR A PLAYER TO GUESS
   The matching itself is matchPlayers() in top10-common.js.
   ============================================================ */
function rosterPlayer(id) {
    return game.roster.find(p => p.id === id) || null;
}

// Players matching what's typed (see matchPlayers), each with a `status`
// for whoever's turn it is (see guessStatus) and, when found, `by`: who
// found them. null below the letter minimum.
function searchRoster(query) {
    const found = matchPlayers(game.roster, query);
    if (!found) return null;
    return {
        ...found,
        players: found.players.map(player => ({
            ...player,
            status: guessStatus(player.id, currentGuesserId()),
            by: game.guessed.find(g => g.id === player.id)?.by ?? null
        }))
    };
}


loadDataManifest();
loadDivisions();
