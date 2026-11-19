from __future__ import annotations

import csv
import io
import json
from typing import Any

import pytest
import responses

from sources import census_geocoder as geo
from sources.common import STATUS_SUCCEEDED, ExtractError
from sources.geocode_key import KEY_RULE_VERSION, key_from_parts, normalize_street
from tests.conftest import (
    BUCKET,
    all_keys,
    fixture_bytes,
    fixture_jsonl,
    gz_jsonl,
    object_body,
    seed,
)

RUN_DATE = "2026-11-12"
RUN_ID = "20261112T150000Z-aaaaaaaa"
KC_KEY = f"raw/kc_inspections/dt={RUN_DATE}/{RUN_ID}.jsonl.gz"
KC_ROWS = fixture_jsonl("kc_rows_tricky.jsonl")
REQUEST = fixture_bytes("geocoder_request.csv")
RESPONSE = fixture_bytes("geocoder_response.csv")
RESPONSE_LINES = {line.split(",", 1)[0].strip('"'): line for line in RESPONSE.decode().splitlines()}

TIE_KEYS = {"5358daac897325234bf62fe64a8a3154", "f223c481f1d35eca767a92cf36e9609c"}
NO_MATCH_KEY = "0aa4330a7e6f24482df24a0f816ed1d0"


def request_ids(body: bytes) -> list[str]:
    return [row[0] for row in csv.reader(io.StringIO(body.decode()))]


def multipart_file(request: Any) -> bytes:
    """The addressFile bytes from a multipart body built by requests."""
    body = request.body if isinstance(request.body, bytes) else request.body.encode()
    start = body.index(b"\r\n\r\n", body.index(b'name="addressFile"')) + 4
    return body[start : body.index(b"\r\n--", start)]


def recorded_geocoder(http: responses.RequestsMock, *, reverse: bool = False) -> None:
    """Answer each batch with the recorded response lines for exactly the ids sent."""

    def callback(request: Any) -> tuple[int, dict[str, str], bytes]:
        ids = request_ids(multipart_file(request))
        lines = [RESPONSE_LINES[i] for i in ids]
        if reverse:
            lines.reverse()
        return 200, {"Content-Type": "text/csv"}, ("\n".join(lines) + "\n").encode()

    http.add_callback(responses.POST, geo.BATCH_URL, callback=callback)


def put_kc(s3: Any, rows: list[dict[str, Any]] | None = None, key: str = KC_KEY) -> None:
    seed(s3, key, gz_jsonl(KC_ROWS if rows is None else rows))


def run(s3: Any, sleeps: list[float], **kw: Any) -> dict[str, Any]:
    kw.setdefault("run_date", RUN_DATE)
    kw.setdefault("run_id", RUN_ID)
    kw.setdefault("kc_keys", [KC_KEY])
    return geo.extract(bucket=BUCKET, s3=s3, sleep=sleeps.append, **kw)


# --------------------------------------------------------------------------- parsing


def test_parse_recorded_response_quirks() -> None:
    rows = geo.parse_response_csv(RESPONSE)
    by_key = {r.key: r for r in rows}

    assert len(rows) == 8
    # unordered: the response order is not the request order
    assert [r.key for r in rows] != request_ids(REQUEST)
    assert set(by_key) == set(request_ids(REQUEST))
    # 8 fields on Match, 3 on No_Match / Tie
    assert {r.field_count for r in rows if r.match == "Match"} == {8}
    assert {r.field_count for r in rows if r.match != "Match"} == {3}
    assert {k for k, r in by_key.items() if r.match == "Tie"} == TIE_KEYS
    assert by_key[NO_MATCH_KEY].match == "No_Match"
    assert by_key[NO_MATCH_KEY].longitude is None
    assert by_key[NO_MATCH_KEY].match_type is None
    # "lon,lat": x (longitude) first
    ambaum = by_key["654f144d5719c908cbba8c201e3f4ef6"]
    assert ambaum.longitude == pytest.approx(-122.347308573095)
    assert ambaum.latitude == pytest.approx(47.473947614888)
    assert ambaum.tiger_line_id == "186623879"
    assert ambaum.side == "L"
    pike = by_key["0bbc984554e3bee72b9a684ec93b740a"]
    assert pike.match_type == "Non_Exact"
    assert pike.matched_address == "1500 PIKE PL, SEATTLE, WA, 98101"


