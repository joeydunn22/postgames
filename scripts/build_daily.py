"""Build the daily challenge schedule (data/daily.json) from the trivia data.

Two dailies, one board each per day:
- Who's Missing: one player hidden. This script picks the board and the
  hidden player, and works out the hints the game can't get from the data
  files: the hidden player's league/conference and division that season.
- Top Shelf: the stat name, the top 2-3 names and the values hidden.
  This script picks the board and how many names to hide, and lists the
  stats offered as answers.

Days already in the file are kept as they are, so a day's puzzle never
changes once scheduled; new days are added up to DAYS_AHEAD from today.
Run from the repo root (standard library only):

    python scripts/build_daily.py            # top up the schedule
    python scripts/build_daily.py --check    # only check the division table
"""

import datetime
import functools
import json
import random
import sys
from pathlib import Path

DATA = Path("data")
SCHEDULE = DATA / "daily.json"
START = datetime.date(2026, 10, 3)   # Daily #1
DAYS_AHEAD = 365


# ------------------------------------------------------------------
# Which stats the daily uses, and how hard each one is.
# Recent seasons (the last RECENT_SEASONS) use every stat here; older
# seasons only the easy ones, since an old board in a niche stat is
# close to impossible (1990s 3-point %, anyone?). The hidden player's
# rank is drawn from HIDE_RANKS: deep ranks only where the board is
# easy enough for them to be fair.
# ------------------------------------------------------------------
RECENT_SEASONS = 15
RECENT_SHARE = 0.6      # how often a day uses a recent season rather than an older one

DAILY_STATS = {
    ("mlb", "batting"): {
        "Batting Average": "easy", "Home Runs": "easy", "Runs Batted In": "easy",
        "Hits": "easy", "Runs Scored": "easy",
        "OPS (On-Base + Slugging)": "hard", "Stolen Bases": "hard",
    },
    ("mlb", "pitching"): {
        "Wins": "easy", "ERA": "easy", "Strikeouts": "easy",
        "Saves": "hard",
    },
    ("nfl", None): {
        "Passing Yards": "easy", "Passing TDs": "easy", "Rushing Yards": "easy",
        "Rushing TDs": "easy", "Receptions": "easy", "Receiving Yards": "easy",
        "Receiving TDs": "easy",
        "Sacks": "hard", "Interceptions": "hard",
    },
    ("nba", None): {
        "Points per Game": "easy", "Rebounds per Game": "easy", "Assists per Game": "easy",
        "Steals per Game": "hard", "Blocks per Game": "hard", "3-Pointers Made": "hard",
        "3-Point %": "hard", "Field Goal %": "hard",
    },
}

HIDE_RANKS = {
    ("recent", "easy"): range(1, 11),
    ("recent", "hard"): range(1, 6),
    ("older", "easy"): range(1, 6),
}

# Top Shelf: how many of the top names are hidden. Easy boards hide more.
SHELF_HIDDEN = {
    ("recent", "easy"): 3,
    ("recent", "hard"): 2,
    ("older", "easy"): 2,
}
# A board is skipped for Top Shelf when another daily stat that season
# shares this many of its 10 names: from the names alone the two would
# be a coin flip (Rushing Yards vs Rushing TDs, say).
SHELF_LOOKALIKE = 7
# Top Shelf never repeats its own board within SHELF_REPEAT_DAYS, and
# stays this many days away from a board Who's Missing uses (the NFL has
# too few seasons for the two dailies never to share one).
SHELF_REPEAT_DAYS = 365
SHELF_MISSING_GAP = 30


# ------------------------------------------------------------------
# Leagues and divisions, by season. Each sport is a list of
# (first season, last season, {division: [teams]}) blocks, plus moves
# for single teams. Seasons are the data's years (NBA = the year the
# season ends). --check makes sure every team in every season is covered.
# ------------------------------------------------------------------
MLB_LEAGUES = {"AL": "American League", "NL": "National League"}
NFL_LEAGUES = {"AFC": "AFC", "NFC": "NFC"}
NBA_CONFERENCES = {"East": "Eastern Conference", "West": "Western Conference"}

