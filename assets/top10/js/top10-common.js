/* ============================================================
   TOP 10 — COMMON HELPERS
   Loaded first on every trivia page (the game, the daily, the stats
   page): formatting and the player search. No game state, no Firebase.
   ============================================================ */

const SPORT_LABELS = { mlb: "MLB", nba: "NBA", nfl: "NFL" };

// Guess search: names show once this many letters are typed, at most
// GUESS_RESULTS at a time
const GUESS_MIN_LETTERS = 3;
const GUESS_RESULTS = 5;

// Names and guesses can come from other players via Firebase, so never
// put them into innerHTML without escaping
function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
}

// NBA seasons span two years and are stored by the year they end:
// 2025 is shown as "2024-25"
function formatSeason(sport, year) {
    if (!year) return "";
    return sport === "nba" ? `${year - 1}-${String(year).slice(-2)}` : String(year);
}

// The data uses "2TM"/"3TM" for players traded mid-season
function formatTeam(team) {
    const multi = /^(\d)TM$/.exec(team);
    return multi ? `${multi[1]} teams` : team;
}

// A team code as a small tag in the team's color (see top10-teams.js)
function teamTagFor(sport, team, extraClass = "") {
    if (!team) return "";
    const color = teamColor(sport, team);
    const style = color ? ` style="--team: ${color}"` : "";
    return `<span class="team-tag ${color ? "has-color" : ""} ${extraClass}"${style}>${escapeHTML(formatTeam(team))}</span>`;
}

// "MLB · Batting · 2023"
function boardContextLabel({ sport, category, year }) {
    const cat = category && category[0].toUpperCase() + category.slice(1);
    return [SPORT_LABELS[sport] || sport, cat, formatSeason(sport, year)].filter(Boolean).join(" · ");
}


/* ============================================================
   PLAYER SEARCH
   Guesses are picked from everyone who played that season, never just
   the board, so the list gives nothing away. Every typed word must be
   the start of a word in the name ("aj bro" finds A.J. Brown), ignoring
   accents and punctuation. No typo or nickname matching: you pick the
   exact player.
   ============================================================ */
function normalize(text) {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Words a search can start with. "Amon-Ra St. Brown": amonra, amon, ra, st, brown
function withSearchWords(player) {
    const pieces = player.name.split(/\s+/).flatMap(word => [word, ...word.split("-")]);
    return { ...player, full: normalize(player.name), words: [...new Set(pieces.map(normalize).filter(Boolean))] };
}

// Up to GUESS_RESULTS roster players matching what's typed, in the
// roster's (surname) order, and how many more matched. null below the
// letter minimum.
function matchPlayers(roster, query) {
    const typed = query.split(/\s+/).map(normalize).filter(Boolean);
    if (typed.join("").length < GUESS_MIN_LETTERS) return null;

    const matches = roster.filter(player =>
        typed.every(part => player.words.some(word => word.startsWith(part))) ||
        player.full.startsWith(typed.join("")));

    return { players: matches.slice(0, GUESS_RESULTS), more: Math.max(0, matches.length - GUESS_RESULTS) };
}


/* ============================================================
   DAILY SUMMARY
   Played / win % / streaks, then how many guesses each solve took
   (see dailySummary in top10-records.js). `highlight` marks today's
   row on the daily page.
   ============================================================ */
function dailySummaryHTML(summary, highlight = null) {
    const winPct = summary.played ? Math.round((summary.solved / summary.played) * 100) : 0;
    const tiles = [["Played", summary.played], ["Win %", winPct], ["Streak", summary.streak], ["Best streak", summary.bestStreak]];
    const most = Math.max(1, ...summary.distribution);

    return `
        <div class="stats-totals">
            ${tiles.map(([label, value]) => `
                <div class="stats-total">
                    <span class="stats-total-num">${value}</span>
                    <span class="stats-total-label">${label}</span>
                </div>`).join("")}
        </div>
        <ol class="daily-dist" aria-label="Guesses needed">
            ${summary.distribution.map((count, i) => `
                <li class="daily-dist-row ${highlight === i + 1 ? "today" : ""}">
                    <span class="daily-dist-label">${i + 1}</span>
                    <span class="daily-dist-bar" style="width: ${Math.max(8, (count / most) * 100)}%">${count}</span>
                </li>`).join("")}
        </ol>`;
}
