/* ============================================================
   TOP 10 — EVENT LISTENERS
   ============================================================ */

/* Handle Enter key for submitting guesses */
ui.input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
        submitGuess();
    }
});

/* Handle Submit Guess button */
document.getElementById("submitGuessBtn").addEventListener("click", () => {
    submitGuess();
});

/* Handle Reveal Answers / Play Again button */
ui.actionButton.addEventListener("click", () => {
    if (game.state === "playing") {
        revealAllAnswers();
        updateActionButton();
        return;
    }

    if (game.state === "results") {
        resetGame();
        updateActionButton();
        return;
    }
});

/* Handle stat dropdown selection */
ui.statSelect.addEventListener("change", () => {
    game.stat = ui.statSelect.value;

    const titleEl = ui.statTitle;

    if (!game.stat) {
        titleEl.textContent = "Select a stat to begin";
        return;
    }

    titleEl.textContent =
        ui.statSelect.options[ui.statSelect.selectedIndex].text;

    resetGame();
});


/* ============================================================
   TOP 10 — CORE LOGIC FUNCTIONS
   ============================================================ */

/* Animate input + player column based on guess type */
function playGuessAnimation(type) {
    const inputEl = ui.input;
    const playerCol =
        document.querySelectorAll(".player-column")[game.currentPlayerIndex];

    const map = {
        correct: { input: "correct-flash", player: "player-correct" },
        duplicate: { input: "duplicate-flash", player: "player-duplicate" },
        wrong: { input: "wrong-flash", player: "player-wrong" }
    };

    const classes = map[type];
    if (!classes) return;

    inputEl.classList.remove(classes.input);
    void inputEl.offsetWidth;
    inputEl.classList.add(classes.input);
    setTimeout(() => inputEl.classList.remove(classes.input), 700);

    if (playerCol) {
        playerCol.classList.remove(classes.player);
        void playerCol.offsetWidth;
        playerCol.classList.add(classes.player);
        setTimeout(() => playerCol.classList.remove(classes.player), 700);
    }
}

/* Update the Reveal/Play Again button text */
function updateActionButton() {
    const btn = ui.actionButton;

    switch (game.state) {
        case "playing":
            btn.textContent = "Reveal Answers";
            break;
        case "results":
            btn.textContent = "Play Again";
            break;
    }
}

/* Reveal all answers and show results */
function revealAllAnswers() {
    const stat = game.data[game.stat];
    const answers = stat.players;

    game.globalGuessed = answers.map(a => normalize(a.name));

    renderList();
    renderResults();

    game.state = "results";
}

/* Reset the game for a new round */
function resetGame() {
    game.state = "playing";
    updateActionButton();

    game.currentPlayerIndex = 0;

    game.players.forEach(p => {
        p.guesses = [];
        p.score = 0;
    });

    game.globalGuessed = [];

    game.stat = ui.statSelect.value;

    ui.statTitle.innerHTML =
        game.sport.toUpperCase() + " - Top 10 " +
        ui.statSelect.selectedOptions[0].text;

    const input = ui.input;
    input.value = "";
    input.focus();

    ui.resultsSection.classList.add("hidden");
    ui.currentPlayerDisplay.classList.remove("hidden");
    ui.playersContainer.classList.remove("hidden");

    renderPlayerSetup();
    renderList();
}

/* Give up and reveal all answers */
function giveUp() {
    const answers = game.data[game.stat];

    game.globalGuessed = answers.map(a => normalize(a.name));

    renderList();
    renderResults();
}

/* Handle guess submission, scoring, and turn rotation */
function submitGuess() {
    const input = ui.input;
    const rawGuess = input.value;
    const guess = normalize(rawGuess);
    if (!guess) return;

    document.getElementById("addPlayerBtn").classList.add("hidden");
    document.getElementById("removePlayerBtn").classList.add("hidden");

    const answers = game.data[game.stat].players;

    let matches = [];
    for (let a of answers) {
        if (isMatch(guess, a.name)) matches.push(a);
    }

    if (matches.length === 0) {
        playGuessAnimation("wrong");

        requestAnimationFrame(() => {
            game.currentPlayerIndex =
                (game.currentPlayerIndex + 1) % game.players.length;
            renderList();
        });

        input.value = "";
        return;
    }

    if (matches.length > 1) {
        alert("Multiple players match:\n\n" +
            matches.map(m => m.name).join("\n"));
        input.value = "";
        return;
    }

    const matchedAnswer = matches[0];
    const normalizedAnswer = normalize(matchedAnswer.name);

    if (game.globalGuessed.includes(normalizedAnswer)) {
        playGuessAnimation("duplicate");

        requestAnimationFrame(() => {
            renderList();
        });

        input.value = "";
        return;
    }

    game.globalGuessed.push(normalizedAnswer);
    game.players[game.currentPlayerIndex].guesses.push(matchedAnswer);
    game.players[game.currentPlayerIndex].score++;

    renderList();
    playGuessAnimation("correct");

    if (game.globalGuessed.length === answers.length) {
        input.value = "";
        input.blur();
        setTimeout(() => {
            renderResults();
            game.state = "results";
            updateActionButton();
        }, 50);
        return;
    }

    requestAnimationFrame(() => {
        game.currentPlayerIndex =
            (game.currentPlayerIndex + 1) % game.players.length;
        renderList();
    });

    input.value = "";
}


