"""
Build Top 10 trivia data from free, open stat sources.

Usage (run from the repo root):
    python scripts/build_trivia_data.py mlb 2025
    python scripts/build_trivia_data.py mlb 1990-2026
    python scripts/build_trivia_data.py nfl 1999-2025
    python scripts/build_trivia_data.py nba 1980-2026   (NBA years are the
                                                         season's end: 2026 = 2025-26)
    python scripts/build_trivia_data.py mlb all         (all-time career boards)
    python scripts/build_trivia_data.py nba all
    python scripts/build_trivia_data.py nfl all

Sources:
    MLB  the MLB Stats API (statsapi.mlb.com): league leaders per stat,
         already ranked, ties marked and rate stats limited to qualified
         players. One request per season for batting, one for pitching,
         plus three for the season's player list.
    NFL  nflverse (github.com/nflverse): one CSV of every player's
         regular-season totals per season. We rank each stat ourselves,
         and the same CSV gives the season's player list.
    NBA  stats.nba.com league leaders (the site behind NBA.com's stats
         pages): one request per stat per season, already ranked and
         limited to qualified players, plus one for the player list.

All-time boards (year "all"):
    MLB  the Stats API's career leaders (which include the Negro Leagues,
         part of MLB's official record since 2024), plus each board
         player's season-by-season teams, and every season's player list
         for the guess list. About 170 requests.
    NBA  stats.nba.com's "All Time" totals, one request for every player
         ever, ranked here with career minimums, plus one request per
         season for each player's years and teams.
    NFL  Wikipedia's lists of NFL career leaders (nflverse starts in 1999,
         too late for careers), matched to players in nflverse's season
         rosters, 1920 on, which also give the guess list. About 125
         requests.
    Each board player's team is the one they played the most games for
    (NFL: the most seasons).
    The guess list has everyone's years and position but no team (only
    board players have one, so showing it would give them away).

Output:  data/{sport}/{year}/{category or "stats"}.json
         and a matching entry in data/manifest.json, so the game offers it.
         data/{sport}/{year}/players.json, everyone who played that season.

Each game file is a list of { label, group, players: [{ rank, id, name, team, value }],
more_tied? }, in STAT_GROUPS order; `group` heads the stat's section in the
game's Stat dropdown. `value` is display text. Ties at 10th are kept, unless the
tie is so big it would swamp the board (see top_ten).

The player list is [{ id, name, team, pos }]: what players search when
guessing. It covers the whole league, not just the boards, so searching
gives nothing away. `id` is the source's player id; guesses are matched
by id, so two players with the same name never get mixed up.
"""

import csv
import datetime
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

DATA = Path("data")
MANIFEST = DATA / "manifest.json"

TOP_N = 10
MAX_BOARD = 15   # more answers than this and the tie at the bottom is left out
MIN_BOARD = 5    # fewer answers than this and the stat is skipped for that season
ALL_TIME = "all" # the "year" all-time (career) boards are filed under


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


# Sections of the game's Stat dropdown, in order: (sport, category) -> [(group, [labels])].
# Every stat label must be listed here; files are written in this order.
STAT_GROUPS = {
    ("mlb", "batting"): [
        ("Hitting", ["Batting Average", "Hits", "Runs Scored", "Runs Batted In", "Doubles", "Triples"]),
        ("Power", ["Home Runs", "Slugging %", "OPS (On-Base + Slugging)", "Total Bases", "Extra-Base Hits"]),
        ("On Base", ["On-Base %", "Walks", "Intentional Walks", "Hit By Pitch", "Strikeouts"]),
        ("Speed", ["Stolen Bases", "Caught Stealing"]),
        ("Playing Time & Other", ["Games Played", "Plate Appearances", "Grounded Into Double Plays", "Sacrifice Flies"]),
    ],
    ("mlb", "pitching"): [
        ("Results", ["Wins", "Losses", "Win %", "Saves", "Holds", "Blown Saves"]),
        ("Run Prevention", ["ERA", "WHIP", "Hits per 9 Innings", "Earned Runs Allowed", "Home Runs Allowed"]),
        ("Strikeouts & Control", ["Strikeouts", "Strikeouts per 9 Innings", "Strikeout-to-Walk Ratio",
                                  "Walks per 9 Innings", "Walks Allowed", "Hit Batters", "Wild Pitches"]),
        ("Workload", ["Innings Pitched", "Games Started", "Games Pitched", "Games Finished",
                      "Complete Games", "Shutouts"]),
    ],
    ("nfl", None): [
        ("Passing", ["Passing Yards", "Passing TDs", "Interceptions Thrown", "Completions", "Pass Attempts",
                     "Completion %", "Yards per Pass Attempt", "Passer Rating", "Times Sacked", "Quarterback Wins"]),
        ("Rushing", ["Rushing Yards", "Rushing TDs", "Carries", "Yards per Carry"]),
        ("Receiving", ["Receptions", "Receiving Yards", "Receiving TDs", "Targets", "Yards per Reception"]),
        ("All-Purpose", ["Yards from Scrimmage", "All-Purpose Yards", "Rushing + Receiving TDs", "Points Scored",
                         "Fantasy Points (PPR)", "Fumbles", "Games Played"]),
        ("Defense", ["Sacks", "Combined Tackles", "Solo Tackles", "Tackles for Loss", "Interceptions",
                     "Passes Defended", "Forced Fumbles"]),
        ("Kicking & Returns", ["Field Goals Made", "Longest Field Goal", "Kick Return Yards", "Punt Return Yards"]),
    ],
    ("nba", None): [
        ("Per Game", ["Points per Game", "Rebounds per Game", "Assists per Game", "Steals per Game",
                      "Blocks per Game", "3-Pointers Made per Game", "Minutes per Game"]),
        ("Shooting", ["Field Goal %", "3-Point %", "Free Throw %", "Field Goals Made", "3-Pointers Made",
                      "Free Throws Made"]),
        ("Season Totals", ["Total Points", "Total Rebounds", "Total Assists", "Total Steals", "Total Blocks",
                           "Offensive Rebounds", "Turnovers"]),
    ],
}