def test_parse_ignores_commas_in_echoed_address() -> None:
    rows = geo.parse_response_csv(fixture_bytes("geocoder_response_profiling_cut.csv"))
    by_key = {r.key: r for r in rows}
    assert len(rows) == 7
    assert (
        by_key["f3b531490ed0f658"].matched_address == "33100 PACIFIC HWY S, FEDERAL WAY, WA, 98003"
    )
    assert by_key["f3b531490ed0f658"].longitude == pytest.approx(-122.313221975389)
    assert by_key["939f46cf072dd078"].match == "No_Match"
    assert by_key["6b5f41c6636ddd52"].match == "Tie"


def test_parse_rejects_truncated_rows_and_skips_blank_lines() -> None:
    assert geo.parse_response_csv(b"\n\n") == []
    with pytest.raises(ExtractError):
        geo.parse_response_csv(b'"abc","x"\n')


def test_validate_response_accepts_any_order_but_not_missing_ids() -> None:
    rows = geo.parse_response_csv(RESPONSE)
    geo.validate_response(reversed(request_ids(REQUEST)), rows)
    with pytest.raises(ExtractError, match="1 ids missing"):
        geo.validate_response(request_ids(REQUEST), rows[1:])
    with pytest.raises(ExtractError):
        geo.validate_response(request_ids(REQUEST), [*rows, rows[0]])


# --------------------------------------------------------------------------- inputs


def test_build_inputs_from_real_rows() -> None:
    inputs, stats = geo.build_inputs(KC_ROWS)

    assert stats.kc_rows == 33
    assert stats.mobile_rows_excluded == 8
    assert stats.empty_street_rows_skipped == 1  # address ", 1"
    assert stats.distinct_keys == 8
    streets = {i.street for i in inputs}
    assert "9614 14TH AVE SW" not in streets  # mobile-only address
    assert "17620 140TH AVE SE" in streets  # mobile at C-7, but a non-mobile unit at C-8
    assert [i.key for i in inputs] == sorted(i.key for i in inputs)
    kent = next(i for i in inputs if i.street == "19918 68TH AVE S")
    assert (kent.city, kent.zip5) == ("KENT", "98032")  # 'Kent'/'KENT', 98032-2155 merged


def test_city_sent_is_the_most_common_spelling() -> None:
    # Synthetic rows (shape of KC rows) to exercise the tie-break.
    rows = [
        {"address": "1 MAIN ST", "zip_code": "98004", "city": c, "classification": "Bakery"}
        for c in ["BELLEUE", "Bellevue", "BELLEVUE", "AAA", "ZZZ"]
    ]
    inputs, _ = geo.build_inputs(rows)
    assert [i.city for i in inputs] == ["BELLEVUE"]
    inputs, _ = geo.build_inputs(rows[3:])
    assert [i.city for i in inputs] == ["AAA"]  # tie: alphabetical


def test_request_csv_matches_the_file_that_was_sent() -> None:
    inputs, _ = geo.build_inputs(KC_ROWS)
    assert geo.build_request_csv(inputs) == REQUEST


def test_request_csv_quotes_street_and_city() -> None:
    item = geo.GeocodeInput(key="k", street='1 "A" ST', city="", zip5="")
    assert geo.build_request_csv([item]) == b'k,"1 ""A"" ST","",WA,\n'


# --------------------------------------------------------------------------- skip / retry


def status(match: str, day: str) -> geo.PriorStatus:
    return geo.PriorStatus(match=match, requested_at=f"{day}T10:00:00Z", response_key="x")


def test_select_pending_skip_and_retry_rules() -> None:
    items = [geo.GeocodeInput(key=k, street=k, city="", zip5="") for k in "abcdef"]
    prior = {
        "a": status("Match", "2025-01-01"),  # matched long ago: never re-sent
        "b": status("No_Match", "2026-08-15"),  # 89 days before run date: skip
        "c": status("No_Match", "2026-08-14"),  # 90 days: retry
        "d": status("Tie", "2026-01-01"),  # old tie: retry
        "e": status("Tie", "2026-11-01"),  # recent tie: skip
    }
    sel = geo.select_pending(items, prior, run_date=RUN_DATE)

    assert [i.key for i in sel.pending] == ["c", "d", "f"]
    assert (sel.new, sel.retry_unmatched) == (1, 2)
    assert (sel.skipped_matched, sel.skipped_recent_unmatched) == (1, 2)


