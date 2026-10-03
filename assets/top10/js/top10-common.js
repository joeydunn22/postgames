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

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

// "Amon-Ra St. Brown" -> "A.S.B.", "Ken Griffey Jr." -> "K.G."
function initials(name) {
    return name.split(/\s+/)
        .filter(word => !NAME_SUFFIXES.has(normalize(word)))
        .map(word => word[0].toUpperCase() + ".")
        .join("");
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


/* ============================================================
   QUALIFIERS
   Rate stats (averages, percentages, per-game) only rank players who
   played enough. The sources apply their own minimums (MLB and the NBA
   in their APIs, NFL in scripts/build_trivia_data.py following Pro
   Football Reference); this just says so under the stat name.
   ============================================================ */
const MLB_RATE_BATTING = ["Batting Average", "On-Base %", "Slugging %", "OPS (On-Base + Slugging)"];
const MLB_RATE_PITCHING = ["ERA", "WHIP", "Win %", "Hits per 9 Innings", "Strikeouts per 9 Innings",
    "Strikeout-to-Walk Ratio", "Walks per 9 Innings"];
const NFL_RATE = {
    "Completion %": [14, "pass attempts"],
    "Yards per Pass Attempt": [14, "pass attempts"],
    "Passer Rating": [14, "pass attempts"],
    "Yards per Carry": [6.25, "carries"],
    "Yards per Reception": [1.875, "catches"]
};

// A short note for a rate stat, or "" for a counting stat
function statQualifier(sport, label, year) {
    if (sport === "mlb" && MLB_RATE_BATTING.includes(label)) {
        return "Qualified hitters only: 3.1 plate appearances per team game (502 in a full season)";
    }
    if (sport === "mlb" && MLB_RATE_PITCHING.includes(label)) {
        return "Qualified pitchers only: 1 inning per team game (162 in a full season)";
    }
    if (sport === "nfl" && NFL_RATE[label]) {
        const [perGame, what] = NFL_RATE[label];
        const games = Number(year) >= 2021 ? 17 : 16;
        return `Qualified players only: ${Math.ceil(perGame * games)}+ ${what} (${perGame} per team game)`;
    }
    if (sport === "nba" && label.endsWith("%")) {
        return "Qualified players only: the NBA's minimum made shots";
    }
    if (sport === "nba" && label.endsWith("per Game")) {
        return "Qualified players only: the NBA's minimum games played";
    }
    return "";
}


/* ============================================================
   DAILY PAGES (Who's Missing, Top Shelf)
   Shared plumbing: fetching data, sharing, the countdown and test mode.
   Test mode is one switch for both dailies: five quick taps on
   "Daily #N" (or ?test in the address) turns it on. It lets you play
   any day's puzzle, saved apart from your real record.
   ============================================================ */
const DAILY_TEST_FLAG = "postgames.top10.daily-test-on";

// A file under data/ (paths are relative to pages/)
async function fetchData(path) {
    const response = await fetch(`../data/${path}`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

function timeToNextPuzzle() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const minutes = Math.max(1, Math.ceil((midnight - now) / 60000));
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

// The phone's share sheet where there is one, else copy to the clipboard;
// `statusEl` says what happened
async function shareOrCopy(text, statusEl) {
    try {
        if (navigator.share) {
            await navigator.share({ text });
            return;
        }
        await navigator.clipboard.writeText(text);
        statusEl.textContent = "Copied. Paste it in the group chat.";
    } catch (error) {
        if (error?.name !== "AbortError") statusEl.textContent = "Couldn't share. Try again.";
    }
}

function readDailyTestFlag() {
    try {
        return localStorage.getItem(DAILY_TEST_FLAG) === "1" || new URLSearchParams(location.search).has("test");
    } catch {
        return false;
    }
}

function writeDailyTestFlag(on) {
    try {
        on ? localStorage.setItem(DAILY_TEST_FLAG, "1") : localStorage.removeItem(DAILY_TEST_FLAG);
    } catch {}
}

// Calls `onToggle` after five taps within three seconds
function fiveTaps(onToggle) {
    let taps = [];
    return () => {
        const now = Date.now();
        taps = [...taps.filter(t => now - t < 3000), now];
        if (taps.length >= 5) {
            taps = [];
            onToggle();
        }
    };
}

// "today", "+2 days", "-1 day" for the test bar
function testDayLabel(number, offset) {
    const when = offset === 0 ? "today" : `${offset > 0 ? "+" : ""}${offset} day${Math.abs(offset) === 1 ? "" : "s"}`;
    return `${number ? `#${number} · ` : ""}${when}`;
}

// Replay a CSS animation class on an element
function replayClass(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
}
