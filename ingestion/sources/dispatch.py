"""Send the GitHub ``repository_dispatch`` that starts the dbt pipeline workflow.

Called by Step Functions after every extract step succeeded. It re-checks that each step
result has an OK status and refuses to dispatch otherwise, so dbt never runs on a half-loaded
day even if the state machine wiring is wrong.

The token is read from AWS Secrets Manager (secret ARN in ``GITHUB_TOKEN_SECRET_ARN``). The
secret may be the bare token string or JSON with a ``token`` (or ``github_token``) field. The
token is never logged.

Payload sent to ``POST /repos/{GITHUB_REPO}/dispatches``::

    {"event_type": "pipeline_run",
     "client_payload": {"run_date": "...", "run_id": "...",
                        "s3_keys": {"kc_inspections": [...], "census_geocoder": [...]},
                        "rows": {"kc_inspections": n, "census_geocoder": n},
                        "statuses": {"kc_inspections": "succeeded", ...}}}
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable, Iterable, Mapping
from typing import Any

import requests

from sources.common import (
    OK_STATUSES,
    ConfigError,
    ExtractError,
    log,
    new_session,
    request_with_retries,
)

EVENT_TYPE = "pipeline_run"
API_BASE = "https://api.github.com"
TIMEOUT = (10.0, 30.0)
REQUIRED_SOURCES = ("kc_inspections", "census_geocoder")
_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

logger = logging.getLogger(__name__)


def normalize_results(event: Any) -> list[dict[str, Any]]:
    """Accept the step results as a list, ``{"results": [...]}``, or ``{name: result}``."""
    if isinstance(event, Mapping) and "results" in event:
        event = event["results"]
    if isinstance(event, Mapping):
        event = [v for v in event.values() if isinstance(v, Mapping) and "source" in v]
    if not isinstance(event, list) or not all(isinstance(r, Mapping) for r in event):
        raise ExtractError("dispatch input must be a list of step results")
    return [dict(r) for r in event]


def build_payload(
    results: Iterable[Mapping[str, Any]],
    *,
    required_sources: Iterable[str] = REQUIRED_SOURCES,
) -> dict[str, Any]:
    """Build the dispatch body; raise unless every required source is present and OK."""
    by_source: dict[str, Mapping[str, Any]] = {}
    for result in results:
        source = result.get("source")
        if not source:
            raise ExtractError(f"step result without a source: {dict(result)!r}")
        if source in by_source:
            raise ExtractError(f"duplicate result for source {source}")
        by_source[source] = result

    required_sources = tuple(required_sources)
    missing = [s for s in required_sources if s not in by_source]
    if missing:
        raise ExtractError(f"missing step results for: {', '.join(missing)}")
    failed = {
        s: r.get("status") for s, r in by_source.items() if r.get("status") not in OK_STATUSES
    }
    if failed:
        raise ExtractError(f"not dispatching; steps not OK: {failed}")
    run_dates = {r.get("run_date") for r in by_source.values()}
    if len(run_dates) != 1 or None in run_dates:
        raise ExtractError(f"step results disagree on run_date: {sorted(map(str, run_dates))}")
    # The geocoder reuses the KC run_id, so the first required source's run_id names the run.
    if required_sources:
        anchor = by_source[required_sources[0]]
    elif by_source:
        anchor = next(iter(by_source.values()))
    else:
        raise ExtractError("no step results to dispatch")
    run_id = anchor.get("run_id")

    return {
        "event_type": EVENT_TYPE,
        "client_payload": {
            "run_date": run_dates.pop(),
            "run_id": run_id,
            "s3_keys": {s: list(r.get("s3_keys", [])) for s, r in by_source.items()},
            "rows": {s: int(r.get("rows", 0)) for s, r in by_source.items()},
            "statuses": {s: r.get("status") for s, r in by_source.items()},
        },
    }


def read_token(secret_arn: str, client: Any) -> str:
    """GitHub token from Secrets Manager: bare string or JSON ``{"token": ...}``."""
    secret = client.get_secret_value(SecretId=secret_arn).get("SecretString") or ""
    secret = secret.strip()
    if secret.startswith("{"):
        try:
            data = json.loads(secret)
        except json.JSONDecodeError as exc:
            raise ConfigError("GitHub token secret is not valid JSON") from exc
        secret = str(data.get("token") or data.get("github_token") or "").strip()
    if not secret:
        raise ConfigError("GitHub token secret is empty")
    return secret


def send_dispatch(
    *,
    repo: str,
    token: str,
    payload: Mapping[str, Any],
    session: requests.Session | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    """POST the dispatch; GitHub answers 204 No Content on success. Returns the status code."""
    if not _REPO_RE.match(repo):
        raise ConfigError(f"GITHUB_REPO must be 'owner/name', got {repo!r}")
    session = session or new_session()
    response = request_with_retries(
        session,
        "POST",
        f"{API_BASE}/repos/{repo}/dispatches",
        json=payload,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        logger=logger,
        timeout=TIMEOUT,
        max_attempts=4,
        sleep=sleep,
        retry_statuses={429, 500, 502, 503, 504},
    )
    if response.status_code != 204:
        raise ExtractError(f"unexpected GitHub response {response.status_code}")
    return response.status_code


def dispatch(
    *,
    event: Any,
    repo: str,
    secret_arn: str,
    secrets_client: Any,
    session: requests.Session | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    results = normalize_results(event)
    payload = build_payload(results)
    token = read_token(secret_arn, secrets_client)
    status_code = send_dispatch(
        repo=repo, token=token, payload=payload, session=session, sleep=sleep
    )
    client_payload = payload["client_payload"]
    keys = [k for ks in client_payload["s3_keys"].values() for k in ks]
    result = {
        "source": "dispatch",
        "status": "succeeded",
        "run_date": client_payload["run_date"],
        "run_id": client_payload["run_id"],
        "rows": sum(client_payload["rows"].values()),
        "s3_keys": keys,
        "repo": repo,
        "event_type": EVENT_TYPE,
        "http_status": status_code,
    }
    log(logger, "dispatch_sent", **result)
    return result