MLB_DIVISIONS = [
    (1990, 1993, {
        "AL East": ["BAL", "BOS", "CLE", "DET", "MIL", "NYY", "TOR"],
        "AL West": ["CAL", "CWS", "KC", "MIN", "OAK", "SEA", "TEX"],
        "NL East": ["CHC", "FLA", "MON", "NYM", "PHI", "PIT", "STL"],
        "NL West": ["ATL", "CIN", "COL", "HOU", "LA", "SD", "SF"],
    }),
    (1994, 1997, {
        "AL East": ["BAL", "BOS", "DET", "NYY", "TOR"],
        "AL Central": ["CLE", "CWS", "KC", "MIL", "MIN"],
        "AL West": ["ANA", "CAL", "OAK", "SEA", "TEX"],
        "NL East": ["ATL", "FLA", "MON", "NYM", "PHI"],
        "NL Central": ["CHC", "CIN", "HOU", "PIT", "STL"],
        "NL West": ["COL", "LA", "SD", "SF"],
    }),
    (1998, 2012, {
        "AL East": ["BAL", "BOS", "NYY", "TB", "TOR"],
        "AL Central": ["CLE", "CWS", "DET", "KC", "MIN"],
        "AL West": ["ANA", "LAA", "OAK", "SEA", "TEX"],
        "NL East": ["ATL", "FLA", "MIA", "MON", "NYM", "PHI", "WSH"],
        "NL Central": ["CHC", "CIN", "HOU", "MIL", "PIT", "STL"],
        "NL West": ["AZ", "COL", "LA", "LAD", "SD", "SF"],
    }),
    (2013, 2100, {
        "AL East": ["BAL", "BOS", "NYY", "TB", "TOR"],
        "AL Central": ["CLE", "CWS", "DET", "KC", "MIN"],
        "AL West": ["ATH", "HOU", "LAA", "OAK", "SEA", "TEX"],
        "NL East": ["ATL", "MIA", "NYM", "PHI", "WSH"],
        "NL Central": ["CHC", "CIN", "MIL", "PIT", "STL"],
        "NL West": ["AZ", "COL", "LAD", "SD", "SF"],
    }),
]

NFL_DIVISIONS = [
    (1999, 2001, {
        "AFC East": ["BUF", "IND", "MIA", "NE", "NYJ"],
        "AFC Central": ["BAL", "CIN", "CLE", "JAX", "PIT", "TEN"],
        "AFC West": ["DEN", "KC", "OAK", "SD", "SEA"],
        "NFC East": ["ARI", "DAL", "NYG", "PHI", "WAS"],
        "NFC Central": ["CHI", "DET", "GB", "MIN", "TB"],
        "NFC West": ["ATL", "CAR", "NO", "SF", "STL"],
    }),
    (2002, 2100, {
        "AFC East": ["BUF", "MIA", "NE", "NYJ"],
        "AFC North": ["BAL", "CIN", "CLE", "PIT"],
        "AFC South": ["HOU", "IND", "JAX", "TEN"],
        "AFC West": ["DEN", "KC", "LAC", "LV", "OAK", "SD"],
        "NFC East": ["DAL", "NYG", "PHI", "WAS"],
        "NFC North": ["CHI", "DET", "GB", "MIN"],
        "NFC South": ["ATL", "CAR", "NO", "TB"],
        "NFC West": ["ARI", "LA", "SEA", "SF", "STL"],
    }),
]

# NBA: four divisions through 2003-04, six since. Conference is East/West.
NBA_DIVISIONS = [
    (1980, 2004, {
        "East Atlantic": ["BOS", "MIA", "NJN", "NYK", "ORL", "PHI", "WAS"],
        "East Central": ["ATL", "CHH", "CHI", "CLE", "DET", "IND", "MIL", "NOH", "TOR"],
        "West Midwest": ["DAL", "DEN", "HOU", "KCK", "MEM", "MIN", "SAC", "SAS", "UTA", "VAN"],
        "West Pacific": ["GSW", "LAC", "LAL", "PHX", "POR", "SDC", "SEA"],
    }),
    (2005, 2100, {
        "East Atlantic": ["BKN", "BOS", "NJN", "NYK", "PHI", "TOR"],
        "East Central": ["CHI", "CLE", "DET", "IND", "MIL"],
        "East Southeast": ["ATL", "CHA", "MIA", "ORL", "WAS"],
        "West Northwest": ["DEN", "MIN", "OKC", "POR", "SEA", "UTA"],
        "West Pacific": ["GSW", "LAC", "LAL", "PHX", "SAC"],
        "West Southwest": ["DAL", "HOU", "MEM", "NOH", "NOK", "NOP", "SAS"],
    }),
]

# Single-team moves inside a block: (team, first season, last season, division)
NBA_MOVES = [
    ("HOU", 1980, 1980, "East Central"),    # to the Midwest with Dallas's arrival
    ("SAS", 1980, 1980, "East Central"),
    ("CHI", 1980, 1980, "West Midwest"),    # to the Central in 1980-81
    ("MIL", 1980, 1980, "West Midwest"),
    ("SAC", 1989, 2004, "West Pacific"),    # Kings to the Pacific in 1988-89
    ("CHH", 1990, 1990, "West Midwest"),    # Hornets' second season, then the Central
    ("ORL", 1990, 1990, "East Central"),    # Magic's first season, then the Atlantic
]