def test_load_prior_status_latest_request_wins(s3) -> None:
    key = "0aa4330a7e6f24482df24a0f816ed1d0"
    old = "raw/census_geocoder/dt=2026-01-02/r1/response_0001.csv"
    new = "raw/census_geocoder/dt=2026-05-01/r2/response_0001.csv"
    seed(s3, old, f'"{key}","90 YESLER WAY","No_Match"\n'.encode())
    match_line = RESPONSE_LINES["c1141ced6aa3226fa962aad160e83d7e"].replace(
        "c1141ced6aa3226fa962aad160e83d7e", key
    )
    seed(s3, new, (match_line + "\n").encode())
    record = {"response_key": new, "requested_at": "2026-05-01T18:30:00Z"}
    seed(s3, "raw/census_geocoder/dt=2026-05-01/r2/chunk_0001.json", json.dumps(record).encode())

    prior = geo.load_prior_status(s3, BUCKET)

    assert prior[key].match == "Match"
    assert prior[key].requested_at == "2026-05-01T18:30:00Z"  # from the chunk record
    assert prior[key].response_key == new


def test_load_prior_status_falls_back_to_partition_date(s3) -> None:
    key = "raw/census_geocoder/dt=2026-03-04/r1/response_0001.csv"
    seed(s3, key, b'"k1","x","Tie"\n')
    seed(s3, key.replace("response", "request"), b'k1,"x","",WA,\n')
    prior = geo.load_prior_status(s3, BUCKET)
    assert prior == {"k1": geo.PriorStatus("Tie", "2026-03-04T00:00:00Z", key)}


# --------------------------------------------------------------------------- end to end


def raw_puts(s3: Any) -> list[dict[str, Any]]:
    return [p for p in s3.test_puts if p["Key"].startswith("raw/census_geocoder/")]


def test_first_run_lands_request_response_record_and_manifest(s3, http, no_sleep) -> None:
    put_kc(s3)
    recorded_geocoder(http)

    result = run(s3, no_sleep)

    prefix = f"raw/census_geocoder/dt={RUN_DATE}/{RUN_ID}/"
    assert result["status"] == STATUS_SUCCEEDED
    assert result["rows"] == 8
    assert result["match_counts"] == {"Match": 5, "No_Match": 1, "Tie": 2}
    assert result["s3_keys"] == [
        f"{prefix}request_0001.csv",
        f"{prefix}response_0001.csv",
        f"{prefix}chunk_0001.json",
        f"{prefix}manifest_0001.json",
    ]
    assert object_body(s3, f"{prefix}request_0001.csv") == REQUEST
    # response landed byte-for-byte as received
    assert object_body(s3, f"{prefix}response_0001.csv") == http.calls[0].response.content
    assert len(http.calls) == 1
    posted = http.calls[0].request
    assert b'name="benchmark"\r\n\r\nPublic_AR_Current' in posted.body

    record = json.loads(object_body(s3, f"{prefix}chunk_0001.json"))
    assert record["rows_sent"] == record["rows_received"] == 8
    assert record["requested_at"].endswith("Z")
    assert record["response_already_landed"] is False
    manifest = json.loads(object_body(s3, f"{prefix}manifest_0001.json"))
    assert manifest["benchmark"] == "Public_AR_Current"
    assert manifest["key_rule_version"] == KEY_RULE_VERSION
    assert manifest["status"] == STATUS_SUCCEEDED
    assert manifest["attempt"] == 1
    assert manifest["kc_input_keys"] == [KC_KEY]
    assert manifest["chunks"] == [record]


def test_every_raw_write_is_create_only_and_written_once(s3, http, no_sleep) -> None:
    put_kc(s3)
    recorded_geocoder(http)
    run(s3, no_sleep, chunk_size=3)

    puts = raw_puts(s3)
    assert puts and all(p["IfNoneMatch"] == "*" for p in puts)
    keys = [p["Key"] for p in puts]
    assert len(keys) == len(set(keys))  # no key is written twice


def test_rerun_same_date_sends_nothing(s3, http, no_sleep) -> None:
    put_kc(s3)
    recorded_geocoder(http)
    run(s3, no_sleep)

    again = run(s3, no_sleep, run_id="20261112T170000Z-bbbbbbbb")

    assert len(http.calls) == 1
    assert again["rows"] == 0
    assert again["counts"]["skipped_matched"] == 5
    assert again["counts"]["skipped_recent_unmatched"] == 3
    assert again["s3_keys"] == [
        f"raw/census_geocoder/dt={RUN_DATE}/20261112T170000Z-bbbbbbbb/manifest_0001.json"
    ]


