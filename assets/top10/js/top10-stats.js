/* ============================================================
   TOP 10 — STATS PAGE (pages/top10-stats.html)
   Daily challenge record, then lifetime numbers from the solo games
   saved on this phone (see top10-records.js). Everything is worked out fresh from the saved
   list each time the page opens.
   ============================================================ */

const BOARDS_SHOWN = 20;   // boards listed before "Show all"
let _showAllBoards = false;

function formatAverage(n) {
    return n.toFixed(1);
}

// Big numbers across the top
function renderTotals(games) {
    const totals = summarizeGames(games);
    const tiles = [
        ["Games", totals.games],
        ["Avg score", formatAverage(totals.average)],
        ["Perfect", totals.perfect],
        ["Players found", totals.found]
    ];
    document.getElementById("statsTotals").innerHTML = tiles.map(([label, value]) => `
        <div class="stats-total">
            <span class="stats-total-num">${value}</span>
            <span class="stats-total-label">${label}</span>
        </div>`).join("");
}

// One row per sport played, most played first
function renderSports(games) {
    const bySport = new Map();
    for (const g of games) {
        if (!bySport.has(g.sport)) bySport.set(g.sport, []);
        bySport.get(g.sport).push(g);
    }
    const rows = [...bySport]
        .map(([sport, list]) => ({ sport, ...summarizeGames(list) }))
        .sort((a, b) => b.games - a.games);

    document.getElementById("statsSports").innerHTML = `
        <div class="stats-cols" aria-hidden="true"><span></span><span>Games</span><span>Avg</span><span>Perfect</span></div>
        <ol class="stats-list">
            ${rows.map(row => `
                <li class="stats-row">
                    <span class="stats-sport">${escapeHTML(SPORT_LABELS[row.sport] || row.sport)}</span>
                    <span class="stats-num">${row.games}</span>
                    <span class="stats-num">${formatAverage(row.average)}</span>
                    <span class="stats-num">${row.perfect}</span>
                </li>`).join("")}
        </ol>`;
}

// Best score on each board, most recently played first
function renderBoards(games) {
    const boards = new Map();
    for (const g of games) {
        const key = boardKey(g);
        const board = boards.get(key) || { ...g, best: 0, plays: 0, last: 0 };
        board.best = Math.max(board.best, g.score);
        board.total = g.total;
        board.plays += 1;
        board.last = Math.max(board.last, g.at);
        boards.set(key, board);
    }
    const rows = [...boards.values()].sort((a, b) => b.last - a.last);
    const shown = _showAllBoards ? rows : rows.slice(0, BOARDS_SHOWN);

    document.getElementById("statsBoards").innerHTML = shown.map(board => `
        <li class="stats-board ${board.best === board.total ? "perfect" : ""}">
            <span class="stats-board-main">
                <span class="stats-board-stat">${escapeHTML(board.stat)}</span>
                <span class="stats-board-context">${escapeHTML(boardContextLabel(board))} · played ${board.plays}×</span>
            </span>
            <span class="stats-board-best">${board.best}<span class="stats-board-total">/${board.total}</span></span>
        </li>`).join("");

    const moreBtn = document.getElementById("statsMoreBtn");
    moreBtn.classList.toggle("hidden", rows.length <= shown.length);
    moreBtn.textContent = `Show all ${rows.length} boards`;
}

function renderDaily() {
    const summary = dailySummary();
    document.getElementById("statsDaily").classList.toggle("hidden", summary.played === 0);
    if (summary.played) document.getElementById("statsDailySummary").innerHTML = dailySummaryHTML(summary);

    const shelfStats = shelfSummary(loadDailyDays(SHELF_KEY));
    document.getElementById("statsShelf").classList.toggle("hidden", shelfStats.played === 0);
    const tiles = [["Played", shelfStats.played], ["Avg pts", shelfStats.average.toFixed(1)],
                   ["Best", shelfStats.best], ["Streak", shelfStats.streak]];
    document.getElementById("statsShelfSummary").innerHTML = `<div class="stats-totals">${tiles.map(([label, value]) =>
        `<div class="stats-total"><span class="stats-total-num">${value}</span><span class="stats-total-label">${label}</span></div>`).join("")}</div>`;
}

function renderStats() {
    renderDaily();
    const games = loadSoloGames();
    document.getElementById("statsEmpty").classList.toggle("hidden", games.length > 0);
    document.getElementById("statsBody").classList.toggle("hidden", games.length === 0);
    if (games.length === 0) return;

    renderTotals(games);
    renderSports(games);
    renderBoards(games);
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("statsMoreBtn").addEventListener("click", () => {
        _showAllBoards = true;
        renderStats();
    });
    document.getElementById("statsResetBtn").addEventListener("click", () => {
        if (!confirm("Erase all your solo stats on this phone? This can't be undone.")) return;
        clearSoloGames();
        renderStats();
    });
    renderStats();
});
