/* ============================================================
   TOP 10 — SAVED RECORDS
   Solo games and daily challenges saved on this phone (localStorage),
   shared by the trivia, daily and stats pages. Never touches the page.

   Solo games are saved as one list of finished games, oldest first:
     { version: 1, games: [{ sport, category, year, stat, score, total,
                             strikes, timer, at }] }
   Every best and total is worked out from that list, so new stats need
   no new saving, and the whole list can be copied to an account later.
   ============================================================ */

const RECORDS_KEY = "postgames.top10.solo";

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


/* ============================================================
   DAILY CHALLENGE
   One entry per day played, saved after every guess so closing the
   app mid-puzzle never resets it:
     { version: 1, days: { "2026-10-03": { number, marks, missIds,
                                           done, solved, at } } }
   marks: one per guess used, "miss" | "hint" | "correct".
   Test mode (see top10-daily.js) saves the same way under
   DAILY_TEST_KEY, so it never touches the real record.
   ============================================================ */

const DAILY_KEY = "postgames.top10.daily";
const DAILY_TEST_KEY = "postgames.top10.daily-test";
const DAILY_GUESSES = 5;

function loadDailyDays(key = DAILY_KEY) {
    try {
        const saved = JSON.parse(localStorage.getItem(key));
        return saved?.days && typeof saved.days === "object" ? saved.days : {};
    } catch {
        return {};
    }
}

// Save one day's progress; null removes the day
function saveDailyDay(date, entry, key = DAILY_KEY) {
    const days = { ...loadDailyDays(key), [date]: entry };
    if (!entry) delete days[date];
    try {
        localStorage.setItem(key, JSON.stringify({ version: 1, days }));
    } catch (error) {
        console.error("Couldn't save the daily:", error);
    }
}

// "YYYY-MM-DD" for the phone's local date, so the puzzle changes at your midnight
function localDateKey(date = new Date()) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
        .map((n, i) => String(n).padStart(i ? 2 : 4, "0")).join("-");
}

// The date key `days` after (or before) another
function addDays(key, days) {
    const [y, m, d] = key.split("-").map(Number);
    return localDateKey(new Date(y, m - 1, d + days));
}

// Whole days from one date key to another
function daysBetween(fromKey, toKey) {
    const utc = key => Date.UTC(...key.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
    return Math.round((utc(toKey) - utc(fromKey)) / 86400000);
}

// Played, solved, streaks (days in a row solved) and how many guesses
// each solve took. The current streak survives until a day is missed or
// failed, so it still counts this morning before today's is played.
function dailySummary(days = loadDailyDays(), today = localDateKey()) {
    const finished = Object.entries(days).filter(([, d]) => d.done).sort(([a], [b]) => a.localeCompare(b));
    const distribution = Array(DAILY_GUESSES).fill(0);
    let best = 0, run = 0, previous = null;

    for (const [date, day] of finished) {
        if (day.solved) {
            distribution[day.marks.length - 1] += 1;
            run = previous && daysBetween(previous, date) === 1 ? run + 1 : 1;
            previous = date;
            best = Math.max(best, run);
        } else {
            run = 0;
            previous = null;
        }
    }
    const current = previous && daysBetween(previous, today) <= 1 ? run : 0;
    const solved = distribution.reduce((a, b) => a + b, 0);

    return { played: finished.length, solved, streak: current, bestStreak: best, distribution };
}


/* ============================================================
   TOP SHELF
   Saved like the daily above (loadDailyDays / saveDailyDay with these
   keys), one entry per day:
     { v: 2, number, hidden, stage: "season" | "players" | "order" | "value" | "done",
       seasonGuesses: [years], seasonSolved, playerGuesses: [{ id, hit }],
       order: [ids, your #1 first], orderCorrect: how many in the right spot,
       valueGuess,
       valueTier: "exact" | "close" | "near" | "far", done, at }
   Points: see shelfRoundPoints(). Entries without v: 2 are from an older format and start over.
   ============================================================ */

const SHELF_KEY = "postgames.top10.topshelf";
const SHELF_TEST_KEY = "postgames.top10.topshelf-test";
const SHELF_SEASON_TRIES = 3;
const SHELF_PLAYER_MISSES = 3;
const SHELF_VALUE_POINTS = { exact: 3, close: 2, near: 1, far: 0 };

// Points per round. Season: 3/2/1 by try. Top 3: 1 per name, plus a
// bonus point for naming them all without a miss, so only a mistake-free
// day gets the max. Order: 1 per right spot. Number: 3/2/1/0 by closeness.
function shelfRoundPoints(day, hidden) {
    const guesses = day.playerGuesses || [];
    const found = guesses.filter(g => g.hit).length;
    const clean = found === hidden && guesses.length === hidden;
    return {
        season: day.seasonSolved ? SHELF_SEASON_TRIES + 1 - day.seasonGuesses.length : 0,
        players: found + (clean ? 1 : 0),
        order: day.orderCorrect || 0,
        value: SHELF_VALUE_POINTS[day.valueTier] ?? 0
    };
}

function shelfRoundMax(hidden) {
    return { season: SHELF_SEASON_TRIES, players: hidden + 1, order: hidden, value: SHELF_VALUE_POINTS.exact };
}

// Days saved before `hidden` was kept all hid 3
function shelfPoints(day) {
    return Object.values(shelfRoundPoints(day, day.hidden || 3)).reduce((a, b) => a + b, 0);
}

function shelfMaxPoints(hidden = 3) {
    return Object.values(shelfRoundMax(hidden)).reduce((a, b) => a + b, 0);
}

// Played, average and best points, and streaks of days in a row played
function shelfSummary(days, today = localDateKey()) {
    const finished = Object.entries(days).filter(([, d]) => d.done && d.v === 2).sort(([a], [b]) => a.localeCompare(b));
    let best = 0, run = 0, bestStreak = 0, previous = null, total = 0;
    for (const [date, day] of finished) {
        const points = shelfPoints(day);
        total += points;
        best = Math.max(best, points);
        run = previous && daysBetween(previous, date) === 1 ? run + 1 : 1;
        bestStreak = Math.max(bestStreak, run);
        previous = date;
    }
    return {
        played: finished.length,
        average: finished.length ? total / finished.length : 0,
        best,
        streak: previous && daysBetween(previous, today) <= 1 ? run : 0,
        bestStreak
    };
}

/* ============================================================
   TODAY'S DAILIES
   Whether each daily is done today and a one-line result, for the
   cards that link to them (home page and the trivia setup screen).
   null when today's isn't finished.
   ============================================================ */
function todaysDailyResults(today = localDateKey()) {
    const missing = loadDailyDays()[today];
    const shelf = loadDailyDays(SHELF_KEY)[today];
    const streak = n => (n > 1 ? ` · ${n}-day streak` : "");
    return {
        missing: missing?.done
            ? (missing.solved ? `Solved in ${missing.marks.length}/${DAILY_GUESSES}` : "Not today") + streak(dailySummary().streak)
            : null,
        shelf: shelf?.done && shelf.v === 2
            ? `Scored ${shelfPoints(shelf)}/${shelfMaxPoints(shelf.hidden || 3)}` + streak(shelfSummary(loadDailyDays(SHELF_KEY)).streak)
            : null
    };
}
