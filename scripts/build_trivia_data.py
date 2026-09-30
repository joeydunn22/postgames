"""
Build Top 10 trivia data from free, open stat sources.

Usage (run from the repo root):
    python scripts/build_trivia_data.py mlb 2025
    python scripts/build_trivia_data.py mlb 1990-2026
    python scripts/build_trivia_data.py nfl 1999-2025
    python scripts/build_trivia_data.py nba 1980-2026   (NBA years are the
                                                         season's end: 2026 = 2025-26)

Sources:
    MLB  the MLB Stats API (statsapi.mlb.com): league leaders per stat,
         already ranked, ties marked and rate stats limited to qualified
         players. One request per season for batting, one for pitching.
    NFL  nflverse (github.com/nflverse): one CSV of every player's
         regular-season totals per season. We rank each stat ourselves.
    NBA  stats.nba.com league leaders (the site behind NBA.com's stats
         pages): one request per stat per season, already ranked and
         limited to qualified players.

Output:  data/{sport}/{year}/{category or "stats"}.json
         and a matching entry in data/manifest.json, so the game offers it.

Each game file is a list of { label, players: [{ rank, name, team, value }],
more_tied? }. `value` is display text. Ties at 10th are kept, unless the
tie is so big it would swamp the board (see top_ten).
"""

import csv
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

DATA = Path("data")
MANIFEST = DATA / "manifest.json"

TOP_N = 10
MAX_BOARD = 15   # more answers than this and the tie at the bottom is left out
MIN_BOARD = 5    # fewer answers than this and the stat is skipped for that season


# ------------------------------------------------------------
# Shared helpers
# ------------------------------------------------------------

def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "postgames-trivia-builder"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def top_ten(rows):
    """
    rows: [{rank, name, team, value}] in leaderboard order, ranks with ties.
    Keeps everyone ranked 10th or better. If a big tie at the bottom
    would push the board past MAX_BOARD, that tie is left out and counted
    in more_tied instead. Returns (players, more_tied), or None when too
    few players are left to make a board.
    """
    board = [r for r in rows if r["rank"] <= TOP_N]
    more_tied = 0
    if len(board) > MAX_BOARD:
        last_rank = board[-1]["rank"]
        more_tied = sum(1 for r in board if r["rank"] == last_rank)
        board = [r for r in board if r["rank"] != last_rank]
    if len(board) < MIN_BOARD or len({r["value"] for r in board}) == 1:
        return None  # too few answers, or everyone tied (nothing to rank)
    return board, more_tied


def make_stat(label, rows):
    result = top_ten(rows)
    if not result:
        return None
    players, more_tied = result
    stat = {"label": label, "players": players}
    if more_tied:
        stat["more_tied"] = more_tied
    return stat


def write_game_file(sport, category, year, stats):
    output = DATA / sport / str(year) / f"{category or 'stats'}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    entry = {"sport": sport, "year": year, "file": output.relative_to(DATA).as_posix()}
    if category:
        entry["category"] = category
    update_manifest(entry)
    print(f"  {output}: {len(stats)} stats")


def update_manifest(entry):
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = [e for e in manifest["available"] if e["file"] != entry["file"]] + [entry]
    manifest["available"] = sorted(entries, key=lambda e: (e["sport"], -e["year"], e.get("category", "")))
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ------------------------------------------------------------
# MLB: the MLB Stats API
# ------------------------------------------------------------

MLB_API = "https://statsapi.mlb.com/api/v1"