def group_stats(sport, category, stats):
    """Give each stat its dropdown section and put them in STAT_GROUPS order."""
    order = {}
    for group, labels in STAT_GROUPS[(sport, category)]:
        for label in labels:
            order[label] = (len(order), group)
    for stat in stats:
        if stat["label"] not in order:
            print(f"  ! {stat['label']} has no group in STAT_GROUPS; filed under Other")
    grouped = [{"label": stat["label"], "group": order.get(stat["label"], (0, "Other"))[1],
                **{k: v for k, v in stat.items() if k != "label"}} for stat in stats]
    return sorted(grouped, key=lambda stat: order.get(stat["label"], (len(order), ""))[0])


def write_game_file(sport, category, year, stats):
    stats = group_stats(sport, category, stats)
    output = DATA / sport / str(year) / f"{category or 'stats'}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    entry = {"sport": sport, "year": year, "file": output.relative_to(DATA).as_posix()}
    if category:
        entry["category"] = category
    update_manifest(entry)
    print(f"  {output}: {len(stats)} stats")
    return output


def write_players_file(sport, year, players, game_files):
    """
    players: {id: {name, team, pos}} for everyone who played that season
    (all-time: {id: {name, pos, years}}, no team).
    Every board answer must be pickable, so any board player missing from
    the list is added (with a warning), and names follow the boards.
    """
    players = {str(pid): dict(p) for pid, p in players.items()}
    for path in game_files:
        for stat in json.loads(path.read_text(encoding="utf-8")):
            for p in stat["players"]:
                listed = players.get(p["id"])
                if listed is None:
                    print(f"  ! {p['name']} ({p['id']}) is on a board but not in the player list; adding")
                    players[p["id"]] = ({"name": p["name"], "pos": "", "years": ""} if year == ALL_TIME
                                        else {"name": p["name"], "team": p["team"], "pos": ""})
                else:
                    listed["name"] = p["name"]

    rows = sorted(({"id": pid, **p} for pid, p in players.items()),
                  key=lambda p: (p["name"].split()[-1].lower(), p["name"].lower()))
    output = DATA / sport / str(year) / "players.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    # One player per line: small, and readable in a diff
    lines = ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows)
    output.write_text(f"[\n{lines}\n]\n", encoding="utf-8")
    print(f"  {output}: {len(rows)} players")


def update_manifest(entry):
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = [e for e in manifest["available"] if e["file"] != entry["file"]] + [entry]
    manifest["available"] = sorted(entries, key=lambda e: (e["sport"], e["year"] != ALL_TIME,
                                                           0 if e["year"] == ALL_TIME else -e["year"],
                                                           e.get("category", "")))
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


def mlb_players(year, teams):
    """Everyone who played: the season's player list (names, positions),
    with teams from the season's batting and pitching lines."""
    people = json.loads(fetch(f"{MLB_API}/sports/1/players?season={year}"))["people"]
    players = {p["id"]: {"name": p["fullName"],
                         "team": teams.get(p.get("currentTeam", {}).get("id"), ""),
                         "pos": p.get("primaryPosition", {}).get("abbreviation", "")}
               for p in people}
    for group in MLB_GROUPS.values():
        url = f"{MLB_API}/stats?stats=season&group={group}&season={year}&playerPool=ALL&sportId=1&limit=5000"
        for split in json.loads(fetch(url))["stats"][0]["splits"]:
            player = players.get(split["player"]["id"])
            if not player:
                continue
            num_teams = split.get("numTeams", 1)
            team = f"{num_teams}TM" if num_teams > 1 else teams.get(split.get("team", {}).get("id"))
            if team:
                player["team"] = team
        time.sleep(0.5)
    return players


