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
- **Reorganize freely.** Move or restructure code and files whenever it makes things clearer. When you do, briefly explain where things now live and why, since that helps the owner learn the codebase.

## Running locally

Pages must be served over HTTP (ES modules and `fetch` of JSON fail on `file://`). From the repo root:

```
python -m http.server 8000
```

Then open `http://localhost:8000/pages/top10.html`. Multiplayer requires two browser windows (use one normal + one private, since anonymous auth is per-browser-profile).

## Versioning convention

Commits are titled `vNNN | <summary>`, and each commit bumps the `Testing: Version NNN` line in `pages/top10.html` to match. Keep these in sync when committing.

## Top 10 Trivia architecture

`pages/top10.html` inlines the Firebase init and exposes the SDK on `window` (`db`, `auth`, `ref`, `set`, `update`, `onValue`, `remove`, `get`, `onAuthStateChanged`, `signInAnonymously`). Three module scripts then load **in order** from `assets/top10/js/`:

1. `top10-state.js` — defines the global `window.game` object (single source of truth: `state`, `players`, `globalGuessed`, `sport/category/year/stat`, `data`), `GAME_STATES` (`setup` → `playing` → `results`), and room globals (`currentRoomCode`, `roomActive`, `hostId`, `myPlayerId`).
2. `top10-render.js` — all DOM work. `renderUIForState(game)` is the central re-render called after every state change; it derives what's visible from `game.state` and host/room status. Also wires event handlers and fills `window.ui` with DOM refs.
3. `top10-logic.js` — auth, rooms, game flow, guess matching, data loading.

Although these are ES modules, they communicate through **globals, not imports**: each file ends with a `PUBLIC_API` object whose functions are copied onto `window`. New cross-file functions must be added to that file's `PUBLIC_API`. HTML `onclick` attributes also rely on these globals.

### Multiplayer model (host-authoritative)

Firebase layout per room: `rooms/{CODE}/host`, `rooms/{CODE}/players/{uid}` (name), `rooms/{CODE}/gameState` (mirror of `game`), `rooms/{CODE}/pendingGuess/{uid}`.

- Only the host mutates game state. Non-hosts write guesses to `pendingGuess`; the host's `listenToPendingGuess` runs `hostProcessGuess` → `processGuess`, then clears `pendingGuess` and calls `syncGameState()` to push `gameState`.
- Every client (including the host) applies remote `gameState` in `listenToGame`, which rebuilds `game.players` from `game.playerNames` keyed by uid, and reloads stat data when sport/category/year changes.
- Without a room, the same `processGuess` runs locally for pass-and-play with local player name inputs.
- Firebase drops empty arrays/nulls, so code reading `gameState` defensively defaults arrays (e.g. `guesses || []`).

Guess matching (`findAnswerMatch`) normalizes accents and punctuation, accepts full name, first name alone, or last name alone (ignoring Jr./III suffixes), and allows Levenshtein fuzziness scaled to name length. A guess that matches more than one answer equally well is rejected as a miss rather than guessed at.

## Data pipeline

The game fetches `data/{sport}/{year}/processed/`:
- MLB: `{batting|pitching}_{year}_enriched.json`
- NFL/NBA: `stats_{year}_enriched.json`

Format: an array of `{ stat_id, stat_label, is_percent_stat, players: [{ rank, player (last name), first_name, team, value, is_percent }] }`. Percent values are stored ×100 and divided by 100 on load. Only MLB 2025 and NFL 2025 exist; NBA has no processed data, and the year buttons (2024/2026) will show "No data available".

Scripts in `scripts/` are run from the repo root with hardcoded paths (edit the constants/defaults to change sport/year):
- `batting_reference_parse.py`, `pitching_reference_parse.py` — parse `data/mlb/{year}/raw/*.txt` into `*_raw.json` (the write is commented out to avoid overwriting; uncomment to regenerate).
- `enrich_names.py` — **interactive**: adds `first_name` to MLB raw JSON using `mlbplayers2025.txt`, prompting on ambiguous last names. Defaults target pitching; change `input_path`/`output_path` for batting.
- `nfl_reference_parse.py` — parses NFL raw text and writes the enriched file directly (first names come from the source).