# API leader category -> label shown in the game, in dropdown order
MLB_STATS = {
    "batting": {
        "homeRuns": "Home Runs",
        "battingAverage": "Batting Average",
        "runsBattedIn": "Runs Batted In",
        "hits": "Hits",
        "runs": "Runs Scored",
        "stolenBases": "Stolen Bases",
        "doubles": "Doubles",
        "triples": "Triples",
        "walks": "Walks",
        "strikeouts": "Strikeouts",
        "onBasePercentage": "On-Base %",
        "sluggingPercentage": "Slugging %",
        "onBasePlusSlugging": "OPS (On-Base + Slugging)",
        "totalBases": "Total Bases",
        "extraBaseHits": "Extra-Base Hits",
        "hitByPitches": "Hit By Pitch",
        "intentionalWalks": "Intentional Walks",
        "caughtStealing": "Caught Stealing",
        "groundIntoDoublePlays": "Grounded Into Double Plays",
        "sacrificeFlies": "Sacrifice Flies",
        "totalPlateAppearances": "Plate Appearances",
        "gamesPlayed": "Games Played",
    },
    "pitching": {
        "strikeouts": "Strikeouts",
        "earnedRunAverage": "ERA",
        "wins": "Wins",
        "saves": "Saves",
        "walksAndHitsPerInningPitched": "WHIP",
        "inningsPitched": "Innings Pitched",
        "strikeoutsPer9Inn": "Strikeouts per 9 Innings",
        "strikeoutWalkRatio": "Strikeout-to-Walk Ratio",
        "winPercentage": "Win %",
        "losses": "Losses",
        "completeGames": "Complete Games",
        "shutouts": "Shutouts",
        "holds": "Holds",
        "blownSaves": "Blown Saves",
        "gamesStarted": "Games Started",
        "gamesPlayed": "Games Pitched",
        "gamesFinished": "Games Finished",
        "walksPer9Inn": "Walks per 9 Innings",
        "hitsPer9Inn": "Hits per 9 Innings",
        "walks": "Walks Allowed",
        "homeRuns": "Home Runs Allowed",
        "earnedRun": "Earned Runs Allowed",
        "hitBatsman": "Hit Batters",
        "wildPitch": "Wild Pitches",
    },
}
MLB_GROUPS = {"batting": "hitting", "pitching": "pitching"}


def mlb_team_abbreviations(year):
    teams = json.loads(fetch(f"{MLB_API}/teams?sportId=1&season={year}"))["teams"]
    return {t["id"]: t["abbreviation"] for t in teams}


def build_mlb(year):
    print(f"MLB {year}")
    teams = mlb_team_abbreviations(year)

    for category, labels in MLB_STATS.items():
        url = (f"{MLB_API}/stats/leaders?sportId=1&season={year}&limit=100"
               f"&statGroup={MLB_GROUPS[category]}&leaderCategories={','.join(labels)}")
        leaders = {c["leaderCategory"]: c.get("leaders", [])
                   for c in json.loads(fetch(url))["leagueLeaders"]}

        stats = []
        for key, label in labels.items():
            rows = []
            for leader in leaders.get(key, []):
                value = leader["value"]
                if not value or float(value) == 0:
                    continue  # e.g. holds before they were tracked
                num_teams = leader.get("numTeams", 1)
                team = f"{num_teams}TM" if num_teams > 1 else teams.get(leader["team"]["id"], "")
                rows.append({"rank": leader["rank"], "name": leader["person"]["fullName"],
                             "team": team, "value": value})
            stat = make_stat(label, rows)
            if stat:
                stats.append(stat)

        write_game_file("mlb", category, year, stats)
        time.sleep(0.5)  # be polite to the API


# ------------------------------------------------------------
# NFL: nflverse season totals
# ------------------------------------------------------------

NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_{year}.csv"


def num(row, column):
    try:
        return float(row.get(column) or 0)
    except ValueError:
        return 0.0


def passer_rating(r):
    att = num(r, "attempts")
    parts = [
        (num(r, "completions") / att - 0.3) * 5,
        (num(r, "passing_yards") / att - 3) * 0.25,
        num(r, "passing_tds") / att * 20,
        2.375 - num(r, "passing_interceptions") / att * 25,
    ]
    return sum(min(max(p, 0), 2.375) for p in parts) / 6 * 100


def whole(x):
    return str(round(x))


def one_decimal(x):
    return f"{x:.1f}"


def percent(x):
    return f"{x:.1f}%"