/* ============================================================
   TOP 10 — MATCHING + NORMALIZATION
   ============================================================ */

/* Normalize strings for matching */
function normalize(str) {
    return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/* Determine if a guess matches an answer */
function isMatch(guess, answer) {
    const g = normalize(guess);
    const a = normalize(answer);

    if (g === a) return true;

    const parts = a.split(" ");
    const last = parts[parts.length - 1];
    const first = parts[0];

    if (g === last) return true;
    if (g === first) return true;

    if (levenshtein(g, a) <= 2) return true;
    if (levenshtein(g, last) <= 1) return true;

    return false;
}

/* Compute Levenshtein distance */
function levenshtein(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
}


/* ============================================================
   TOP 10 — GAME FLOW HELPERS
   ============================================================ */

/* Load data only when sport/category/year are selected */
function maybeLoadData() {
    const listEl = ui.top10List;
    if (listEl) listEl.innerHTML = "";

    if (!game.sport) return;

    if (game.sport === "mlb" && !game.category) return;

    if (!game.year) return;

    loadSport();
}


/* ============================================================
   TOP 10 — STAT LOADING
   ============================================================ */

/* Load sport/year/category JSON file */
/* Load sport/year/category JSON file */
function loadSport() {
    let file = "";

    if (game.sport === "mlb") {
        file = `../data/mlb/${game.year}/processed/${game.category}_${game.year}_enriched.json`;
    }
    if (game.sport === "nba") {
        file = `../data/nba/${game.year}/processed/stats_${game.year}_enriched.json`;
    }
    if (game.sport === "nfl") {
        file = `../data/nfl/${game.year}/processed/stats_${game.year}_enriched.json`;
    }

    fetch(file)
        .then(response => response.json())
        .then(data => {
            game.data = {};

            data.forEach(statBlock => {
                const statName =
                    statBlock.stat_label.toLowerCase().replace(/ /g, "_");

                game.data[statName] = {
                    players: statBlock.players.map(p => ({
                        name: `${p.first_name} ${p.player}`,
                        team: p.team,
                        value: p.value
                    })),
                    isPercent: statBlock.is_percent_stat,
                    label: statBlock.stat_label
                };
            });

            // Rebuild dropdown options
            populateStatDropdown();

            // 🔑 Reapply the currently synced stat selection (if any)
            if (game.stat) {
                ui.statSelect.value = game.stat;
            } else {
                ui.statSelect.value = "";
            }
        })
        .catch(err => console.error("Error loading data:", err));
}


/* ============================================================
   TOP 10 — INITIAL LOAD
   ============================================================ */

/* Load initial sport data (if any) */
loadSport();

/* Initialize game and UI once DOM is ready */
document.addEventListener("DOMContentLoaded", () => {

    game.players = [
        { name: "Player 1", guesses: [], score: 0 }
    ];

    renderPlayerSetup();
    renderList();

    ui.sportButtons.querySelectorAll('.pg-button').forEach(btn => {
        btn.addEventListener('click', () => {

            ui.sportButtons.querySelector('.active')?.classList.remove('active');
            btn.classList.add('active');

            game.sport = btn.dataset.sport;
            game.category = null;
            game.year = null;

            ui.mlbCategoryButtons.querySelector('.active')?.classList.remove('active');
            ui.yearButtons.querySelector('.active')?.classList.remove('active');

            resetStatUI();
            ui.statTitle.textContent = "Select a stat to begin";

            const catRow = document.getElementById("mlb-category-buttons");
            const catWrapper = document.getElementById("mlb-category-wrapper");

            // Hide both the wrapper and the buttons when not MLB
            const hideCategory = game.sport !== "mlb";
            catRow.classList.toggle("hidden", hideCategory);
            catWrapper.classList.toggle("hidden", hideCategory);

            maybeLoadData();
        });
    });

    ui.mlbCategoryButtons.querySelectorAll('.pg-button').forEach(btn => {
        btn.addEventListener('click', () => {

            ui.mlbCategoryButtons.querySelector('.active')?.classList.remove('active');
            btn.classList.add('active');

            game.category = btn.dataset.category;

            resetStatUI();
        });
    });

    ui.yearButtons.querySelectorAll('.pg-button').forEach(btn => {
        btn.addEventListener('click', () => {

            if (!game.sport) return;
            if (game.sport === "mlb" && !game.category) return;

            ui.yearButtons.querySelector('.active')?.classList.remove('active');
            btn.classList.add('active');

            game.year = btn.dataset.year;

            resetStatUI();
            maybeLoadData();
        });
    });

    const addBtn = document.getElementById("addPlayerBtn");
    const removeBtn = document.getElementById("removePlayerBtn");

    addBtn.addEventListener("click", () => {
        if (game.players.length >= 4) return;

        game.players.push({
            name: `Player ${game.players.length + 1}`,
            guesses: [],
            score: 0
        });

        renderPlayerSetup();
        renderList();
    });

    removeBtn.addEventListener("click", () => {
        if (game.players.length <= 1) return;

        game.players.pop();

        if (game.currentPlayerIndex >= game.players.length) {
            game.currentPlayerIndex = 0;
        }

        renderPlayerSetup();
        renderList();
    });

});