def test_rerun_same_run_id_adds_a_manifest_and_overwrites_nothing(s3, http, no_sleep) -> None:
    put_kc(s3)
    recorded_geocoder(http)
    first = run(s3, no_sleep)
    again = run(s3, no_sleep)

    prefix = f"raw/census_geocoder/dt={RUN_DATE}/{RUN_ID}/"
    assert again["s3_keys"] == [f"{prefix}manifest_0002.json"]
    assert set(first["s3_keys"]) < set(all_keys(s3, prefix))
    keys = [p["Key"] for p in raw_puts(s3)]
    assert len(keys) == len(set(keys))


def test_unmatched_are_retried_after_90_days(s3, http, no_sleep, monkeypatch) -> None:
    put_kc(s3)
    recorded_geocoder(http)
    # requested_at is wall-clock time; pin it to the run date so "90 days later" is fixed.
    monkeypatch.setattr(geo, "utc_now_iso", lambda: f"{RUN_DATE}T17:00:00Z")
    run(s3, no_sleep)
    monkeypatch.undo()

    later = run(s3, no_sleep, run_date="2027-02-10", run_id="20270210T150000Z-cccccccc")

    assert later["counts"]["retry_unmatched"] == 3
    sent = request_ids(multipart_file(http.calls[1].request))
    assert set(sent) == {*TIE_KEYS, NO_MATCH_KEY}


def test_chunks_are_sent_one_at_a_time_and_join_on_id(s3, http, no_sleep) -> None:
    put_kc(s3)
    recorded_geocoder(http, reverse=True)

    result = run(s3, no_sleep, chunk_size=3, chunk_pause_s=5.0)

    assert result["chunks"] == 3
    assert [len(request_ids(multipart_file(c.request))) for c in http.calls] == [3, 3, 2]
    assert no_sleep == [5.0, 5.0]
    sent = [k for c in http.calls for k in request_ids(multipart_file(c.request))]
    assert sent == request_ids(REQUEST)


def test_invalid_response_is_retried_then_fails(s3, http, no_sleep) -> None:
    put_kc(s3)
    short = b"\n".join(RESPONSE.splitlines()[1:]) + b"\n"
    for _ in range(geo.VALIDATION_ATTEMPTS):
        http.post(geo.BATCH_URL, body=short)

    with pytest.raises(ExtractError, match="invalid after 3 attempts"):
        run(s3, no_sleep)

    prefix = f"raw/census_geocoder/dt={RUN_DATE}/{RUN_ID}/"
    assert all_keys(s3, prefix) == [f"{prefix}manifest_0001.json", f"{prefix}request_0001.csv"]
    manifest = json.loads(object_body(s3, f"{prefix}manifest_0001.json"))
    assert manifest["status"] == "failed"
    assert manifest["written_keys"] == [f"{prefix}request_0001.csv"]


def test_resume_after_partial_run_without_overwrites(s3, http, no_sleep) -> None:
    put_kc(s3)
    # chunk 1 (3 rows) OK, chunk 2 fails with HTTP 500 on every attempt
    calls = {"n": 0}

    def flaky(request: Any) -> tuple[int, dict[str, str], bytes]:
        calls["n"] += 1
        if calls["n"] == 1:
            ids = request_ids(multipart_file(request))
            return 200, {}, ("\n".join(RESPONSE_LINES[i] for i in ids) + "\n").encode()
        return 500, {}, b"busy"

    http.add_callback(responses.POST, geo.BATCH_URL, callback=flaky)
    with pytest.raises(ExtractError):
        run(s3, no_sleep, chunk_size=3)
    prefix = f"raw/census_geocoder/dt={RUN_DATE}/{RUN_ID}/"
    before = {k: object_body(s3, k) for k in all_keys(s3, prefix)}
    assert sorted(before) == [
        f"{prefix}chunk_0001.json",
        f"{prefix}manifest_0001.json",
        f"{prefix}request_0001.csv",
        f"{prefix}request_0002.csv",
        f"{prefix}response_0001.csv",
    ]

    http.remove(responses.POST, geo.BATCH_URL)
    recorded_geocoder(http)
    result = run(s3, no_sleep, chunk_size=3)

    assert result["counts"]["new"] == 5  # the 3 rows of chunk 1 are not re-sent
    assert result["s3_keys"][0] == f"{prefix}request_0003.csv"
    assert result["s3_keys"][-1] == f"{prefix}manifest_0002.json"
    assert {k: object_body(s3, k) for k in before} == before  # nothing overwritten
    failed = json.loads(object_body(s3, f"{prefix}manifest_0001.json"))
    resumed = json.loads(object_body(s3, f"{prefix}manifest_0002.json"))
    assert failed["status"] == "failed"
    assert [c["chunk"] for c in failed["chunks"]] == [1]
    assert resumed["status"] == STATUS_SUCCEEDED
    assert [c["chunk"] for c in resumed["chunks"]] == [3, 4]
    keys = [p["Key"] for p in raw_puts(s3)]
    assert len(keys) == len(set(keys))