# (label, value of a player row, display format, qualifier or None)
# Qualifiers follow Pro Football Reference: per team game, 14 pass
# attempts, 6.25 carries, 1.875 catches.
def nfl_stats(team_games):
    passer = lambda r: num(r, "attempts") >= 14 * team_games
    rusher = lambda r: num(r, "carries") >= 6.25 * team_games
    receiver = lambda r: num(r, "receptions") >= 1.875 * team_games
    return [
        ("Passing Yards", lambda r: num(r, "passing_yards"), whole, None),
        ("Passing TDs", lambda r: num(r, "passing_tds"), whole, None),
        ("Interceptions Thrown", lambda r: num(r, "passing_interceptions"), whole, None),
        ("Completions", lambda r: num(r, "completions"), whole, None),
        ("Pass Attempts", lambda r: num(r, "attempts"), whole, None),
        ("Completion %", lambda r: num(r, "completions") / num(r, "attempts") * 100, percent, passer),
        ("Yards per Pass Attempt", lambda r: num(r, "passing_yards") / num(r, "attempts"), one_decimal, passer),
        ("Passer Rating", passer_rating, one_decimal, passer),
        ("Times Sacked", lambda r: num(r, "sacks_suffered"), whole, None),
        ("Rushing Yards", lambda r: num(r, "rushing_yards"), whole, None),
        ("Rushing TDs", lambda r: num(r, "rushing_tds"), whole, None),
        ("Carries", lambda r: num(r, "carries"), whole, None),
        ("Yards per Carry", lambda r: num(r, "rushing_yards") / num(r, "carries"), one_decimal, rusher),
        ("Receptions", lambda r: num(r, "receptions"), whole, None),
        ("Receiving Yards", lambda r: num(r, "receiving_yards"), whole, None),
        ("Receiving TDs", lambda r: num(r, "receiving_tds"), whole, None),
        ("Targets", lambda r: num(r, "targets"), whole, None),
        ("Yards per Reception", lambda r: num(r, "receiving_yards") / num(r, "receptions"), one_decimal, receiver),
        ("Yards from Scrimmage", lambda r: num(r, "rushing_yards") + num(r, "receiving_yards"), whole, None),
        ("Rushing + Receiving TDs", lambda r: num(r, "rushing_tds") + num(r, "receiving_tds"), whole, None),
        ("Fantasy Points (PPR)", lambda r: num(r, "fantasy_points_ppr"), one_decimal, None),
        ("Fumbles", lambda r: num(r, "fumbles_total"), whole, None),
        ("Sacks", lambda r: num(r, "def_sacks"), one_decimal, None),
        ("Combined Tackles", lambda r: num(r, "def_tackles_solo") + num(r, "def_tackle_assists"), whole, None),
        ("Solo Tackles", lambda r: num(r, "def_tackles_solo"), whole, None),
        ("Tackles for Loss", lambda r: num(r, "def_tackles_for_loss"), whole, None),
        ("Interceptions", lambda r: num(r, "def_interceptions"), whole, None),
        ("Passes Defended", lambda r: num(r, "def_pass_defended"), whole, None),
        ("Forced Fumbles", lambda r: num(r, "def_fumbles_forced"), whole, None),
        ("Field Goals Made", lambda r: num(r, "fg_made"), whole, None),
        ("Longest Field Goal", lambda r: num(r, "fg_long"), whole, None),
        ("Kick Return Yards", lambda r: num(r, "kickoff_return_yards"), whole, None),
        ("Punt Return Yards", lambda r: num(r, "punt_return_yards"), whole, None),
    ]


# nflverse uses today's team codes for every season; show where teams were then.
# (code, first season in the new city, code before that)
NFL_MOVES = [("LA", 2016, "STL"), ("LAC", 2017, "SD"), ("LV", 2020, "OAK")]


def nfl_team(code, year):
    for new, since, old in NFL_MOVES:
        if code == new and year < since:
            return old
    return code


def rank_rows(players, value_of, fmt, year):
    """Sort high to low and rank; players whose shown values match share a rank."""
    scored = sorted(((value_of(r), r) for r in players), key=lambda pair: -pair[0])
    rows = []
    for i, (value, r) in enumerate(scored):
        if value <= 0 or i >= 100:
            break
        shown = fmt(value)
        rank = rows[-1]["rank"] if rows and rows[-1]["value"] == shown else i + 1
        rows.append({"rank": rank, "name": r["player_display_name"],
                     "team": nfl_team(r["recent_team"], year), "value": shown})
    return rows


def build_nfl(year):
    print(f"NFL {year}")
    players = list(csv.DictReader(io.StringIO(fetch(NFLVERSE.format(year=year)))))
    team_games = 17 if year >= 2021 else 16

    stats = []
    for label, value_of, fmt, qualifies in nfl_stats(team_games):
        pool = [r for r in players if qualifies is None or qualifies(r)]
        stat = make_stat(label, rank_rows(pool, value_of, fmt, year))
        if stat:
            stats.append(stat)

    write_game_file("nfl", None, year, stats)


# ------------------------------------------------------------
# NBA: stats.nba.com league leaders
# ------------------------------------------------------------

