/* ============================================================
   TOP 10 — RENDER HELPERS
   ============================================================ */

/* Render player name input fields */
function renderPlayerSetup() {
    ui.playerNameInputs.innerHTML = "";

    game.players.forEach((player, index) => {
        const input = document.createElement("input");
        input.type = "text";
        input.value = player.name;
        input.className = "player-name-input";

        input.addEventListener("input", () => {
            player.name = input.value.trim() || `Player ${index + 1}`;
            updateDisplayedNames();
            renderList();
        });

        ui.playerNameInputs.appendChild(input);
    });
}

/* Reset stat dropdown and title */
function resetStatUI() {
    game.stat = null;

    ui.statSelect.disabled = true;
    ui.statSelect.innerHTML = `<option value="">Select a stat...</option>`;

    const titleEl = ui.statTitle;
    if (titleEl) {
        titleEl.textContent = "Select a stat to begin";
    }
}

/* Populate stat dropdown with loaded stats */
function populateStatDropdown() {
    ui.statSelect.disabled = false;
    ui.statSelect.innerHTML = `<option value="">Select a stat...</option>`;

    const stats = Object.keys(game.data);

    stats.forEach(stat => {
        const option = document.createElement("option");
        option.value = stat;
        option.textContent = stat.replace(/_/g, " ").toUpperCase();
        ui.statSelect.appendChild(option);
    });
}

/* Update displayed player names across UI */
function updateDisplayedNames() {
    const currentPlayerDisplay = ui.currentPlayerDisplay;
    if (currentPlayerDisplay) {
        currentPlayerDisplay.textContent =
            `Current Turn: ${game.players[game.currentPlayerIndex].name}`;
    }

    ui.playersContainer.querySelectorAll(".player-column h3")
        .forEach((header, index) => {
            if (game.players[index]) {
                header.textContent = game.players[index].name;
            }
        });

    ui.resultsSection.querySelectorAll(".player-column h3")
        .forEach((header, index) => {
            if (game.players[index]) {
                header.textContent = game.players[index].name;
            }
        });
}


/* ============================================================
   TOP 10 — MAIN RENDER FUNCTIONS
   ============================================================ */

/* Render a single player column */
function renderPlayerColumn(col, player, index, isPercent) {
    col.classList.remove("current-player");
    if (index === game.currentPlayerIndex) {
        col.classList.add("current-player");
    }

    const guessesHTML = player.guesses.map(g => {
        const displayValue = isPercent ? g.value + "%" : g.value;
        return `<li>${g.name} — ${g.team} — ${displayValue}</li>`;
    }).join("");

    col.innerHTML = `
        <h3>${player.name}</h3>
        <ul>${guessesHTML}</ul>
        <div class="player-score">Score: ${player.score}</div>
    `;
}

/* Render the full Top 10 list */
function renderList() {
    if (!game.stat || !game.data[game.stat]) {
        return;
    }

    const stat = game.data[game.stat];
    const list = stat.players;
    const isPercent = stat.isPercent;

    let html = "<ol>";
    for (let i = 0; i < list.length; i++) {
        const normalized = normalize(list[i].name);
        const displayValue = isPercent ? list[i].value + "%" : list[i].value;

        if (game.globalGuessed.includes(normalized)) {
            html += `<li class="revealed">${list[i].name} — ${list[i].team} — ${displayValue}</li>`;
        } else {
            html += "<li>__________</li>";
        }
    }
    html += "</ol>";
    ui.top10List.innerHTML = html;

    ui.currentPlayerDisplay.textContent =
        "Current Turn: " + game.players[game.currentPlayerIndex].name;

    updateGuessInputLock();

    const container = ui.playersContainer;

    container.style.justifyContent =
        game.players.length === 1 ? "center" : "space-between";

    container.classList.toggle("single-player", game.players.length === 1);

    while (container.children.length < game.players.length) {
        const col = document.createElement("div");
        col.classList.add("player-column");
        container.appendChild(col);
    }
    while (container.children.length > game.players.length) {
        container.removeChild(container.lastChild);
    }

    game.players.forEach((player, index) => {
        const col = container.children[index];
        renderPlayerColumn(col, player, index, isPercent);
    });
}


/* ============================================================
   TOP 10 — RESULTS RENDERING
   ============================================================ */

/* Render final results screen */
function renderResults() {
    const stat = game.data[game.stat];
    const list = stat.players;
    const isPercent = stat.isPercent;

    let highest = Math.max(...game.players.map(p => p.score));
    let winners = game.players.filter(p => p.score === highest);

    let winnerText = "";
    if (winners.length === 1) {
        winnerText = `${winners[0].name} wins!`;
    } else {
        winnerText = "It's a tie!";
    }

    ui.resultsWinner.textContent = winnerText;

    ui.resultsPlayers.innerHTML = "";

    game.players.forEach(player => {
        const div = document.createElement("div");
        div.className = "player-column";

        const guessesHTML = player.guesses.map(g => {
            const displayValue = isPercent ? g.value + "%" : g.value;
            return `<li>${g.name} — ${g.team} — ${displayValue}</li>`;
        }).join("");

        div.innerHTML = `
            <h3>${player.name}</h3>
            <div class="player-score">${player.score} correct</div>
            <ul>${guessesHTML}</ul>
        `;

        ui.resultsPlayers.appendChild(div);
    });

    // visibility toggles: now class-based
    ui.resultsSection.classList.remove("hidden");
    ui.currentPlayerDisplay.classList.add("hidden");
    ui.playersContainer.classList.add("hidden");

    // leave these as-is for now (we'll clean them later if needed)
    document.getElementById("addPlayerBtn").style.display = "inline-block";
    document.getElementById("removePlayerBtn").style.display = "inline-block";
}