def division_of(sport, team, year):
    """(league or conference name, division name) for a team that season, or None."""
    blocks = {"mlb": MLB_DIVISIONS, "nfl": NFL_DIVISIONS, "nba": NBA_DIVISIONS}[sport]
    division = None
    for first, last, divisions in blocks:
        if first <= year <= last:
            division = next((d for d, teams in divisions.items() if team in teams), None)
    if sport == "nba":
        for moved, first, last, to in NBA_MOVES:
            if moved == team and first <= year <= last:
                division = to
    if not division:
        return None

    if sport == "nba":
        conference, name = division.split(" ", 1)
        return NBA_CONFERENCES[conference], f"{name} Division"
    league = division.split(" ")[0]
    return (MLB_LEAGUES if sport == "mlb" else NFL_LEAGUES)[league], division


# ------------------------------------------------------------------
# Picking puzzles
# ------------------------------------------------------------------
def manifest():
    return json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))["available"]


@functools.lru_cache(maxsize=None)
def load_json(path):
    """A data file, read once (callers must not change what comes back)."""
    return json.loads((DATA / path).read_text(encoding="utf-8"))


def season_start(sport, year):
    return year - 1 if sport == "nba" else year


def newest_start(entries, sport):
    return max(season_start(sport, e["year"]) for e in entries if e["sport"] == sport)


def hideable(board, rank_range):
    """Players on a board that are fair to hide: in the rank range and on
    one team (a traded player has no single team or division to hint at).
    A tie with a player on the board is fine, since they're shown, but not
    a tie at the bottom that left more tied players off the board: any of
    them would be a right answer."""
    left_off = board["players"][-1]["value"] if board.get("more_tied") else None
    return [p for p in board["players"]
            if p["rank"] in rank_range
            and not p["team"].endswith("TM")
            and p["value"] != left_off]


def era_of(entry, entries):
    recent = season_start(entry["sport"], entry["year"]) > newest_start(entries, entry["sport"]) - RECENT_SEASONS
    return "recent" if recent else "older"


def boards_for(entry, entries):
    """Boards in one data file the daily can use, each with its hideable players."""
    stats = DAILY_STATS.get((entry["sport"], entry.get("category")))
    if not stats:
        return []
    era = era_of(entry, entries)
    found = []
    for board in load_json(entry["file"]):
        ranks = HIDE_RANKS.get((era, stats.get(board["label"])))
        players = hideable(board, ranks) if ranks else []
        if players:
            found.append((board, players))
    return found


def make_puzzle(entry, board, player):
    league, division = division_of(entry["sport"], player["team"], entry["year"])
    return {
        "sport": entry["sport"],
        "category": entry.get("category"),
        "year": entry["year"],
        "stat": board["label"],
        "rank": player["rank"],
        "id": player["id"],
        "league": league,
        "division": division,
    }


def board_id(puzzle):
    return (puzzle["sport"], puzzle.get("category"), puzzle["year"], puzzle["stat"])


def pick_day(rng, entries, used, yesterday_sport):
    """One puzzle: a sport (not yesterday's), recent or older seasons
    (RECENT_SHARE), a season/category, a stat, then a player. Each step is
    an even pick, so niche stats and recent seasons get their turn rather
    than being swamped by the many older easy boards. A board is never
    used twice."""
    sports = sorted({e["sport"] for e in entries} - {yesterday_sport})
    for _ in range(500):
        sport = rng.choice(sports)
        era = "recent" if rng.random() < RECENT_SHARE else "older"
        pool = [e for e in entries if e["sport"] == sport and era_of(e, entries) == era]
        if not pool:
            continue
        entry = rng.choice(pool)
        options = [(b, players) for b, players in boards_for(entry, entries)
                   if (entry["sport"], entry.get("category"), entry["year"], b["label"]) not in used]
        if options:
            board, players = rng.choice(options)
            return make_puzzle(entry, board, rng.choice(players))
    raise SystemExit("Couldn't find an unused board after 500 tries")


# ------------------------------------------------------------------
# Top Shelf
# ------------------------------------------------------------------
def shelf_options(sport):
    """Every daily stat for a sport, the answers Top Shelf offers."""
    return [label for (s, _), stats in DAILY_STATS.items() if s == sport for label in stats]


def season_boards(entries, sport, year):
    """Every daily-stat board in one season of a sport, all categories: {label: board}."""
    boards = {}
    for entry in entries:
        if entry["sport"] == sport and entry["year"] == year:
            stats = DAILY_STATS.get((sport, entry.get("category")), {})
            boards.update({b["label"]: b for b in load_json(entry["file"]) if b["label"] in stats})
    return boards


