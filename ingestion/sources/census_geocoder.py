"""US Census batch geocoder: geocode KC and WSLCB addresses not yet in raw geocode results.

Source card: ``docs/source_cards/census_geocoder.md``.

Flow for one run:
  1. read the KC raw file(s) of this run (``raw/kc_inspections/dt=.../<run_id>.jsonl.gz``);
  2. build distinct non-mobile addresses keyed by ``geocode_key`` (see ``sources.geocode_key``,
     the canonical rule dbt must reproduce);
  3. derive what is already geocoded from every earlier response under ``raw/census_geocoder/``:
     a ``Match`` is never re-sent; a ``No_Match`` / ``Tie`` is re-sent once its latest request is
     at least 90 days old (TIGER updates add streets); anything else is new;
  4. send the rest to ``/geocoder/locations/addressbatch`` in chunks of at most 5,000 rows, one
     call at a time with a pause between calls;
  5. land, per chunk, the request CSV we sent, the response CSV byte-for-byte as received and a
     small chunk record (requested_at, counts), plus one manifest per attempt at the end:

     raw/census_geocoder/dt=YYYY-MM-DD/<run_id>/request_0001.csv
     raw/census_geocoder/dt=YYYY-MM-DD/<run_id>/response_0001.csv
     raw/census_geocoder/dt=YYYY-MM-DD/<run_id>/chunk_0001.json
     raw/census_geocoder/dt=YYYY-MM-DD/<run_id>/manifest_0001.json

Request CSV (no header): ``geocode_key,"STREET_CLEAN","CITY",WA,zip5``.
Response CSV (no header, ragged): 8 fields on ``Match``, 3 on ``No_Match``/``Tie``; output order
differs from input order; coordinates are one field ``"lon,lat"``. The response is parsed here
only to validate it (same id set as the request) and to drive the skip logic; it is landed
unchanged and dbt does the real parsing.

Write-once: every object is written exactly once with ``If-None-Match: *`` (required by the raw
bucket policy); nothing under ``raw/`` is ever rewritten. HTTP 412 means "already landed": for a
response or chunk record that is accepted as is; for a new request or manifest name it means the
number is taken, so the next free number is used.

Idempotency and resume: re-running a date (or retrying the same run) sends only keys that have no
response yet, so nothing is geocoded twice. A retry of the same ``run_id`` continues after the
highest request/response/chunk/manifest number already in the folder, so a failed attempt's files
stay as they are and each attempt adds its own ``manifest_NNNN.json`` (status succeeded/failed).
"""

from __future__ import annotations

import csv
import datetime as dt
import gzip
import io
import json
import logging
import re
import time
from collections import Counter
from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any

import requests

