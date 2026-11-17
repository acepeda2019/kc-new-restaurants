"""King County food inspections, current dataset (Socrata ``r878-4sxa``): full pull to S3 raw.

Source card: ``docs/source_cards/kc_inspections_current.md``.

Why always a full pull: Socrata ``:updated_at`` holds one value for every row (the table is
rewritten wholesale on refresh), so it cannot drive an incremental window. The full table is
about 112k rows, i.e. 3 pages of 50,000. A full pull also captures corrections and deletions;
dbt dedupes on key.

Landing: ``s3://$RAW_BUCKET/raw/kc_inspections/dt=YYYY-MM-DD/<run_id>.jsonl.gz``. Each line is
one JSON object exactly as Socrata returned it (same keys, same string values, absent keys stay
absent). No field is renamed, cast or filtered.

Idempotency: if a file already exists in the run date's partition, the extractor does not pull
again and returns that file (status ``skipped_existing``), unless ``force=True``. Objects are
never overwritten; a forced re-pull lands a new ``<run_id>`` file next to the old one.

Write-once: the file is sent with one ``PutObject`` carrying ``If-None-Match: *`` (the raw bucket
policy denies raw writes without it; the gzip is a few MB, so no multipart upload). HTTP 412
means the object for this ``run_id`` already exists, which is treated as already landed.

Consistency: the row count is read before paging and must equal the rows landed, and the
``X-SODA2-Truth-Last-Modified`` header must not change during the pull (a republish mid-pull
would mix two versions). Either failure raises, so the daily job stops before dbt.
"""

from __future__ import annotations

import gzip
import json
import logging
import math
import os
import tempfile
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

SOURCE = "kc_inspections"
DATASET_ID = "r878-4sxa"
BASE_URL = f"https://data.kingcounty.gov/resource/{DATASET_ID}.json"
FILE_SUFFIX = ".jsonl.gz"
DEFAULT_PAGE_SIZE = 50_000
# Socrata system row id: stable within a dataset version, so offset paging does not skip or
# repeat rows. (It is not stable across republishes, which is why it is not used as a key.)
ORDER_BY = ":id"
TIMEOUT = (10.0, 120.0)  # connect, read seconds
LAST_MODIFIED_HEADER = "X-SODA2-Truth-Last-Modified"

logger = logging.getLogger(__name__)


def object_key(run_date: str, run_id: str) -> str:
    return f"{raw_partition(SOURCE, run_date)}{run_id}{FILE_SUFFIX}"


def _session(app_token: str | None) -> requests.Session:
    headers = {"Accept": "application/json"}
    if app_token:
        headers["X-App-Token"] = app_token
    return new_session(headers)


def fetch_row_count(
    session: requests.Session, *, sleep: Callable[[float], None] = time.sleep
) -> tuple[int, str | None]:
    """Return (row count, truth-last-modified header) for the dataset."""
    response = request_with_retries(
        session,
        "GET",
        BASE_URL,
        params={"$select": "count(*) as row_count"},
        logger=logger,
        timeout=TIMEOUT,
        sleep=sleep,
    )
    body = response.json()
    try:
        count = int(body[0]["row_count"])
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise ExtractError(f"unexpected count response: {str(body)[:200]}") from exc
    return count, response.headers.get(LAST_MODIFIED_HEADER)