def shelf_boards(entry, entries):
    """Boards in one data file Top Shelf can use, each with how many names to hide."""
    stats = DAILY_STATS.get((entry["sport"], entry.get("category")))
    if not stats:
        return []
    era = era_of(entry, entries)
    season = season_boards(entries, entry["sport"], entry["year"])
    found = []
    for board in load_json(entry["file"]):
        hidden = SHELF_HIDDEN.get((era, stats.get(board["label"])))
        if not hidden or len(board["players"]) < hidden + 5:
            continue
        names = {p["id"] for p in board["players"]}
        lookalike = any(len(names & {p["id"] for p in other["players"]}) >= SHELF_LOOKALIKE
                        for label, other in season.items() if label != board["label"])
        if not lookalike:
            found.append((board, hidden))
    return found


def pick_shelf_day(rng, entries, used, avoid_sports):
    """One Top Shelf puzzle, picked like pick_day: sport (not yesterday's
    or today's Who's Missing sport, when there's a choice), era, season,
    then stat. Boards in `used` are skipped."""
    all_sports = sorted({e["sport"] for e in entries})
    preferred = [s for s in all_sports if s not in avoid_sports] or all_sports
    for attempt in range(500):
        sport = rng.choice(preferred if attempt < 300 else all_sports)
        era = "recent" if rng.random() < RECENT_SHARE else "older"
        pool = [e for e in entries if e["sport"] == sport and era_of(e, entries) == era]
        if not pool:
            continue
        entry = rng.choice(pool)
        options = [(b, hidden) for b, hidden in shelf_boards(entry, entries)
                   if (entry["sport"], entry.get("category"), entry["year"], b["label"]) not in used]
        if options:
            board, hidden = rng.choice(options)
            return {
                "sport": entry["sport"],
                "category": entry.get("category"),
                "year": entry["year"],
                "stat": board["label"],
                "group": board.get("group", ""),
                "hidden": hidden,
                "options": shelf_options(entry["sport"]),
            }
    raise SystemExit("Couldn't find an unused Top Shelf board after 500 tries")


def check_divisions(entries):
    """Every team on every board in every season must have a division."""
    missing = set()
    for entry in entries:
        for board in load_json(entry["file"]):
            for player in board["players"]:
                if not player["team"].endswith("TM") and not division_of(entry["sport"], player["team"], entry["year"]):
                    missing.add((entry["sport"], entry["year"], player["team"]))
    for sport, year, team in sorted(missing):
        print(f"  no division: {sport} {year} {team}")
    return not missing


def main():
    entries = manifest()
    if not check_divisions(entries):
        raise SystemExit("Fix the division table first.")
    print("Division table covers every team.")
    if "--check" in sys.argv:
        return

    schedule = json.loads(SCHEDULE.read_text(encoding="utf-8")) if SCHEDULE.exists() else {}
    puzzles = schedule.get("puzzles", [])
    days_needed = (datetime.date.today() - START).days + DAYS_AHEAD + 1

    shelf = schedule.get("top_shelf", [])
    used = {board_id(p) for p in puzzles}

    rng = random.Random(f"postgames-daily-{len(puzzles)}")
    added = 0
    while len(puzzles) < days_needed:
        yesterday = puzzles[-1]["sport"] if puzzles else None
        puzzle = pick_day(rng, entries, used, yesterday)
        puzzles.append(puzzle)
        used.add(board_id(puzzle))
        added += 1

    shelf_rng = random.Random(f"postgames-top-shelf-{len(shelf)}")
    shelf_added = 0
    while len(shelf) < days_needed:
        day = len(shelf)
        avoid = {puzzles[day]["sport"]} | ({shelf[-1]["sport"]} if shelf else set())
        shelf_used = ({board_id(p) for p in shelf[-SHELF_REPEAT_DAYS:]} |
                      {board_id(p) for p in puzzles[max(0, day - SHELF_MISSING_GAP):day + SHELF_MISSING_GAP + 1]})
        shelf.append(pick_shelf_day(shelf_rng, entries, shelf_used, avoid))
        shelf_added += 1

    SCHEDULE.write_text(json.dumps({
        "_readme": "Daily challenge schedule: puzzles[0] (Who's Missing) and top_shelf[0] are Daily #1 on `start`, "
                   "one per day after. Built by scripts/build_daily.py, which keeps existing days and adds new ones.",
        "start": START.isoformat(),
        "puzzles": puzzles,
        "top_shelf": shelf,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    through = START + datetime.timedelta(days=len(puzzles) - 1)
    print(f"{SCHEDULE}: {len(puzzles)} days ({added} new Who's Missing, {shelf_added} new Top Shelf), through {through}")


if __name__ == "__main__":
    main()
