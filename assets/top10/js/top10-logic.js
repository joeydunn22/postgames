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
        roundComplete: false,
        lastGuess: null
    });
    game.players = game.players.map(p => ({ ...p, score: 0 }));
    startTurnClock();
    clearEndVotes();
    syncGameState();
    render();
}

function endGame() {
    if (!isHost() || game.state !== GAME_STATES.PLAYING) return;

    clearTimeout(_autoEndTimer);
    game.state = GAME_STATES.RESULTS;
    game.turnEndsAt = null;
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
        turnEndsAt: null,
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
        game.turnEndsAt = null;
        _autoEndTimer = setTimeout(endGame, 2500);
    } else {
        nextTurn();
    }
    render();
}

function nextTurn() {
    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    startTurnClock();
}


/* ============================================================
   8. TURN TIMER
   With a timer on, each turn gets game.timerSeconds. The deadline is
   synced as server time so every phone counts down together. Only
   the host (or the one device) checks it: running out counts as a
   miss and passes the turn.
   ============================================================ */
function startTurnClock() {
    game.turnEndsAt = game.timerSeconds ? serverNow() + game.timerSeconds * 1000 : null;
}

function checkTurnClock() {
    if (!isHost() || game.state !== GAME_STATES.PLAYING || game.roundComplete) return;
    if (!game.turnEndsAt || serverNow() < game.turnEndsAt) return;

    const player = game.players[game.currentPlayerIndex];
    game.lastGuess = { playerName: player?.name || "", guess: "", answer: null, result: "timeout", at: Date.now() };
    nextTurn();
    syncGameState();
    render();
}

setInterval(checkTurnClock, 250);


/* ============================================================
   9. DATA
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
   10. MATCHING A GUESS TO AN ANSWER
   Accepts, ignoring accents, punctuation, Jr./III, middle initials
   and small typos:
   - the full name, the first name alone or the surname alone
     (surnames can be several words: "St. Brown", "De La Cruz")
   - a full name with a short first name ("Matt Stafford", "Steph Curry")
   - a well-known nickname from PLAYER_NICKNAMES
   A guess that fits more than one answer equally well counts as a miss.
   ============================================================ */
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

// Short first names that don't start with the same letter as the full one
// (same-letter ones like Mike/Michael already match)
const FIRST_NAME_GROUPS = [
    ["bill", "billy", "will", "willie", "william"],
    ["bob", "bobby", "rob", "robbie", "robert"],
    ["dick", "rick", "ricky", "richard"],
    ["ted", "teddy", "ed", "eddie", "edward"],
    ["jack", "john", "johnny"],
    ["tony", "anthony"],
    ["chuck", "charles", "charlie"],
    ["hank", "henry"]
];

// Nicknames people actually say, keyed by the name exactly as the data has it.
// Matched exactly (no typo allowance), since many are only a few letters.
const PLAYER_NICKNAMES = {
    // MLB
    "Alex Rodriguez": ["A-Rod"],
    "Ivan Rodriguez": ["Pudge", "I-Rod"],
    "David Ortiz": ["Big Papi", "Papi"],
    "Randy Johnson": ["Big Unit", "The Big Unit"],
    "Roger Clemens": ["Rocket", "The Rocket"],
    "Frank Thomas": ["Big Hurt", "The Big Hurt"],
    "Mark McGwire": ["Big Mac"],
    "Ken Griffey Jr.": ["Junior", "The Kid"],
    "Pete Alonso": ["Polar Bear"],
    "Pablo Sandoval": ["Kung Fu Panda", "Panda"],
    "Max Scherzer": ["Mad Max"],
    "Vladimir Guerrero Jr.": ["Vladdy", "Vlad Jr"],
    "Giancarlo Stanton": ["Mike Stanton"],
    // NBA
    "Shaquille O'Neal": ["Shaq"],
    "Kevin Durant": ["KD"],
    "Kevin Garnett": ["KG", "Big Ticket", "The Big Ticket"],
    "Chris Paul": ["CP3"],
    "Anthony Davis": ["AD", "The Brow"],
    "Shai Gilgeous-Alexander": ["SGA"],
    "Michael Jordan": ["MJ"],
    "LeBron James": ["Bron", "King James", "LBJ"],
    "Giannis Antetokounmpo": ["Greek Freak", "The Greek Freak"],
    "Nikola Jokić": ["Joker", "The Joker"],
    "Stephen Curry": ["Steph", "Chef Curry"],
    "Russell Westbrook": ["Russ"],
    "Hakeem Olajuwon": ["Dream", "The Dream", "Akeem Olajuwon"],
    "Karl Malone": ["Mailman", "The Mailman"],
    "Charles Barkley": ["Chuck", "Sir Charles"],
    "Julius Erving": ["Dr J", "Doctor J"],
    "Allen Iverson": ["AI", "The Answer"],
    "Tracy McGrady": ["T-Mac"],
    "Paul Pierce": ["The Truth"],
    "Dennis Rodman": ["The Worm", "Worm"],
    "Kobe Bryant": ["Mamba", "Black Mamba"],
    "Dwyane Wade": ["D-Wade", "Flash"],
    "Damian Lillard": ["Dame", "Dame Time"],
    "James Harden": ["The Beard", "Beard"],
    "Victor Wembanyama": ["Wemby"],
    "Chris Webber": ["C-Webb"],
    "Vince Carter": ["Vinsanity"],
    "Anthony Edwards": ["Ant", "Ant Man"],
    "Karl-Anthony Towns": ["KAT"],
    "Anfernee Hardaway": ["Penny", "Penny Hardaway"],
    "Metta World Peace": ["Ron Artest", "Artest"],
    "Jimmy Butler III": ["Jimmy Buckets"],
    "Kawhi Leonard": ["The Claw"],
    // NFL
    "Christian McCaffrey": ["CMC"],
    "Odell Beckham Jr.": ["OBJ"],
    "Calvin Johnson": ["Megatron"],
    "Rob Gronkowski": ["Gronk"],
    "Marshawn Lynch": ["Beast Mode"],
    "Adrian Peterson": ["AP", "All Day"],
    "LaDainian Tomlinson": ["LT"],
    "Chad Johnson": ["Ochocinco", "Chad Ochocinco"],
    "Terrell Owens": ["TO"],
    "Antonio Brown": ["AB"],
    "Tyreek Hill": ["Cheetah"],
    "Jerome Bettis": ["The Bus", "Bus"],
    "Ben Roethlisberger": ["Big Ben"],
    "Derrick Henry": ["King Henry"],
    "Marquise Brown": ["Hollywood", "Hollywood Brown"],
    "Amon-Ra St. Brown": ["Sun God"],
    "Tom Brady": ["TB12"],
    "Maurice Jones-Drew": ["MJD"]
};

