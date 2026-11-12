from __future__ import annotations

import gzip
import json
from typing import Any

import pytest
import requests
import responses
from responses import matchers

from sources import kc_inspections as kc
from sources.common import STATUS_SKIPPED_EXISTING, STATUS_SUCCEEDED, ExtractError
from tests.conftest import BUCKET, TRUTH_LAST_MODIFIED, all_keys, fixture_json, object_body

RUN_DATE = "2026-11-12"
PAGES = {
    0: fixture_json("kc_page_offset0.json"),
    3: fixture_json("kc_page_offset3.json"),
    6: fixture_json("kc_page_offset6.json"),
}
ALL_ROWS = PAGES[0] + PAGES[3] + PAGES[6]
HEADERS = {"X-SODA2-Truth-Last-Modified": TRUTH_LAST_MODIFIED}


def add_count(http: responses.RequestsMock, count: int, headers: dict[str, str] | None = None):
    http.get(
        kc.BASE_URL,
        json=[{"row_count": str(count)}],
        headers=headers or HEADERS,
        match=[matchers.query_param_matcher({"$select": "count(*) as row_count"})],
    )


def add_page(http: responses.RequestsMock, offset: int, rows: list[Any], limit: int = 3, **kw):
    params = {"$limit": str(limit), "$offset": str(offset), "$order": ":id"}
    kw.setdefault("headers", HEADERS)
    if "body" not in kw:
        kw["json"] = rows
    http.get(kc.BASE_URL, match=[matchers.query_param_matcher(params)], **kw)


def run(s3: Any, sleeps: list[float], **kw: Any) -> dict[str, Any]:
    kw.setdefault("run_id", "20261112T150000Z-aaaaaaaa")
    return kc.extract(
        bucket=BUCKET, run_date=RUN_DATE, s3=s3, page_size=3, sleep=sleeps.append, **kw
    )


def landed_rows(s3: Any, key: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in gzip.decompress(object_body(s3, key)).splitlines()]


def test_full_pull_pages_with_limit_offset_and_stable_order(s3, http, no_sleep):
    add_count(http, 7)
    for offset, rows in PAGES.items():
        add_page(http, offset, rows)

    result = run(s3, no_sleep)

    key = "raw/kc_inspections/dt=2026-11-12/20261112T150000Z-aaaaaaaa.jsonl.gz"
    assert result["status"] == STATUS_SUCCEEDED
    assert result["rows"] == 7
    assert result["pages"] == 3
    assert result["s3_keys"] == [key]
    assert result["run_date"] == RUN_DATE
    assert result["bytes"] == len(object_body(s3, key))
    page_calls = [c for c in http.calls if "%24offset" in c.request.url]
    assert len(page_calls) == 3
    assert all("%24order=%3Aid" in c.request.url for c in page_calls)


def test_rows_are_landed_exactly_as_received(s3, http, no_sleep):
    add_count(http, 7)
    for offset, rows in PAGES.items():
        add_page(http, offset, rows)

    result = run(s3, no_sleep)

    landed = landed_rows(s3, result["s3_keys"][0])
    assert landed == ALL_ROWS  # same keys, same string values, same order
    # absent keys stay absent (Socrata omits nulls); nothing is added or renamed
    assert [sorted(r) for r in landed] == [sorted(r) for r in ALL_ROWS]
    head = s3.head_object(Bucket=BUCKET, Key=result["s3_keys"][0])
    assert head["Metadata"]["rows"] == "7"
    assert head["Metadata"]["source-last-modified"] == TRUTH_LAST_MODIFIED


def test_exact_multiple_of_page_size_ends_on_empty_page(s3, http, no_sleep):
    add_count(http, 6)
    add_page(http, 0, PAGES[0])
    add_page(http, 3, PAGES[3])
    add_page(http, 6, [])

    result = run(s3, no_sleep)

    assert result["rows"] == 6
    assert result["pages"] == 3