def build_mlb(year):
    print(f"MLB {year}")
    teams = mlb_team_abbreviations(year)
    game_files = []

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
                rows.append({"rank": leader["rank"], "id": str(leader["person"]["id"]),
                             "name": leader["person"]["fullName"], "team": team, "value": value})
            stat = make_stat(label, rows)
            if stat:
                stats.append(stat)

        game_files.append(write_game_file("mlb", category, year, stats))
        time.sleep(0.5)  # be polite to the API

    write_players_file("mlb", year, mlb_players(year, teams), game_files)


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


# nflverse writes safeties as SAF in recent seasons and S before, and
# kickers and punters as SPEC in old rosters
NFL_POSITION_FIXES = {"SAF": "S", "SPEC": "K/P"}


def nfl_team(code, year):
    for new, since, old in NFL_MOVES:
        if code == new and year < since:
            return old
    return code


def rank_rows(players, value_of, fmt, describe):
    """Sort high to low and rank; players whose shown values match share a rank.
    describe(row) gives the player's {id, name, team}."""
    scored = sorted(((value_of(r), r) for r in players), key=lambda pair: -pair[0])
    rows = []
    for i, (value, r) in enumerate(scored):
        if value <= 0 or i >= 100:
            break
        shown = fmt(value)
        rank = rows[-1]["rank"] if rows and rows[-1]["value"] == shown else i + 1
        rows.append({"rank": rank, **describe(r), "value": shown})
    return rows


def build_nfl(year):
    print(f"NFL {year}")
    # Rows with no name are team totals for plays not credited to a player
    players = [r for r in csv.DictReader(io.StringIO(fetch(NFLVERSE.format(year=year))))
               if r["player_display_name"].strip()]
    team_games = 17 if year >= 2021 else 16

    stats = []
    for label, value_of, fmt, qualifies in nfl_stats(team_games):
        pool = [r for r in players if qualifies is None or qualifies(r)]
        describe = lambda r: {"id": r["player_id"], "name": r["player_display_name"],
                              "team": nfl_team(r["recent_team"], year)}
        stat = make_stat(label, rank_rows(pool, value_of, fmt, describe))
        if stat:
            stats.append(stat)

    game_file = write_game_file("nfl", None, year, stats)

    roster = {r["player_id"]: {"name": r["player_display_name"],
                               "team": nfl_team(r["recent_team"], year),
                               "pos": NFL_POSITION_FIXES.get(r["position"], r["position"])}
              for r in players}
    write_players_file("nfl", year, roster, [game_file])


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

# Everyone who played, sorted by minutes (Totals mode applies no minimums).
# stats.nba.com's endpoints with positions don't answer scripts, so NBA
# players have a team but no position.
NBA_PLAYERS_API = ("https://stats.nba.com/stats/leagueleaders?LeagueID=00&Scope=S"
                   "&SeasonType=Regular%20Season&ActiveFlag=&PerMode=Totals&Season={season}&StatCategory=MIN")

# stats.nba.com's codes for some teams in older seasons, as fans know them
NBA_TEAM_FIXES = {"UTH": "UTA", "GOS": "GSW", "PHL": "PHI", "SAN": "SAS"}


def nba_season(year):
    """We key NBA seasons by the year they end: 2025 is the 2024-25 season."""
    return f"{year - 1}-{str(year)[-2:]}"


def fetch_nba(url):
    try:
        request = urllib.request.Request(url, headers=NBA_HEADERS)
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))["resultSet"]
    finally:
        time.sleep(0.6)  # stats.nba.com blocks rapid-fire requests


def nba_team(code):
    return NBA_TEAM_FIXES.get(code, code)


def build_nba(year):
    print(f"NBA {nba_season(year)}")
    stats = []
    for label, category, mode, fmt in NBA_STATS:
        try:
            result = fetch_nba(NBA_API.format(mode=mode, season=nba_season(year), stat=category))
        except Exception as error:
            print(f"  ! skipped {label}: {error}")
            continue

        column = {name: i for i, name in enumerate(result["headers"])}
        # Already in leaderboard order; rank by the value players will see
        rows = []
        for i, row in enumerate(result["rowSet"][:100]):
            value = row[column[category]]
            if not value:
                continue
            shown = fmt(value)
            rank = rows[-1]["rank"] if rows and rows[-1]["value"] == shown else i + 1
            rows.append({"rank": rank, "id": str(row[column["PLAYER_ID"]]), "name": row[column["PLAYER"]],
                         "team": nba_team(row[column["TEAM"]]), "value": shown})
        stat = make_stat(label, rows)
        if stat:
            stats.append(stat)

    game_file = write_game_file("nba", None, year, stats)

    result = fetch_nba(NBA_PLAYERS_API.format(season=nba_season(year)))
    column = {name: i for i, name in enumerate(result["headers"])}
    roster = {row[column["PLAYER_ID"]]: {"name": row[column["PLAYER"]], "team": nba_team(row[column["TEAM"]]), "pos": ""}
              for row in result["rowSet"]}
    write_players_file("nba", year, roster, [game_file])


