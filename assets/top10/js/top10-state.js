/* ============================================================
   TOP 10 — SHARED STATE
   Loaded first. These are plain scripts (not modules), so every
   top-level variable and function in any of the three files is
   visible to the other two.
   ============================================================ */

const GAME_STATES = {
    SETUP: "setup",
    PLAYING: "playing",
    RESULTS: "results"
};

// Applies to both pass-the-phone games and rooms
const MAX_PLAYERS = 4;


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
    timerSeconds: 0,      // seconds per turn, 0 = no timer
    players: [],          // [{ id, name, score }] in turn order
    currentPlayerIndex: 0,
    turnEndsAt: null,     // server time (ms) the current turn runs out, when timed
    guessed: [],          // [{ answer, by }] correct answers and who got them
    roundComplete: false, // every answer found
    lastGuess: null       // { playerName, guess, answer, result, at }, shown to everyone
};

// Turn timer choices offered to the host (seconds, 0 = off)
const TIMER_OPTIONS = [0, 45, 60, 90];

const game = {
    ...structuredClone(SYNCED_DEFAULTS),

    // Local only
    data: {},             // stat label -> { players: [{ name, rank, team, value }], isPercent }
    dataStatus: "idle"    // idle | loading | ready | empty | error
};


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

// True if any data exists matching the given sport/category/year (omitted = any)
function hasData({ sport, category, year } = {}) {
    return dataManifest.some(entry =>
        (!sport || entry.sport === sport) &&
        (!category || entry.category === category) &&
        (!year || String(entry.year) === String(year)));
}

function availableYears({ sport, category } = {}) {
    const years = dataManifest
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
