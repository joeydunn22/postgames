/* ============================================================
   TOP 10 — STATE & UI REFERENCES
   ============================================================ */

// Told to move from top10.html
let currentUser = null;
let currentRoomCode = null;
let roomActive = false;
let myPlayerId = null;
let hostId = null;


const game = {
    state: "setup",            // start in setup, not playing
    currentPlayerIndex: 0,
    players: [],               // [{ id, name, guesses[], score }]
    globalGuessed: [],         // ["aaron_judge", ...]
    sport: null,
    category: null,
    year: null,
    stat: null,

    // LOCAL ONLY (not synced)
    data: {}                   // loaded from JSON, stays local
};

/* Cached UI elements */
const ui = {
    top10List: document.getElementById("top10List"),
    input: document.getElementById("userGuess"),
    statSelect: document.getElementById("statSelect"),
    statTitle: document.getElementById("statTitle"),

    resultsSection: document.getElementById("resultsSection"),
    resultsWinner: document.getElementById("resultsWinner"),
    resultsPlayers: document.getElementById("resultsPlayers"),

    currentPlayerDisplay: document.getElementById("currentPlayerDisplay"),

    playerNameInputs: document.getElementById("playerNameInputs"),
    playerSetup: document.getElementById("player-setup"),
    playersContainer: document.querySelector(".players-container"),

    actionButton: document.getElementById("actionButton"),

    sportButtons: document.getElementById("sport-buttons"),
    yearButtons: document.getElementById("year-buttons"),
    mlbCategoryButtons: document.getElementById("mlb-category-buttons"),

    submitGuessBtn: document.getElementById("submitGuessBtn"),
};