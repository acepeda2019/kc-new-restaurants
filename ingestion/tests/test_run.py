from typing import Any

import pytest

import run
from sources import census_geocoder, kc_inspections

KC_RESULT = {
    "source": "kc_inspections",
    "status": "succeeded",
    "run_date": "2026-11-17",
    "run_id": "20261117T140000Z-abcd1234",
    "rows": 3,
    "s3_keys": ["raw/kc_inspections/dt=2026-11-17/20261117T140000Z-abcd1234.jsonl.gz"],
}


@pytest.fixture(autouse=True)
def bucket_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAW_BUCKET", "test-bucket")
    monkeypatch.delenv("SOCRATA_APP_TOKEN", raising=False)


def test_run_extract_passes_kc_keys_to_geocoder(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, dict[str, Any]] = {}

    def fake_kc(**kwargs: Any) -> dict:
        calls["kc"] = kwargs
        return KC_RESULT

    def fake_geo(**kwargs: Any) -> dict:
        calls["geo"] = kwargs
        return {"source": "census_geocoder", "status": "succeeded", "run_id": kwargs["run_id"]}

    monkeypatch.setattr(kc_inspections, "extract", fake_kc)
    monkeypatch.setattr(census_geocoder, "extract", fake_geo)

    results = run.run_extract("2026-11-17", "20261117T140000Z-abcd1234", False, s3="s3-client")

    assert [r["source"] for r in results] == ["kc_inspections", "census_geocoder"]
    assert calls["kc"]["bucket"] == "test-bucket"
    assert calls["kc"]["force"] is False
    assert calls["geo"]["kc_keys"] == KC_RESULT["s3_keys"]
    assert calls["geo"]["run_id"] == calls["kc"]["run_id"] == "20261117T140000Z-abcd1234"
    assert calls["geo"]["run_date"] == "2026-11-17"
    assert calls["geo"]["s3"] == "s3-client"


def test_cli_exits_1_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(**kwargs: Any) -> dict:
        raise RuntimeError("Socrata is down")

    monkeypatch.setattr(kc_inspections, "extract", boom)
    monkeypatch.setattr(run, "s3_client", lambda: "s3-client")

    with pytest.raises(SystemExit) as exc:
        run.main(["extract", "--run-date", "2026-11-17"])
    assert exc.value.code == 1


def test_cli_prints_one_json_line_per_step(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(kc_inspections, "extract", lambda **kw: KC_RESULT)
    monkeypatch.setattr(
        census_geocoder, "extract", lambda **kw: {"source": "census_geocoder", "rows": 0}
    )
    monkeypatch.setattr(run, "s3_client", lambda: "s3-client")

    run.main(["extract", "--run-date", "2026-11-17", "--run-id", KC_RESULT["run_id"]])

    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 2
    assert '"source": "kc_inspections"' in lines[0]
    assert '"source": "census_geocoder"' in lines[1]
