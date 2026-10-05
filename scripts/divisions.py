"""Leagues and divisions for every team, by season.

Used by build_daily.py (Who's Missing's hints, and checking every team
on every board is covered) and by the game's hints, which read the same
tables from data/divisions.json. Run this file (or build_daily.py) after
changing a table to rewrite that JSON:

    python scripts/divisions.py
"""

import json
from pathlib import Path

DIVISIONS_JSON = Path("data") / "divisions.json"


# ------------------------------------------------------------------
# Leagues and divisions, by season. Each sport is a list of
# (first season, last season, {division: [teams]}) blocks, plus moves
# for single teams. Seasons are the data's years (NBA = the year the
# season ends). build_daily.py --check makes sure every team on every
# board is covered.
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


def write_divisions():
    """The tables as data/divisions.json, for the game (see divisionOf in top10-common.js)."""
    def blocks(table):
        return [{"first": first, "last": last, "divisions": divisions} for first, last, divisions in table]

    DIVISIONS_JSON.write_text(json.dumps({
        "_readme": "Leagues and divisions by season, for the game's hints. Written by scripts/divisions.py; edit the tables there.",
        "mlb": {"leagues": MLB_LEAGUES, "blocks": blocks(MLB_DIVISIONS)},
        "nfl": {"leagues": NFL_LEAGUES, "blocks": blocks(NFL_DIVISIONS)},
        "nba": {"leagues": NBA_CONFERENCES, "blocks": blocks(NBA_DIVISIONS),
                "moves": [{"team": t, "first": f, "last": l, "division": d} for t, f, l, d in NBA_MOVES]},
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{DIVISIONS_JSON} written")


if __name__ == "__main__":
    write_divisions()
