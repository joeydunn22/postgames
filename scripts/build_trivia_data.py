"""
Build Top 10 trivia data from Baseball/Football Reference leaderboard text.

Usage (run from the repo root):
    python scripts/build_trivia_data.py mlb batting 2025
    python scripts/build_trivia_data.py mlb pitching 2025
    python scripts/build_trivia_data.py nfl 2025

Input:   data/{sport}/{year}/raw/{year}-{category or sport}.txt
         (the leaderboards page copied as text: a stat name line, then
         rows like "1.  Judge • NYY  9.7")
Output:  data/{sport}/{year}/{category or "stats"}.json
         and a matching entry in data/manifest.json, so the game offers it.

MLB leaderboards only show last names. First names come from
data/mlb/{year}/raw/mlbplayers{year}.txt (one "First Last" per line).
Every choice is remembered in data/mlb/first_names.json, keyed by
"Last|TEAM", so you're only asked about a player once. Edit that
file to fix a wrong first name.
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

DATA = Path("data")
MANIFEST = DATA / "manifest.json"
FIRST_NAMES = DATA / "mlb" / "first_names.json"

TOP_N = 10

# Source stat names that read badly in the game
LABEL_FIXES = {
    "Wins Above Replacement--all": "Wins Above Replacement",
}

# "1.  Judge • NYY  9.7", "T-4  Skenes • PIT  7.7", or an unranked tie row
ROW = re.compile(
    r"^(?:(?:T-?|t-?)?(\d+)[Tt]?\.?[\t ]+)?"  # optional rank
    r"(.+?)\s*•\s*([A-Z0-9]{2,3})[\t ]+"      # name • TEAM
    r"([0-9.]+%?)(?:\s*\*+)?$"                # value as printed, then an optional ** footnote
)
MORE_TIED = re.compile(r"^(\d+) more tied at", re.IGNORECASE)
SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


# ------------------------------------------------------------
# Parsing the leaderboard text
# ------------------------------------------------------------

def read_blocks(path):
    """Split the file into (stat label, lines) blocks."""
    blocks = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.lower().startswith("view all players"):
            continue
        is_header = "•" not in line and not MORE_TIED.match(line)
        if is_header:
            blocks.append((line, []))
        elif blocks:
            blocks[-1][1].append(line)
    return blocks


def parse_block(lines):
    """Rows ranked in the top 10 (ties included), plus how many tied rows the source left out."""
    rows = []
    rank = None
    more_tied = 0

    for line in lines:
        tied = MORE_TIED.match(line)
        if tied:
            more_tied = int(tied.group(1))
            continue

        match = ROW.match(line)
        if not match:
            print(f"  ! couldn't read row: {line!r}")
            continue

        rank_text, name, team, value = match.groups()
        rank = int(rank_text) if rank_text else rank  # unranked rows tie the row above
        if rank is not None and rank <= TOP_N:
            rows.append({"rank": rank, "name": name.rstrip("*").strip(), "team": team, "value": value})

    return rows, more_tied


# ------------------------------------------------------------
# MLB first names
# ------------------------------------------------------------

def normalize(text):
    """Lowercase, no accents or punctuation: "Rodríguez Jr." -> "rodriguez jr"."""
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^a-z0-9 ]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def load_roster(path):
    """Map every plausible form of each last name to its (first, last) players."""
    lookup = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        first = parts[0]
        # Skip a middle initial: "Luis F. Castillo" -> "Castillo"
        has_initial = len(parts) > 2 and re.fullmatch(r"[A-Za-z]\.", parts[1])
        last = " ".join(parts[2:] if has_initial else parts[1:])

        words = normalize(last).split()
        keys = {" ".join(words), words[-1], " ".join(words[-2:])}
        if words[-1] in SUFFIXES and len(words) > 1:
            keys |= {" ".join(words[:-1]), words[-2]}
        for key in keys:
            lookup.setdefault(key, []).append((first, last))
    return lookup


def roster_candidates(last, lookup):
    """Roster players whose last name matches exactly or contains it as a word."""
    key = normalize(last)
    found = list(lookup.get(key, []))
    for roster_key, players in lookup.items():
        if key in roster_key.split():
            found.extend(players)
    return list(dict.fromkeys(found))  # dedupe, keep order


def choose_first_name(last, team, context, candidates):
    """Ask on the command line when the roster doesn't settle it."""
    if not candidates:
        print(f"\nNo roster match for {last} ({team}) in {context}")
        return input("First name: ").strip()

    print(f"\nWhich {last} ({team}) in {context}?")
    for i, (first, full_last) in enumerate(candidates, start=1):
        print(f"  {i}. {first} {full_last}")
    while True:
        choice = input("Number: ").strip()
        if choice.isdigit() and 1 <= int(choice) <= len(candidates):
            return candidates[int(choice) - 1][0]
        print("Pick one of the numbers above.")


def add_first_names(stats, year):
    known = json.loads(FIRST_NAMES.read_text(encoding="utf-8")) if FIRST_NAMES.exists() else {}
    lookup = load_roster(DATA / "mlb" / str(year) / "raw" / f"mlbplayers{year}.txt")

    for stat in stats:
        for player in stat["players"]:
            last, team = player["name"], player["team"]
            key = f"{last}|{team}"
            if key not in known:
                candidates = roster_candidates(last, lookup)
                known[key] = (candidates[0][0] if len(candidates) == 1
                              else choose_first_name(last, team, stat["label"], candidates))
                FIRST_NAMES.write_text(json.dumps(known, ensure_ascii=False, indent=2, sort_keys=True),
                                       encoding="utf-8")  # save as we go
            player["name"] = f"{known[key]} {last}"


# ------------------------------------------------------------
# Output
# ------------------------------------------------------------

def update_manifest(entry):
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = [e for e in manifest["available"] if e["file"] != entry["file"]] + [entry]
    manifest["available"] = sorted(entries, key=lambda e: (e["sport"], -e["year"], e.get("category", "")))
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build(sport, category, year):
    source = DATA / sport / str(year) / "raw" / f"{year}-{category or sport}.txt"
    output = DATA / sport / str(year) / f"{category or 'stats'}.json"
    print(f"Reading {source}")

    stats = []
    for label, lines in read_blocks(source):
        rows, more_tied = parse_block(lines)
        if not rows:
            print(f"  ! skipped {label!r}: no rows")
            continue
        stat = {"label": LABEL_FIXES.get(label, label), "players": rows}
        if more_tied:
            stat["more_tied"] = more_tied  # source didn't list everyone tied for 10th
        stats.append(stat)

    if sport == "mlb":
        add_first_names(stats, year)

    output.write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    entry = {"sport": sport, "year": year, "file": output.relative_to(DATA).as_posix()}
    if category:
        entry["category"] = category
    update_manifest(entry)
    print(f"Wrote {len(stats)} stats to {output} and updated {MANIFEST}")


def main(args):
    if len(args) == 3 and args[0] == "mlb" and args[1] in ("batting", "pitching") and args[2].isdigit():
        build("mlb", args[1], int(args[2]))
    elif len(args) == 2 and args[0] in ("nfl", "nba") and args[1].isdigit():
        build(args[0], None, int(args[1]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
