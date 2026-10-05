# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Postgames is a static website (plain HTML/CSS/vanilla JS, no build step, no package manager, no tests) with Firebase Realtime Database for multiplayer. Remote: `github.com/joeydunn22/postgames`; the live site is GitHub Pages at `joeydunn22.github.io/postgames`. The local copy lives at `C:/Users/josep/Claude Code/Postgames`, deliberately outside OneDrive (a OneDrive move once left a partial copy, and syncing fights with git). The only real feature is **Top 10 Trivia** (`pages/top10.html`), with two daily challenges (`pages/top10-daily.html` Who's Missing, `pages/top10-topshelf.html` Top Shelf) and a stats page (`pages/top10-stats.html`); `debates.html`, `movies.html`, `snacks.html` are "coming soon" placeholders.

## Vision

Postgames is a website (eventually an app) for people, mostly guys, coming home from the bar and looking for something to do. The planned features are sports trivia, a movie selector and a snack finder. **Current focus is sports trivia**; leave the other pages alone unless asked.

"Name the top 10" is the core feel the owner likes, but the format isn't fixed: other game modes and setups are welcome. Make the call on what's best; the owner will ask for changes.

Trivia data is fetched automatically from free, open sources by `scripts/build_trivia_data.py` (see Data pipeline).

## Roadmap

The future-state plan, in priority order. It sets direction only: each item is still built one step at a time, when we get to it. Tick items off (`[x]`) as they ship, add ideas as they come up, and reorder if priorities change.

### 1. Data sourcing — MOSTLY DONE

More seasons and sports add more replay value than any feature. Don't scrape Sports Reference (its terms forbid automated scraping and it rate-limits). Use free, open sources, and write static JSON files the game reads, so the site stays static.

