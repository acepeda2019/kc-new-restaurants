"""Shared helpers for the extractors: config, run context, structured logging, HTTP retries, S3.

Nothing in here transforms source data. It only deals with plumbing.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re
import secrets
import time
from collections.abc import Callable, Iterable, Mapping
from typing import Any
from zoneinfo import ZoneInfo

import requests

LOCAL_TZ = ZoneInfo("America/Los_Angeles")
USER_AGENT = "kc-new-eats-ingestion/0.1 (+python-requests)"
RAW_PREFIX = "raw"
RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})

# Result statuses that mean "this step is good, carry on".
STATUS_SUCCEEDED = "succeeded"
STATUS_SKIPPED_EXISTING = "skipped_existing"
OK_STATUSES = frozenset({STATUS_SUCCEEDED, STATUS_SKIPPED_EXISTING})

_RUN_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


class ConfigError(RuntimeError):
    """Missing or invalid configuration."""


class ExtractError(RuntimeError):
    """The extract could not complete; the workflow must stop."""


# --------------------------------------------------------------------------- config


def env(name: str, default: str | None = None, *, required: bool = False) -> str | None:
    """Read an environment variable; empty strings count as unset."""
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        if required:
            raise ConfigError(f"environment variable {name} is required")
        return default
    return value.strip()


# --------------------------------------------------------------------------- run context


def resolve_run_date(value: str | None, *, now: dt.datetime | None = None) -> str:
    """Return the run date as YYYY-MM-DD: the given value, else today in America/Los_Angeles."""
    if value:
        if not _RUN_DATE_RE.match(value):
            raise ConfigError(f"run_date must be YYYY-MM-DD, got {value!r}")
        dt.date.fromisoformat(value)  # raises on impossible dates like 2026-02-30
        return value
    now = now or dt.datetime.now(dt.UTC)
    return now.astimezone(LOCAL_TZ).date().isoformat()


def new_run_id(*, now: dt.datetime | None = None) -> str:
    """Sortable, unique run id: UTC timestamp plus 8 random hex chars."""
    now = (now or dt.datetime.now(dt.UTC)).astimezone(dt.UTC)
    return f"{now:%Y%m%dT%H%M%SZ}-{secrets.token_hex(4)}"


def validate_run_id(value: str) -> str:
    if not _RUN_ID_RE.match(value):
        raise ConfigError(f"run_id has unsupported characters: {value!r}")
    return value


def utc_now_iso() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def raw_partition(source: str, run_date: str) -> str:
    """S3 prefix of one source's partition for a run date (with trailing slash)."""
    return f"{RAW_PREFIX}/{source}/dt={run_date}/"


# --------------------------------------------------------------------------- logging


class JsonFormatter(logging.Formatter):
    """One JSON object per line, so CloudWatch Logs Insights can query fields."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": dt.datetime.fromtimestamp(record.created, dt.UTC).isoformat(
                timespec="milliseconds"
            ),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, Mapping):
            payload.update(fields)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str | None = None) -> None:
    """Install the JSON formatter on the root logger (idempotent; keeps any handler already installed)."""
    root = logging.getLogger()
    root.setLevel((level or env("LOG_LEVEL", "INFO") or "INFO").upper())
    if not root.handlers:
        root.addHandler(logging.StreamHandler())
    for handler in root.handlers:
        handler.setFormatter(JsonFormatter())
    # botocore is chatty at DEBUG and can log request bodies.
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def log(logger: logging.Logger, event: str, level: int = logging.INFO, **fields: Any) -> None:
    logger.log(level, event, extra={"fields": fields})


# --------------------------------------------------------------------------- HTTP


def new_session(headers: Mapping[str, str] | None = None) -> requests.Session:
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    if headers:
        session.headers.update(headers)
    return session


def backoff_delay(attempt: int, *, base: float, cap: float) -> float:
    """Exponential backoff for attempt 1, 2, 3 ... : base, 2*base, 4*base, capped."""
    return min(cap, base * (2 ** (attempt - 1)))


def _retry_after_seconds(response: requests.Response) -> float | None:
    value = response.headers.get("Retry-After")
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def request_with_retries(
    session: requests.Session,
    method: str,
    url: str,
    *,
    logger: logging.Logger,
    timeout: float | tuple[float, float],
    max_attempts: int = 4,
    backoff_base: float = 2.0,
    backoff_cap: float = 60.0,
    sleep: Callable[[float], None] = time.sleep,
    retry_statuses: Iterable[int] = RETRYABLE_STATUSES,
    **kwargs: Any,
) -> requests.Response:
    """Send one HTTP request, retrying timeouts, connection errors and retryable statuses.

    Non-retryable HTTP errors (e.g. 400, 401, 404) raise immediately. The final failure is
    raised as ``ExtractError`` so the workflow stops.
    """
    retry_set = frozenset(retry_statuses)
    last_error: str = ""
    for attempt in range(1, max_attempts + 1):
        try:
            response = session.request(method, url, timeout=timeout, **kwargs)
        except (requests.Timeout, requests.ConnectionError) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            delay = backoff_delay(attempt, base=backoff_base, cap=backoff_cap)
        else:
            if response.status_code < 400:
                return response
            last_error = f"HTTP {response.status_code}: {response.text[:300]}"
            if response.status_code not in retry_set:
                raise ExtractError(f"{method} {url} failed: {last_error}")
            delay = _retry_after_seconds(response) or backoff_delay(
                attempt, base=backoff_base, cap=backoff_cap
            )
        if attempt == max_attempts:
            break
        log(
            logger,
            "http_retry",
            logging.WARNING,
            url=url,
            attempt=attempt,
            max_attempts=max_attempts,
            delay_s=delay,
            error=last_error,
        )
        sleep(delay)
    raise ExtractError(f"{method} {url} failed after {max_attempts} attempts: {last_error}")


# --------------------------------------------------------------------------- S3


def s3_client() -> Any:
    import boto3  # imported lazily so pure helpers stay importable without AWS config

    return boto3.client("s3")


def list_keys(s3: Any, bucket: str, prefix: str) -> list[str]:
    keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        keys.extend(obj["Key"] for obj in page.get("Contents", []))
    return keys


def put_once(s3: Any, bucket: str, key: str, body: bytes, **extra: Any) -> bool:
    """Write-once PutObject: sends ``If-None-Match: *`` (required by the raw bucket policy).

    Returns True if this call created the object, False if it already existed (HTTP 412
    PreconditionFailed), which callers treat as "already landed". Other errors raise.
    """
    from botocore.exceptions import ClientError

    try:
        s3.put_object(Bucket=bucket, Key=key, Body=body, IfNoneMatch="*", **extra)
    except ClientError as exc:
        error = exc.response.get("Error", {})
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if error.get("Code") == "PreconditionFailed" or status == 412:
            return False
        raise
    return True


def read_object(s3: Any, bucket: str, key: str) -> bytes:
    return s3.get_object(Bucket=bucket, Key=key)["Body"].read()


def object_exists(s3: Any, bucket: str, key: str) -> bool:
    from botocore.exceptions import ClientError

    try:
        s3.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise
    return True