def test_retries_transient_errors_with_exponential_backoff(s3, http, no_sleep):
    add_count(http, 7)
    add_page(http, 0, [], status=503)
    add_page(http, 0, [], body=requests.ConnectionError("reset"))
    add_page(http, 0, PAGES[0])
    add_page(http, 3, [], status=429, headers={"Retry-After": "7"})
    add_page(http, 3, PAGES[3])
    add_page(http, 6, PAGES[6])

    result = run(s3, no_sleep, page_pause_s=0.5)

    assert result["rows"] == 7
    # 2.0, 4.0 = backoff for page 1; 0.5 polite pause; 7 = Retry-After; 0.5 pause
    assert no_sleep == [2.0, 4.0, 0.5, 7.0, 0.5]


def test_gives_up_after_max_attempts_and_lands_nothing(s3, http, no_sleep):
    add_count(http, 7)
    for _ in range(4):
        add_page(http, 0, [], status=502)

    with pytest.raises(ExtractError, match="after 4 attempts"):
        run(s3, no_sleep)
    assert all_keys(s3) == []


def test_client_error_is_not_retried(s3, http, no_sleep):
    add_count(http, 7)
    add_page(http, 0, [], status=400)

    with pytest.raises(ExtractError, match="HTTP 400"):
        run(s3, no_sleep)
    assert no_sleep == []


def test_row_count_mismatch_fails(s3, http, no_sleep):
    add_count(http, 8)
    for offset, rows in PAGES.items():
        add_page(http, offset, rows)

    with pytest.raises(ExtractError, match="row count mismatch"):
        run(s3, no_sleep)
    assert all_keys(s3) == []


def test_dataset_republished_mid_pull_fails(s3, http, no_sleep):
    add_count(http, 7)
    add_page(http, 0, PAGES[0])
    add_page(http, 3, PAGES[3])
    add_page(http, 6, PAGES[6], headers={"X-SODA2-Truth-Last-Modified": "Fri, 13 Nov 2026"})

    with pytest.raises(ExtractError, match="dataset changed"):
        run(s3, no_sleep)
    assert all_keys(s3) == []


def test_app_token_header_is_sent_when_configured(s3, http, no_sleep):
    add_count(http, 7)
    for offset, rows in PAGES.items():
        add_page(http, offset, rows)

    run(s3, no_sleep, app_token="tok-123")

    assert all(c.request.headers.get("X-App-Token") == "tok-123" for c in http.calls)


def test_no_app_token_header_by_default(s3, http, no_sleep):
    add_count(http, 7)
    for offset, rows in PAGES.items():
        add_page(http, offset, rows)

    run(s3, no_sleep)

    assert all("X-App-Token" not in c.request.headers for c in http.calls)


def test_rerun_for_same_date_is_a_no_op(s3, http, no_sleep):
    add_count(http, 7)
    for offset, rows in PAGES.items():
        add_page(http, offset, rows)
    first = run(s3, no_sleep)
    calls_after_first = len(http.calls)
    body_before = object_body(s3, first["s3_keys"][0])

    second = run(s3, no_sleep, run_id="20261112T170000Z-bbbbbbbb")

    assert len(http.calls) == calls_after_first  # no network on the re-run
    assert second["status"] == STATUS_SKIPPED_EXISTING
    assert second["s3_keys"] == first["s3_keys"]
    assert second["run_id"] == first["run_id"]
    assert second["rows"] == 7
    assert all_keys(s3) == first["s3_keys"]
    assert object_body(s3, first["s3_keys"][0]) == body_before


def test_force_lands_a_new_file_and_keeps_the_old_one(s3, http, no_sleep):
    add_count(http, 7)
    for offset, rows in PAGES.items():
        add_page(http, offset, rows)
    first = run(s3, no_sleep)
    second = run(s3, no_sleep, run_id="20261112T170000Z-bbbbbbbb", force=True)

    assert second["status"] == STATUS_SUCCEEDED
    assert all_keys(s3) == sorted(first["s3_keys"] + second["s3_keys"])
    # deterministic gzip: identical content gives identical bytes
    assert object_body(s3, first["s3_keys"][0]) == object_body(s3, second["s3_keys"][0])


def test_rejects_unsafe_run_id(s3, no_sleep):
    with pytest.raises(Exception, match="run_id"):
        run(s3, no_sleep, run_id="../etc")
