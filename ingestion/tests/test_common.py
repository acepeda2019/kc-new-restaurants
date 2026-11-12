from __future__ import annotations

import datetime as dt
import json
import logging

import pytest

from sources.common import (
    ConfigError,
    JsonFormatter,
    backoff_delay,
    new_run_id,
    raw_partition,
    resolve_run_date,
    validate_run_id,
)


def test_run_date_defaults_to_today_in_los_angeles() -> None:
    # 05:00 UTC on Nov 13 is still Nov 12 in Seattle (PST, UTC-8)
    now = dt.datetime(2026, 11, 13, 5, 0, tzinfo=dt.UTC)
    assert resolve_run_date(None, now=now) == "2026-11-12"
    assert resolve_run_date(None, now=dt.datetime(2026, 11, 13, 9, 0, tzinfo=dt.UTC)) == (
        "2026-11-13"
    )


def test_run_date_override_is_validated() -> None:
    assert resolve_run_date("2026-01-31") == "2026-01-31"
    for bad in ("2026-02-30", "20261112", "2026-11-12T00:00"):
        with pytest.raises((ConfigError, ValueError)):
            resolve_run_date(bad)


def test_run_id_is_sortable_and_safe() -> None:
    a = new_run_id(now=dt.datetime(2026, 11, 12, 15, 0, tzinfo=dt.UTC))
    b = new_run_id(now=dt.datetime(2026, 11, 12, 16, 0, tzinfo=dt.UTC))
    assert a.startswith("20261112T150000Z-")
    assert a < b
    assert validate_run_id(a) == a
    with pytest.raises(ConfigError):
        validate_run_id("a/b")


def test_backoff_is_exponential_and_capped() -> None:
    assert [backoff_delay(n, base=2.0, cap=10.0) for n in (1, 2, 3, 4)] == [2.0, 4.0, 8.0, 10.0]


def test_raw_partition_layout() -> None:
    assert raw_partition("kc_inspections", "2026-11-12") == "raw/kc_inspections/dt=2026-11-12/"


def test_json_log_line_carries_fields() -> None:
    record = logging.LogRecord("x", logging.INFO, __file__, 1, "page_fetched", None, None)
    record.fields = {"source": "kc_inspections", "rows": 3, "bytes": 10}
    line = json.loads(JsonFormatter().format(record))
    assert line["event"] == "page_fetched"
    assert (line["source"], line["rows"], line["bytes"]) == ("kc_inspections", 3, 10)


def test_live_network_is_blocked_in_tests() -> None:
    import requests

    with pytest.raises(Exception, match="live network access attempted"):
        requests.get("https://data.kingcounty.gov/resource/r878-4sxa.json", timeout=5)
