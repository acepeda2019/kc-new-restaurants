"""Score Claude's stored classifications against the owner's labels (SAN-66). Free: no API calls.

Grades each labelled place on what the app does with it:

- **decision**: category and opening_type both right (what Claude's confidence is about);
- **shown/hidden**: whether the app would accept the place (not excluded, not a transfer);
- **replaces_name**: the predecessor's name, where both sides call it a new concept (a
  disagreement on the type is already counted under opening_type).

Cuisine isn't scored: Claude names it at a finer grain than the labels ("Sushi" vs
"Japanese"), so an exact match is the wrong test. Where Claude names one and the label
differs, the pair is listed for the owner to read; a blank from Claude is never a miss, since
its rule is to name one only when the name makes it evident.

Calibration is decision accuracy per confidence band; with each band's size in the whole
population it estimates how many places shown in the app are wrong at each threshold. Labels
whose note starts with ``unsure`` are reported separately.

Run from ``ingestion/``::

    uv run python -m evals.score_stored --db ../transform/kcne.duckdb
"""

from __future__ import annotations

import argparse
import csv
from collections import Counter
from typing import Any

from evals.sample_labels import BAND_QUOTAS, LABELS_PATH, band

BAND_LOWER = {"<0.6": 0.0, "0.6-0.8": 0.6, "0.8-0.9": 0.8, ">=0.9": 0.9}
THRESHOLDS = (0.6, 0.8, 0.9)


def shown(category: str, opening_type: str) -> bool:
    """Whether the app accepts an answer (its 'accepted' status, confidence aside)."""
    return category != "excluded" and opening_type != "ownership_transfer"


def _same(a: str | None, b: str | None) -> bool:
    return (a or "").strip().casefold() == (b or "").strip().casefold()


def grade(label: dict[str, str], answer: dict[str, Any]) -> dict[str, Any]:
    """One place's grades. ``None`` means the field doesn't apply to this place."""
    concept = label["opening_type"] == answer["opening_type"] == "new_concept"
    return {
        "business_id": label["business_id"],
        "band": band(answer["confidence"]),
        "unsure": label.get("note", "").strip().lower().startswith("unsure"),
        "category": label["category"] == answer["category"],
        "opening_type": label["opening_type"] == answer["opening_type"],
        "decision": (label["category"], label["opening_type"])
        == (answer["category"], answer["opening_type"]),
        "shown": shown(label["category"], label["opening_type"])
        == shown(answer["category"], answer["opening_type"]),
        "replaces_name": _same(label["replaces_name"], answer["replaces_name"])
        if concept
        else None,
    }


def rate(grades: list[dict[str, Any]], field: str) -> tuple[int, int]:
    """(right, applicable) for one field."""
    applicable = [g[field] for g in grades if g[field] is not None]
    return sum(applicable), len(applicable)


def at_threshold(
    grades: list[dict[str, Any]], population: Counter, threshold: float
) -> tuple[int, float]:
    """(answers above the threshold, estimated wrong decisions among them) in the population.

    Each band's error rate in the sample is scaled to that band's size in the population, so a
    threshold must be a band's lower edge.
    """
    shown_n, wrong = 0, 0.0
    for b, lower in BAND_LOWER.items():
        if lower < threshold:
            continue
        right, n = rate([g for g in grades if g["band"] == b], "decision")
        shown_n += population[b]
        wrong += population[b] * (1 - right / n) if n else 0.0
    return shown_n, wrong


def report(
    labels: list[dict[str, str]], answers: dict[str, dict[str, Any]], population: Counter
) -> str:
    """The markdown report."""
    grades = [grade(lab, answers[lab["business_id"]]) for lab in labels]
    sure = [g for g in grades if not g["unsure"]]
    pct = lambda r: f"{r[0]}/{r[1]} ({r[0] / r[1]:.0%})" if r[1] else "n/a"  # noqa: E731
    out = [
        f"# Stored classifications vs owner labels ({len(grades)} places)",
        "",
        "| Field | All | Excluding unsure |",
        "|---|---|---|",
    ]
    for field in ("decision", "shown", "category", "opening_type", "replaces_name"):
        out.append(f"| {field} | {pct(rate(grades, field))} | {pct(rate(sure, field))} |")
    out += ["", "## Calibration (decision accuracy per band)", ""]
    out += ["| Band | Sample | Right | In population |", "|---|---|---|---|"]
    for b in BAND_QUOTAS:
        in_band = [g for g in grades if g["band"] == b]
        out.append(f"| {b} | {len(in_band)} | {pct(rate(in_band, 'decision'))} | {population[b]} |")
    out += ["", "## If the threshold were… (estimated over the population)", ""]
    out += ["| Threshold | Answers at or above | Est. wrong decisions | Est. wrong share |"]
    out += ["|---|---|---|---|"]
    for t in THRESHOLDS:
        n, wrong = at_threshold(grades, population, t)
        out.append(
            f"| {t} | {n} | {wrong:.0f} | {wrong / n:.0%} |" if n else f"| {t} | 0 | - | - |"
        )
    out += ["", "## Confusion (label → Claude)", ""]
    for field in ("category", "opening_type"):
        pairs = Counter(
            (lab[field], answers[lab["business_id"]][field])
            for lab in labels
            if lab[field] != answers[lab["business_id"]][field]
        )
        listed = "; ".join(f"{a} → {c} x{n}" for (a, c), n in pairs.most_common())
        out.append(f"**{field}:** {listed or 'none'}")
        out.append("")
    cuisines = [
        f"- `{lab['business_id']}`: label {lab['likely_cuisine'] or '(blank)'}, Claude {ans}"
        for lab in labels
        if (ans := answers[lab["business_id"]]["likely_cuisine"])
        and not _same(lab["likely_cuisine"], ans)
    ]
    out += ["## Cuisine where Claude named one and the label differs", "", *(cuisines or ["none"])]
    return "\n".join(out)


def read_answers(db_path: str) -> tuple[dict[str, dict[str, Any]], Counter]:
    """Claude's stored answers by business_id, and how many answers fall in each band."""
    import duckdb

    sql = """
        select business_id, category, opening_type, replaces_name, likely_cuisine, confidence
        from int_classified_candidates where source = 'claude'
    """
    with duckdb.connect(db_path, read_only=True) as con:
        cursor = con.execute(sql)
        columns = [c[0] for c in cursor.description]
        rows = [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]
    return {r["business_id"]: r for r in rows}, Counter(band(r["confidence"]) for r in rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default="../transform/kcne.duckdb", help="dbt DuckDB file")
    args = parser.parse_args()
    with LABELS_PATH.open(encoding="utf-8-sig") as f:
        labels = list(csv.DictReader(f))
    answers, population = read_answers(args.db)
    print(report(labels, answers, population))


if __name__ == "__main__":
    main()
