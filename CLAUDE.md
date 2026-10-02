# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Postgames is a static website (plain HTML/CSS/vanilla JS, no build step, no package manager, no tests) with Firebase Realtime Database for multiplayer. Remote: `github.com/joeydunn22/postgames`. The only real feature is **Top 10 Trivia** (`pages/top10.html`); `debates.html`, `movies.html`, `snacks.html` are "coming soon" placeholders.

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
- [ ] Career and all-time leaderboards (e.g. "top 10 career home runs")
- [ ] Commercial-use check: MLB's and NBA.com's terms allow personal, non-commercial use; revisit before Postgames makes money. nflverse data is free to use with credit

### 2. Trivia enhancements — NOW

Small gameplay additions that make a night of play more fun.

- [x] Turn timer (host setting: off / 45s / 60s / 90s; running out counts as a miss)
- [x] Random board: any sport, or random within the picked sport
- [ ] "Pass" option on your turn
- [ ] Hints (reveal a team or first letter, maybe at a point cost)
- [x] Era filter (host setting: All / Last 5 / Last 10 / 2010s / 2000s / Pre-2000)
- [ ] Difficulty filter (e.g. by how famous the players are), if a good signal exists
- [ ] Other game modes beyond "name the top 10" (e.g. guess the stat from the list, team-based boards)
- [x] Guess by picking a player from a search of everyone who played that season (replaced free-text matching, typos and nicknames)
- [ ] Revisit tap-to-guess if accidental taps turn out to be a problem in real games
- [ ] NBA positions in the guess list, if an open source answers scripts (stats.nba.com's position endpoints time out)

### 3. Larger game enhancements — NEXT

- [ ] Proper solo mode with personal bests saved on the device (localStorage, no accounts)
- [ ] Real login: upgrade Firebase anonymous auth to Google sign-in (keeps existing uids), once there's something worth saving across devices
- [ ] Lifetime stats and records, friends/groups

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
- **Commit and push by default.** After finishing a change, commit it (following the versioning convention below) and push to `origin main` without asking, unless the owner says not to for that change.
- **Reorganize freely.** Move or restructure code and files whenever it makes things clearer. When you do, briefly explain where things now live and why, since that helps the owner learn the codebase.

## Running locally

Pages must be served over HTTP (`fetch` of the JSON data fails on `file://`). From the repo root:

```
python -m http.server 8000
```

Then open `http://localhost:8000/pages/top10.html`. Multiplayer requires two browser windows (use one normal + one private, since anonymous auth is per-browser-profile).

## Versioning convention

Commits are titled `vNNN | <summary>`, and each commit bumps the `Version NNN` footer line in `pages/top10.html` to match. Keep these in sync when committing.

## Visual design

Dark "late night at the bar" look: near-black background, a single amber accent (`--accent`), condensed display type (Big Shoulders Display) for headlines and numbers, DM Sans for body text. Layout is open and flowing — sections are separated by spacing and thin rules, not boxes or cards. Design mobile-first (players are on their phones).

- `assets/global/global.css` — design tokens (`:root` variables) and shared components: `.site-header`/`.brand`/`.site-nav`, `.btn` / `.btn-primary` / `.link-btn`, `.chip`, `.input` / `.select`, `.display` / `.eyebrow` / `.lede` / `.hint`. Reuse these rather than restyling per page.
- `assets/home/home.css` — home page and the "coming soon" placeholder pages.
- `assets/top10/css/top10.css` — trivia only.
- Every page loads the two Google Fonts in its `<head>`, followed by the favicon and the app (PWA) tags; copy that whole block when adding a page, fixing the `../` prefixes.

## Installable app (PWA)

The site installs to a phone's home screen as a Progressive Web App. `manifest.webmanifest` (repo root) gives the app name, colors, icons and start page (the home page), and opens it full screen (`standalone`), so there is no browser back button: every page must keep a way home (the POSTGAMES logo). Icons are in `assets/icons/` (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png` at 180px); the current ones are placeholders, and replacing them is just overwriting those files at the same sizes. Each page's `<head>` links the manifest and has iPhone-specific meta tags.

There is deliberately **no service worker** (the owner chose no offline mode), so nothing is cached beyond normal browser caching and players always get the latest version after a push. Installing needs HTTPS, which GitHub Pages provides; on iPhone the home-screen app has its own storage, so it signs in as a new anonymous Firebase user.

## Top 10 Trivia architecture

`pages/top10.html` inlines the Firebase init as a module and exposes the SDK on `window` (`db`, `auth`, `ref`, `set`, `onValue`, `remove`, `get`, `onAuthStateChanged`, `signInAnonymously`). Three **plain `defer` scripts** (not modules) then run in order from `assets/top10/js/`. As classic scripts, every top-level `let`/`const`/`function` in one file is visible to the others — no imports/exports, and no two files may declare the same top-level name. Fetch paths are relative to `pages/top10.html` (e.g. `../data/manifest.json`).

1. `top10-state.js` — all shared state. `game` holds the current game; the fields listed in `SYNCED_DEFAULTS` (`state`, `sport`, `category`, `year`, `stat`, `era`, `timerSeconds`, `players: [{id, name, score}]`, `currentPlayerIndex`, `turnEndsAt`, `guessed: [{id, by}]`, `roundComplete`, `lastGuess`) are exactly what's mirrored to Firebase; `data`/`roster`/`dataStatus` are local (`emptyGameData()` resets them). Also room state (`currentUser`, `currentRoomCode`, `hostId`, `roomMembers`, `endVotes`, `roomStatus`), `session`, `dataManifest`, and helpers `inRoom()`, `isHost()` (always true off-room), `hasData()`, `availableYears()`, `serverNow()`, `randomItem()`, `newLocalPlayer()`. `TIMER_OPTIONS` lists the timer choices; `GUESS_MIN_LETTERS`/`GUESS_RESULTS` set the guess search; `ERAS` holds the era tests, and `playableEntries()` is the manifest filtered to the picked era (`hasData()` and `availableYears()` go through it).
2. `top10-render.js` — the only file that touches the DOM. `render()` redraws from state after any change, showing one of the setup / playing / results sections. Event handlers call logic actions (`selectSport`, `submitGuess`, `voteToEndGame`, …) and never change state themselves. Startup runs on `DOMContentLoaded` because rendering uses helpers from the logic file. Anything interpolated into `innerHTML` must go through `escapeHTML()` — names and guesses come from other players.
3. `top10-logic.js` — actions and rules: sign-in, rooms and their Firebase listeners, setup actions, game flow (`startGame` / `endGame` / `newGame`), end-game voting, guessing, data loading, and the player search for guesses. Never touches the DOM: change state, then call `render()`.

### Multiplayer model (host-authoritative)

Firebase layout per room: `rooms/{CODE}/host`, `players/{uid}` (display name), `gameState` (the `SYNCED_DEFAULTS` fields), `pendingGuess/{uid}`, `endVotes/{uid}`, `session`.

- Only the host changes game state, then calls `syncGameState()` to `set` the whole `gameState`. That includes setup picks, so non-hosts see the sport/season/stat live. Non-hosts send guesses (a player id) to `pendingGuess`; the host applies them only if it's that player's turn.
- Every client applies `gameState` in `onGameStateChange`. Firebase drops empty arrays and nulls, so every field falls back to its `SYNCED_DEFAULTS` value when missing — add new synced fields there and this is handled automatically.
- `game.players` in a room is rebuilt from `roomMembers` (names, room order) plus synced scores (`roomPlayers()`).
- Listeners are stored in `_roomUnsubscribers` and switched off on leaving. If the host leaves, the first remaining member claims `host`. The last player out deletes the room.
- **Ending a game:** solo, End Game ends immediately; in a room each player toggles `endVotes/{uid}` and the host ends it once everyone has voted. Clearing the board auto-ends after a short delay. Only the host sees "New Game".
- **Session ("Tonight") leaderboard:** `recordGameResult()` runs once per game in `endGame` and adds points/games per player id to `session.players`; a win goes only to an outright top scorer (ties and one-player games award none). In a room the host writes it to `rooms/{CODE}/session`; off-room it lives in memory. Ids are Firebase uids in rooms and `local-N` on one device, so renames don't split a record. Leaving a room resets to a fresh local game and session.
- **Era:** `era` (a key of `ERAS`) is a host setup choice that limits the sport chips, Season list and Random to seasons in that era. "Last 5/10" count back from each sport's newest season; decades use the season's start year (NBA 2000 = 1999-00, so it's Pre-2000). Changing era drops a picked season that falls outside it.
- **Random board:** `pickRandomBoard(sport?)` (host) picks, within the era, a sport evenly (so MLB's extra files don't dominate), then any manifest entry for it, waits for `loadStats()`, then a random stat. It only fills the picks; the host still presses Start.
- **Turn timer:** `timerSeconds` (0 = off) is a host setup choice. `startTurnClock()` sets `turnEndsAt` in *server* time (`serverNow()` = local clock + Firebase's `.info/serverTimeOffset`) whenever a turn starts, so all phones count down together. Only the host runs `checkTurnClock()` (every 250 ms): at the deadline it records a `timeout` guess and calls `nextTurn()`. The renderer redraws just the countdown every 250 ms (`renderTurnClock()`).
- `game.lastGuess` (`{ playerName, id, guess, answer, result: correct|wrong|repeat|timeout, at }`; `guess` is the picked player's name, `answer` the board name or null) is synced so everyone sees feedback; the renderer animates only guesses newer than the last one it drew.

**Guessing is picking, not typing.** Players type into the guess box and pick from a list; free text can't be submitted, so there's no name matching, typo tolerance or nicknames. `searchRoster()` searches `game.roster`, everyone who played that season (never just the board, so the list gives nothing away). Nothing shows under `GUESS_MIN_LETTERS` (3) letters. Every typed word must start a word of the name, ignoring accents and punctuation ("aj bro" → A.J. Brown, "amon" → Amon-Ra St. Brown). At most `GUESS_RESULTS` (5) show, in surname order, with "… N more" when more match. Each row shows team and position (NBA: team only), and players already on the board are greyed out. Tapping a row guesses immediately (`pickGuess` → `submitGuess(id)`); on a keyboard, arrow keys + Enter work, and Enter alone picks a lone result. Guesses are matched to the board by player id, so same-named players (two Josh Allens) never get mixed up.

## Data pipeline

`data/manifest.json` lists every playable sport/category/year and its file; the game offers only what's listed (sport chips grey out, the Season dropdown lists available years newest first) and loads files through it. Game files are `data/{sport}/{year}/{category or "stats"}.json`: an array of `{ label, players: [{ rank, id, name, team, value }], more_tied? }`. Next to them, `data/{sport}/{year}/players.json` lists everyone who played that season, one `{ id, name, team, pos }` per line, sorted by surname: the guess list. `loadStats()` fetches both, and `id` is the source's player id (MLB person id, nflverse gsis id, NBA player id). `value` is display text (".331", "68.5%"); `team` is `2TM`/`3TM` for MLB players traded mid-season; `more_tied` counts a tie at the bottom left off the board. Current data: MLB 1990–2026 (batting, pitching), NFL 1999–2025, NBA 1979-80 to 2025-26. NBA seasons are keyed by the year they end (`2025` = 2024-25); the page shows them as "2024-25" via `formatSeason()` in the renderer.

`scripts/build_trivia_data.py` fetches and builds everything (standard library only, no API keys). Run from the repo root with a year or range:

```
python scripts/build_trivia_data.py mlb 2026
python scripts/build_trivia_data.py mlb 1990-2026
python scripts/build_trivia_data.py nfl 1999-2025
python scripts/build_trivia_data.py nba 1980-2026
```

- **MLB** uses the Stats API's league leaders (one request per season per category). The API ranks, marks ties and applies rate-stat qualifiers itself. Stats and their labels are in `MLB_STATS`.
- **NFL** downloads nflverse's regular-season player totals (one CSV per season) and ranks each stat in `nfl_stats()`. Rate stats use Pro Football Reference's per-team-game qualifiers. nflverse uses today's team codes for every season, and `NFL_MOVES` maps them back (e.g. 2003 Rams → STL). Its tackle counts come from play-by-play and can differ slightly from official totals. Rows with no player name are team totals for uncredited plays and are skipped.
- **NBA** uses stats.nba.com's league leaders (the site behind NBA.com's stats pages), one request per stat per season, with browser-like headers because it rejects anything else. It applies the NBA's own qualifiers. Percentages only work in `Totals` mode, and a few categories (e.g. `GP`) aren't supported. Stats are in `NBA_STATS`, and `NBA_TEAM_FIXES` maps its odd old team codes (UTH → UTA). A full backfill takes about 20 minutes because of the polite delay between requests.
- MLB and NBA sources work from a home connection but may block cloud/datacenter IPs, so run the script locally.
- `top_ten()` keeps everyone ranked 10th or better. A tie at the bottom that would push a board past 15 is dropped into `more_tied`. A board with fewer than 5 players, or where everyone is tied, is skipped for that season.
- Every build also writes the season's `players.json` (`write_players_file`): MLB from `sports/1/players?season=` plus the season's batting/pitching lines for teams; NFL from the same nflverse CSV; NBA from the league-leaders endpoint in Totals mode (everyone who played, no position). It adds any board player missing from the list, with a warning, and uses the board's spelling of names, so every answer can always be picked.
- To add a stat, add a line to `MLB_STATS`, `NBA_STATS` or `nfl_stats()` and rerun the seasons.
