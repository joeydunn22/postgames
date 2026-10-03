"""Build the daily challenge schedule (data/daily.json) from the trivia data.

Who's Missing: each day is one top-10 board with one player hidden. This
script picks the board and the hidden player for every day, and works out
the hints the game can't get from the data files: the hidden player's
league/conference and division that season.

Days already in the file are kept as they are, so a day's puzzle never
changes once scheduled; new days are added up to DAYS_AHEAD from today.
Run from the repo root (standard library only):

    python scripts/build_daily.py            # top up the schedule
    python scripts/build_daily.py --check    # only check the division table
"""

import datetime
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


def load_json(path):
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

    rng = random.Random(f"postgames-daily-{len(puzzles)}")
    used = {board_id(p) for p in puzzles}
    added = 0
    while len(puzzles) < days_needed:
        yesterday = puzzles[-1]["sport"] if puzzles else None
        puzzle = pick_day(rng, entries, used, yesterday)
        puzzles.append(puzzle)
        used.add(board_id(puzzle))
        added += 1

    SCHEDULE.write_text(json.dumps({
        "_readme": "Daily challenge schedule: puzzles[0] is Daily #1 on `start`, one per day after. "
                   "Built by scripts/build_daily.py, which keeps existing days and adds new ones.",
        "start": START.isoformat(),
        "puzzles": puzzles,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{SCHEDULE}: {len(puzzles)} days ({added} new), through {START + datetime.timedelta(days=len(puzzles) - 1)}")


if __name__ == "__main__":
    main()
