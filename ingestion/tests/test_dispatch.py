from __future__ import annotations

import json
from typing import Any

import boto3
import pytest

from sources import dispatch as dsp
from sources.common import ConfigError, ExtractError

REPO = "example-owner/example-repo"
URL = f"https://api.github.com/repos/{REPO}/dispatches"

KC = {
    "source": "kc_inspections",
    "status": "succeeded",
    "run_date": "2026-11-12",
    "run_id": "20261112T150000Z-aaaaaaaa",
    "rows": 111644,
    "s3_keys": ["raw/kc_inspections/dt=2026-11-12/20261112T150000Z-aaaaaaaa.jsonl.gz"],
}
GEO = {
    "source": "census_geocoder",
    "status": "succeeded",
    "run_date": "2026-11-12",
    "run_id": "20261112T150000Z-aaaaaaaa",
    "rows": 8,
    "s3_keys": [
        "raw/census_geocoder/dt=2026-11-12/20261112T150000Z-aaaaaaaa/request_0001.csv",
        "raw/census_geocoder/dt=2026-11-12/20261112T150000Z-aaaaaaaa/response_0001.csv",
        "raw/census_geocoder/dt=2026-11-12/20261112T150000Z-aaaaaaaa/manifest_0001.json",
    ],
}


@pytest.fixture
def secret_arn(aws: Any) -> str:
    client = boto3.client("secretsmanager", region_name="us-west-2")
    return client.create_secret(Name="gh-dispatch", SecretString="ghp_test_token")["ARN"]


def test_payload_shape() -> None:
    payload = dsp.build_payload([KC, GEO])
    assert payload == {
        "event_type": "pipeline_run",
        "client_payload": {
            "run_date": "2026-11-12",
            "run_id": "20261112T150000Z-aaaaaaaa",
            "s3_keys": {"kc_inspections": KC["s3_keys"], "census_geocoder": GEO["s3_keys"]},
            "rows": {"kc_inspections": 111644, "census_geocoder": 8},
            "statuses": {"kc_inspections": "succeeded", "census_geocoder": "succeeded"},
        },
    }
    assert len(payload["client_payload"]) <= 10  # GitHub limit on top-level properties


def test_skipped_existing_kc_still_dispatches() -> None:
    payload = dsp.build_payload([{**KC, "status": "skipped_existing"}, GEO])
    assert payload["client_payload"]["statuses"]["kc_inspections"] == "skipped_existing"


@pytest.mark.parametrize(
    ("results", "message"),
    [
        ([KC], "missing step results for: census_geocoder"),
        ([KC, {**GEO, "status": "failed"}], "steps not OK"),
        ([KC, {**GEO, "run_date": "2026-11-11"}], "disagree on run_date"),
        ([KC, KC, GEO], "duplicate"),
        ([KC, {k: v for k, v in GEO.items() if k != "source"}], "without a source"),
    ],
)
def test_refuses_to_build_payload(results: list[dict[str, Any]], message: str) -> None:
    with pytest.raises(ExtractError, match=message):
        dsp.build_payload(results)


@pytest.mark.parametrize(
    "event",
    [
        [KC, GEO],
        {"results": [KC, GEO]},
        {"kc_inspections": KC, "census_geocoder": GEO},
    ],
)
def test_normalize_results_accepts_step_functions_shapes(event: Any) -> None:
    assert dsp.normalize_results(event) == [KC, GEO]


def test_normalize_results_rejects_garbage() -> None:
    with pytest.raises(ExtractError):
        dsp.normalize_results("nope")


def test_read_token_bare_and_json(aws: Any) -> None:
    client = boto3.client("secretsmanager", region_name="us-west-2")
    bare = client.create_secret(Name="a", SecretString=" ghp_bare \n")["ARN"]
    js = client.create_secret(Name="b", SecretString=json.dumps({"token": "ghp_json"}))["ARN"]
    empty = client.create_secret(Name="c", SecretString=json.dumps({"other": "x"}))["ARN"]
    assert dsp.read_token(bare, client) == "ghp_bare"
    assert dsp.read_token(js, client) == "ghp_json"
    with pytest.raises(ConfigError):
        dsp.read_token(empty, client)


def test_dispatch_sends_payload_with_token(http, secret_arn, no_sleep) -> None:
    http.post(URL, status=204)
    client = boto3.client("secretsmanager", region_name="us-west-2")

    result = dsp.dispatch(
        event={"results": [KC, GEO]},
        repo=REPO,
        secret_arn=secret_arn,
        secrets_client=client,
        sleep=no_sleep.append,
    )

    request = http.calls[0].request
    assert request.headers["Authorization"] == "Bearer ghp_test_token"
    assert request.headers["Accept"] == "application/vnd.github+json"
    assert json.loads(request.body) == dsp.build_payload([KC, GEO])
    assert result["status"] == "succeeded"
    assert result["http_status"] == 204
    assert result["run_date"] == "2026-11-12"
    assert "ghp_test_token" not in json.dumps(result)


def test_dispatch_retries_server_errors(http, secret_arn, no_sleep) -> None:
    http.post(URL, status=502)
    http.post(URL, status=204)
    client = boto3.client("secretsmanager", region_name="us-west-2")
    dsp.dispatch(
        event=[KC, GEO],
        repo=REPO,
        secret_arn=secret_arn,
        secrets_client=client,
        sleep=no_sleep.append,
    )
    assert len(http.calls) == 2
    assert no_sleep == [2.0]


def test_dispatch_does_not_retry_auth_errors(http, secret_arn, no_sleep) -> None:
    http.post(URL, status=401, json={"message": "Bad credentials"})
    client = boto3.client("secretsmanager", region_name="us-west-2")
    with pytest.raises(ExtractError, match="HTTP 401"):
        dsp.dispatch(
            event=[KC, GEO],
            repo=REPO,
            secret_arn=secret_arn,
            secrets_client=client,
            sleep=no_sleep.append,
        )
    assert len(http.calls) == 1


def test_failed_step_means_no_http_call(http, secret_arn) -> None:
    client = boto3.client("secretsmanager", region_name="us-west-2")
    with pytest.raises(ExtractError):
        dsp.dispatch(
            event=[{**KC, "status": "failed"}, GEO],
            repo=REPO,
            secret_arn=secret_arn,
            secrets_client=client,
        )
    assert len(http.calls) == 0


def test_rejects_bad_repo_name() -> None:
    with pytest.raises(ConfigError):
        dsp.send_dispatch(repo="not a repo", token="t", payload={})