NBA_API = ("https://stats.nba.com/stats/leagueleaders?LeagueID=00&Scope=S"
           "&SeasonType=Regular%20Season&ActiveFlag=&PerMode={mode}&Season={season}&StatCategory={stat}")
# stats.nba.com only answers requests that look like they come from nba.com
NBA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "Accept": "application/json",
}

# (label, stat category, PerGame or Totals, display format). The API applies
# the NBA's own minimums (games played, made shots) to per-game and % stats.
# Percentages only work in Totals mode.
NBA_STATS = [
    ("Points per Game", "PTS", "PerGame", one_decimal),
    ("Rebounds per Game", "REB", "PerGame", one_decimal),
    ("Assists per Game", "AST", "PerGame", one_decimal),
    ("Steals per Game", "STL", "PerGame", one_decimal),
    ("Blocks per Game", "BLK", "PerGame", one_decimal),
    ("3-Pointers Made per Game", "FG3M", "PerGame", one_decimal),
    ("Minutes per Game", "MIN", "PerGame", one_decimal),
    ("Field Goal %", "FG_PCT", "Totals", lambda x: percent(x * 100)),
    ("3-Point %", "FG3_PCT", "Totals", lambda x: percent(x * 100)),
    ("Free Throw %", "FT_PCT", "Totals", lambda x: percent(x * 100)),
    ("Total Points", "PTS", "Totals", whole),
    ("Total Rebounds", "REB", "Totals", whole),
    ("Total Assists", "AST", "Totals", whole),
    ("Total Steals", "STL", "Totals", whole),
    ("Total Blocks", "BLK", "Totals", whole),
    ("3-Pointers Made", "FG3M", "Totals", whole),
    ("Free Throws Made", "FTM", "Totals", whole),
    ("Field Goals Made", "FGM", "Totals", whole),
    ("Offensive Rebounds", "OREB", "Totals", whole),
    ("Turnovers", "TOV", "Totals", whole),
]

# stats.nba.com's codes for some teams in older seasons, as fans know them
NBA_TEAM_FIXES = {"UTH": "UTA", "GOS": "GSW", "PHL": "PHI", "SAN": "SAS"}


def nba_season(year):
    """We key NBA seasons by the year they end: 2025 is the 2024-25 season."""
    return f"{year - 1}-{str(year)[-2:]}"


def build_nba(year):
    print(f"NBA {nba_season(year)}")
    stats = []
    for label, category, mode, fmt in NBA_STATS:
        url = NBA_API.format(mode=mode, season=nba_season(year), stat=category)
        try:
            request = urllib.request.Request(url, headers=NBA_HEADERS)
            with urllib.request.urlopen(request, timeout=60) as response:
                result = json.loads(response.read().decode("utf-8"))["resultSet"]
        except Exception as error:
            print(f"  ! skipped {label}: {error}")
            continue
        finally:
            time.sleep(0.6)  # stats.nba.com blocks rapid-fire requests

        column = {name: i for i, name in enumerate(result["headers"])}
        # Already in leaderboard order; rank by the value players will see
        rows = []
        for i, row in enumerate(result["rowSet"][:100]):
            value = row[column[category]]
            if not value:
                continue
            shown = fmt(value)
            rank = rows[-1]["rank"] if rows and rows[-1]["value"] == shown else i + 1
            team = row[column["TEAM"]]
            rows.append({"rank": rank, "name": row[column["PLAYER"]],
                         "team": NBA_TEAM_FIXES.get(team, team), "value": shown})
        stat = make_stat(label, rows)
        if stat:
            stats.append(stat)

    write_game_file("nba", None, year, stats)


# ------------------------------------------------------------
# Command line
# ------------------------------------------------------------

BUILDERS = {"mlb": build_mlb, "nba": build_nba, "nfl": build_nfl}


def parse_years(text):
    first, _, last = text.partition("-")
    if not first.isdigit() or (last and not last.isdigit()):
        sys.exit(__doc__)
    return range(int(first), int(last or first) + 1)


def main(args):
    if len(args) != 2 or args[0] not in BUILDERS:
        sys.exit(__doc__)
    for year in parse_years(args[1]):
        try:
            BUILDERS[args[0]](year)
        except Exception as error:  # keep going: one bad season shouldn't stop a backfill
            print(f"  ! {args[0]} {year} failed: {error}")


if __name__ == "__main__":
    main(sys.argv[1:])