- [x] MLB from the MLB Stats API (`statsapi.mlb.com`), full names (retired the hand-copy path and first-name lookup)
- [x] NFL from nflverse (open stats CSVs on GitHub)
- [x] Backfill: MLB 1990–2026, NFL 1999–2025
- [x] NBA from stats.nba.com, 1979-80 through 2025-26
- [ ] NFL 2026 once the season ends (or a "so far" board mid-season)
- [ ] Bring back advanced stats the free sources lack (MLB WAR, NFL QBR/Approximate Value), if an open source exists
- [ ] Add more leagues (NHL next, then others) if good free sources exist
- [x] All-time (career) boards for MLB, NBA and NFL, picked as "All-time" in the Season list (NFL totals from Wikipedia's career-leader lists, since nflverse starts in 1999)
- [x] Nightly refresh of all three sports' all-time boards (GitHub Actions; see Data pipeline). Keep it free: no paid runners or services without the owner's say-so
- [ ] Commercial-use check: MLB's and NBA.com's terms allow personal, non-commercial use; revisit before Postgames makes money. nflverse data is free to use with credit; Wikipedia's lists are CC BY-SA (credited in the NFL all-time note)

### 2. Trivia enhancements — NOW

Small gameplay additions that make a night of play more fun.

- [x] Turn timer (host setting: off / 45s / 60s / 90s; running out counts as a miss)
- [x] Random board: any sport, or random within the picked sport
- [x] Hints: one step at a time on every blank slot (league → division → team → initials; all-time: years → team → initials), voted on in rooms, and a hinted solo game isn't saved
- [ ] Revisit whether hints should cost something in group play (they're free now; everyone has to agree to one)
- [x] Era filter (host setting: All / Last 5 / Last 10 / 2010s / 2000s / Pre-2000)
- [ ] Difficulty filter (e.g. by how famous the players are), if a good signal exists
- [ ] Other game modes beyond "name the top 10" (e.g. team-based boards; see the dailies below)
- [x] Guess by picking a player from a search of everyone who played that season (replaced free-text matching, typos and nicknames)
- [ ] Revisit tap-to-guess if accidental taps turn out to be a problem in real games
- [ ] NBA positions in the guess list, if an open source answers scripts (stats.nba.com's position endpoints time out)
- [x] Track every guess: misses blocked per player, found players blocked for all, end-of-game misses list with who guessed them
- [ ] Owner is testing whether players already on the board should stay blocked for everyone (currently yes); revisit after real games

### 3. Larger game enhancements — NEXT

The owner wants to grow this into sign-in, friends and daily challenges. Agreed order (2026-10-03): solo on the device first, then a daily challenge that needs no accounts, then Google sign-in once people want bests across phones or a real leaderboard, then friends. Keep three ways to play working throughout: solo, one phone for a group, and rooms across phones.

- [x] Solo mode (one player, not in a room): three strikes, best per board and a lifetime stats page, saved on the device (localStorage, no accounts)
- [x] Daily challenge "Who's Missing?": one hidden player per day, 5 guesses, hints, streaks, shareable emoji result (see Daily challenge below)
- [x] Second daily, "Top Shelf": season, top 3 and #1's number hidden; name the season, the top 3, their order, then #1's number (see Daily challenge: Top Shelf below)
- [ ] **Next session starts here:** the owner's play-test feedback on both dailies (test mode), then tune: difficulty tiers, hidden counts, closeness tiers, points
- [ ] Owner unsure whether naming all of the top 3 is too hard on hard stats (Top Shelf always hides 3); decide after testing
- [ ] Top up the daily schedule before it runs out (`python scripts/build_daily.py`; it's built through 2027-10-03), and rebuild NFL/NBA current seasons with care, since a scheduled puzzle needs its hidden player to stay on the board
- [ ] Real login: upgrade Firebase anonymous auth to Google sign-in (keeps existing uids), and copy the phone's saved solo games up on first sign-in. Its own session: Google sign-in inside an iPhone home-screen app has popup/redirect quirks, and accounts need a privacy policy and per-user database rules
- [ ] Friends list and daily-challenge leaderboards (needs sign-in)
- [ ] More solo stats if wanted (per-era numbers): the saved game list already has what they need

### 4. Other pages — SOMEDAY

Movies and snacks wait until trivia is what people actually open. Each needs its own data source (e.g. TMDB for movies, a maps/places API for snacks), so each is a project about as big as trivia.

- [ ] Movie selector
- [ ] Snack finder
- [ ] Debates
- [x] Installable as a Progressive Web App (home-screen icon, full screen; no offline)
- [ ] Swap the placeholder "P" app icons for the owner's real icon
- [ ] Maybe a small "Add to Home Screen" hint, mainly for iPhone where there's no install prompt
- [ ] Eventually an app wrapper around the site (App Store / Play Store)

## Working with the owner

- **Take the lead.** The owner is not an experienced coder. Make the technical calls yourself and give a clear recommendation rather than a menu of options; the owner will almost always go with it. Ask them only about design choices (look, feel, gameplay).
- **Go step by step; don't build the future state early.** This project is a learning experience the owner enjoys taking incrementally. Don't introduce accounts, an app wrapper, frameworks or build tooling ahead of time — solve the current step well and leave those for later.
- **Keep the Roadmap current.** When a change ships a Roadmap item or brings up a new idea, update the Roadmap in the same commit.
- **Commit and push by default.** After finishing a change, commit it (following the versioning convention below) and push to `origin main` without asking, unless the owner says not to for that change. Run `git pull --rebase` first: the nightly job pushes data commits to `main`.
- **Write patch notes.** Update `PATCH_NOTES.md` (repo root) in the same commit as every push that changes what players get. They're real patch notes the owner shares with players, so write for players, not coders. Newest first, one entry per day: `## October 4, 2026 (v138–v142)`. Under it, `### New` for features players will notice, each a bold name plus a sentence or two on how to use it (`- **All-time leaderboards.** …`); the big ones should stand out. Then `### Improvements` and `### Fixes` as needed, one short line each. Behind-the-scenes work gets at most a short line about what players notice ("refreshed nightly"), never how it works; skip it if players notice nothing. Pushes that only change docs need no entry.
- **Explain before building bigger features.** For anything new in concept (the PWA, the guess dropdown, accounts), the owner wants a plain-language walkthrough first: what it is, the options with concrete examples, edge cases and your recommendation. Then build once they say "green light". Small follow-ups can go straight in.
- **Fairness matters a lot to the owner.** Guessing must never leak answers (the guess list searches the whole season, not the board), and rules should feel even-handed between players.
- **Check your work visually when it's about looks.** There's no browser tool, but headless Chrome can screenshot a preview page: `chrome.exe --headless=new --screenshot=out.png --window-size=600,1000 file:///.../preview.html`, then view the PNG (headless Chrome won't go narrower than about 500px). Logic can be tested by loading the real game scripts in Node with the Firebase globals stubbed (`vm.runInContext`).
- **The owner tests on their phone through the installed app.** After a push, remind them to swipe the app closed and reopen it; the footer shows the version.
- **Reorganize freely.** Move or restructure code and files whenever it makes things clearer. When you do, briefly explain where things now live and why, since that helps the owner learn the codebase.

## Running locally

Pages must be served over HTTP (`fetch` of the JSON data fails on `file://`). From the repo root:

```
python -m http.server 8000
```

Then open `http://localhost:8000/pages/top10.html`. Multiplayer requires two browser windows (use one normal + one private, since anonymous auth is per-browser-profile).

## Versioning convention

Commits are titled `vNNN | <summary>`, and each commit bumps the `Version NNN` footer line in `pages/top10.html` to match, **and** the `?v=NNN` stamp on every local CSS/JS link in every page (`index.html` and `pages/*.html`). The stamp makes phones load a new version's files together instead of mixing new and cached ones (GitHub Pages lets browsers cache files for 10 minutes). Keep all of these in sync when committing. Data JSON is fetched with `cache: "no-cache"` instead, so it needs no stamp. The exceptions to `vNNN` titles are the nightly job's commits: `data | nightly all-time refresh` (only `data/`) and `keepalive | …` (only `.github/keepalive`).

## Visual design

Dark "late night at the bar" look: near-black background, a single amber accent (`--accent`), condensed display type (Big Shoulders Display) for headlines and numbers, DM Sans for body text. Layout is open and flowing — sections are separated by spacing and thin rules, not boxes or cards. Design mobile-first (players are on their phones).

- `assets/global/global.css` — design tokens (`:root` variables) and shared components: `.site-header`/`.brand`/`.site-nav`, `.btn` / `.btn-primary` / `.link-btn`, `.chip`, `.input` / `.select`, `.display` / `.eyebrow` / `.lede` / `.hint`. Reuse these rather than restyling per page.
- `assets/home/home.css` — home page and the "coming soon" placeholder pages.
- `assets/top10/css/top10.css` — trivia only.
- Every page loads the two Google Fonts in its `<head>`, followed by the favicon and the app (PWA) tags; copy that whole block when adding a page, fixing the `../` prefixes.

## Installable app (PWA)

The site installs to a phone's home screen as a Progressive Web App. `manifest.webmanifest` (repo root) gives the app name, colors, icons and start page (the home page), and opens it full screen (`standalone`), so there is no browser back button: every page must keep a way home (the POSTGAMES logo). Icons are in `assets/icons/` (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png` at 180px); the current ones are placeholders, and replacing them is just overwriting those files at the same sizes. Each page's `<head>` links the manifest and has iPhone-specific meta tags.

There is deliberately **no service worker** (the owner chose no offline mode), so nothing is cached beyond normal browser caching, and players get the latest version after a push once they reopen the app (the installed app resumes the open page rather than reloading; swiping it closed and reopening is the fix). The `?v=NNN` stamps (see Versioning convention) keep a new version's files from mixing with cached old ones. Installing needs HTTPS, which GitHub Pages provides; on iPhone the home-screen app has its own storage, so it signs in as a new anonymous Firebase user.

## Top 10 Trivia architecture

`pages/top10.html` inlines the Firebase init as a module and exposes the SDK on `window` (`db`, `auth`, `ref`, `set`, `onValue`, `remove`, `get`, `onAuthStateChanged`, `signInAnonymously`). Six **plain `defer` scripts** (not modules) then run in order from `assets/top10/js/`. As classic scripts, every top-level `let`/`const`/`function` in one file is visible to the others — no imports/exports, and no two files may declare the same top-level name. Fetch paths are relative to `pages/top10.html` (e.g. `../data/manifest.json`).

1. `top10-common.js` — helpers every trivia page uses: `escapeHTML()`, `ALL_TIME` and `formatSeason()` ("All-time" for it), `divisionOf()` (a team's league and division that season, from `data/divisions.json`), `formatTeam()`, `teamTagFor(sport, team)`, `boardContextLabel()`, `initials()`, `statQualifier()` (the note under a rate stat's name, e.g. "Qualified pitchers only: 1 inning per team game", shown on the play screen and the daily), `SPORT_LABELS`, the player search (`normalize`, `withSearchWords`, `matchPlayers`, `GUESS_MIN_LETTERS`/`GUESS_RESULTS`) and `dailySummaryHTML()`, plus the daily pages' shared plumbing (`fetchData`, `shareOrCopy`, `timeToNextPuzzle`, test-mode flag and `fiveTaps`, `replayClass`). No state, no Firebase.
2. `top10-records.js` — everything saved on the phone: solo games and daily results (see below). Touches neither the DOM nor Firebase.
3. `top10-state.js` — all shared state. `game` holds the current game; the fields listed in `SYNCED_DEFAULTS` (`state`, `sport`, `category`, `year`, `stat`, `era`, `timerSeconds`, `players: [{id, name, score}]`, `currentPlayerIndex`, `turnEndsAt`, `hintLevel`, `guessed: [{id, by}]`, `misses: [{id, name, by}]`, `roundComplete`, `lastGuess`) are exactly what's mirrored to Firebase; `data`/`roster`/`dataStatus`/`strikes`/`soloResult` are local (`emptyGameData()` resets them). Also room state (`currentUser`, `currentRoomCode`, `hostId`, `roomMembers`, `endVotes`, `hintVotes`, `roomStatus`), `session`, `dataManifest`, `divisionTable`, and helpers `inRoom()`, `isAllTime()`, `isHost()` (always true off-room), `isSolo()`, `struckOut()`, `roundOver()`, `hasData()`, `availableYears()`, `serverNow()`, `randomItem()`, `newLocalPlayer()`. `TIMER_OPTIONS` lists the timer choices; `ERAS` holds the era tests, and `playableEntries()` is the manifest filtered to the picked era (`hasData()` and `availableYears()` go through it); all-time boards belong to no era and only show with All.
4. `top10-teams.js` — `TEAM_COLORS`: one standout color per team code, per sport, and `teamColor()`, which brightens dark ones (keeping hue) until they read on the background. Add a code here when new teams show up in the data.
5. `top10-render.js` — the only file that touches the DOM. `render()` redraws from state after any change, showing one of the setup / playing / results sections. Event handlers call logic actions (`selectSport`, `submitGuess`, `voteToEndGame`, …) and never change state themselves. Startup runs on `DOMContentLoaded` because rendering uses helpers from the logic file. Anything interpolated into `innerHTML` must go through `escapeHTML()` — names and guesses come from other players. `teamTag(team)` is `teamTagFor` with the game's sport.
6. `top10-logic.js` — actions and rules: sign-in, rooms and their Firebase listeners, setup actions, game flow (`startGame` / `endGame` / `newGame`), end-game voting, guessing, data loading, and the player search for guesses. Never touches the DOM: change state, then call `render()`.

### Three ways to play

- **Solo:** not in a room, one player on the phone. Three strikes (`SOLO_STRIKES`) and you're out: a wrong guess or a timeout is a strike (`game.strikes`, shown as ✗✗✗ on the scoreboard). Finished games are saved on the phone (below).
- **One phone:** not in a room, 2-4 players passing the phone. No strikes; play until the board's cleared or End Game.
- **Room:** everyone on their own phone (Multiplayer model below). No strikes, nothing saved on the phone.

`roundOver()` (board cleared, or solo struck out) is what stops guessing; `finishTurn()` then shows results after a short delay instead of passing the turn.

### Solo mode and saved games

`top10-records.js` keeps every finished solo game in localStorage under `postgames.top10.solo` as `{ version: 1, games: [{ sport, category, year, stat, score, total, strikes, timer, at }] }`, oldest first. Nothing else is stored: bests and totals are worked out from that list (`bestOnBoard()`, `summarizeGames()`), so new stats need no new saving, and the list is what gets copied up to an account once sign-in exists. Every localStorage call is wrapped in try/catch (private browsing can block it); the game still plays, it just doesn't save. `recordSoloGame()` runs in `endGame` when solo, skips a game quit before any guess or one that used hints (`soloResult: { hinted: true }`, said on the results screen), and sets `game.soloResult` (`{ previousBest, newBest }`) for the results line. Setup shows "Your best: 7 of 10" for the picked board (solo only). `pages/top10-stats.html` + `top10-stats.js` show the daily record, then solo lifetime totals, per-sport rows and the best on every board played, with a reset (solo only). The iPhone home-screen app and Safari have separate storage, so they keep separate stats.

### Daily challenge: Who's Missing?

`pages/top10-daily.html` + `top10-daily.js` (loads `top10-common`, `top10-teams`, `top10-records`; no Firebase). One top-10 board a day with one player hidden; everyone gets the same one. The board shows every other name, team and value, and the hidden player's value. Five guesses (`DAILY_GUESSES`): a miss, or tapping "Take a hint", uses one and unlocks the next hint: league/conference → division → team + position (NBA: team) → initials. The hint button goes away once all four are out. After a miss or a hint, the line under the guess box says what happened and shows the hint it unlocked (it's visible with the keyboard up, unlike the hint list above); the new hint row also flashes. Finishing drops the keyboard and scrolls to the result. Guessing uses the same season-wide search as the game; board players and your own misses are greyed out. Finished: answer revealed on the board, a share button (phone share sheet, else clipboard: `Postgames Daily #N · MLB 2005 ERA` / `❌💡✅ 3/5` / link), streaks and how many guesses each solve took, time to the next puzzle. The puzzle changes at the phone's local midnight (`localDateKey()`); the installed app reloads it on resume if the date changed.

- **Schedule:** `data/daily.json` = `{ start, puzzles: [{ sport, category, year, stat, rank, id, league, division }] }`, `puzzles[0]` is Daily #1 on `start` (2026-10-03). The page finds the hidden player on the board by `id`. `league`/`division` are worked out by the script because the data files don't have them.
- **`scripts/build_daily.py`** keeps every existing day and adds days through `DAYS_AHEAD` (365) from today; `--check` only checks the division table. Its tables:
  - `DAILY_STATS`: which stats the daily uses, each `easy` or `hard`. `RECENT_SEASONS` (15): recent seasons use every listed stat; older ones only easy stats (old boards in niche stats are near impossible). `HIDE_RANKS`: which ranks can be hidden (recent easy 1-10, recent hard 1-5, older easy 1-5).
  - `RECENT_SHARE` (0.6) of days use recent seasons. Each day picks evenly a sport (never yesterday's), era, season, stat, then player, so niche stats get their turn. A board is never reused.
  - Never hidden: players traded mid-season (no single team/division) and players in a bottom tie with players left off the board (`more_tied`).
  - `MLB_DIVISIONS` / `NFL_DIVISIONS` / `NBA_DIVISIONS` (+ `NBA_MOVES`), in `scripts/divisions.py`, give each team's league and division by season, realignments included. The script refuses to run if any team on any board lacks one; add new team codes there. It also rewrites `data/divisions.json`, which the game's hints read.
- **Saved:** `postgames.top10.daily` = `{ version: 1, days: { "YYYY-MM-DD": { number, marks: ["miss"|"hint"|"correct"], missIds, done, solved, at } } }`, written after every guess so closing the app never resets the day. `dailySummary()` gives played, solved, current/best streak (days in a row solved; a miss or fail resets) and the guess distribution. The trivia setup screen's daily cards (one per daily) show today's result and streak; they're hidden in rooms. The home page links both dailies, and each daily's finished screen links the other.
- **Test mode** (for the owner, both dailies): tap "Daily #N" five times, or open the page with `?test`. A red bar lets you step to any day's puzzle (‹ ›) and Replay it. It saves under `postgames.top10.daily-test`, never touching the real record or streak; the flag itself is `postgames.top10.daily-test-on`. Tap five times again (or Exit) to leave.
- Static site, so someone determined could read the answer from the data files; accepted for now.

### Daily challenge: Top Shelf

`pages/top10-topshelf.html` + `top10-topshelf.js` (same scripts as Who's Missing). A board with the season, the top 3 (`hidden`) names and every value hidden; the sport, the stat (with its qualifier) and ranks 4-10's names and teams are shown. Four rounds, saved after every step:

1. **The season:** pick from the sport's seasons (from `manifest.json`), `SHELF_SEASON_TRIES` (3) tries, no hints (owner's call).
2. **The top 3:** name them in any order via the season search, `SHELF_PLAYER_MISSES` (3) misses. Found names go in a tray under the box, not their slots, so the order stays hidden. A miss lists their teams, a second their initials, both alphabetical by name so nothing hints at the order. Visible board players, found ones and your misses are greyed out in the list.
3. **The order:** all three names are revealed (alphabetical); tap them into #1, #2, #3 (Undo, then Lock it in). Locking reveals the real top 3 on the board, green where your order was right.
4. **#1's number:** typed blind (no other values shown, owner's call); `valueTier()` scores exact (to the shown precision) / within 3% / within 10% / further. Batting averages can be typed ".331" or "331".

Points (`shelfPoints()`): season 3/2/1 by try (0 if missed) + 1 per top player named + 1 per player in the right spot (`orderCorrect`) + number 3/2/1/0; max 12. Values show only at the end. Share: `Season ❌✅ · Top 3 ✅❌✅ · Order ✅❌❌ · #1 🟩` and points. Saved under `postgames.top10.topshelf` (test mode `…-test`) with `loadDailyDays`/`saveDailyDay`; entries carry `v: 2`, and older-format entries (from the first, stat-guessing version) are ignored and start over. `shelfSummary()` gives played, average/best points and streaks of days played. Test mode is shared with Who's Missing.

Schedule: `daily.json`'s `top_shelf` list (`{ sport, category, year, stat, hidden }`), same day numbering. `build_daily.py` picks it like Who's Missing: a daily stat for that era (older seasons easy stats only), `SHELF_HIDDEN` (3) hidden, no ties among the top four (the order must be clear), never the same sport as that day's Who's Missing or yesterday's Top Shelf when avoidable. It never repeats its own board within a year and stays 30 days from a board Who's Missing uses (the NFL has too few seasons to keep the two fully apart).

### Multiplayer model (host-authoritative)

Firebase layout per room: `rooms/{CODE}/host`, `players/{uid}` (display name), `gameState` (the `SYNCED_DEFAULTS` fields), `pendingGuess/{uid}`, `endVotes/{uid}`, `session`.

- Only the host changes game state, then calls `syncGameState()` to `set` the whole `gameState`. That includes setup picks, so non-hosts see the sport/season/stat live. Non-hosts send guesses (a player id) to `pendingGuess`; the host applies them only if it's that player's turn.
- Every client applies `gameState` in `onGameStateChange`. Firebase drops empty arrays and nulls, so every field falls back to its `SYNCED_DEFAULTS` value when missing — add new synced fields there and this is handled automatically.
- `game.players` in a room is rebuilt from `roomMembers` (names, room order) plus synced scores (`roomPlayers()`).
- Listeners are stored in `_roomUnsubscribers` and switched off on leaving. If the host leaves, the first remaining member claims `host`. The last player out deletes the room.
- **Ending a game:** off-room, End Game ends immediately; in a room each player toggles `endVotes/{uid}` and the host ends it once everyone has voted. Clearing the board auto-ends after a short delay. Only the host sees "New Game".
- **Session ("Tonight") leaderboard:** `recordGameResult()` runs once per game in `endGame` and adds points/games per player id to `session.players`; a win goes only to an outright top scorer (ties and one-player games award none). In a room the host writes it to `rooms/{CODE}/session`; off-room it lives in memory. Ids are Firebase uids in rooms and `local-N` on one device, so renames don't split a record. Leaving a room resets to a fresh local game and session.
- **Hints:** `hintLevel` (synced) counts the hint steps given, and each shows on every slot still blank: season boards league/conference → division → team + position → initials; all-time boards career years → main team + position → initials (`hintSteps()`, `slotHint()`). League and division come from `data/divisions.json`; position and years from the guess list; a player traded mid-season shows "2 teams" for the league/division steps. Off-room the Hint button gives the next step at once; in a room each player toggles `hintVotes/{uid}` (`toggleMyVote()`, shared with End Game) and the host gives the hint once everyone has voted (`checkHintVotes()`). Hints cost nothing, but a solo game with hints isn't saved.
- **Era:** `era` (a key of `ERAS`) is a host setup choice that limits the sport chips, Season list and Random to seasons in that era. "Last 5/10" count back from each sport's newest season; decades use the season's start year (NBA 2000 = 1999-00, so it's Pre-2000). Changing era drops a picked season that falls outside it.
- **Random board:** `pickRandomBoard(sport?)` (host) picks, within the era, a sport evenly (so MLB's extra files don't dominate), then any manifest entry for it, waits for `loadStats()`, then a random stat. It only fills the picks; the host still presses Start.
- **Turn timer:** `timerSeconds` (0 = off) is a host setup choice. `startTurnClock()` sets `turnEndsAt` in *server* time (`serverNow()` = local clock + Firebase's `.info/serverTimeOffset`) whenever a turn starts, so all phones count down together. Only the host runs `checkTurnClock()` (every 250 ms): at the deadline it records a `timeout` guess (a strike, solo) and calls `finishTurn()`. The renderer redraws just the countdown every 250 ms (`renderTurnClock()`).
- `game.lastGuess` (`{ playerName, id, guess, answer, result: correct|wrong|timeout, at }`; `guess` is the picked player's name, `answer` the board name or null) is synced so everyone sees feedback; the renderer animates only guesses newer than the last one it drew.

**Guessing is picking, not typing.** Players type into the guess box and pick from a list; free text can't be submitted, so there's no name matching, typo tolerance or nicknames. `searchRoster()` searches `game.roster`, everyone who played that season (never just the board, so the list gives nothing away). Nothing shows under `GUESS_MIN_LETTERS` (3) letters. Every typed word must start a word of the name, ignoring accents and punctuation ("aj bro" → A.J. Brown, "amon" → Amon-Ra St. Brown). At most `GUESS_RESULTS` (5) show, in surname order, with "… N more" when more match. Each row shows the team as a colored tag (`teamTag()`, also used on the board) and position (NBA: team only), and players you can't pick are greyed out (see below). Tapping a row guesses immediately (`pickGuess` → `submitGuess(id)`); on a keyboard, arrow keys + Enter work, and Enter alone picks a lone result. Guesses are matched to the board by player id, so same-named players (two Josh Allens) never get mixed up.

**Every guess is tracked:** correct ones in `guessed`, wrong ones in `misses` (with who made them). `guessStatus(playerId, guesserId)` decides what can be picked: a player already found is blocked for everyone (green "✓ On the board · who"), and a player you missed with is blocked for you only (red "✗ You missed"). Others can still try a player someone else got wrong, and other people's misses never show in your list. The host checks the same rule, ignoring a blocked pick without costing the turn. The results screen lists everyone's misses, one row per player guessed with who guessed them, most-guessed first (`renderMisses()`).

## Data pipeline

`data/manifest.json` lists every playable sport/category/year and its file; the game offers only what's listed (sport chips grey out, the Season dropdown lists available years newest first) and loads files through it. Game files are `data/{sport}/{year}/{category or "stats"}.json`: an array of `{ label, group, players: [{ rank, id, name, team, value }], more_tied? }`; `group` is the stat's section in the Stat dropdown (Passing, Rushing, …), set from `STAT_GROUPS` in the script, which also fixes the stats' order. Next to them, `data/{sport}/{year}/players.json` lists everyone who played that season, one `{ id, name, team, pos }` per line, sorted by surname: the guess list. `loadStats()` fetches both, and `id` is the source's player id (MLB person id, nflverse gsis id, NBA player id). `value` is display text (".331", "68.5%"); `team` is `2TM`/`3TM` for MLB players traded mid-season; `more_tied` counts a tie at the bottom left off the board. Current data: MLB 1990–2026 (batting, pitching), NFL 1999–2025, NBA 1979-80 to 2025-26, plus all-time boards for all three. NBA seasons are keyed by the year they end (`2025` = 2024-25); the page shows them as "2024-25" via `formatSeason()` in `top10-common.js`.

`scripts/build_trivia_data.py` fetches and builds everything (standard library only, no API keys). Run from the repo root with a year or range:

```
python scripts/build_trivia_data.py mlb 2026
python scripts/build_trivia_data.py mlb 1990-2026
python scripts/build_trivia_data.py nfl 1999-2025
python scripts/build_trivia_data.py nba 1980-2026
python scripts/build_trivia_data.py mlb all
python scripts/build_trivia_data.py nba all
python scripts/build_trivia_data.py nfl all
```

- **MLB** uses the Stats API's league leaders (one request per season per category, plus three for the season's player list). The API ranks, marks ties and applies rate-stat qualifiers itself. Stats and their labels are in `MLB_STATS`.
- **NFL** downloads nflverse's regular-season player totals (one CSV per season) and ranks each stat in `nfl_stats()`. Rate stats use Pro Football Reference's per-team-game qualifiers. nflverse uses today's team codes for every season, and `NFL_MOVES` maps them back (e.g. 2003 Rams → STL). Its tackle counts come from play-by-play and can differ slightly from official totals. Rows with no player name are team totals for uncredited plays and are skipped.
- **NBA** uses stats.nba.com's league leaders (the site behind NBA.com's stats pages), one request per stat per season, with browser-like headers because it rejects anything else. It applies the NBA's own qualifiers. Percentages only work in `Totals` mode, and a few categories (e.g. `GP`) aren't supported. Stats are in `NBA_STATS`, and `NBA_TEAM_FIXES` maps its odd old team codes (UTH → UTA). A full backfill takes about 20 minutes because of the polite delay between requests.
- **All-time boards** use the year `"all"` (`ALL_TIME`): `data/{sport}/all/…`, listed first in the manifest and shown as "All-time" at the top of the Season list. MLB uses the Stats API's career leaders (MLB applies its own career minimums and includes the Negro Leagues, part of its official record since 2024). NBA takes one "All Time" totals request covering every player and ranks it with career minimums (400 games for per-game stats; 2,000 / 250 / 1,200 makes for FG% / 3P% / FT%). A board player's `team` is the one they played the most games for (MLB from each player's season-by-season lines, by franchise, shown with the code from their last season there; NBA from each season's player list). The all-time `players.json` is everyone who ever played, `{ id, name, pos, years }` ("1966–1993"), with no team, since only board players have one and showing it would give them away. The guess list shows the years. NBA years are missing for the earliest few seasons, which the source has no lists for. NFL: no open source has full careers as numbers (nflverse starts in 1999), so the boards come from Wikipedia's "List of NFL career … leaders" pages (`NFL_CAREER_STATS`: page, value column, format; read with the MediaWiki API and a small HTML table reader, `WikiTables`), and the players from nflverse's season rosters, 1920 on (`nfl_all_time_players()`): guess list, career years and main team (most seasons; seasons marked retired or free agent don't count, `NFL_OFF_ROSTER`). Each Wikipedia name is matched to a roster player by name (initials run together, suffixes dropped), then seasons, then position; `NFL_NAME_FIXES` covers nicknames (Dick Lane → Night Train Lane), and the board keeps Wikipedia's spelling. The script warns about any name it can't match. Old roster team codes are mapped to familiar ones (`NFL_ROSTER_TEAM_FIXES`). `statQualifier()` notes the minimums for all-time boards and which team is shown (most games; NFL most seasons), and credits Wikipedia on NFL ones. The dailies skip all-time boards.
- **Nightly refresh:** `.github/workflows/nightly-all-time.yml` runs at 08:00 UTC on GitHub Actions (free and unlimited for this public repo; keep it free). It runs `mlb all`, `nba all` and `nfl all`, each allowed to fail on its own, and commits `data/` only if something changed. GitHub pauses scheduled jobs after 60 days without a commit, so on a quiet night with no commit in 45 days (`KEEPALIVE_DAYS`) it writes the date to `.github/keepalive` (never read by the site) and commits that as `keepalive | …`. The all-time builders never write a partial build: any failed request stops that sport (only next season's list, which may not exist yet, is allowed to be missing), so a bad night keeps the previous boards. The run's Report step names any sport that didn't refresh. Start a run by hand with `gh workflow run nightly-all-time.yml`; see results with `gh run list --workflow nightly-all-time.yml`. Only all-time boards refresh: the dailies need season boards to stay fixed.
- `scripts/divisions.py` holds the league/division tables (used by `build_daily.py`) and writes them to `data/divisions.json` for the game's hints; run it (or `build_daily.py`) after changing a table.
- MLB and NBA sources work from a home connection but may block cloud/datacenter IPs, so run the script locally.
- `top_ten()` keeps everyone ranked 10th or better. A tie at the bottom that would push a board past 15 is dropped into `more_tied`. A board with fewer than 5 players, or where everyone is tied, is skipped for that season.
- Every build also writes the season's `players.json` (`write_players_file`): MLB from `sports/1/players?season=` plus the season's batting/pitching lines for teams; NFL from the same nflverse CSV; NBA from the league-leaders endpoint in Totals mode (everyone who played, no position). It adds any board player missing from the list, with a warning, and uses the board's spelling of names, so every answer can always be picked.
- To add a stat, add a line to `MLB_STATS`, `NBA_STATS` or `nfl_stats()`, list its label under a group in `STAT_GROUPS`, and rerun the seasons.
- `data/daily.json` (the daily schedule) is built separately by `scripts/build_daily.py` (see Daily challenge). It refers to boards by stat label and player id, so renaming a stat label means updating it there too.
