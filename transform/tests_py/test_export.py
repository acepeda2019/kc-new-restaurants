import json
from pathlib import Path

import boto3
import duckdb
import pytest
from moto import mock_aws

import export

BUCKET = "test-bucket"


def make_db(path: Path, rows: int) -> str:
    db = str(path / "kcne.duckdb")
    with duckdb.connect(db) as con:
        con.execute(
            "create table mart_new_openings as select i as rank, 'R' || i as restaurant_id, "
            "date '2026-11-10' as first_inspection_date, "
            "[{'date': date '2026-11-10', 'description': 'x', 'points': 5}] as red_violations "
            f"from range(1, {rows + 1}) t(i)"
        )
        con.execute(
            "create table mart_metrics as select current_timestamp as built_at, "
            f'{rows} as opened_last_30_days, json(\'[{{"city": "SEATTLE", "openings": 2}}]\') as by_city'
        )
    return db


@pytest.fixture
def s3():
    with mock_aws():
        client = boto3.client("s3", region_name="us-west-2")
        client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "us-west-2"}
        )
        yield client


def test_blocks_empty() -> None:
    with pytest.raises(export.PublishBlocked):
        export.check_publishable(0, None)


def test_blocks_large_drop() -> None:
    with pytest.raises(export.PublishBlocked):
        export.check_publishable(40, 100)


def test_allows_first_run() -> None:
    export.check_publishable(25, None)


def test_allows_normal() -> None:
    export.check_publishable(95, 100)


def test_writes_three_files(tmp_path: Path) -> None:
    out = tmp_path / "out"
    result = export.export(
        db_path=make_db(tmp_path, 2), out_dir=out, run_date="2026-11-17", run_id="r1"
    )
    openings = json.loads((out / "openings.json").read_text())
    metrics = json.loads((out / "metrics.json").read_text())
    manifest = json.loads((out / "manifest.json").read_text())
    assert [o["rank"] for o in openings] == [1, 2]
    assert openings[0]["first_inspection_date"] == "2026-11-10"
    assert openings[0]["red_violations"][0]["points"] == 5
    assert metrics["by_city"][0]["city"] == "SEATTLE"
    assert manifest["row_count"] == 2 and manifest["schema_version"] == 1
    assert result["s3_keys"] == []


def test_uploads_dated_copy_and_compares_with_previous(tmp_path: Path, s3) -> None:
    db = make_db(tmp_path, 100)
    first = export.export(
        db_path=db, out_dir=tmp_path / "a", run_date="2026-11-16", run_id="r1", s3=s3, bucket=BUCKET
    )
    assert first["previous_count"] is None
    assert "exports/dt=2026-11-16/r1/manifest.json" in first["s3_keys"]

    (tmp_path / "x").mkdir()
    small = make_db(tmp_path / "x", 40)
    out = tmp_path / "b"
    with pytest.raises(export.PublishBlocked):
        export.export(
            db_path=small, out_dir=out, run_date="2026-11-17", run_id="r2", s3=s3, bucket=BUCKET
        )
    assert not out.exists()  # nothing written when blocked
    keys = [o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET)["Contents"]]
    assert not any("dt=2026-11-17" in k for k in keys)
