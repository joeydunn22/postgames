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
- [ ] NFL 2026 once the season ends (or a "so far" board mid-season)
- [ ] Bring back advanced stats the free sources lack (MLB WAR, NFL QBR/Approximate Value), if an open source exists
- [ ] Add more sports (NBA, NHL) if good free sources exist
- [ ] Career and all-time leaderboards (e.g. "top 10 career home runs")
- [ ] Commercial-use check: MLB's terms allow personal, non-commercial use; revisit before Postgames makes money. nflverse data is free to use with credit

### 2. Trivia enhancements — NOW

Small gameplay additions that make a night of play more fun.

- [ ] Turn timer (host setting: off / 30s / 60s)
- [ ] "Pass" option on your turn
- [ ] Random board button
- [ ] Hints (reveal a team or first letter, maybe at a point cost)
- [ ] Era/difficulty filter now that there are many seasons
- [ ] Other game modes beyond "name the top 10" (e.g. guess the stat from the list, team-based boards)
- [ ] Looser guess matching where it's still too strict (nicknames, common misspellings)

### 3. Larger game enhancements — NEXT

- [ ] Proper solo mode with personal bests saved on the device (localStorage, no accounts)
- [ ] Real login: upgrade Firebase anonymous auth to Google sign-in (keeps existing uids), once there's something worth saving across devices
- [ ] Lifetime stats and records, friends/groups

### 4. Other pages — SOMEDAY

Movies and snacks wait until trivia is what people actually open. Each needs its own data source (e.g. TMDB for movies, a maps/places API for snacks), so each is a project about as big as trivia.

- [ ] Movie selector
- [ ] Snack finder
- [ ] Debates
- [ ] Eventually an app wrapper around the site

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
- Every page loads the two Google Fonts in its `<head>`; copy that block when adding a page.

## Top 10 Trivia architecture

`pages/top10.html` inlines the Firebase init as a module and exposes the SDK on `window` (`db`, `auth`, `ref`, `set`, `onValue`, `remove`, `get`, `onAuthStateChanged`, `signInAnonymously`). Three **plain `defer` scripts** (not modules) then run in order from `assets/top10/js/`. As classic scripts, every top-level `let`/`const`/`function` in one file is visible to the others — no imports/exports, and no two files may declare the same top-level name. Fetch paths are relative to `pages/top10.html` (e.g. `../data/manifest.json`).

1. `top10-state.js` — all shared state. `game` holds the current game; the fields listed in `SYNCED_DEFAULTS` (`state`, `sport`, `category`, `year`, `stat`, `players: [{id, name, score}]`, `currentPlayerIndex`, `guessed: [{answer, by}]`, `roundComplete`, `lastGuess`) are exactly what's mirrored to Firebase; `data`/`dataStatus` are local. Also room state (`currentUser`, `currentRoomCode`, `hostId`, `roomMembers`, `endVotes`, `roomStatus`), `session`, `dataManifest`, and helpers `inRoom()`, `isHost()` (always true off-room), `hasData()`, `availableYears()`, `newLocalPlayer()`.
2. `top10-render.js` — the only file that touches the DOM. `render()` redraws from state after any change, showing one of the setup / playing / results sections. Event handlers call logic actions (`selectSport`, `submitGuess`, `voteToEndGame`, …) and never change state themselves. Startup runs on `DOMContentLoaded` because rendering uses helpers from the logic file. Anything interpolated into `innerHTML` must go through `escapeHTML()` — names and guesses come from other players.
3. `top10-logic.js` — actions and rules: sign-in, rooms and their Firebase listeners, setup actions, game flow (`startGame` / `endGame` / `newGame`), end-game voting, guessing, data loading, and guess matching. Never touches the DOM: change state, then call `render()`.

### Multiplayer model (host-authoritative)

Firebase layout per room: `rooms/{CODE}/host`, `players/{uid}` (display name), `gameState` (the `SYNCED_DEFAULTS` fields), `pendingGuess/{uid}`, `endVotes/{uid}`, `session`.

- Only the host changes game state, then calls `syncGameState()` to `set` the whole `gameState`. That includes setup picks, so non-hosts see the sport/season/stat live. Non-hosts send guesses to `pendingGuess`; the host applies them only if it's that player's turn.
- Every client applies `gameState` in `onGameStateChange`. Firebase drops empty arrays and nulls, so every field falls back to its `SYNCED_DEFAULTS` value when missing — add new synced fields there and this is handled automatically.
- `game.players` in a room is rebuilt from `roomMembers` (names, room order) plus synced scores (`roomPlayers()`).
- Listeners are stored in `_roomUnsubscribers` and switched off on leaving. If the host leaves, the first remaining member claims `host`. The last player out deletes the room.
- **Ending a game:** solo, End Game ends immediately; in a room each player toggles `endVotes/{uid}` and the host ends it once everyone has voted. Clearing the board auto-ends after a short delay. Only the host sees "New Game".
- **Session ("Tonight") leaderboard:** `recordGameResult()` runs once per game in `endGame` and adds points/games per player id to `session.players`; a win goes only to an outright top scorer (ties and one-player games award none). In a room the host writes it to `rooms/{CODE}/session`; off-room it lives in memory. Ids are Firebase uids in rooms and `local-N` on one device, so renames don't split a record. Leaving a room resets to a fresh local game and session.
- `game.lastGuess` (`{ playerName, guess, answer, result: correct|wrong|repeat, at }`) is synced so everyone sees feedback; the renderer animates only guesses newer than the last one it drew.

Guess matching (`findAnswerMatch`) ignores accents and punctuation, accepts full name, first name alone or last name alone (ignoring Jr./III), and allows about one typo per five letters. A guess that fits more than one answer equally well is a miss.

## Data pipeline

`data/manifest.json` lists every playable sport/category/year and its file; the game offers only what's listed (sport chips grey out, the Season dropdown lists available years newest first) and loads files through it. Game files are `data/{sport}/{year}/{category or "stats"}.json`: an array of `{ label, players: [{ rank, name, team, value }], more_tied? }`. `value` is display text (".331", "68.5%"); `team` is `2TM`/`3TM` for MLB players traded mid-season; `more_tied` counts a tie at the bottom left off the board. Current data: MLB 1990–2026 (batting, pitching), NFL 1999–2025.

`scripts/build_trivia_data.py` fetches and builds everything (standard library only, no API keys). Run from the repo root with a year or range:

```
python scripts/build_trivia_data.py mlb 2026
python scripts/build_trivia_data.py mlb 1990-2026
python scripts/build_trivia_data.py nfl 1999-2025
```

- **MLB** uses the Stats API's league leaders (one request per season per category). The API ranks, marks ties and applies rate-stat qualifiers itself. Stats and their labels are in `MLB_STATS`.
- **NFL** downloads nflverse's regular-season player totals (one CSV per season) and ranks each stat in `nfl_stats()`. Rate stats use Pro Football Reference's per-team-game qualifiers. nflverse uses today's team codes for every season, and `NFL_MOVES` maps them back (e.g. 2003 Rams → STL). Its tackle counts come from play-by-play and can differ slightly from official totals.
- `top_ten()` keeps everyone ranked 10th or better. A tie at the bottom that would push a board past 15 is dropped into `more_tied`. A board with fewer than 5 players, or where everyone is tied, is skipped for that season.
- To add a stat, add a line to `MLB_STATS` or `nfl_stats()` and rerun the seasons.