def test_412_on_request_name_moves_to_next_number(s3) -> None:
    prefix = f"raw/census_geocoder/dt={RUN_DATE}/{RUN_ID}/"
    seed(s3, f"{prefix}request_0001.csv", b"other attempt")
    chunk_no, key = geo._claim_request(s3, BUCKET, prefix, 1, b"mine")
    assert (chunk_no, key) == (2, f"{prefix}request_0002.csv")
    assert object_body(s3, f"{prefix}request_0001.csv") == b"other attempt"


def test_412_on_response_is_treated_as_already_landed(s3, http, no_sleep, monkeypatch) -> None:
    """A concurrent attempt landed response_0001 between our listing and our write."""
    put_kc(s3)
    recorded_geocoder(http)
    prefix = f"raw/census_geocoder/dt={RUN_DATE}/{RUN_ID}/"
    other = b""  # the other attempt's object; empty so it does not mark keys as geocoded
    seed(s3, f"{prefix}response_0001.csv", other)
    monkeypatch.setattr(geo, "_used_numbers", lambda *_a: (0, 0))  # listing missed it

    result = run(s3, no_sleep)

    assert result["status"] == STATUS_SUCCEEDED
    assert object_body(s3, f"{prefix}response_0001.csv") == other  # untouched
    record = json.loads(object_body(s3, f"{prefix}chunk_0001.json"))
    assert record["response_already_landed"] is True


def test_find_kc_keys_prefers_run_id_then_latest(s3) -> None:
    other = f"raw/kc_inspections/dt={RUN_DATE}/20261112T180000Z-zzzzzzzz.jsonl.gz"
    put_kc(s3)
    put_kc(s3, key=other)
    assert geo.find_kc_keys(s3, BUCKET, RUN_DATE, RUN_ID) == [KC_KEY]
    assert geo.find_kc_keys(s3, BUCKET, RUN_DATE) == [other]
    with pytest.raises(ExtractError):
        geo.find_kc_keys(s3, BUCKET, "2026-01-01")


# --------------------------------------------------------------------------- WSLCB addresses


def test_lcb_king_addresses_share_the_kc_key_rule_and_other_counties_are_skipped(
    s3, http, no_sleep
) -> None:
    lcb_key = f"raw/lcb_local_authority/dt={RUN_DATE}/{RUN_ID}.jsonl.gz"
    seed(
        s3,
        lcb_key,
        gz_jsonl(
            [
                {
                    "streetaddress": "18230 E VALLEY HWY STE 136",
                    "city": "KENT",
                    "zipcode": "980321294",
                    "countyname": "KING",
                },
                {
                    "streetaddress": "32420 RAINIER AVE NE STE 100",
                    "city": "PORT GAMBLE",
                    "zipcode": "983641204",
                    "countyname": "KITSAP",
                },
            ]
        ),
    )
    expected = key_from_parts(normalize_street("18230 E VALLEY HWY STE 136"), "98032")

    def callback(request: Any) -> tuple[int, dict[str, str], bytes]:
        ids = request_ids(multipart_file(request))
        addr = "18230 E VALLEY HWY, KENT, WA, 98032"
        line = f'"{ids[0]}","{addr}","Match","Exact","{addr}","-122.2,47.4","1","L"'
        return 200, {"Content-Type": "text/csv"}, (line + "\n").encode()

    http.add_callback(responses.POST, geo.BATCH_URL, callback=callback)
    result = geo.extract(
        bucket=BUCKET,
        run_date=RUN_DATE,
        run_id=RUN_ID,
        kc_keys=[],
        lcb_keys=[lcb_key],
        s3=s3,
        sleep=no_sleep.append,
    )

    sent = request_ids(multipart_file(http.calls[0].request))
    assert sent == [expected]  # Kitsap skipped; STE 136 and ZIP+4 normalised like KC
    assert result["match_counts"] == {"Match": 1}
    manifest = json.loads(object_body(s3, result["s3_keys"][-1]))
    assert manifest["lcb_input_keys"] == [lcb_key] and manifest["kc_input_keys"] == []


def test_geocoder_needs_some_input(s3) -> None:
    with pytest.raises(ExtractError, match="no raw keys"):
        geo.extract(bucket=BUCKET, run_date=RUN_DATE, run_id=RUN_ID, kc_keys=[], s3=s3)