def fetch_page(
    session: requests.Session,
    *,
    offset: int,
    limit: int,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[list[dict[str, Any]], str | None]:
    """Fetch one page ordered by ``:id``; return (rows, truth-last-modified header)."""
    response = request_with_retries(
        session,
        "GET",
        BASE_URL,
        params={"$limit": limit, "$offset": offset, "$order": ORDER_BY},
        logger=logger,
        timeout=TIMEOUT,
        sleep=sleep,
    )
    rows = response.json()
    if not isinstance(rows, list):
        raise ExtractError(f"expected a JSON array at offset {offset}, got {type(rows).__name__}")
    return rows, response.headers.get(LAST_MODIFIED_HEADER)


def _existing_files(s3: Any, bucket: str, run_date: str) -> list[str]:
    prefix = raw_partition(SOURCE, run_date)
    return sorted(k for k in list_keys(s3, bucket, prefix) if k.endswith(FILE_SUFFIX))


def _skipped_result(s3: Any, bucket: str, run_date: str, key: str) -> dict[str, Any]:
    head = s3.head_object(Bucket=bucket, Key=key)
    meta = head.get("Metadata", {})
    run_id = key.rsplit("/", 1)[-1].removesuffix(FILE_SUFFIX)
    result = {
        "source": SOURCE,
        "status": STATUS_SKIPPED_EXISTING,
        "run_date": run_date,
        "run_id": run_id,
        "rows": int(meta.get("rows", 0)),
        "pages": int(meta.get("pages", 0)),
        "bytes": int(head.get("ContentLength", 0)),
        "s3_keys": [key],
        "bucket": bucket,
    }
    log(logger, "extract_skipped_existing", **result)
    return result


def extract(
    *,
    bucket: str,
    run_date: str,
    run_id: str,
    s3: Any,
    session: requests.Session | None = None,
    app_token: str | None = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    force: bool = False,
    sleep: Callable[[float], None] = time.sleep,
    page_pause_s: float = 1.0,
) -> dict[str, Any]:
    """Full pull of the dataset to one gzip JSONL object. Returns the step result dict."""
    validate_run_id(run_id)
    if page_size < 1:
        raise ValueError("page_size must be positive")

    if not force:
        existing = _existing_files(s3, bucket, run_date)
        if existing:
            return _skipped_result(s3, bucket, run_date, existing[-1])

    key = object_key(run_date, run_id)
    session = session or _session(app_token)
    started = time.monotonic()
    window = {"mode": "full", "order": ORDER_BY, "page_size": page_size}
    log(logger, "extract_started", source=SOURCE, run_date=run_date, run_id=run_id, window=window)

    expected_rows, version_before = fetch_row_count(session, sleep=sleep)
    max_pages = math.ceil(expected_rows / page_size) + 1  # +1 for the final empty/short page

    rows_total = 0
    pages = 0
    raw_bytes = 0
    version_after = version_before
    fd, tmp_path = tempfile.mkstemp(suffix=FILE_SUFFIX)
    os.close(fd)
    try:
        # mtime=0 keeps the gzip bytes deterministic for identical content.
        with (
            open(tmp_path, "wb") as fh,
            gzip.GzipFile(fileobj=fh, mode="wb", mtime=0, filename="") as gz,
        ):
            offset = 0
            while True:
                if pages >= max_pages:
                    raise ExtractError(
                        f"paging did not terminate after {pages} pages "
                        f"(expected {expected_rows} rows)"
                    )
                if pages:
                    sleep(page_pause_s)
                page_rows, version_after = fetch_page(
                    session, offset=offset, limit=page_size, sleep=sleep
                )
                pages += 1
                page_bytes = 0
                for row in page_rows:
                    line = json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                    encoded = line.encode("utf-8")
                    gz.write(encoded)
                    page_bytes += len(encoded)
                rows_total += len(page_rows)
                raw_bytes += page_bytes
                log(
                    logger,
                    "page_fetched",
                    source=SOURCE,
                    page=pages,
                    offset=offset,
                    rows=len(page_rows),
                    bytes=page_bytes,
                )
                if len(page_rows) < page_size:
                    break
                offset += page_size

        if version_after != version_before:
            raise ExtractError(
                f"dataset changed during the pull ({LAST_MODIFIED_HEADER} "
                f"{version_before!r} -> {version_after!r}); retry"
            )
        if rows_total != expected_rows:
            raise ExtractError(f"row count mismatch: landed {rows_total}, expected {expected_rows}")

        with open(tmp_path, "rb") as fh:
            body = fh.read()
        gz_bytes = len(body)
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
                "rows": str(rows_total),
                "pages": str(pages),
                "extracted-at": utc_now_iso(),
                "source-last-modified": version_after or "",
            },
        )
    finally:
        os.remove(tmp_path)

    if not created:
        log(logger, "object_already_landed", logging.WARNING, source=SOURCE, s3_key=key)
        return _skipped_result(s3, bucket, run_date, key)

    result = {
        "source": SOURCE,
        "status": STATUS_SUCCEEDED,
        "run_date": run_date,
        "run_id": run_id,
        "rows": rows_total,
        "pages": pages,
        "bytes": gz_bytes,
        "uncompressed_bytes": raw_bytes,
        "s3_keys": [key],
        "bucket": bucket,
        "source_last_modified": version_after,
        "elapsed_s": round(time.monotonic() - started, 2),
    }
    log(logger, "extract_succeeded", window=window, **result)
    return result
