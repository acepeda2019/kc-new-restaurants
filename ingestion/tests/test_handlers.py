"""Handlers wired end to end with moto S3/Secrets Manager and recorded HTTP responses."""

from __future__ import annotations

from typing import Any

import boto3
import pytest
import responses
from responses import matchers

from handlers import census_geocoder as geo_handler
from handlers import dispatch as dispatch_handler
from handlers import kc_inspections as kc_handler
from sources import census_geocoder as geo
from sources import kc_inspections as kc
from sources.common import ConfigError, ExtractError
from tests.conftest import BUCKET, TRUTH_LAST_MODIFIED, fixture_bytes, fixture_jsonl

TRICKY = fixture_jsonl("kc_rows_tricky.jsonl")
RESPONSE = fixture_bytes("geocoder_response.csv")


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch, s3: Any) -> Any:
    monkeypatch.setenv("RAW_BUCKET", BUCKET)
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    # Handlers use the client that enforces the raw bucket policy (create-only writes).
    monkeypatch.setattr(kc_handler, "s3_client", lambda: s3)
    monkeypatch.setattr(geo_handler, "s3_client", lambda: s3)
    # Single-page / single-chunk fixtures: no polite pause or retry sleep is reached here.
    return s3


def mock_kc_single_page(http: responses.RequestsMock) -> None:
    headers = {"X-SODA2-Truth-Last-Modified": TRUTH_LAST_MODIFIED}
    http.get(
        kc.BASE_URL,
        json=[{"row_count": str(len(TRICKY))}],
        headers=headers,
        match=[matchers.query_param_matcher({"$select": "count(*) as row_count"})],
    )
    http.get(
        kc.BASE_URL,
        json=TRICKY,
        headers=headers,
        match=[matchers.query_param_matcher({"$limit": "50000", "$offset": "0", "$order": ":id"})],
    )


def test_pipeline_kc_then_geocoder_then_dispatch(env, http, monkeypatch) -> None:
    mock_kc_single_page(http)
    http.post(geo.BATCH_URL, body=RESPONSE)

    kc_result = kc_handler.handler({"run_date": "2026-11-12", "run_id": "run-1"}, None)
    assert kc_result["status"] == "succeeded"
    assert kc_result["rows"] == len(TRICKY)
    assert kc_result["s3_keys"] == ["raw/kc_inspections/dt=2026-11-12/run-1.jsonl.gz"]
    assert {"status", "rows", "s3_keys", "run_date", "run_id"} <= set(kc_result)

    geo_result = geo_handler.handler(kc_result, None)  # Step Functions passes the KC result
    assert geo_result["status"] == "succeeded"
    assert geo_result["run_id"] == "run-1"
    assert geo_result["rows"] == 8

    secrets = boto3.client("secretsmanager", region_name="us-west-2")
    arn = secrets.create_secret(Name="gh", SecretString='{"token": "ghp_x"}')["ARN"]
    monkeypatch.setenv("GITHUB_REPO", "example-owner/example-repo")
    monkeypatch.setenv("GITHUB_TOKEN_SECRET_ARN", arn)
    http.post("https://api.github.com/repos/example-owner/example-repo/dispatches", status=204)

    out = dispatch_handler.handler([kc_result, geo_result], None)
    assert out["status"] == "succeeded"
    assert out["run_date"] == "2026-11-12"


def test_kc_handler_defaults_run_date_and_run_id(env, http) -> None:
    mock_kc_single_page(http)
    result = kc_handler.handler({}, None)
    assert len(result["run_date"]) == 10
    assert result["run_id"]
    assert result["s3_keys"][0].startswith(f"raw/kc_inspections/dt={result['run_date']}/")


def test_kc_handler_requires_bucket(s3) -> None:
    with pytest.raises(ConfigError, match="RAW_BUCKET"):
        kc_handler.handler({}, None)


def test_kc_handler_rejects_bad_run_date(env) -> None:
    with pytest.raises(ConfigError, match="YYYY-MM-DD"):
        kc_handler.handler({"run_date": "11/12/2026"}, None)


def test_kc_handler_raises_on_source_failure(env, http) -> None:
    http.get(kc.BASE_URL, status=404)
    with pytest.raises(ExtractError):
        kc_handler.handler({"run_date": "2026-11-12"}, None)


def test_geocoder_handler_refuses_failed_kc_step(env) -> None:
    with pytest.raises(ExtractError, match="not geocoding"):
        geo_handler.handler({"status": "failed", "run_date": "2026-11-12", "run_id": "r"}, None)


def test_geocoder_handler_finds_kc_file_without_keys(env, http) -> None:
    mock_kc_single_page(http)
    http.post(geo.BATCH_URL, body=RESPONSE)
    kc_handler.handler({"run_date": "2026-11-12", "run_id": "run-1"}, None)

    result = geo_handler.handler({"kc_inspections": {"run_date": "2026-11-12"}}, None)
    assert result["counts"]["kc_rows"] == len(TRICKY)


def test_dispatch_handler_requires_config(aws) -> None:
    with pytest.raises(ConfigError, match="GITHUB_REPO"):
        dispatch_handler.handler([], None)
