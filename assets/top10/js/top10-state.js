/* ============================================================
   TOP 10 — SHARED STATE
   Loaded first. These are plain scripts (not modules), so every
   variable and function declared at the top level of any of the
   three files is visible to the other two.
   ============================================================ */

const GAME_STATES = {
    SETUP: "setup",
    PLAYING: "playing",
    RESULTS: "results"
};

// Applies to both pass-the-phone games and rooms
const MAX_PLAYERS = 4;


/* ============================================================
   ROOM + IDENTITY
   ============================================================ */

let currentUser = null;
let myPlayerId = null;
let currentRoomCode = null;
let roomActive = false;
let hostId = null;

// Room only: { uid: true } for each player who voted to end the game
let endVotes = {};

// DOM references, filled in by the renderer
const ui = {};

// Entries from data/manifest.json: which sport/category/year combos have data
let dataManifest = [];


/* ============================================================
   CORE GAME STATE (shared by single + multiplayer)
   ============================================================ */

const game = {
    state: GAME_STATES.SETUP,
    currentPlayerIndex: 0,

    players: [],
    playerNames: {},

    globalGuessed: [],
    roundComplete: false,
    lastGuess: null,

    sport: null,
    category: null,
    year: null,
    stat: null,

    authReady: false,
    isGuessLocked: false,

    data: {}   // local-only stat data
};


/* ============================================================
   SESSION ("Tonight") LEADERBOARD
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

function setAuthState(user) {
    currentUser = user;
    myPlayerId = user?.uid ?? null;
    game.authReady = !!user;
}

// Local (one-device) players get a stable id so the session
// leaderboard follows them through renames
let _nextLocalId = 1;
function newLocalPlayer(name) {
    return { id: `local-${_nextLocalId++}`, name, guesses: [], score: 0 };
}

// True if any data exists matching the given sport/category/year (omitted = any)
function hasData({ sport, category, year } = {}) {
    return dataManifest.some(entry =>
        (!sport || entry.sport === sport) &&
        (!category || entry.category === category) &&
        (!year || String(entry.year) === String(year)));
}
