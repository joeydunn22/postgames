/* ============================================================
   TOP 10 — GLOBAL STATE (must exist before logic/render)
   ============================================================ */

// Multiplayer identity + room state
window.currentUser = null;
window.myPlayerId = null;
window.currentRoomCode = null;
window.roomActive = false;
window.hostId = null;

// Core game state (shared by single + multiplayer)
window.game = {
    state: "setup",            // "setup" | "playing" | "results"
    currentPlayerIndex: 0,

    players: [],               // [{ id, name, guesses[], score }]
    playerNames: {},           // multiplayer name map (uid → {name})

    globalGuessed: [],         // ["aaron_judge", ...]

    sport: null,
    category: null,
    year: null,
    stat: null,

    authReady: false,          // set true when Firebase auth resolves

    // LOCAL ONLY (not synced)
    data: {}                   // loaded JSON stat data
};


/* ============================================================
   TOP 10 — UI REFERENCES
   ============================================================ */

window.ui = {};   // ensure global

function initUI() {
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

    // Results area
    ui.resultsSection = document.getElementById('resultsSection');
    ui.resultsWinner = document.getElementById('resultsWinner');
    ui.resultsPlayers = document.getElementById('resultsPlayers');

    // Controls / misc
    ui.actionButton = document.getElementById('actionButton');
    ui.sportButtons = document.getElementById('sport-buttons');
    ui.mlbCategoryButtons = document.getElementById('mlb-category-buttons');
    ui.yearButtons = document.getElementById('year-buttons');
}


/* ============================================================
   TOP 10 — ACTION BUTTON HANDLER
   ============================================================ */

function initActionButtonHandlers() {
    if (!ui.actionButton) return;

    ui.actionButton.onclick = () => {
        const s = game.state;

        // Only host can advance phases in multiplayer
        if (roomActive && myPlayerId !== hostId) return;

        if (s === "setup") {
            startGame();
        }
        else if (s === "playing") {
            applyEndGame(game);
        }
        else if (s === "results") {
            resetGame();
        }

        // Sync state if host in multiplayer
        if (roomActive && myPlayerId === hostId) {
            syncGameState();
        }
    };
}


/* ============================================================
   TOP 10 — LOCAL PLAYER ADD/REMOVE
   ============================================================ */

function initLocalPlayerButtons() {
    const addBtn = ui.addPlayerBtn;
    const removeBtn = ui.removePlayerBtn;

    if (!addBtn || !removeBtn) return;

    addBtn.onclick = () => {
        if (roomActive) return;
        if (game.players.length >= 4) return;

        game.players.push({
            id: crypto.randomUUID(),
            name: `Player ${game.players.length + 1}`,
            guesses: [],
            score: 0
        });

        renderUIForState(game);
    };

    removeBtn.onclick = () => {
        if (roomActive) return;
        if (game.players.length <= 1) return;

        game.players.pop();

        if (game.currentPlayerIndex >= game.players.length) {
            game.currentPlayerIndex = 0;
        }

        renderUIForState(game);
    };
}


/* ============================================================
   INITIALIZE UI + BUTTONS
   ============================================================ */

initUI();
initActionButtonHandlers();
initLocalPlayerButtons();