# ------------------------------------------------------------
# All-time (career) boards
# ------------------------------------------------------------

def career_years(first, last):
    """'1966–1993', or one year for a one-season career, '' if unknown."""
    if not first:
        return ""
    return str(first) if first == last else f"{first}–{last}"


def main_team(games_by_team):
    """The team a player played the most games for. games_by_team is
    {team: games} in the order they played for them; a tie goes to the
    later team."""
    best = None
    for team, games in games_by_team.items():
        if best is None or games >= games_by_team[best]:
            best = team
    return best or ""


def write_all_time(sport, boards_by_category, roster, teams):
    """Give board players their main team, then write the game files and the guess list."""
    game_files = []
    for category, stats in boards_by_category.items():
        for stat in stats:
            for p in stat["players"]:
                p["team"] = teams.get(p["id"], "")
        game_files.append(write_game_file(sport, category, ALL_TIME, stats))
    write_players_file(sport, ALL_TIME, roster, game_files)


# MLB ------------------------------------------------------------

def mlb_main_teams(ids):
    """{player id: team code} for the team each played the most games for,
    from their season-by-season lines. A franchise counts as one team
    (Brooklyn and LA Dodgers), shown by its code in the player's last
    season there (Christy Mathewson: the New York Giants, not SF)."""
    codes = {}   # (team id, season) -> code

    def code(team_id, season):
        if (team_id, season) not in codes:
            teams = json.loads(fetch(f"{MLB_API}/teams/{team_id}?season={season}")).get("teams", [])
            if not teams:  # some old teams only answer without a season
                teams = json.loads(fetch(f"{MLB_API}/teams/{team_id}")).get("teams", [])
            codes[team_id, season] = teams[0].get("abbreviation", "") if teams else ""
        return codes[team_id, season]

    result = {}
    ids = sorted(ids)
    for start in range(0, len(ids), 40):
        batch = ",".join(ids[start:start + 40])
        url = f"{MLB_API}/people?personIds={batch}&hydrate=stats(group=[hitting,pitching],type=[yearByYear])"
        for person in json.loads(fetch(url))["people"]:
            games = {}  # (season, team id) -> games, hitting or pitching, whichever is more
            for line in person.get("stats", []):
                for split in line["splits"]:
                    team = split.get("team", {}).get("id")
                    if not team or split.get("sport", {}).get("id", 1) != 1:
                        continue  # a season's total across teams, or the minors
                    key = (int(split["season"]), team)
                    games[key] = max(games.get(key, 0), split["stat"].get("gamesPlayed", 0))
            by_team, last_season = {}, {}
            for (season, team), n in sorted(games.items()):
                by_team[team] = by_team.get(team, 0) + n
                last_season[team] = season
            team = main_team(by_team)
            result[str(person["id"])] = code(team, last_season[team]) if team else ""
        time.sleep(0.5)
    return result


def mlb_all_time_players():
    """Everyone who ever played, from each season's player list:
    {id: {name, pos, years}}."""
    players, seen = {}, {}
    for year in range(1871, datetime.date.today().year + 1):
        for p in json.loads(fetch(f"{MLB_API}/sports/1/players?season={year}")).get("people", []):
            first, last = seen.get(p["id"], (year, year))
            seen[p["id"]] = (min(first, year), max(last, year))
            players[p["id"]] = p
        time.sleep(0.2)

    roster = {}
    for pid, p in players.items():
        first, last = seen[pid]
        # Debut and last game are more exact than the season lists (which include the bench)
        if p.get("mlbDebutDate"):
            first = int(p["mlbDebutDate"][:4])
        if p.get("lastPlayedDate"):
            last = max(first, int(p["lastPlayedDate"][:4]))
        pos = p.get("primaryPosition", {}).get("abbreviation", "")
        roster[pid] = {"name": p["fullName"], "pos": "" if pos == "X" else pos,  # X: unknown
                       "years": career_years(first, last)}
    print(f"  {len(roster)} players, 1871-{datetime.date.today().year}")
    return roster


def build_mlb_all_time():
    print("MLB all-time")
    boards = {}
    for category, labels in MLB_STATS.items():
        url = (f"{MLB_API}/stats/leaders?sportId=1&statType=career&limit=100"
               f"&statGroup={MLB_GROUPS[category]}&leaderCategories={','.join(labels)}")
        leaders = {c["leaderCategory"]: c.get("leaders", [])
                   for c in json.loads(fetch(url))["leagueLeaders"]}
        stats = []
        for key, label in labels.items():
            rows = [{"rank": leader["rank"], "id": str(leader["person"]["id"]),
                     "name": leader["person"]["fullName"], "team": "", "value": leader["value"]}
                    for leader in leaders.get(key, []) if leader["value"] and float(leader["value"]) != 0]
            stat = make_stat(label, rows)
            if stat:
                stats.append(stat)
        boards[category] = stats
        time.sleep(0.5)

    ids = {p["id"] for stats in boards.values() for stat in stats for p in stat["players"]}
    write_all_time("mlb", boards, mlb_all_time_players(), mlb_main_teams(ids))


