from __future__ import annotations

import gzip
import json
from typing import Any

import pytest

from sources import lcb_local_authority as lcb
from sources.common import STATUS_SKIPPED_EXISTING, STATUS_SUCCEEDED, ExtractError
from tests.conftest import BUCKET, all_keys, fixture_json, object_body

RUN_DATE = "2026-11-19"
ROWS = fixture_json("lcb_local_authority_page.json")  # live sample, personal fields replaced


def landed_rows(s3: Any, key: str) -> list[dict[str, Any]]:
    lines = gzip.decompress(object_body(s3, key)).decode().splitlines()
    return [json.loads(line) for line in lines if line]


def test_lands_the_snapshot_as_received(s3: Any, http: Any) -> None:
    http.get(lcb.BASE_URL, json=ROWS)
    result = lcb.extract(bucket=BUCKET, run_date=RUN_DATE, run_id="r1", s3=s3)

    assert result["status"] == STATUS_SUCCEEDED
    assert result["rows"] == len(ROWS)
    key = "raw/lcb_local_authority/dt=2026-11-19/r1.jsonl.gz"
    assert all_keys(s3) == [key]
    assert landed_rows(s3, key) == ROWS  # unchanged: same keys, same string values


def test_reuses_todays_file_unless_forced(s3: Any, http: Any) -> None:
    http.get(lcb.BASE_URL, json=ROWS)
    lcb.extract(bucket=BUCKET, run_date=RUN_DATE, run_id="r1", s3=s3)

    again = lcb.extract(bucket=BUCKET, run_date=RUN_DATE, run_id="r2", s3=s3)
    assert again["status"] == STATUS_SKIPPED_EXISTING
    assert len(http.calls) == 1  # no second pull

    forced = lcb.extract(bucket=BUCKET, run_date=RUN_DATE, run_id="r3", s3=s3, force=True)
    assert forced["status"] == STATUS_SUCCEEDED
    assert len(all_keys(s3)) == 2  # a new file beside the old one, never an overwrite


def test_refuses_a_response_that_is_not_a_list(s3: Any, http: Any) -> None:
    http.get(lcb.BASE_URL, json={"error": "nope"})
    with pytest.raises(ExtractError):
        lcb.extract(bucket=BUCKET, run_date=RUN_DATE, run_id="r1", s3=s3)
    assert all_keys(s3) == []


def test_refuses_a_full_page_rather_than_landing_part_of_it(
    s3: Any, http: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lcb, "PAGE_LIMIT", len(ROWS))
    http.get(lcb.BASE_URL, json=ROWS)
    with pytest.raises(ExtractError, match="page limit"):
        lcb.extract(bucket=BUCKET, run_date=RUN_DATE, run_id="r1", s3=s3)
    assert all_keys(s3) == []


def test_fixture_holds_no_real_contact_details() -> None:
    for row in ROWS:
        assert row.get("dayphone") in (None, "2065550100")
        for field in ("contact", "applicants", "designatedsignee", "licenseename", "mailaddress"):
            assert field not in row or str(row[field]).startswith(("SAMPLE", "100 SAMPLE"))
