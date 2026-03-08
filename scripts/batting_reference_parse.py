import re
import json

INPUT_FILE = "data/mlb/2025/raw/2025-batting.txt"

def clean_stat_id(label):
    """Convert stat label to a clean ID."""
    return re.sub(r'[^a-z0-9]+', '_', label.lower()).strip('_')

def parse_player_line(line, last_rank):
    m = re.match(
        r'^(?:(?:T-?|t-?)?(\d+)[Tt]?\.?[\t ]+)?'   # optional rank
        r'(.+?)\s*•\s*([A-Z0-9]{2,3})[\t ]+([0-9.]+)$',
        line
    )

    if not m:
        return None, last_rank

    rank_str = m.group(1)
    name = m.group(2).strip().rstrip("*").rstrip()
    team = m.group(3).strip()
    value = float(m.group(4))

    rank = int(rank_str) if rank_str is not None else last_rank

    return {
        "rank": rank,
        "player_last": name,
        "team": team,
        "value": value
    }, rank

def parse_file():
    """Reads the entire .txt file and splits it into stat blocks."""
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        lines = [line.rstrip("\n") for line in f]

    stats = []
    current_label = None
    current_rows = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Stat header: no bullet "•" in line
        if "•" not in stripped:
            if current_label and current_rows:
                stats.append((current_label, current_rows))
            current_label = stripped
            current_rows = []
            continue

        # Otherwise it's a player row (ranked or missing-rank tie)
        current_rows.append(stripped)

    # Save last block
    if current_label and current_rows:
        stats.append((current_label, current_rows))

    return stats

def build_stat_json(label, rows):
    """Builds JSON for a single stat block."""
    stat_id = clean_stat_id(label)
    parsed_rows = []

    last_rank = None

    for r in rows:
        p, last_rank = parse_player_line(r, last_rank)
        if p:
            parsed_rows.append(p)

    # Sort by value descending
    parsed_rows.sort(key=lambda x: x["value"], reverse=True)

    # Top 10 + ties
    top10 = parsed_rows[:10]
    if not top10:
        return None

    threshold = top10[-1]["value"]
    final_rows = [p for p in parsed_rows if p["value"] >= threshold]

    return {
        "sport": "mlb",
        "season": 2025,
        "stat_id": stat_id,
        "stat_label": label,
        "players": [
            {
                "rank": p["rank"],
                "player": p["player_last"],
                "first_name": None,
                "team": p["team"],
                "value": p["value"]
            }
            for p in final_rows
        ]
    }

def main():
    stats = parse_file()
    all_stats = []

    for label, rows in stats:
        data = build_stat_json(label, rows)
        if not data:
            print(f"\nSkipping {label} — could not parse")
            continue

        all_stats.append(data)

    #with open("data/mlb/2025/processed/batting_2025_raw.json", "w", encoding="utf-8") as f:   #  ----- commented out to avoid overwriting
    #    json.dump(all_stats, f, ensure_ascii=False, indent=2)   #   ----- commented out to avoid overwriting

if __name__ == "__main__":
    main()