# NBA ------------------------------------------------------------

NBA_ALL_TIME_API = ("https://stats.nba.com/stats/leagueleaders?LeagueID=00&Scope=S"
                    "&SeasonType=Regular%20Season&ActiveFlag=&PerMode=Totals&Season=All%20Time&StatCategory=PTS")
NBA_FIRST_SEASON = 1947  # 1946-47, the BAA's first season


# Career minimums, as Basketball Reference's all-time lists use:
# per-game stats need 400 games; percentages need enough makes.
def nba_all_time_stats():
    per_game = lambda column: lambda r: r[column] / r["GP"]
    games = lambda r: r["GP"] >= 400
    return [
        ("Points per Game", per_game("PTS"), one_decimal, games),
        ("Rebounds per Game", per_game("REB"), one_decimal, games),
        ("Assists per Game", per_game("AST"), one_decimal, games),
        ("Steals per Game", per_game("STL"), one_decimal, games),
        ("Blocks per Game", per_game("BLK"), one_decimal, games),
        ("3-Pointers Made per Game", per_game("FG3M"), one_decimal, games),
        ("Minutes per Game", per_game("MIN"), one_decimal, games),
        ("Field Goal %", lambda r: r["FGM"] / r["FGA"] * 100, percent, lambda r: r["FGM"] >= 2000),
        ("3-Point %", lambda r: r["FG3M"] / r["FG3A"] * 100, percent, lambda r: r["FG3M"] >= 250),
        ("Free Throw %", lambda r: r["FTM"] / r["FTA"] * 100, percent, lambda r: r["FTM"] >= 1200),
        ("Total Points", lambda r: r["PTS"], whole, None),
        ("Total Rebounds", lambda r: r["REB"], whole, None),
        ("Total Assists", lambda r: r["AST"], whole, None),
        ("Total Steals", lambda r: r["STL"], whole, None),
        ("Total Blocks", lambda r: r["BLK"], whole, None),
        ("3-Pointers Made", lambda r: r["FG3M"], whole, None),
        ("Free Throws Made", lambda r: r["FTM"], whole, None),
        ("Field Goals Made", lambda r: r["FGM"], whole, None),
        ("Offensive Rebounds", lambda r: r["OREB"], whole, None),
        ("Turnovers", lambda r: r["TOV"], whole, None),
    ]


def nba_careers():
    """Every player's seasons and games per team, from each season's
    player list: {id: {"first", "last", "games": {team: games}}}, NBA
    years being the season's end. Seasons the source has no list for
    (the earliest few) are skipped."""
    careers = {}
    for year in range(NBA_FIRST_SEASON, datetime.date.today().year + 2):
        url = NBA_PLAYERS_API.format(season=nba_season(year)).replace("StatCategory=MIN", "StatCategory=PTS")
        try:
            rows = fetch_nba(url)
        except Exception as error:
            print(f"  ! no player list for {nba_season(year)}: {error}")
            continue
        column = {name: i for i, name in enumerate(rows["headers"])}
        for row in rows["rowSet"]:
            career = careers.setdefault(str(row[column["PLAYER_ID"]]), {"first": year, "last": year, "games": {}})
            career["last"] = year
            team = nba_team(row[column["TEAM"]])
            career["games"][team] = career["games"].get(team, 0) + (row[column["GP"]] or 0)
    return careers


def build_nba_all_time():
    print("NBA all-time")
    result = fetch_nba(NBA_ALL_TIME_API)
    column = {name: i for i, name in enumerate(result["headers"])}
    players = [{name: row[i] or 0 for name, i in column.items()} for row in result["rowSet"]]
    print(f"  {len(players)} players")

    describe = lambda r: {"id": str(r["PLAYER_ID"]), "name": r["PLAYER_NAME"], "team": ""}
    stats = []
    for label, value_of, fmt, qualifies in nba_all_time_stats():
        pool = [r for r in players if r["GP"] and (qualifies is None or qualifies(r))]
        stat = make_stat(label, rank_rows(pool, value_of, fmt, describe))
        if stat:
            stats.append(stat)

    careers = nba_careers()
    # Years run from the first season's start to the last one's end: 1969–1989
    years = lambda c: career_years(c["first"] - 1, c["last"]) if c else ""
    roster = {str(r["PLAYER_ID"]): {"name": r["PLAYER_NAME"], "pos": "",
                                    "years": years(careers.get(str(r["PLAYER_ID"])))}
              for r in players}
    teams = {pid: main_team(c["games"]) for pid, c in careers.items()}
    write_all_time("nba", {None: stats}, roster, teams)

