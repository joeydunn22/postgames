import re
import json

INPUT_FILE = "data/nfl/2025/raw/2025-nfl.txt"

def clean_stat_id(label):
    return re.sub(r'[^a-z0-9]+', '_', label.lower()).strip('_')

def split_name(full_name):
    parts = full_name.split()
    if len(parts) == 1:
        return parts[0], parts[0]
    return parts[0], " ".join(parts[1:])

def parse_player_line(line, last_rank):
    lower = line.lower()

    # Incomplete indicator
    if "tied at" in lower:
        return None, last_rank, True

    m = re.match(
        r'^(?:(?:T-?|t-?)?(\d+)[Tt]?\.?[\t ]+)?'
        r'(.+?)\s*•\s*([A-Z0-9]{3})[\t ]+([0-9.]+%?)$',
        line
    )

    if not m:
        return None, last_rank, False

    rank_str = m.group(1)
    full_name = m.group(2).strip().rstrip("*").rstrip()
    team = m.group(3).strip()
    raw_value = m.group(4)

    is_percent = raw_value.endswith('%')
    value = float(raw_value.rstrip('%'))

    first, last = split_name(full_name)
    rank = int(rank_str) if rank_str is not None else last_rank

    return {
        "rank": rank,
        "player": last,
        "first_name": first,
        "team": team,
        "value": value,
        "is_percent": is_percent
    }, rank, False

def parse_file():
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        lines = [line.rstrip("\n") for line in f]

    stats = []
    current_label = None
    current_rows = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        lower = stripped.lower()

        # "tied at" lines belong to current stat block
        if "tied at" in lower:
            current_rows.append(stripped)
            continue

        # Real stat header: no bullet AND not "view all players"
        if "•" not in stripped and "view all players" not in lower:
            if current_label and current_rows:
                stats.append((current_label, current_rows))
            current_label = stripped
            current_rows = []
            continue

        # Player row
        if "•" in stripped:
            current_rows.append(stripped)

    if current_label and current_rows:
        stats.append((current_label, current_rows))

    return stats

def build_stat_json(label, rows):
    parsed_rows = []
    last_rank = None
    incomplete = False
    percent_stat = False

    for r in rows:
        p, last_rank, inc = parse_player_line(r, last_rank)
        if inc:
            incomplete = True
        if p:
            parsed_rows.append(p)
            if p["is_percent"]:
                percent_stat = True

    if not parsed_rows:
        return None

    # Top 10 + ties, preserving source order
    if len(parsed_rows) <= 10:
        final_rows = parsed_rows
    else:
        final_rows = []
        last_value = parsed_rows[9]["value"]

        for p in parsed_rows:
            if len(final_rows) < 10:
                final_rows.append(p)
            elif p["value"] == last_value:
                final_rows.append(p)
            else:
                break

    final_label = label + " (IC)" if incomplete else label

    return {
        "sport": "nfl",
        "season": 2025,
        "stat_id": clean_stat_id(final_label),
        "stat_label": final_label,
        "is_percent_stat": percent_stat,
        "players": final_rows
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

    # Uncomment to save
    with open("data/nfl/2025/processed/stats_2025_enriched.json", "w", encoding="utf-8") as f:
        json.dump(all_stats, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()