function normalize(text) {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Typos allowed when matching against `target`: ~1 wrong letter per 5, at least 1
function closeEnough(guess, target) {
    return levenshtein(guess, target) <= Math.max(1, Math.floor(target.length * 0.2));
}

// Every way an answer can be named. "Amon-Ra St. Brown" gives first
// "amonra" and surnames "stbrown" and "brown".
function nameForms(name) {
    const words = name.split(/\s+/).map(normalize).filter(Boolean);
    // Drop Jr./III and middle initials (but never the first name: "J.J.", "A.J.")
    const core = words.filter((word, idx) => idx === 0 || (!NAME_SUFFIXES.has(word) && word.length > 1));
    const rest = core.slice(1);
    const fulls = [...new Set([normalize(name), core.join("")])];
    const first = core[0];
    const surnames = rest.length > 0 ? [...new Set([rest.join(""), rest.at(-1)])] : [];
    return {
        name,
        fulls,
        first,
        surnames,
        aliases: [...new Set([...fulls, first, ...surnames])],
        nicknames: (PLAYER_NICKNAMES[name] || []).map(normalize)
    };
}

// How well a guessed first name fits: 0 same or a short form, 1 a typo,
// 2 only the same first letter (or an initial), Infinity no fit
function firstNameFit(guessed, first) {
    if (guessed === first) return 0;
    if (guessed.length >= 2 && (first.startsWith(guessed) || guessed.startsWith(first))) return 0;
    if (FIRST_NAME_GROUPS.some(group => group.includes(guessed) && group.includes(first))) return 0;
    if (closeEnough(guessed, first)) return 1;
    if (guessed[0] === first[0]) return 2;
    return Infinity;
}

function findAnswerMatch(rawGuess, answers) {
    const guess = normalize(rawGuess);
    if (!guess) return null;

    const candidates = answers.map(({ name }) => nameForms(name));
    const onlyOne = list => list.length === 1 ? list[0].name : null;

    const exactFull = candidates.find(c => c.fulls.includes(guess));
    if (exactFull) return exactFull.name;

    const exact = candidates.filter(c => c.aliases.includes(guess) || c.nicknames.includes(guess));
    if (exact.length > 0) return onlyOne(exact);

    const byParts = matchFirstAndSurname(rawGuess, candidates);
    if (byParts) return byParts;

    // Typos in the full name, first name or surname
    let bestDistance = Infinity;
    let best = [];
    for (const candidate of candidates) {
        for (const alias of candidate.aliases) {
            if (!closeEnough(guess, alias)) continue;
            const distance = levenshtein(guess, alias);
            if (distance > bestDistance) continue;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = [];
            }
            if (!best.includes(candidate)) best.push(candidate);
        }
    }
    return onlyOne(best);
}

// A guess of two or more words read as first name + surname, so
// "Matt Stafford", "Steph Curry" and "Amon-Ra Brown" work. The surname
// must match (typos allowed); the best-fitting first name wins.
function matchFirstAndSurname(rawGuess, candidates) {
    const words = rawGuess.trim().split(/\s+/).map(normalize).filter(Boolean);
    if (words.length < 2) return null;

    const [guessedFirst, ...rest] = words;
    const guessedSurnames = [rest.join(""), rest.at(-1)];

    let bestFit = Infinity;
    let best = [];
    for (const candidate of candidates) {
        const surnameFits = candidate.surnames.some(surname =>
            guessedSurnames.some(guessed => closeEnough(guessed, surname)));
        if (!surnameFits) continue;

        const fit = firstNameFit(guessedFirst, candidate.first);
        if (fit === Infinity || fit > bestFit) continue;
        if (fit < bestFit) {
            bestFit = fit;
            best = [];
        }
        best.push(candidate);
    }
    return best.length === 1 ? best[0].name : null;
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
