/* ============================================================
   TOP 10 — SOLO RECORDS
   Solo games saved on this phone (localStorage), shared by the trivia
   page and the stats page. Never touches the page.

   Saved as one list of finished games, oldest first:
     { version: 1, games: [{ sport, category, year, stat, score, total,
                             strikes, timer, at }] }
   Every best and total is worked out from that list, so new stats need
   no new saving, and the whole list can be copied to an account later.
   ============================================================ */

const RECORDS_KEY = "postgames.top10.solo";

const SPORT_LABELS = { mlb: "MLB", nba: "NBA", nfl: "NFL" };

// NBA seasons span two years and are stored by the year they end:
// 2025 is shown as "2024-25"
function formatSeason(sport, year) {
    if (!year) return "";
    return sport === "nba" ? `${year - 1}-${String(year).slice(-2)}` : String(year);
}

// One board = sport + category + season + stat
function boardKey({ sport, category, year, stat }) {
    return [sport, category || "", year, stat].join("|");
}

// localStorage can be missing or blocked (private browsing), so every
// read and write is guarded: the game still plays, it just can't save
function loadSoloGames() {
    try {
        const saved = JSON.parse(localStorage.getItem(RECORDS_KEY));
        return Array.isArray(saved?.games) ? saved.games : [];
    } catch {
        return [];
    }
}

function saveSoloGames(games) {
    try {
        localStorage.setItem(RECORDS_KEY, JSON.stringify({ version: 1, games }));
    } catch (error) {
        console.error("Couldn't save solo games:", error);
    }
}

function addSoloGame(record) {
    saveSoloGames([...loadSoloGames(), record]);
}

function clearSoloGames() {
    try {
        localStorage.removeItem(RECORDS_KEY);
    } catch {}
}

// Best score and number of plays on one board, or null if never played
function bestOnBoard(board, games = loadSoloGames()) {
    const key = boardKey(board);
    const scores = games.filter(g => boardKey(g) === key).map(g => g.score);
    return scores.length ? { best: Math.max(...scores), plays: scores.length } : null;
}

// Totals for a list of games
function summarizeGames(games) {
    const found = games.reduce((sum, g) => sum + g.score, 0);
    return {
        games: games.length,
        found,
        average: games.length ? found / games.length : 0,
        perfect: games.filter(g => g.score === g.total).length
    };
}
