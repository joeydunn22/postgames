/* ============================================================
   TOP 10 — STATE & UI REFERENCES
   ============================================================ */

// Told to move from top10.html
let currentUser = null;
let currentRoomCode = null;
let roomActive = false;
let myPlayerId = null;
let hostId = null;


/* Game state object */
const game = {
    state: "playing",
    currentPlayerIndex: 0,
    players: [],
    globalGuessed: [],
    category: null,
    sport: null,
    year: null,
    stat: null,
    data: {}
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
};


/* ============================================================
   TOP 10 — INITIALIZATION HELPERS
   ============================================================ */

/* Create initial player objects */
function initializePlayers(count) {
    game.players = Array.from({ length: count }, (_, i) => ({
        name: `Player ${i + 1}`,
        guesses: [],
        score: 0
    }));
}