# enrich_names.py

import json
import unicodedata
import re

# ------------------------------------------------------------
# Normalization helper (accent-insensitive, punctuation-stripped)
# ------------------------------------------------------------

def normalize_name(s):
    if not s:
        return ""
    s = s.lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")  # remove accents
    s = re.sub(r"[^a-z0-9 ]", "", s)  # remove punctuation
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ------------------------------------------------------------
# Memory for (last, team) → first_name
# ------------------------------------------------------------

memory = {}

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


# ------------------------------------------------------------
# Load MLB players from mlbplayers2025.txt
# Handles:
#   - middle initials (Luis F. Castillo → Castillo)
#   - multi-word surnames (De La Cruz)
#   - no ethnicity heuristics
# ------------------------------------------------------------

def load_mlb_players(path="data/mlb/2025/raw/mlbplayers2025.txt"):
    players = []

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            parts = line.split()
            first = parts[0]

            # Middle initial detection: "X."
            if (
                len(parts) > 2 and
                len(parts[1]) == 2 and
                parts[1][0].isalpha() and
                parts[1][1] == "."
            ):
                last = " ".join(parts[2:])
            else:
                last = " ".join(parts[1:])

            players.append({"first": first, "last": last})

    return players


# ------------------------------------------------------------
# Generate multiple lookup keys for each MLB last name
# ------------------------------------------------------------

def keys_for_mlb_last(raw_last):
    raw_last = raw_last.strip()
    norm = normalize_name(raw_last)
    parts = norm.split()

    keys = set()

    # Full normalized last name
    if norm:
        keys.add(norm)

    # Final token (Lee, Cruz, Castillo)
    if parts:
        keys.add(parts[-1])

    # Last two tokens (la cruz, de los, etc.)
    if len(parts) >= 2:
        keys.add(" ".join(parts[-2:]))

    # Suffix removal (Harris II → Harris)
    if parts and parts[-1] in SUFFIXES:
        base = " ".join(parts[:-1])
        if base:
            keys.add(base)
            base_parts = base.split()
            keys.add(base_parts[-1])

    return keys


# ------------------------------------------------------------
# Build lookup: normalized_key → list of (first, raw_last)
# ------------------------------------------------------------

def build_lastname_lookup(players):
    lookup = {}
    for p in players:
        first = p["first"]
        raw_last = p["last"]
        for k in keys_for_mlb_last(raw_last):
            lookup.setdefault(k, []).append((first, raw_last))
    return lookup


# ------------------------------------------------------------
# Interactive enrichment
# ------------------------------------------------------------

def interactive_enrich_all(
    input_path="data/mlb/2025/processed/pitching_2025_raw.json",
    output_path="data/mlb/2025/processed/pitching_2025_enriched.json",
    players_path="data/mlb/2025/raw/mlbplayers2025.txt"
):
    # Load MLB players + lookup
    players = load_mlb_players(players_path)
    lookup = build_lastname_lookup(players)

    # Load raw stats
    with open(input_path, "r", encoding="utf-8") as f:
        all_stats = json.load(f)

    # Walk through every stat block
    for stat in all_stats:
        stat_label = stat["stat_label"]

        for p in stat["players"]:
            last = p["player"]
            norm_last = normalize_name(last)
            team = p["team"]
            value = p["value"]

            # Memory first
            if (last, team) in memory:
                p["first_name"] = memory[(last, team)]
                continue

            # Build candidate list
            candidates = []

            # 1. Exact key match
            if norm_last in lookup:
                candidates.extend(lookup[norm_last])

            # 2. Token-based match (Lee → Hoo Lee, etc.)
            for key, fl_pairs in lookup.items():
                key_parts = key.split()
                if norm_last in key_parts:
                    candidates.extend(fl_pairs)

            # Deduplicate
            seen = set()
            unique = []
            for first, raw_last in candidates:
                if (first, raw_last) not in seen:
                    seen.add((first, raw_last))
                    unique.append((first, raw_last))
            candidates = unique

            # Case 1: exactly one candidate
            if len(candidates) == 1:
                chosen_first = candidates[0][0]
                p["first_name"] = chosen_first
                memory[(last, team)] = chosen_first
                continue

            # Case 2: no candidates
            if len(candidates) == 0:
                print(f"\nNo matches found for {last} ({team}) in {stat_label}")
                chosen = input("Enter first name manually: ").strip()
                p["first_name"] = chosen
                memory[(last, team)] = chosen
                continue

            # Case 3: ambiguous
            print(f"\nAmbiguous name: {last} ({team}) in {stat_label}, value {value}")
            print("Possible first names:")
            for i, (first, raw_last) in enumerate(candidates, start=1):
                print(f"  {i}. {first}  (MLB last: {raw_last})")

            while True:
                choice = input("Choose number: ").strip()
                if choice.isdigit() and 1 <= int(choice) <= len(candidates):
                    chosen_first = candidates[int(choice) - 1][0]
                    p["first_name"] = chosen_first
                    memory[(last, team)] = chosen_first
                    break
                print("Invalid choice. Try again.")

    # Write enriched file
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_stats, f, ensure_ascii=False, indent=2)

    print(f"\nEnriched file written to {output_path}")


# ------------------------------------------------------------
# Entry point
# ------------------------------------------------------------

if __name__ == "__main__":
    interactive_enrich_all()