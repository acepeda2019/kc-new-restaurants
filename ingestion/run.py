"""Command-line entry point for the extract layer, run by the daily GitHub Actions job.

    uv run python run.py extract [--run-date YYYY-MM-DD] [--run-id ID] [--force]
    uv run python run.py classify --db ../transform/kcne.duckdb [--run-date] [--run-id] [--limit N]

extract: KC inspections, then the Census geocoder on that pull's files.
classify: Claude Haiku on new or changed rows of dbt's int_candidates (needs ANTHROPIC_API_KEY).
Each prints one JSON line per step result and exits 1 if a step raises, so the job stops.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from typing import Any

from sources import census_geocoder, claude_classifications, kc_inspections
from sources.common import configure_logging, env, new_run_id, resolve_run_date, s3_client

logger = logging.getLogger("run")


def run_extract(run_date: str, run_id: str, force: bool, s3: Any) -> list[dict]:
    """Land today's KC pull, then geocode its new addresses. Returns both step results.

    The geocoder reuses the KC run's ``run_id`` and reads exactly the files KC landed.
    ``force`` lands a second KC file for the date instead of reusing the existing one.
    """
    bucket = env("RAW_BUCKET", required=True)
    kc = kc_inspections.extract(
        bucket=bucket,
        run_date=run_date,
        run_id=run_id,
        s3=s3,
        app_token=env("SOCRATA_APP_TOKEN"),
        force=force,
    )
    geo = census_geocoder.extract(
        bucket=bucket, run_date=run_date, run_id=run_id, kc_keys=kc["s3_keys"], s3=s3
    )
    return [kc, geo]


def anthropic_client() -> Any:
    import anthropic

    return anthropic.Anthropic()  # reads ANTHROPIC_API_KEY


def run_classify(run_date: str, run_id: str, db: str, limit: int | None, s3: Any) -> list[dict]:
    """Classify new or changed candidates from dbt's DuckDB file. Returns the step result."""
    result = claude_classifications.extract(
        bucket=env("RAW_BUCKET", required=True),
        run_date=run_date,
        run_id=run_id,
        candidates=claude_classifications.read_candidates(db, limit),
        s3=s3,
        client=anthropic_client(),
    )
    return [result]


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="run.py", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    extract = sub.add_parser("extract", help="KC inspections, then the Census geocoder")
    extract.add_argument("--run-date", help="YYYY-MM-DD; default: today in America/Los_Angeles")
    extract.add_argument("--run-id", help="default: a new timestamped id")
    extract.add_argument("--force", action="store_true", help="land a new KC file for the date")
    classify = sub.add_parser("classify", help="Claude Haiku on new candidate openings")
    classify.add_argument("--db", required=True, help="dbt DuckDB file with int_candidates")
    classify.add_argument("--run-date", help="YYYY-MM-DD; default: today in America/Los_Angeles")
    classify.add_argument("--run-id", help="default: a new timestamped id")
    classify.add_argument("--limit", type=int, help="classify at most N candidates (manual runs)")
    args = parser.parse_args(argv)

    configure_logging()
    run_date, run_id = resolve_run_date(args.run_date), args.run_id or new_run_id()
    try:
        if args.command == "extract":
            results = run_extract(run_date, run_id, args.force, s3_client())
        else:
            results = run_classify(run_date, run_id, args.db, args.limit, s3_client())
    except Exception:
        logger.exception("extract failed")
        sys.exit(1)
    for result in results:
        print(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
