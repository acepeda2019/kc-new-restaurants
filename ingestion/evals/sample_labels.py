"""Pick the places the owner labels for the classification eval (SAN-66).

The sample leans on the 0.8 threshold, the decision under test: a fixed number per confidence
band of Claude's stored answer, with a floor for each hard case (new concepts, transfers,
food-hall stalls, cafés, excluded places). It writes two files:

- ``classification_labels.csv``: one row per sampled place, ``business_id`` filled in and the
  answer columns blank for the owner. Same columns as ``classification_overrides.csv``, but a
  separate file: a label is an answer the owner checked, and doesn't change what the app shows.
- ``labelling_sheet.md``: what Claude saw for each place, and nothing of Claude's answer, so
  the owner isn't nudged toward agreeing with it.

Run from ``ingestion/`` (free, no API calls; never overwrites labels already written)::

    uv run python -m evals.sample_labels --db ../transform/kcne.duckdb
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path
from typing import Any

from sources.claude_classifications import candidate_input

HERE = Path(__file__).parent
LABELS_PATH = HERE / "classification_labels.csv"
SHEET_PATH = HERE / "labelling_sheet.md"
LABEL_COLUMNS = (
    "business_id",
    "category",
    "opening_type",
    "replaces_name",
    "likely_cuisine",
    "labelled_at",
    "note",
)
SEED = 66

#: Places per band of Claude's confidence, weighted toward the 0.8 threshold.
BAND_QUOTAS = {"<0.6": 10, "0.6-0.8": 15, "0.8-0.9": 15, ">=0.9": 10}
#: At least this many of each hard case, as Claude answered it (field, value, minimum).
CASE_FLOORS = (
    ("opening_type", "new_concept", 8),
    ("opening_type", "ownership_transfer", 5),
    ("category", "food_hall_stall", 5),
    ("category", "cafe_bakery_dessert", 8),
    ("category", "excluded", 8),
)


def band(confidence: float) -> str:
    """The confidence band a stored answer falls in."""
    if confidence < 0.6:
        return "<0.6"
    if confidence < 0.8:
        return "0.6-0.8"
    if confidence < 0.9:
        return "0.8-0.9"
    return ">=0.9"


def pick_sample(rows: list[dict[str, Any]], seed: int = SEED) -> list[dict[str, Any]]:
    """Rows chosen to fill BAND_QUOTAS, meeting CASE_FLOORS first. Same rows, same seed, same pick.

    Each row needs ``business_id``, ``category``, ``opening_type`` and ``confidence``. A floor or
    band that the data can't fill is filled as far as it goes.
    """
    pool = sorted(rows, key=lambda r: r["business_id"])
    random.Random(seed).shuffle(pool)  # noqa: S311 (a reproducible sample, not security)
    left = dict(BAND_QUOTAS)
    chosen: list[dict[str, Any]] = []
    taken: set[str] = set()

    def take(row: dict[str, Any]) -> bool:
        b = band(row["confidence"])
        if row["business_id"] in taken or left[b] == 0:
            return False
        left[b] -= 1
        taken.add(row["business_id"])
        chosen.append(row)
        return True

    for field, value, minimum in CASE_FLOORS:
        have = sum(1 for r in chosen if r[field] == value)
        for row in pool:
            if have >= minimum:
                break
            if row[field] == value and take(row):
                have += 1
    for row in pool:
        take(row)
    return sorted(chosen, key=lambda r: (r["confidence"], r["business_id"]))


def read_rows(db_path: str) -> list[dict[str, Any]]:
    """Candidates Claude answered, with that answer, from the dbt DuckDB file (read-only)."""
    import duckdb

    sql = """
        select cand.*, cls.category, cls.opening_type, cls.confidence
        from int_candidates as cand
        join int_classified_candidates as cls using (business_id)
        where cls.source = 'claude'
    """
    with duckdb.connect(db_path, read_only=True) as con:
        cursor = con.execute(sql)
        columns = [c[0] for c in cursor.description]
        return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]


def sheet(sample: list[dict[str, Any]], db_path: str) -> str:
    """The labelling sheet: each place's inputs exactly as Claude got them, without its answer."""
    lines = [
        "# Classification labels: what Claude saw",
        "",
        f"{len(sample)} places sampled from `{Path(db_path).name}` (seed {SEED}). For each one,",
        "fill its row in `classification_labels.csv` with the answer you believe is right:",
        "",
        "- `category`: restaurant, cafe_bakery_dessert, food_hall_stall, food_truck or excluded;",
        "- `opening_type`: new_opening, new_concept or ownership_transfer;",
        "- `replaces_name`: the predecessor's name, only for new_concept;",
        "- `likely_cuisine`: only when the name makes it evident, else blank;",
        "- `note`: anything you were unsure about.",
        "",
        "The definitions are Claude's own, in `SYSTEM_PROMPT` of",
        "`sources/claude_classifications.py`. The places appear in no meaningful order.",
        "",
    ]
    for i, row in enumerate(sorted(sample, key=lambda r: r["business_id"]), start=1):
        facts = json.dumps(candidate_input(row), indent=2, default=str, ensure_ascii=False)
        lines += [f"## {i}. {row['business_name']} (`{row['business_id']}`)", "", "````json"]
        lines += [facts, "````", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default="../transform/kcne.duckdb", help="dbt DuckDB file")
    args = parser.parse_args()
    if LABELS_PATH.exists():
        raise SystemExit(f"{LABELS_PATH} already exists; delete it first to draw a new sample.")
    sample = pick_sample(read_rows(args.db))
    with LABELS_PATH.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(LABEL_COLUMNS)
        for row in sorted(sample, key=lambda r: r["business_id"]):
            writer.writerow([row["business_id"], *[""] * (len(LABEL_COLUMNS) - 1)])
    SHEET_PATH.write_text(sheet(sample, args.db))
    print(f"{len(sample)} places -> {LABELS_PATH.name}, {SHEET_PATH.name}")


if __name__ == "__main__":
    main()
