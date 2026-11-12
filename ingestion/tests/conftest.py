from __future__ import annotations

import gzip
import json
import socket
from pathlib import Path
from typing import Any

import boto3
import pytest
import responses
from moto import mock_aws

FIXTURES = Path(__file__).parent / "fixtures"
BUCKET = "test-raw-bucket"
TRUTH_LAST_MODIFIED = "Thu, 12 Nov 2026 15:15:09 GMT"  # real header value, 2026-11-12


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def fixture_json(name: str) -> Any:
    return json.loads(fixture_bytes(name))


def fixture_jsonl(name: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in fixture_bytes(name).decode().splitlines() if line]


def gz_jsonl(rows: list[dict[str, Any]]) -> bytes:
    body = "".join(json.dumps(r, separators=(",", ":")) + "\n" for r in rows).encode()
    return gzip.compress(body, mtime=0)


@pytest.fixture(autouse=True)
def _aws_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fake credentials so nothing can reach real AWS."""
    for name, value in {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_SESSION_TOKEN": "testing",
        "AWS_DEFAULT_REGION": "us-west-2",
        "AWS_REGION": "us-west-2",
    }.items():
        monkeypatch.setenv(name, value)
    for name in ("AWS_PROFILE", "SOCRATA_APP_TOKEN", "RAW_BUCKET", "GITHUB_REPO"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail any test that opens a real socket connection."""

    def guard(self: socket.socket, address: Any) -> None:
        raise RuntimeError(f"live network access attempted in a test: {address!r}")

    monkeypatch.setattr(socket.socket, "connect", guard)
    monkeypatch.setattr(socket.socket, "connect_ex", guard)


@pytest.fixture
def aws() -> Any:
    with mock_aws():
        yield


@pytest.fixture
def s3(aws: Any) -> Any:
    client = boto3.client("s3", region_name="us-west-2")
    client.create_bucket(
        Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "us-west-2"}
    )
    return client


@pytest.fixture
def http(aws: Any) -> Any:
    """Block all real HTTP; tests register the responses they expect.

    Depends on ``aws`` so that moto's mock (which passes non-AWS URLs through) is started first
    and this mock sits on top of it.
    """
    with responses.RequestsMock(assert_all_requests_are_fired=False) as mock:
        yield mock


@pytest.fixture
def no_sleep() -> list[float]:
    """Collect sleep calls instead of sleeping."""
    calls: list[float] = []
    return calls


def object_body(s3: Any, key: str) -> bytes:
    return s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()


def all_keys(s3: Any, prefix: str = "") -> list[str]:
    out = s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix)
    return sorted(o["Key"] for o in out.get("Contents", []))
