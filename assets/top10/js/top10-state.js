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

// Put this near the top of your main script (before any render functions run)
function initUI() {
    window.ui = window.ui || {};

    // Gameplay / stat area
    ui.statSection = document.getElementById('statSection');
    ui.top10List = document.getElementById('top10List');

    // Stat controls
    ui.statSelect = document.getElementById('statSelect');
    ui.statTitle = document.getElementById('statTitle');
    ui.input = document.getElementById('userGuess');
    ui.submitGuessBtn = document.getElementById('submitGuessBtn');

    // Player UI
    ui.playerSetup = document.getElementById('player-setup');
    ui.playerNameInputs = document.getElementById('playerNameInputs');
    ui.playersContainer = document.querySelector('.players-container');
    ui.currentPlayerDisplay = document.getElementById('currentPlayerDisplay');
    ui.addPlayerBtn = document.getElementById('addPlayerBtn');
    ui.removePlayerBtn = document.getElementById('removePlayerBtn');

    // Results area (end-game)
    ui.resultsSection = document.getElementById('resultsSection');
    ui.resultsWinner = document.getElementById('resultsWinner');
    ui.resultsPlayers = document.getElementById('resultsPlayers');

    // Controls / misc
    ui.actionButton = document.getElementById('actionButton');
    ui.actionBtn = ui.actionButton; // alias for older code
    ui.sportButtons = document.getElementById('sport-buttons');
    ui.mlbCategoryButtons = document.getElementById('mlb-category-buttons');
    ui.yearButtons = document.getElementById('year-buttons');
}

// Call once during app bootstrap
initUI();