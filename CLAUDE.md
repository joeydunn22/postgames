# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Postgames is a static website (plain HTML/CSS/vanilla JS, no build step, no package manager, no tests) with Firebase Realtime Database for multiplayer. Remote: `github.com/joeydunn22/postgames`. The only real feature is **Top 10 Trivia** (`pages/top10.html`); `debates.html`, `movies.html`, `snacks.html` are "coming soon" placeholders.

## Vision

Postgames is a website (eventually an app) for people, mostly guys, coming home from the bar and looking for something to do. The planned features are sports trivia, a movie selector and a snack finder. **Current focus is sports trivia**; leave the other pages alone unless asked.

Trivia data is currently compiled by hand from Baseball/Football Reference and parsed with the scripts below. The long-term goal is to pull it from an API automatically so each season doesn't need manual parsing, but that is future work.

## Working with the owner

- **Take the lead.** The owner is not an experienced coder. Make the technical calls yourself and give a clear recommendation rather than a menu of options; the owner will almost always go with it. Ask them only about design choices (look, feel, gameplay).
- **Go step by step; don't build the future state early.** This project is a learning experience the owner enjoys taking incrementally. Don't introduce the API, an app wrapper, frameworks or build tooling ahead of time — solve the current step well and leave those for later.
- **Commit and push by default.** After finishing a change, commit it (following the versioning convention below) and push to `origin main` without asking, unless the owner says not to for that change.
- **Reorganize freely.** Move or restructure code and files whenever it makes things clearer. When you do, briefly explain where things now live and why, since that helps the owner learn the codebase.

## Running locally

Pages must be served over HTTP (ES modules and `fetch` of JSON fail on `file://`). From the repo root:

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

`pages/top10.html` inlines the Firebase init and exposes the SDK on `window` (`db`, `auth`, `ref`, `set`, `update`, `onValue`, `remove`, `get`, `onAuthStateChanged`, `signInAnonymously`). Three module scripts then load **in order** from `assets/top10/js/`:

1. `top10-state.js` — defines the global `window.game` object (single source of truth: `state`, `players`, `globalGuessed`, `sport/category/year/stat`, `data`), `GAME_STATES` (`setup` → `playing` → `results`), room globals (`currentRoomCode`, `roomActive`, `hostId`, `myPlayerId`, `endVotes`), `MAX_PLAYERS` (4, enforced for local games and on room join), and `dataManifest` + `hasData()`. Anything the renderer needs at page load must live here, because `top10-render.js` initializes before `top10-logic.js` has run.
2. `top10-render.js` — all DOM work. `renderUIForState(game)` is the central re-render called after every state change: it shows exactly one of the setup / playing / results sections based on `game.state`, and derives everything else (chip active/disabled state, room bar, scoreboard, board, feedback) from `game` and room status. Click handlers only set `game` fields and call it. Player names and guesses come from other players via Firebase, so anything interpolated into `innerHTML` must go through `escapeHTML()`. Also wires event handlers and fills `window.ui` with DOM refs.
3. `top10-logic.js` — auth, rooms, game flow, guess matching, data loading. It should not touch the DOM beyond `setRoomStatus()` and the stat hint; leave display decisions to the renderer.

Although these are ES modules, they communicate through **globals, not imports**: each file ends with a `PUBLIC_API` object whose functions are copied onto `window`. New cross-file functions must be added to that file's `PUBLIC_API`. HTML `onclick` attributes also rely on these globals.

### Multiplayer model (host-authoritative)

Firebase layout per room: `rooms/{CODE}/host`, `rooms/{CODE}/players/{uid}` (name), `rooms/{CODE}/gameState` (mirror of `game`), `rooms/{CODE}/pendingGuess/{uid}`, `rooms/{CODE}/endVotes/{uid}`.

- Only the host mutates game state. Non-hosts write guesses to `pendingGuess`; the host's `listenToPendingGuess` runs `hostProcessGuess` → `processGuess`, then clears `pendingGuess` and calls `syncGameState()` to push `gameState`.
- Every client (including the host) applies remote `gameState` in `listenToGame`, which rebuilds `game.players` from `game.playerNames` keyed by uid, and reloads stat data when sport/category/year changes.
- **Ending a game:** the End Game button lives inside the gameplay section. In a room each player toggles `endVotes/{uid}`; the host's `checkEndVotes()` ends the game once every player in `playerNames` has voted. Solo, it ends immediately. When all answers are guessed the game auto-ends after a short delay. Only the host sees "New Game" on the results screen.
- Without a room, the same `processGuess` runs locally for pass-and-play with local player name inputs.
- Firebase drops empty arrays/nulls, so a field reset to `[]`/`null` simply disappears from `gameState` and `Object.assign` would keep the stale local value. `listenToGame` explicitly resets `globalGuessed`, `stat` and `lastGuess`; do the same for any new field that can be emptied.
- `game.lastGuess` (`{ playerName, guess, answer, result: correct|wrong|repeat, at }`) is set in `processGuess` and synced so every player sees feedback for each guess; the renderer animates only guesses newer than the last one it drew.

Guess matching (`findAnswerMatch`) normalizes accents and punctuation, accepts full name, first name alone, or last name alone (ignoring Jr./III suffixes), and allows Levenshtein fuzziness scaled to name length. A guess that matches more than one answer equally well is rejected as a miss rather than guessed at.

## Data pipeline

The game fetches `data/{sport}/{year}/processed/`:
- MLB: `{batting|pitching}_{year}_enriched.json`
- NFL/NBA: `stats_{year}_enriched.json`

Format: an array of `{ stat_id, stat_label, is_percent_stat, players: [{ rank, player (last name), first_name, team, value, is_percent }] }`. Percent values are stored ×100 and divided by 100 on load. Only MLB 2025 and NFL 2025 exist so far.

`data/manifest.json` lists every available sport/category/year; buttons with no matching entry are greyed out. **Add an entry there whenever a new processed file is added**, or the game won't offer it.

Scripts in `scripts/` are run from the repo root with hardcoded paths (edit the constants/defaults to change sport/year):
- `batting_reference_parse.py`, `pitching_reference_parse.py` — parse `data/mlb/{year}/raw/*.txt` into `*_raw.json` (the write is commented out to avoid overwriting; uncomment to regenerate).
- `enrich_names.py` — **interactive**: adds `first_name` to MLB raw JSON using `mlbplayers2025.txt`, prompting on ambiguous last names. Defaults target pitching; change `input_path`/`output_path` for batting.
- `nfl_reference_parse.py` — parses NFL raw text and writes the enriched file directly (first names come from the source).
