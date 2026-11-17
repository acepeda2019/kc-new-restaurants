"""Export the app's marts to JSON, refusing to publish a broken day.

    uv run python export.py --db kcne.duckdb --out ../app/data [--run-date YYYY-MM-DD] [--run-id ID]

Writes ``openings.json`` (array of ``mart_new_openings`` rows, by rank), ``metrics.json``
(the one ``mart_metrics`` row) and ``manifest.json`` (built_at, row_count, schema_version).

Guard: the export is refused (exit 1, nothing written) when there are 0 openings, or fewer
than half of the previous published run, which usually means a bad or partial KC pull. The
site then keeps serving the last good deploy.

With ``RAW_BUCKET`` set (the daily job), the three files are also kept in
``s3://$RAW_BUCKET/exports/dt=YYYY-MM-DD/<run_id>/`` (never overwritten), and the previous
run's count is read from the newest manifest there. Without it, only the empty check applies.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import secrets
import sys
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import duckdb

SCHEMA_VERSION = 1
MIN_SHARE_OF_PREVIOUS = 0.5
EXPORTS_PREFIX = "exports/"


class PublishBlocked(RuntimeError):
    """The new data looks broken; publishing would replace a good site with a bad one."""


def check_publishable(new_count: int, previous_count: int | None) -> None:
    """Raise PublishBlocked on 0 openings or a drop below half of the previous run."""
    if new_count == 0:
        raise PublishBlocked("0 openings: refusing to publish an empty list")
    if previous_count and new_count < MIN_SHARE_OF_PREVIOUS * previous_count:
        raise PublishBlocked(
            f"{new_count} openings vs {previous_count} last run (< 50%): likely a bad pull"
        )


def read_marts(db_path: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """The app's rows as plain JSON values (dates as ISO strings), via DuckDB's to_json."""
    with duckdb.connect(db_path, read_only=True) as con:
        openings = [
            json.loads(row[0])
            for row in con.execute(
                "select to_json(t) from mart_new_openings as t order by t.rank"
            ).fetchall()
        ]
        metrics = json.loads(con.execute("select to_json(t) from mart_metrics as t").fetchone()[0])
    return openings, metrics


def previous_count(s3: Any, bucket: str) -> int | None:
    """row_count of the newest exported manifest, or None if nothing was exported yet."""
    manifests: list[str] = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=EXPORTS_PREFIX):
        manifests += [
            o["Key"] for o in page.get("Contents", []) if o["Key"].endswith("manifest.json")
        ]
    if not manifests:
        return None
    body = s3.get_object(Bucket=bucket, Key=max(manifests))["Body"].read()
    return int(json.loads(body)["row_count"])


def export(
    *,
    db_path: str,
    out_dir: Path,
    run_date: str,
    run_id: str,
    s3: Any = None,
    bucket: str | None = None,
) -> dict[str, Any]:
    """Guard, then write the three files to out_dir (and S3 when given). Returns a summary."""
    openings, metrics = read_marts(db_path)
    previous = previous_count(s3, bucket) if s3 is not None and bucket else None
    check_publishable(len(openings), previous)

    built_at = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
    manifest = {
        "built_at": built_at,
        "run_date": run_date,
        "run_id": run_id,
        "row_count": len(openings),
        "schema_version": SCHEMA_VERSION,
    }
    files = {"openings.json": openings, "metrics.json": metrics, "manifest.json": manifest}
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, payload in files.items():
        (out_dir / name).write_text(json.dumps(payload, ensure_ascii=False, indent=1))

    keys: list[str] = []
    if s3 is not None and bucket:
        for name in files:  # manifest last, so a manifest only exists for a complete export
            key = f"{EXPORTS_PREFIX}dt={run_date}/{run_id}/{name}"
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=(out_dir / name).read_bytes(),
                ContentType="application/json",
            )
            keys.append(key)
    return {"rows": len(openings), "previous_count": previous, "s3_keys": keys, **manifest}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="export.py", description=__doc__.splitlines()[0])
    parser.add_argument("--db", required=True, help="dbt DuckDB file")
    parser.add_argument("--out", required=True, help="folder for the app's JSON")
    parser.add_argument("--run-date", help="YYYY-MM-DD; default: today in America/Los_Angeles")
    parser.add_argument("--run-id", help="default: a new timestamped id")
    args = parser.parse_args(argv)

    now = dt.datetime.now(dt.UTC)
    run_date = args.run_date or now.astimezone(ZoneInfo("America/Los_Angeles")).date().isoformat()
    run_id = args.run_id or f"{now:%Y%m%dT%H%M%SZ}-{secrets.token_hex(4)}"
    bucket = os.environ.get("RAW_BUCKET") or None
    s3 = None
    if bucket:
        import boto3

        s3 = boto3.client("s3")
    try:
        result = export(
            db_path=args.db,
            out_dir=Path(args.out),
            run_date=run_date,
            run_id=run_id,
            s3=s3,
            bucket=bucket,
        )
    except PublishBlocked as exc:
        print(json.dumps({"status": "blocked", "reason": str(exc)}), file=sys.stderr)
        sys.exit(1)
    print(json.dumps({"status": "exported", **result}))


if __name__ == "__main__":
    main()
