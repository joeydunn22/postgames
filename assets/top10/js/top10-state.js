/* ============================================================
   GLOBAL MULTIPLAYER + ROOM STATE + UI CONTAINER
   ============================================================ */

window.currentUser = null;
window.myPlayerId = null;
window.currentRoomCode = null;
window.roomActive = false;
window.hostId = null;

window.ui = {};   // UI reference container (used by render.js)


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