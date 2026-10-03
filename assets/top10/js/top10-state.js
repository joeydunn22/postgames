/* ============================================================
   TOP 10 — SHARED STATE
   Loaded after top10-common.js and top10-records.js. These are plain scripts (not
   modules), so every top-level variable and function in any of the
   files is visible to the others.
   ============================================================ */

const GAME_STATES = {
    SETUP: "setup",
    PLAYING: "playing",
    RESULTS: "results"
};

// Applies to both pass-the-phone games and rooms
const MAX_PLAYERS = 4;

// Three ways to play:
//   solo        one player on this phone, not in a room: three strikes and
//               you're out, and finished games are saved (top10-records.js)
//   one phone   2-4 players passing this phone around
//   room        everyone on their own phone (see top10-logic.js)
const SOLO_STRIKES = 3;


/* ============================================================
   THE GAME
   Everything in SYNCED_DEFAULTS is mirrored to rooms/{code}/gameState.
   Firebase drops empty arrays and nulls, so anything missing from a
   remote update falls back to these defaults.
   ============================================================ */

const SYNCED_DEFAULTS = {
    state: GAME_STATES.SETUP,
    sport: null,
    category: null,       // MLB only: "batting" | "pitching"
    year: null,
    stat: null,           // stat label, e.g. "Home Runs"
    era: "all",           // which seasons are on offer, a key of ERAS
    timerSeconds: 0,      // seconds per turn, 0 = no timer
    players: [],          // [{ id, name, score }] in turn order
    currentPlayerIndex: 0,
    turnEndsAt: null,     // server time (ms) the current turn runs out, when timed
    guessed: [],          // [{ id, by }] board players found (by player id) and who got them
    misses: [],           // [{ id, name, by }] wrong guesses, in order, and who made them
    roundComplete: false, // every answer found
    lastGuess: null       // { playerName, id, guess, answer, result: correct|wrong|timeout, at }, shown to everyone
};

// Era choices offered to the host. Each test gets the season's start
// year (NBA 2025 = the 2024-25 season, so 2024) and the newest start
// year that sport has data for.
const ERAS = {
    all: () => true,
    last5: (start, newest) => start > newest - 5,
    last10: (start, newest) => start > newest - 10,
    "2010s": start => start >= 2010 && start < 2020,
    "2000s": start => start >= 2000 && start < 2010,
    pre2000: start => start < 2000
};

// Turn timer choices offered to the host (seconds, 0 = off)
const TIMER_OPTIONS = [0, 45, 60, 90];

const game = {
    ...structuredClone(SYNCED_DEFAULTS),

    // Local only
    data: {},             // stat label -> { players: [{ rank, id, name, team, value }], more_tied? }
    roster: [],           // everyone who played that season, what guesses are picked from (see loadStats)
    dataStatus: "idle",   // idle | loading | ready | empty | error
    strikes: 0,           // solo: wrong guesses and timeouts this game
    soloResult: null      // solo: { previousBest, newBest } for the results screen, once saved
};

// The local-only fields of `game`, empty
function emptyGameData() {
    return { data: {}, roster: [], dataStatus: "idle", strikes: 0, soloResult: null };
}


/* ============================================================
   ROOM + IDENTITY
   ============================================================ */

let currentUser = null;
let currentRoomCode = null;
let hostId = null;
let roomMembers = {};     // uid -> display name, everyone in the room
let endVotes = {};        // uid -> true, players who voted to end the game
let roomStatus = "";      // short message under the room controls

function inRoom() {
    return currentRoomCode !== null;
}

// Solo/pass-the-phone players are always "host": they control everything
function isHost() {
    return !inRoom() || currentUser?.uid === hostId;
}

function isSolo() {
    return !inRoom() && game.players.length === 1;
}

function struckOut() {
    return isSolo() && game.strikes >= SOLO_STRIKES;
}

// No more guesses: the board's cleared, or a solo player struck out
function roundOver() {
    return game.roundComplete || struckOut();
}


/* ============================================================
   SESSION ("TONIGHT") LEADERBOARD
   Running totals across every game played in this room, or on this
   device when not in a room. Keyed by player id (Firebase uid in a
   room, "local-N" on one device).
   { gamesPlayed, players: { id: { name, wins, points, games } } }
   ============================================================ */

let session = emptySession();

function emptySession() {
    return { gamesPlayed: 0, players: {} };
}


/* ============================================================
   HELPERS
   ============================================================ */

// DOM references, filled in by the renderer
const ui = {};

// Entries from data/manifest.json: which sport/category/year combos have data
let dataManifest = [];

function seasonStartYear(sport, year) {
    return sport === "nba" ? Number(year) - 1 : Number(year);
}

// Manifest entries inside the picked era
function playableEntries(era = game.era) {
    const test = ERAS[era] || ERAS.all;
    const newest = {};
    for (const entry of dataManifest) {
        newest[entry.sport] = Math.max(newest[entry.sport] ?? -Infinity, seasonStartYear(entry.sport, entry.year));
    }
    return dataManifest.filter(entry => test(seasonStartYear(entry.sport, entry.year), newest[entry.sport]));
}

// True if the picked era has data matching the given sport/category/year (omitted = any)
function hasData({ sport, category, year } = {}) {
    return playableEntries().some(entry =>
        (!sport || entry.sport === sport) &&
        (!category || entry.category === category) &&
        (!year || String(entry.year) === String(year)));
}

function availableYears({ sport, category } = {}) {
    const years = playableEntries()
        .filter(entry => entry.sport === sport && (!category || entry.category === category))
        .map(entry => entry.year);
    return [...new Set(years)].sort((a, b) => b - a);
}

// Phones' clocks disagree by a few seconds, so turn timers use Firebase's
// server time: our clock plus the offset Firebase reports
let serverTimeOffset = 0;
function serverNow() {
    return Date.now() + serverTimeOffset;
}

function randomItem(list) {
    return list[Math.floor(Math.random() * list.length)];
}

// One-device players get a stable id so the session leaderboard
// follows them through renames
let _nextLocalId = 1;
function newLocalPlayer(name = `Player ${game.players.length + 1}`) {
    return { id: `local-${_nextLocalId++}`, name, score: 0 };
}
