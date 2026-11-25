"""Re-classify the labelled places with thinking at its default and with it off (SAN-66).

**Spends money** (Haiku 5.5, about 1¢ per arm for 50 places): ask the owner before running.

Production's ``classify_one`` and ``SYSTEM_PROMPT`` are reused unchanged; the only difference
between arms is the ``thinking`` field, added by a thin client wrapper. Each arm's answers are
graded with ``score_stored.grade`` and written to ``evals/runs/<date>-<arm>.jsonl``.

Run from ``ingestion/`` with ``ANTHROPIC_API_KEY`` set::

    uv run python -m evals.thinking_compare --limit 1   # one place per arm: check the cost
    uv run python -m evals.thinking_compare
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import time
from pathlib import Path
from typing import Any

from evals.sample_labels import BAND_QUOTAS, LABELS_PATH, read_rows
from evals.score_stored import grade, rate
from sources.claude_classifications import MODEL, PRICE_PER_MTOK, classify_one

RUNS = Path(__file__).parent / "runs"
#: The ``thinking`` value each arm sends; None leaves it out, as production does.
ARMS: dict[str, dict[str, str] | None] = {"default": None, "disabled": {"type": "disabled"}}


class ArmClient:
    """Wraps an Anthropic client: adds the arm's ``thinking``, checks the model, times each call."""

    def __init__(self, client: Any, thinking: dict[str, str] | None) -> None:
        self._client, self._thinking = client, thinking
        self.calls: list[dict[str, Any]] = []
        self.messages = self

    def create(self, **kwargs: Any) -> Any:
        if self._thinking is not None:
            kwargs["thinking"] = self._thinking
        start = time.monotonic()
        response = self._client.messages.create(**kwargs)
        if not str(response.model).startswith(MODEL):
            raise RuntimeError(
                f"asked for {MODEL}, got {response.model}: the arms aren't comparable"
            )
        self.calls.append(
            {"latency_s": round(time.monotonic() - start, 2), "stop_reason": response.stop_reason}
        )
        return response


def run_arm(arm: str, labels: list[dict[str, str]], rows: dict[str, dict], client: Any) -> dict:
    """Classify every labelled place in one arm; returns its grades, failures and usage."""
    wrapped = ArmClient(client, ARMS[arm])
    usage = {"input": 0, "output": 0}
    grades, records = [], []
    for label in labels:
        record = classify_one(rows[label["business_id"]], wrapped, usage)
        call = wrapped.calls[-1] if wrapped.calls else {}
        records.append({"arm": arm, "business_id": label["business_id"], **call, "answer": record})
        if record is not None:
            grades.append(grade(label, record))
    cost = sum(usage[k] * PRICE_PER_MTOK[k] for k in usage) / 1_000_000
    return {
        "arm": arm,
        "grades": grades,
        "records": records,
        "failed": len(labels) - len(grades),
        "usage": usage,
        "cost_usd": cost,
    }


def summary(results: list[dict]) -> str:
    """A markdown table comparing the arms."""
    pct = lambda r: f"{r[0]}/{r[1]} ({r[0] / r[1]:.0%})" if r[1] else "n/a"  # noqa: E731
    head = "| | " + " | ".join(r["arm"] for r in results) + " |"
    lines = [head, "|---" * (len(results) + 1) + "|"]
    for field in ("decision", "shown", "category", "opening_type", "replaces_name"):
        lines.append(
            f"| {field} | " + " | ".join(pct(rate(r["grades"], field)) for r in results) + " |"
        )
    for b in BAND_QUOTAS:
        cells = [pct(rate([g for g in r["grades"] if g["band"] == b], "decision")) for r in results]
        lines.append(f"| decision at {b} | " + " | ".join(cells) + " |")
    for key, fmt in (("failed", "{}"), ("cost_usd", "${:.4f}")):
        lines.append(f"| {key} | " + " | ".join(fmt.format(r[key]) for r in results) + " |")
    for k in ("input", "output"):
        lines.append(f"| {k} tokens | " + " | ".join(str(r["usage"][k]) for r in results) + " |")
    return "\n".join(lines)


def main() -> None:
    import anthropic

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default="../transform/kcne.duckdb", help="dbt DuckDB file")
    parser.add_argument("--limit", type=int, help="only the first N labelled places")
    args = parser.parse_args()
    with LABELS_PATH.open(encoding="utf-8-sig") as f:
        labels = list(csv.DictReader(f))[: args.limit]
    rows = {r["business_id"]: r for r in read_rows(args.db)}
    client = anthropic.Anthropic(max_retries=2, timeout=60)
    results = [run_arm(arm, labels, rows, client) for arm in ARMS]
    if args.limit is None:
        RUNS.mkdir(exist_ok=True)
        for r in results:
            path = RUNS / f"{dt.date.today().isoformat()}-{r['arm']}.jsonl"
            path.write_text("".join(json.dumps(x, default=str) + "\n" for x in r["records"]))
    print(summary(results))


if __name__ == "__main__":
    main()
