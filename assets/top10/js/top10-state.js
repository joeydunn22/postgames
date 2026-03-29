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
    ui.sportButtons = document.getElementById('sport-buttons');
    ui.mlbCategoryButtons = document.getElementById('mlb-category-buttons');
    ui.yearButtons = document.getElementById('year-buttons');
}

function initActionButtonHandlers() {
    if (!ui.actionButton) return;

    ui.actionButton.onclick = () => {
        const s = game.state;

        if (s === "setup") {
            if (roomActive && myPlayerId !== hostId) return;
            startGame();
        }

        else if (s === "playing") {
            if (roomActive && myPlayerId !== hostId) return;
            applyEndGame(game);
        }

        else if (s === "results") {
            if (roomActive && myPlayerId !== hostId) return;
            resetGame();
        }

        if (roomActive && myPlayerId === hostId) {
            syncGameState();
        }
    };
}

function initLocalPlayerButtons() {
    const addBtn = ui.addPlayerBtn;
    const removeBtn = ui.removePlayerBtn;

    addBtn.onclick = () => {
        if (roomActive) return;
        if (game.players.length >= 4) return;

        game.players.push({
            id: crypto.randomUUID(),
            name: `Player ${game.players.length + 1}`,
            guesses: [],
            score: 0
        });

        renderUIForState();
    };

    removeBtn.onclick = () => {
        if (roomActive) return;
        if (game.players.length <= 1) return;

        game.players.pop();

        if (game.currentPlayerIndex >= game.players.length) {
            game.currentPlayerIndex = 0;
        }

        renderUIForState();
    };
}

// Call once during app bootstrap
initUI();
initActionButtonHandlers();
initLocalPlayerButtons();