# NFL ------------------------------------------------------------
# No open source has full NFL careers as numbers (nflverse starts in
# 1999), so the boards come from Wikipedia's lists of NFL career leaders
# (kept current by editors, from Pro Football Reference; free to reuse
# with credit), and the players from nflverse's season rosters, 1920 on.

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php?action=parse&prop=text&format=json&formatversion=2&page="
# Wikipedia wants a descriptive User-Agent with a way to reach us
WIKIPEDIA_HEADERS = {"User-Agent": "postgames-trivia-builder/1.0 (https://github.com/joeydunn22/postgames)"}
NFL_ROSTERS = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_{year}.csv"
NFL_FIRST_SEASON = 1920

# (label, Wikipedia list "List of NFL career ___ leaders", value column,
# display format, positions the player plays: used only to tell apart
# two players with the same name)
NFL_CAREER_STATS = [
    ("Passing Yards", "passing yards", "Yds", whole, {"QB"}),
    ("Passing TDs", "passing touchdowns", "TDs", whole, {"QB"}),
    ("Completions", "passing completions", "Completions", whole, {"QB"}),
    ("Interceptions Thrown", "interceptions thrown", "Total", whole, {"QB"}),
    ("Passer Rating", "passer rating", "Rating", one_decimal, {"QB"}),
    ("Quarterback Wins", "quarterback wins", "Career wins", whole, {"QB"}),
    ("Rushing Yards", "rushing yards", "Yards", whole, {"RB", "FB", "HB", "QB"}),
    ("Rushing TDs", "rushing touchdowns", "Touchdowns", whole, {"RB", "FB", "HB", "QB"}),
    ("Carries", "rushing attempts", "Attempts", whole, {"RB", "FB", "HB"}),
    ("Receptions", "receptions", "Receptions", whole, {"WR", "TE", "RB", "FB", "HB", "E"}),
    ("Receiving Yards", "receiving yards", "Yards", whole, {"WR", "TE", "RB", "FB", "HB", "E"}),
    ("Receiving TDs", "receiving touchdowns", "Touchdowns", whole, {"WR", "TE", "RB", "FB", "HB", "E"}),
    ("All-Purpose Yards", "all-purpose yards", "Total all-purpose yards gained", whole, None),
    ("Points Scored", "scoring", "Points", whole, {"K", "PK"}),
    ("Games Played", "games played", "Games", whole, None),
    ("Sacks", "sacks", "Sacks", one_decimal, {"DE", "DT", "LB", "OLB", "DL", "NT"}),
    ("Interceptions", "interceptions", "Ints", whole, {"CB", "S", "SS", "FS", "DB", "SAF"}),
    ("Kick Return Yards", "kickoff return yards", "Yards", whole, None),
]

# nflverse's roster codes for some teams and eras, as fans know them
# (CHR was the Chicago Rockets before it was the 1960 LA Chargers)
NFL_ROSTER_TEAM_FIXES = {"ARZ": "ARI", "BLT": "BAL", "CLV": "CLE", "HST": "HOU", "SL": "STL",
                         "COW": "DAL", "RAM": "LA", "CHB": "CHI", "NY": "NYG"}
NFL_ROSTER_TEAM_FIXES_BY_SEASON = {("CHR", 1960): "LAC"}
# Roster statuses for a season a player wasn't on the team: retired, a
# free agent, not with the team. These seasons don't count.
NFL_OFF_ROSTER = {"RET", "RSR", "RSN", "UFA", "RFA", "NWT", "EXE"}
NFL_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
# Wikipedia's name -> the roster's, where they differ by more than punctuation
NFL_NAME_FIXES = {"Michael Vick": "Mike Vick", "Josh Cribbs": "Joshua Cribbs", "Matthew Slater": "Matt Slater",
                  'Ed "Too Tall" Jones': "Too Tall Jones", "Dick Lane": "Night Train Lane"}


def name_key(name):
    """'Odell Beckham Jr.' and 'Odell Beckham' -> 'odell beckham';
    'Y. A. Tittle' and 'Y.A. Tittle' -> 'ya tittle'."""
    import unicodedata
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    plain = re.sub(r"\b(\w)\.\s*(?=\w\.)", r"\1", plain)   # run initials together
    words = [w for w in "".join(c if c.isalnum() or c.isspace() else "" for c in plain).split()
             if w not in NFL_NAME_SUFFIXES]
    return " ".join(words)


