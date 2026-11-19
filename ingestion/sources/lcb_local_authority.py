"""WSLCB Local Authority Letters (data.wa.gov ``vgcw-qfjm``): daily snapshot to S3 raw.

Why this is the Opening soon signal: ``docs/research/2026-11-19-opening-soon-sources.md``.

The dataset is a rolling window of recent licence notices (about 14 rows statewide on
2026-11-19), not history, so each day's snapshot is landed whole and history builds up in raw.
Statewide and unfiltered: extractors only extract; King County and restaurant rules come later
in dbt. Rows hold applicants' contact details; they stay in the private raw bucket.

Landing: ``s3://$RAW_BUCKET/raw/lcb_local_authority/dt=YYYY-MM-DD/<run_id>.jsonl.gz``, one JSON
object per line exactly as returned. Idempotent per run date (an existing file is reused unless
``force``); write-once via ``put_once``. A response larger than ``PAGE_LIMIT`` raises rather
than landing a partial snapshot.
"""

from __future__ import annotations

import gzip
import json
import logging
import time
from collections.abc import Callable
from typing import Any

import requests

from sources.common import (
    STATUS_SKIPPED_EXISTING,
    STATUS_SUCCEEDED,
    ExtractError,
    list_keys,
    log,
    new_session,
    put_once,
    raw_partition,
    request_with_retries,
    utc_now_iso,
    validate_run_id,
)

SOURCE = "lcb_local_authority"
DATASET_ID = "vgcw-qfjm"
BASE_URL = f"https://data.wa.gov/resource/{DATASET_ID}.json"
FILE_SUFFIX = ".jsonl.gz"
PAGE_LIMIT = 50_000  # far above the window's size; a full page means something changed
TIMEOUT = (10.0, 60.0)

logger = logging.getLogger(__name__)


def object_key(run_date: str, run_id: str) -> str:
    return f"{raw_partition(SOURCE, run_date)}{run_id}{FILE_SUFFIX}"


def fetch_rows(
    session: requests.Session, *, sleep: Callable[[float], None] = time.sleep
) -> list[dict[str, Any]]:
    """The whole current window, ordered by Socrata row id."""
    response = request_with_retries(
        session,
        "GET",
        BASE_URL,
        params={"$limit": PAGE_LIMIT, "$order": ":id"},
        logger=logger,
        timeout=TIMEOUT,
        sleep=sleep,
    )
    rows = response.json()
    if not isinstance(rows, list):
        raise ExtractError(f"expected a JSON array, got {type(rows).__name__}")
    if len(rows) >= PAGE_LIMIT:
        raise ExtractError(f"{len(rows)} rows hit the page limit; the window is no longer small")
    return rows


def extract(
    *,
    bucket: str,
    run_date: str,
    run_id: str,
    s3: Any,
    session: requests.Session | None = None,
    force: bool = False,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Land today's snapshot as one gzip JSONL object. Returns the step result dict."""
    validate_run_id(run_id)
    partition = raw_partition(SOURCE, run_date)
    existing = sorted(k for k in list_keys(s3, bucket, partition) if k.endswith(FILE_SUFFIX))
    if existing and not force:
        result = {
            "source": SOURCE,
            "status": STATUS_SKIPPED_EXISTING,
            "run_date": run_date,
            "s3_keys": [existing[-1]],
            "bucket": bucket,
        }
        log(logger, "extract_skipped_existing", **result)
        return result

    rows = fetch_rows(session or new_session({"Accept": "application/json"}), sleep=sleep)
    lines = "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows)
    body = gzip.compress(lines.encode("utf-8"), mtime=0)
    key = object_key(run_date, run_id)
    created = put_once(
        s3,
        bucket,
        key,
        body,
        ContentType="application/gzip",
        Metadata={
            "source": SOURCE,
            "dataset-id": DATASET_ID,
            "run-id": run_id,
            "run-date": run_date,
            "rows": str(len(rows)),
            "extracted-at": utc_now_iso(),
        },
    )
    result = {
        "source": SOURCE,
        "status": STATUS_SUCCEEDED if created else STATUS_SKIPPED_EXISTING,
        "run_date": run_date,
        "run_id": run_id,
        "rows": len(rows),
        "bytes": len(body),
        "s3_keys": [key],
        "bucket": bucket,
    }
    log(logger, "extract_succeeded" if created else "object_already_landed", **result)
    return result