from sources.common import (
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
from sources.geocode_key import (
    KEY_RULE_VERSION,
    key_from_parts,
    normalize_city,
    normalize_street,
    normalize_zip5,
)

SOURCE = "census_geocoder"
KC_SOURCE = "kc_inspections"
BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
BENCHMARK = "Public_AR_Current"
STATE = "WA"
MOBILE_CLASSIFICATION = "Mobile Food Unit"
MAX_CHUNK_SIZE = 5_000  # documented service cap is 10,000
RETRY_UNMATCHED_AFTER_DAYS = 90
TIMEOUT = (10.0, 300.0)  # connect, read seconds
CHUNK_PAUSE_S = 5.0
VALIDATION_ATTEMPTS = 3  # re-submit a chunk whose response does not echo the request ids

MATCH = "Match"
NO_MATCH = "No_Match"
TIE = "Tie"

_DT_RE = re.compile(r"/dt=(\d{4}-\d{2}-\d{2})/")

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- inputs


@dataclass(frozen=True)
class GeocodeInput:
    key: str
    street: str
    city: str
    zip5: str


@dataclass
class InputStats:
    kc_rows: int = 0
    mobile_rows_excluded: int = 0
    empty_street_rows_skipped: int = 0
    distinct_keys: int = 0


def iter_kc_rows(s3: Any, bucket: str, key: str) -> Iterator[dict[str, Any]]:
    """Stream rows from one KC raw gzip JSONL object."""
    body = s3.get_object(Bucket=bucket, Key=key)["Body"]
    with gzip.GzipFile(fileobj=body) as gz:
        for line in io.TextIOWrapper(gz, encoding="utf-8"):
            if line.strip():
                yield json.loads(line)


def iter_lcb_address_rows(s3: Any, bucket: str, key: str) -> Iterator[dict[str, Any]]:
    """King County addresses from one WSLCB snapshot, shaped like KC rows for ``build_inputs``.

    Same key rule as KC, so both sources share one geocode cache (Opening soon pins, SAN-50).
    Other counties are skipped: the app is King County only.
    """
    for row in iter_kc_rows(s3, bucket, key):
        if str(row.get("countyname", "")).strip().upper() != "KING":
            continue
        yield {
            "address": row.get("streetaddress"),
            "city": row.get("city"),
            "zip_code": row.get("zipcode"),
        }


def build_inputs(rows: Iterable[Mapping[str, Any]]) -> tuple[list[GeocodeInput], InputStats]:
    """Distinct non-mobile addresses by geocode_key, sorted by key (deterministic chunks).

    The city sent for a key is its most frequent normalized city across rows (ties: alphabetical),
    which avoids sending one-off typos such as ``BELLEUE``.
    """
    stats = InputStats()
    streets: dict[str, tuple[str, str]] = {}
    cities: dict[str, Counter[str]] = {}
    for row in rows:
        stats.kc_rows += 1
        if row.get("classification") == MOBILE_CLASSIFICATION:
            stats.mobile_rows_excluded += 1
            continue
        street = normalize_street(row.get("address"))
        if not street:
            stats.empty_street_rows_skipped += 1
            continue
        zip5 = normalize_zip5(row.get("zip_code"))
        key = key_from_parts(street, zip5)
        streets.setdefault(key, (street, zip5))
        cities.setdefault(key, Counter())[normalize_city(row.get("city"))] += 1
    inputs = []
    for key in sorted(streets):
        street, zip5 = streets[key]
        city = min(cities[key].items(), key=lambda kv: (-kv[1], kv[0]))[0]
        inputs.append(GeocodeInput(key=key, street=street, city=city, zip5=zip5))
    stats.distinct_keys = len(inputs)
    return inputs, stats


def _quote(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def build_request_csv(inputs: Iterable[GeocodeInput]) -> bytes:
    """Batch file: no header; ``id,"street","city",WA,zip`` (street and city always quoted)."""
    lines = [
        f"{item.key},{_quote(item.street)},{_quote(item.city)},{STATE},{item.zip5}\n"
        for item in inputs
    ]
    return "".join(lines).encode("utf-8")


# --------------------------------------------------------------------------- response parsing


@dataclass(frozen=True)
class GeocodeResponseRow:
    key: str
    match: str
    match_type: str | None = None
    matched_address: str | None = None
    longitude: float | None = None
    latitude: float | None = None
    tiger_line_id: str | None = None
    side: str | None = None
    field_count: int = 0


def _parse_coordinates(value: str) -> tuple[float | None, float | None]:
    """The service returns ``"lon,lat"`` (x first) in one field."""
    try:
        lon_text, lat_text = value.split(",", 1)
        return float(lon_text), float(lat_text)
    except ValueError:
        return None, None


def parse_response_csv(content: bytes | str) -> list[GeocodeResponseRow]:
    """Parse the ragged batch response (8 fields on Match, 3 on No_Match/Tie).

    Field 2 (our address echoed back, with unescaped commas) is ignored; rows are keyed by id.
    """
    text = content.decode("utf-8", errors="replace") if isinstance(content, bytes) else content
    rows: list[GeocodeResponseRow] = []
    for fields in csv.reader(io.StringIO(text)):
        if not fields or all(not f.strip() for f in fields):
            continue
        if len(fields) < 3:
            raise ExtractError(f"geocoder response row has {len(fields)} fields: {fields!r}")
        padded = fields + [""] * (8 - len(fields))
        lon, lat = _parse_coordinates(padded[5]) if padded[5] else (None, None)
        rows.append(
            GeocodeResponseRow(
                key=padded[0],
                match=padded[2],
                match_type=padded[3] or None,
                matched_address=padded[4] or None,
                longitude=lon,
                latitude=lat,
                tiger_line_id=padded[6] or None,
                side=padded[7] or None,
                field_count=len(fields),
            )
        )
    return rows


def validate_response(sent_keys: Iterable[str], rows: list[GeocodeResponseRow]) -> None:
    """The response must echo every sent id exactly once (order is not preserved)."""
    sent = list(sent_keys)
    received = [r.key for r in rows]
    if len(received) != len(sent) or set(received) != set(sent):
        missing = len(set(sent) - set(received))
        extra = len(set(received) - set(sent))
        raise ExtractError(
            f"geocoder response does not match request: sent {len(sent)}, received "
            f"{len(received)} rows ({missing} ids missing, {extra} unexpected)"
        )


# --------------------------------------------------------------------------- prior results


@dataclass(frozen=True)
class PriorStatus:
    match: str
    requested_at: str  # ISO-8601 UTC
    response_key: str


def _partition_midnight(key: str) -> str:
    found = _DT_RE.search("/" + key)
    if not found:
        return "1970-01-01T00:00:00Z"
    return f"{found.group(1)}T00:00:00Z"


def _read_json(s3: Any, bucket: str, key: str) -> dict[str, Any]:
    return json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())


def load_prior_status(s3: Any, bucket: str) -> dict[str, PriorStatus]:
    """Latest geocode status per key from every response file under ``raw/census_geocoder/``.

    ``requested_at`` comes from the write-once chunk record ``chunk_NNNN.json`` next to the
    response; a response without one (a crash between the two writes) falls back to midnight UTC
    of its ``dt=`` partition.
    """
    keys = list_keys(s3, bucket, f"raw/{SOURCE}/")
    requested_at: dict[str, str] = {}
    for key in keys:
        name = key.rsplit("/", 1)[-1]
        if name.startswith("chunk_") and name.endswith(".json"):
            record = _read_json(s3, bucket, key)
            if record.get("response_key") and record.get("requested_at"):
                requested_at[record["response_key"]] = record["requested_at"]
    prior: dict[str, PriorStatus] = {}
    for key in sorted(keys):
        name = key.rsplit("/", 1)[-1]
        if not (name.startswith("response_") and name.endswith(".csv")):
            continue
        at = requested_at.get(key) or _partition_midnight(key)
        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        for row in parse_response_csv(body):
            current = prior.get(row.key)
            if current is None or at >= current.requested_at:
                prior[row.key] = PriorStatus(match=row.match, requested_at=at, response_key=key)
    return prior


@dataclass
class Selection:
    pending: list[GeocodeInput] = field(default_factory=list)
    new: int = 0
    retry_unmatched: int = 0
    skipped_matched: int = 0
    skipped_recent_unmatched: int = 0


def select_pending(
    inputs: Iterable[GeocodeInput],
    prior: Mapping[str, PriorStatus],
    *,
    run_date: str,
    retry_after_days: int = RETRY_UNMATCHED_AFTER_DAYS,
) -> Selection:
    """Keys never geocoded, plus No_Match/Tie keys last requested >= retry_after_days ago."""
    cutoff = dt.date.fromisoformat(run_date) - dt.timedelta(days=retry_after_days)
    selection = Selection()
    for item in inputs:
        status = prior.get(item.key)
        if status is None:
            selection.new += 1
            selection.pending.append(item)
        elif status.match == MATCH:
            selection.skipped_matched += 1
        elif dt.date.fromisoformat(status.requested_at[:10]) <= cutoff:
            selection.retry_unmatched += 1
            selection.pending.append(item)
        else:
            selection.skipped_recent_unmatched += 1
    return selection


def chunked(items: list[GeocodeInput], size: int) -> Iterator[list[GeocodeInput]]:
    if size < 1:
        raise ValueError("chunk size must be positive")
    for start in range(0, len(items), size):
        yield items[start : start + size]


# --------------------------------------------------------------------------- submit


def submit_batch(
    session: requests.Session,
    request_csv: bytes,
    *,
    benchmark: str = BENCHMARK,
    sleep: Callable[[float], None] = time.sleep,
) -> requests.Response:
    return request_with_retries(
        session,
        "POST",
        BATCH_URL,
        files={"addressFile": ("addresses.csv", request_csv, "text/csv")},
        data={"benchmark": benchmark},
        logger=logger,
        timeout=TIMEOUT,
        max_attempts=4,
        backoff_base=5.0,
        backoff_cap=120.0,
        sleep=sleep,
    )


def submit_validated(
    session: requests.Session,
    chunk: list[GeocodeInput],
    request_csv: bytes,
    *,
    benchmark: str,
    sleep: Callable[[float], None],
) -> tuple[requests.Response, list[GeocodeResponseRow], int]:
    """Submit and re-submit (with backoff) while the response does not echo the request ids."""
    last_error: ExtractError | None = None
    for attempt in range(1, VALIDATION_ATTEMPTS + 1):
        response = submit_batch(session, request_csv, benchmark=benchmark, sleep=sleep)
        try:
            rows = parse_response_csv(response.content)
            validate_response((item.key for item in chunk), rows)
        except ExtractError as exc:
            last_error = exc
            log(
                logger,
                "geocoder_response_invalid",
                logging.WARNING,
                attempt=attempt,
                error=str(exc),
            )
            if attempt < VALIDATION_ATTEMPTS:
                sleep(5.0 * 2 ** (attempt - 1))
            continue
        return response, rows, attempt
    raise ExtractError(f"geocoder response invalid after {VALIDATION_ATTEMPTS} attempts") from (
        last_error
    )


# --------------------------------------------------------------------------- run

MAX_NAME_ATTEMPTS = 20  # how often to move to the next free number after a 412 on a new name
_NUMBERED_RE = re.compile(r"/(request|response|chunk|manifest)_(\d{4,})\.(?:csv|json)$")


def run_prefix(run_date: str, run_id: str) -> str:
    return f"{raw_partition(SOURCE, run_date)}{run_id}/"


def _used_numbers(s3: Any, bucket: str, prefix: str) -> tuple[int, int]:
    """Highest chunk number and highest manifest number already present in a run folder."""
    chunk_max = manifest_max = 0
    for key in list_keys(s3, bucket, prefix):
        found = _NUMBERED_RE.search(key)
        if not found:
            continue
        number = int(found.group(2))
        if found.group(1) == "manifest":
            manifest_max = max(manifest_max, number)
        else:
            chunk_max = max(chunk_max, number)
    return chunk_max, manifest_max


def _json_bytes(data: Mapping[str, Any]) -> bytes:
    return json.dumps(data, indent=2, sort_keys=True).encode("utf-8")


def find_kc_keys(s3: Any, bucket: str, run_date: str, run_id: str | None = None) -> list[str]:
    """KC raw file for a run (by run_id), else the latest file of the run date."""
    keys = sorted(
        k
        for k in list_keys(s3, bucket, raw_partition(KC_SOURCE, run_date))
        if k.endswith(".jsonl.gz")
    )
    if run_id:
        exact = [k for k in keys if k.rsplit("/", 1)[-1] == f"{run_id}.jsonl.gz"]
        if exact:
            return exact
    if not keys:
        raise ExtractError(f"no KC raw file found for run_date {run_date}")
    return [keys[-1]]


def _claim_request(
    s3: Any, bucket: str, prefix: str, chunk_no: int, request_csv: bytes
) -> tuple[int, str]:
    """Write the request file under the first free chunk number (write-once).

    A 412 means the name was taken (e.g. by a concurrent attempt): move to the next number
    rather than overwrite.
    """
    for _ in range(MAX_NAME_ATTEMPTS):
        key = f"{prefix}request_{chunk_no:04d}.csv"
        if put_once(s3, bucket, key, request_csv, ContentType="text/csv"):
            return chunk_no, key
        log(logger, "object_already_landed", logging.WARNING, source=SOURCE, s3_key=key)
        chunk_no += 1
    raise ExtractError(f"no free chunk number in {prefix} after {MAX_NAME_ATTEMPTS} tries")


def _geocode_chunks(
    *,
    s3: Any,
    bucket: str,
    session: requests.Session,
    pending: list[GeocodeInput],
    chunk_size: int,
    first_chunk_no: int,
    prefix: str,
    benchmark: str,
    sleep: Callable[[float], None],
    chunk_pause_s: float,
    written: list[str],
    chunk_records: list[dict[str, Any]],
    match_counts: Counter[str],
) -> int:
    """Submit chunks one at a time; after each, land request, response and a chunk record.

    Every object is write-once. ``chunk_NNNN.json`` holds ``requested_at`` and counts for that
    chunk, so a crash later in the run loses nothing that resume or dbt needs.
    """
    rows_received = 0
    next_no = first_chunk_no
    for index, chunk in enumerate(chunked(pending, chunk_size)):
        if index:
            sleep(chunk_pause_s)
        request_csv = build_request_csv(chunk)
        chunk_no, request_key = _claim_request(s3, bucket, prefix, next_no, request_csv)
        next_no = chunk_no + 1
        written.append(request_key)
        response_key = f"{prefix}response_{chunk_no:04d}.csv"
        record_key = f"{prefix}chunk_{chunk_no:04d}.json"

        requested_at = utc_now_iso()
        t0 = time.monotonic()
        response, parsed, attempts = submit_validated(
            session, chunk, request_csv, benchmark=benchmark, sleep=sleep
        )
        elapsed = round(time.monotonic() - t0, 2)
        response_created = put_once(
            s3, bucket, response_key, response.content, ContentType="text/csv"
        )
        if not response_created:
            log(
                logger, "object_already_landed", logging.WARNING, source=SOURCE, s3_key=response_key
            )
        written.append(response_key)

        chunk_matches = Counter(row.match for row in parsed)
        match_counts.update(chunk_matches)
        rows_received += len(parsed)
        record = {
            "source": SOURCE,
            "chunk": chunk_no,
            "request_key": request_key,
            "response_key": response_key,
            "response_already_landed": not response_created,
            "benchmark": benchmark,
            "key_rule_version": KEY_RULE_VERSION,
            "rows_sent": len(chunk),
            "rows_received": len(parsed),
            "request_bytes": len(request_csv),
            "response_bytes": len(response.content),
            "http_status": response.status_code,
            "attempts": attempts,
            "requested_at": requested_at,
            "elapsed_s": elapsed,
            "match_counts": dict(sorted(chunk_matches.items())),
        }
        if not put_once(
            s3, bucket, record_key, _json_bytes(record), ContentType="application/json"
        ):
            log(logger, "object_already_landed", logging.WARNING, source=SOURCE, s3_key=record_key)
        written.append(record_key)
        chunk_records.append(record)
        log(logger, "chunk_geocoded", **record)
    return rows_received


def _write_manifest(
    s3: Any, bucket: str, prefix: str, first_no: int, manifest: dict[str, Any]
) -> str:
    """Write this attempt's manifest once, as ``manifest_NNNN.json`` (first free number)."""
    number = first_no
    for _ in range(MAX_NAME_ATTEMPTS):
        key = f"{prefix}manifest_{number:04d}.json"
        manifest["attempt"] = number
        if put_once(s3, bucket, key, _json_bytes(manifest), ContentType="application/json"):
            return key
        number += 1
    raise ExtractError(f"no free manifest number in {prefix} after {MAX_NAME_ATTEMPTS} tries")


def extract(
    *,
    bucket: str,
    run_date: str,
    run_id: str,
    kc_keys: list[str],
    s3: Any,
    lcb_keys: list[str] | None = None,
    session: requests.Session | None = None,
    benchmark: str = BENCHMARK,
    chunk_size: int = MAX_CHUNK_SIZE,
    retry_after_days: int = RETRY_UNMATCHED_AFTER_DAYS,
    sleep: Callable[[float], None] = time.sleep,
    chunk_pause_s: float = CHUNK_PAUSE_S,
) -> dict[str, Any]:
    """Geocode new addresses from the given KC (and WSLCB) raw files. Returns the step result."""
    validate_run_id(run_id)
    lcb_keys = lcb_keys or []
    if not kc_keys and not lcb_keys:
        raise ExtractError("no raw keys given to the geocoder")
    if not 1 <= chunk_size <= 10_000:
        raise ValueError("chunk_size must be between 1 and 10,000")
    started_at = utc_now_iso()
    started = time.monotonic()

    def all_rows() -> Iterator[dict[str, Any]]:
        for key in kc_keys:
            yield from iter_kc_rows(s3, bucket, key)
        for key in lcb_keys:
            yield from iter_lcb_address_rows(s3, bucket, key)

    inputs, stats = build_inputs(all_rows())
    prior = load_prior_status(s3, bucket)
    selection = select_pending(inputs, prior, run_date=run_date, retry_after_days=retry_after_days)
    counts = {
        "kc_rows": stats.kc_rows,
        "mobile_rows_excluded": stats.mobile_rows_excluded,
        "empty_street_rows_skipped": stats.empty_street_rows_skipped,
        "distinct_keys": stats.distinct_keys,
        "new": selection.new,
        "retry_unmatched": selection.retry_unmatched,
        "skipped_matched": selection.skipped_matched,
        "skipped_recent_unmatched": selection.skipped_recent_unmatched,
        "pending": len(selection.pending),
    }
    log(
        logger,
        "geocode_selection",
        source=SOURCE,
        run_date=run_date,
        run_id=run_id,
        kc_keys=kc_keys,
        **counts,
    )

    prefix = run_prefix(run_date, run_id)
    chunk_max, manifest_max = _used_numbers(s3, bucket, prefix)
    manifest: dict[str, Any] = {
        "source": SOURCE,
        "run_date": run_date,
        "run_id": run_id,
        "endpoint": BATCH_URL,
        "benchmark": benchmark,
        "key_rule_version": KEY_RULE_VERSION,
        "started_at": started_at,
        "kc_input_keys": kc_keys,
        "lcb_input_keys": lcb_keys,
        "counts": counts,
    }
    written: list[str] = []
    chunk_records: list[dict[str, Any]] = []
    match_counts: Counter[str] = Counter()
    session = session or new_session()
    try:
        rows_received = _geocode_chunks(
            s3=s3,
            bucket=bucket,
            session=session,
            pending=selection.pending,
            chunk_size=chunk_size,
            first_chunk_no=chunk_max + 1,
            prefix=prefix,
            benchmark=benchmark,
            sleep=sleep,
            chunk_pause_s=chunk_pause_s,
            written=written,
            chunk_records=chunk_records,
            match_counts=match_counts,
        )
    except Exception as exc:
        manifest.update(
            {
                "status": "failed",
                "failed_at": utc_now_iso(),
                "error": str(exc)[:500],
                "chunks": chunk_records,
                "written_keys": written,
            }
        )
        try:
            _write_manifest(s3, bucket, prefix, manifest_max + 1, manifest)
        except Exception as manifest_exc:  # keep the original error
            log(logger, "manifest_write_failed", logging.ERROR, error=str(manifest_exc))
        log(logger, "extract_failed", logging.ERROR, source=SOURCE, run_id=run_id, error=str(exc))
        raise

    manifest.update(
        {
            "status": STATUS_SUCCEEDED,
            "completed_at": utc_now_iso(),
            "rows_received": rows_received,
            "match_counts": dict(sorted(match_counts.items())),
            "chunks": chunk_records,
            "written_keys": written,
        }
    )
    manifest_key = _write_manifest(s3, bucket, prefix, manifest_max + 1, manifest)

    result = {
        "source": SOURCE,
        "status": STATUS_SUCCEEDED,
        "run_date": run_date,
        "run_id": run_id,
        "rows": rows_received,
        "chunks": len(chunk_records),
        "match_counts": dict(sorted(match_counts.items())),
        "counts": counts,
        "s3_keys": [*written, manifest_key],
        "bucket": bucket,
        "elapsed_s": round(time.monotonic() - started, 2),
    }
    log(logger, "extract_succeeded", **result)
    return result