class WikiTables(HTMLParser):
    """Every table on a Wikipedia page as rows of cell texts, header row
    first, with cells that span rows or columns repeated where they reach.
    Footnote marks and hidden sort keys are left out."""

    def __init__(self):
        super().__init__()
        self.tables, self._open, self._cell, self._skip = [], [], None, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        hidden = (tag == "sup" or tag == "style"
                  or (tag == "span" and ("sortkey" in (a.get("class") or "")
                                         or "display:none" in (a.get("style") or "").replace(" ", ""))))
        if self._skip or hidden:
            if tag in ("sup", "style", "span"):
                self._skip += 1
            return
        if tag == "table":
            self._open.append([])
        elif not self._open:
            return
        elif tag == "tr":
            self._open[-1].append([])
        elif tag in ("td", "th"):
            span = lambda key: int("".join(c for c in a.get(key, "1") if c.isdigit()) or 1)
            self._cell = {"text": "", "rows": span("rowspan"), "cols": span("colspan")}
        elif tag == "br" and self._cell:
            self._cell["text"] += " "

    def handle_endtag(self, tag):
        if self._skip:
            if tag in ("sup", "style", "span"):
                self._skip -= 1
            return
        if tag in ("td", "th") and self._cell is not None and self._open and self._open[-1]:
            self._open[-1][-1].append(self._cell)
            self._cell = None
        elif tag == "table" and self._open:
            self.tables.append(self._fill(self._open.pop()))

    def handle_data(self, data):
        if self._cell is not None and not self._skip:
            self._cell["text"] += data

    @staticmethod
    def _fill(rows):
        grid, carried = [], {}   # column -> (text, rows still to cover)
        for cells in rows:
            row, cells = [], list(cells)
            while cells or len(row) in carried:
                col = len(row)
                if col in carried:
                    text, left = carried.pop(col)
                    if left > 1:
                        carried[col] = (text, left - 1)
                    row.append(text)
                    continue
                cell = cells.pop(0)
                text = " ".join(cell["text"].replace("\xad", "").split())
                for _ in range(cell["cols"]):
                    if cell["rows"] > 1:
                        carried[len(row)] = (text, cell["rows"] - 1)
                    row.append(text)
            grid.append(row)
        return grid


