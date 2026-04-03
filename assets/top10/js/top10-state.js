/* ============================================================
   GLOBAL MULTIPLAYER + ROOM STATE + UI CONTAINER
   ============================================================ */

window.currentUser = null;
window.myPlayerId = null;
window.currentRoomCode = null;
window.roomActive = false;
window.hostId = null;

window.ui = {};   // UI reference container


/* ============================================================
   CORE GAME STATE (shared by single + multiplayer)
   ============================================================ */

window.game = {
    state: "setup",
    currentPlayerIndex: 0,

    players: [],
    playerNames: {},

    globalGuessed: [],

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
    currentUser = user;
    myPlayerId = user?.uid ?? null;
    game.authReady = !!user;
}


/* ============================================================
   PUBLIC API EXPORT
   ============================================================ */

const PUBLIC_API = {
    setAuthState
};

// Attach everything automatically
Object.entries(PUBLIC_API).forEach(([name, fn]) => {
    if (typeof fn === "function") {
        window[name] = fn;
    } else {
        console.warn(`PUBLIC_API: ${name} is not a function`);
    }
});