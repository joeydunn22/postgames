# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Postgames is a static website (plain HTML/CSS/vanilla JS, no build step, no package manager, no tests) with Firebase Realtime Database for multiplayer. Remote: `github.com/joeydunn22/postgames`. The only real feature is **Top 10 Trivia** (`pages/top10.html`); `debates.html`, `movies.html`, `snacks.html` are "coming soon" placeholders.

## Vision

Postgames is a website (eventually an app) for people, mostly guys, coming home from the bar and looking for something to do. The planned features are sports trivia, a movie selector and a snack finder. **Current focus is sports trivia**; leave the other pages alone unless asked.

Trivia data is currently copied by hand from Baseball/Football Reference leaderboards and built with `scripts/build_trivia_data.py`. The long-term goal is to pull it from an API automatically so each season doesn't need manual parsing, but that is future work.

## Working with the owner

- **Take the lead.** The owner is not an experienced coder. Make the technical calls yourself and give a clear recommendation rather than a menu of options; the owner will almost always go with it. Ask them only about design choices (look, feel, gameplay).
- **Go step by step; don't build the future state early.** This project is a learning experience the owner enjoys taking incrementally. Don't introduce the API, an app wrapper, frameworks or build tooling ahead of time — solve the current step well and leave those for later.
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

1. `top10-state.js` — all shared state. `game` holds the current game; the fields listed in `SYNCED_DEFAULTS` (`state`, `sport`, `category`, `year`, `stat`, `players: [{id, name, score}]`, `currentPlayerIndex`, `guessed: [{answer, by}]`, `roundComplete`, `lastGuess`) are exactly what's mirrored to Firebase; `data`/`dataStatus` are local. Also room state (`currentUser`, `currentRoomCode`, `hostId`, `roomMembers`, `endVotes`, `roomStatus`), `session`, `dataManifest`, and helpers `inRoom()`, `isHost()` (always true off-room), `hasData()`, `newLocalPlayer()`.
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

`data/manifest.json` lists every playable sport/category/year and its file; the game greys out anything not listed and loads files through it. Game files are `data/{sport}/{year}/{category or "stats"}.json`: an array of `{ label, players: [{ rank, name, team, value }], more_tied? }`. `value` is the display text exactly as the source prints it (".331", "68.5%"); `more_tied` counts tied-for-10th players the source didn't list. Only MLB 2025 (batting, pitching) and NFL 2025 exist so far.

To add or rebuild data, save the Reference leaderboard page as text to `data/{sport}/{year}/raw/{year}-{category or sport}.txt`, then run from the repo root:

```
python scripts/build_trivia_data.py mlb batting 2025
python scripts/build_trivia_data.py mlb pitching 2025
python scripts/build_trivia_data.py nfl 2025
```

It keeps every row ranked 10 or better (ties included, in source order — never re-sort by value, some stats are lower-is-better), applies `LABEL_FIXES`, writes the game file and updates the manifest. MLB leaderboards only give last names: first names come from `data/mlb/{year}/raw/mlbplayers{year}.txt`, with ambiguous ones asked interactively and every answer remembered in `data/mlb/first_names.json` (keyed `Last|TEAM`; edit it to fix a name).