def wikipedia_leaders(page, value_column):
    """The first table on 'List of NFL career {page} leaders' with a
    `value_column` column (the regular season list; playoff lists come
    after): [{name, value, years}], one per player in list order. years
    is the (first, last) season the row mentions, or None."""
    url = WIKIPEDIA_API + urllib.parse.quote(f"List of NFL career {page} leaders".replace(" ", "_"))
    request = urllib.request.Request(url, headers=WIKIPEDIA_HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        html = json.loads(response.read().decode("utf-8"))["parse"]["text"]
    time.sleep(1)

    parser = WikiTables()
    parser.feed(html)
    clean = lambda text: re.sub(r"\[?\w?\d*\]|[†‡^*§#¤]", "", text).strip()
    for table in parser.tables:
        if not table:
            continue
        header = [clean(h) for h in table[0]]
        player_col = next((i for i, h in enumerate(header) if h in ("Player", "Name", "Quarterback")), None)
        if value_column not in header or player_col is None:
            continue
        value_col = header.index(value_column)
        year_cols = [i for i, h in enumerate(header) if re.search(r"Season|Team|Career|Period", h)]
        players = {}
        for row in table[1:]:
            if len(row) <= max(value_col, player_col):
                continue
            name = clean(row[player_col])
            number = row[value_col].replace(",", "")
            try:
                value = float(re.match(r"[\d.]+", number).group())
            except (AttributeError, ValueError):
                continue
            seen = players.setdefault(name, {"name": name, "value": value, "years": set()})
            for i in year_cols:
                text = row[i] if i < len(row) else ""
                seen["years"].update(int(y) for y in re.findall(r"\b(?:19|20)\d\d\b", text))
                if "present" in text:
                    seen["years"].add(datetime.date.today().year)
        found = list(players.values())
        for p in found:
            p["years"] = (min(p["years"]), max(p["years"])) if p["years"] else None
        return found
    raise ValueError(f"no '{value_column}' table on the {page} list")


def nfl_all_time_players():
    """Everyone on an NFL roster since 1920, from nflverse's season
    rosters: {id: {name, pos, years, team}}, team being the one they were
    on for the most seasons. A player is one id across seasons: their
    nflverse (gsis) id, else Pro Football Reference id, else name + birth
    date (older rosters have no ids)."""
    rows = []
    for year in range(NFL_FIRST_SEASON, datetime.date.today().year + 1):
        try:
            rows += [r for r in csv.DictReader(io.StringIO(fetch(NFL_ROSTERS.format(year=year))))
                     if r["full_name"].strip()]
        except Exception as error:
            print(f"  ! no roster for {year}: {error}")
    known = {}   # (name, birth date) -> an id seen for that player
    for r in rows:
        if r["birth_date"] and (r["gsis_id"] or r["pfr_id"]):
            known.setdefault((name_key(r["full_name"]), r["birth_date"]), r["gsis_id"] or r["pfr_id"])

    players = {}
    for r in sorted(rows, key=lambda r: int(r["season"])):
        if r["status"] in NFL_OFF_ROSTER:
            continue
        key = (name_key(r["full_name"]), r["birth_date"])
        pid = r["gsis_id"] or known.get(key) or r["pfr_id"] or \
            "nfl-" + "-".join(key[0].split() + ([r["birth_date"]] if r["birth_date"] else []))
        p = players.setdefault(pid, {"name": r["full_name"], "seasons": {}, "positions": {}})
        p["name"] = r["full_name"]   # latest spelling
        season = int(r["season"])
        team = NFL_ROSTER_TEAM_FIXES_BY_SEASON.get((r["team"], season)) or NFL_ROSTER_TEAM_FIXES.get(r["team"], r["team"])
        p["seasons"].setdefault(team, set()).add(season)
        pos = NFL_POSITION_FIXES.get(r["position"], r["position"])
        if pos:
            p["positions"][pos] = p["positions"].get(pos, 0) + 1

    roster = {}
    for pid, p in players.items():
        seasons = sorted(s for years in p["seasons"].values() for s in years)
        by_team = {team: len(years) for team, years in sorted(p["seasons"].items(), key=lambda kv: max(kv[1]))}
        roster[pid] = {"name": p["name"],
                       "pos": max(p["positions"], key=p["positions"].get) if p["positions"] else "",
                       "years": career_years(seasons[0], seasons[-1]),
                       "team": main_team(by_team), "first": seasons[0], "last": seasons[-1]}
    print(f"  {len(roster)} players, {NFL_FIRST_SEASON}-{datetime.date.today().year}")
    return roster


def match_nfl_player(leader, positions, by_name):
    """The roster id for a Wikipedia list's player: same name, then (for
    two players with one name) a career overlapping the list's seasons,
    then a fitting position, then the longest career. None if no name matches."""
    candidates = by_name.get(name_key(NFL_NAME_FIXES.get(leader["name"], leader["name"])), [])
    if leader["years"] and len(candidates) > 1:
        first, last = leader["years"]
        overlapping = [c for c in candidates if c[1]["first"] <= last and c[1]["last"] >= first]
        candidates = overlapping or candidates
    if positions and len(candidates) > 1:
        candidates = [c for c in candidates if c[1]["pos"] in positions] or candidates
    if not candidates:
        return None
    return max(candidates, key=lambda c: c[1]["last"] - c[1]["first"])[0]


def build_nfl_all_time():
    print("NFL all-time")
    roster = nfl_all_time_players()
    by_name = {}
    for pid, p in roster.items():
        by_name.setdefault(name_key(p["name"]), []).append((pid, p))

    stats = []
    for label, page, column, fmt, positions in NFL_CAREER_STATS:
        try:
            leaders = wikipedia_leaders(page, column)
        except Exception as error:
            print(f"  ! skipped {label}: {error}")
            continue
        for leader in leaders:
            pid = match_nfl_player(leader, positions, by_name)
            if pid:
                leader["id"] = pid   # keeping Wikipedia's spelling of the name, the better known one
            else:
                print(f"  ! {label}: no roster match for {leader['name']}")
                leader["id"] = "wiki-" + "-".join(name_key(leader["name"]).split())
        describe = lambda r: {"id": r["id"], "name": r["name"], "team": ""}
        stat = make_stat(label, rank_rows(leaders, lambda r: r["value"], fmt, describe))
        if stat:
            stats.append(stat)

    teams = {pid: p["team"] for pid, p in roster.items()}
    guess_list = {pid: {"name": p["name"], "pos": p["pos"], "years": p["years"]} for pid, p in roster.items()}
    write_all_time("nfl", {None: stats}, guess_list, teams)


# ------------------------------------------------------------
# Command line
# ------------------------------------------------------------

BUILDERS = {"mlb": build_mlb, "nba": build_nba, "nfl": build_nfl}
ALL_TIME_BUILDERS = {"mlb": build_mlb_all_time, "nba": build_nba_all_time, "nfl": build_nfl_all_time}


def parse_years(text):
    first, _, last = text.partition("-")
    if not first.isdigit() or (last and not last.isdigit()):
        sys.exit(__doc__)
    return range(int(first), int(last or first) + 1)


def main(args):
    if len(args) != 2 or args[0] not in BUILDERS:
        sys.exit(__doc__)
    if args[1] == ALL_TIME:
        if args[0] not in ALL_TIME_BUILDERS:
            sys.exit(f"No all-time boards for {args[0]} yet.")
        ALL_TIME_BUILDERS[args[0]]()
        return
    for year in parse_years(args[1]):
        try:
            BUILDERS[args[0]](year)
        except Exception as error:  # keep going: one bad season shouldn't stop a backfill
            print(f"  ! {args[0]} {year} failed: {error}")


if __name__ == "__main__":
    main(sys.argv[1:])
