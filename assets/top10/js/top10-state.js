/* ============================================================
   GLOBAL MULTIPLAYER + ROOM STATE + UI CONTAINER
   ============================================================ */

const GAME_STATES = {
    SETUP: "setup",
    PLAYING: "playing",
    RESULTS: "results"
};

window.GAME_STATES = GAME_STATES;

window.currentUser = null;
window.myPlayerId = null;
window.currentRoomCode = null;
window.roomActive = false;
window.hostId = null;

window.ui = {};   // UI reference container

// Entries from data/manifest.json: which sport/category/year combos have data
window.dataManifest = [];

// Room only: { uid: true } for each player who voted to end the game
window.endVotes = {};


/* ============================================================
   CORE GAME STATE (shared by single + multiplayer)
   ============================================================ */

window.game = {
    state: GAME_STATES.SETUP,
    currentPlayerIndex: 0,

    players: [],
    playerNames: {},

    globalGuessed: [],
    roundComplete: false,

    sport: null,
    category: null,
    year: null,
    stat: null,

    authReady: false,

    isGuessLocked: false,

    data: {}   // local-only stat data    
};


/* ============================================================
   AUTH STATE HELPER
   ============================================================ */

function setAuthState(user) {
    window.currentUser = user;
    window.myPlayerId = user?.uid ?? null;
    game.authReady = !!user;
}


/* ============================================================
   DATA AVAILABILITY HELPER
   ============================================================ */

// True if any data exists matching the given sport/category/year (omitted = any)
function hasData({ sport, category, year } = {}) {
    return dataManifest.some(entry =>
        (!sport || entry.sport === sport) &&
        (!category || entry.category === category) &&
        (!year || String(entry.year) === String(year)));
}


/* ============================================================
   PUBLIC API EXPORT
   ============================================================ */

const PUBLIC_API = {
    setAuthState,
    hasData,
    GAME_STATES
};

// Attach everything automatically
Object.entries(PUBLIC_API).forEach(([name, fn]) => {
    if (typeof fn === "function" || typeof fn === "object") {
        window[name] = fn;
    } else {
        console.warn(`PUBLIC_API: ${name} is not a function`);
    }
});