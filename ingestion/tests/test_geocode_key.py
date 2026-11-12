"""The canonical geocode cache key. dbt must reproduce these exact results."""

from __future__ import annotations

import hashlib

import pytest

from sources.geocode_key import (
    geocode_key,
    key_from_parts,
    normalize_city,
    normalize_street,
    normalize_zip5,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # Source-card examples (KC and geocoder cards).
        ("10439 16TH AVE SW, C", "10439 16TH AVE SW"),
        ("17620 140TH AVE SE, C-7", "17620 140TH AVE SE"),
        ("33100 PACIFIC HWY S, #5", "33100 PACIFIC HWY S"),
        ("2808 CALDER AVE NE, 12234", "2808 CALDER AVE NE"),
        ("575 BELLEVUE SQ, 2040", "575 BELLEVUE SQ"),
        ("400 BROAD ST STE 100", "400 BROAD ST"),
        ("SEA-TAC AIRPORT, ConD", "SEA-TAC AIRPORT"),
        ("SUMMIT STEVENS PASS US HWY 2", "SUMMIT STEVENS PASS US HWY 2"),
        ("1416 NW Ballard Way", "1416 NW BALLARD WAY"),
        # Real KC addresses with an inline unit (no comma).
        ("1500 PIKE PL MARKET #1", "1500 PIKE PL MARKET"),
        ("14400 AMBAUM BLVD SW STE B&C", "14400 AMBAUM BLVD SW"),
        ("1512 11TH AVE SUITE A", "1512 11TH AVE"),
        ("200 SUE BIRD COURT N UNIT 1", "200 SUE BIRD COURT N"),
        ("25636 PACIFIC HWY SUITE C13", "25636 PACIFIC HWY"),
        ("575 BELLEVUE SQUARE SQ, #175", "575 BELLEVUE SQUARE SQ"),
        # Every designator form.
        ("100 MAIN ST # 120", "100 MAIN ST"),
        ("100 MAIN ST STE. 5", "100 MAIN ST"),
        ("100 MAIN ST STE.5", "100 MAIN ST"),
        ("100 MAIN ST SPACE 12", "100 MAIN ST"),
        ("100 MAIN ST BLDG C", "100 MAIN ST"),
        ("100 main st suite b", "100 MAIN ST"),
        # Only one trailing designator is removed.
        ("100 MAIN ST BLDG C STE 5", "100 MAIN ST BLDG C"),
        # Words that start like a designator are kept.
        ("100 STEWART", "100 STEWART"),
        ("2200 UNITED BLVD", "2200 UNITED BLVD"),
        ("100 SPACEPORT", "100 SPACEPORT"),
        # Designator without a value is kept.
        ("100 MAIN STE", "100 MAIN STE"),
        # Known limitation, pinned so dbt reproduces it: a street literally named like a
        # designator loses its last word. No such KC address existed on 2026-11-12.
        ("100 UNIT RD", "100"),
        # Whitespace: collapsed and trimmed; suffixes are not rewritten.
        ("  2725  NE\tSUNSET   BL ", "2725 NE SUNSET BL"),
        ("2725 NE SUNSET BLVD", "2725 NE SUNSET BLVD"),
        # Empty street after the comma rule.
        (", 1", ""),
        ("", ""),
        (None, ""),
    ],
)
def test_normalize_street(raw: str | None, expected: str) -> None:
    assert normalize_street(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("98109-4610", "98109"), (" 98101 ", "98101"), ("98101", "98101"), ("", ""), (None, "")],
)
def test_normalize_zip5(raw: str | None, expected: str) -> None:
    assert normalize_zip5(raw) == expected


def test_normalize_city() -> None:
    assert normalize_city(" Seattle ") == "SEATTLE"
    assert normalize_city("Seattle  tacoma") == "SEATTLE TACOMA"
    assert normalize_city(None) == ""


def test_key_is_full_md5_of_street_pipe_zip() -> None:
    expected = hashlib.md5(b"2746 NE 45TH ST|98105").hexdigest()  # noqa: S324
    assert key_from_parts("2746 NE 45TH ST", "98105") == expected
    # Pinned value: the id this key was sent under in the recorded geocoder request.
    assert expected == "c1141ced6aa3226fa962aad160e83d7e"
    assert len(expected) == 32


def test_unit_case_and_zip4_variants_share_one_key() -> None:
    base = geocode_key("17620 140TH AVE SE", "98058")
    assert geocode_key("17620 140TH AVE SE, C-7", "98058") == base
    assert geocode_key("17620 140th Ave SE, C-8", "98058") == base
    assert geocode_key("19918 68TH AVE S", "98032-2155") == geocode_key("19918 68TH AVE S", "98032")


def test_different_zip_gives_different_key() -> None:
    assert geocode_key("400 BROAD ST", "98109") != geocode_key("400 BROAD ST", "98101")


def test_blank_zip_still_has_a_key() -> None:
    assert geocode_key("400 BROAD ST", None) == key_from_parts("400 BROAD ST", "")


def test_empty_street_has_no_key() -> None:
    assert geocode_key(", 1", "98108") is None
    assert geocode_key(None, "98108") is None
