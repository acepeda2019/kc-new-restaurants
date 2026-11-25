from __future__ import annotations

from collections import Counter

from evals.sample_labels import BAND_QUOTAS, CASE_FLOORS, band, pick_sample, sheet


def _rows() -> list[dict]:
    """200 fake answers spread over every band, category and opening type."""
    categories = ["restaurant", "cafe_bakery_dessert", "food_hall_stall", "food_truck", "excluded"]
    types = ["new_opening", "new_opening", "new_concept", "ownership_transfer"]
    confidences = [0.4, 0.55, 0.65, 0.75, 0.82, 0.88, 0.9, 0.95]
    return [
        {
            "business_id": f"PR{i:04d}",
            "business_name": f"Place {i}",
            "category": categories[i % 5],
            "opening_type": types[i % 4],
            "confidence": confidences[i % 8],
        }
        for i in range(200)
    ]


def test_band_edges():
    assert [band(c) for c in (0.59, 0.6, 0.79, 0.8, 0.89, 0.9, 1.0)] == [
        "<0.6",
        "0.6-0.8",
        "0.6-0.8",
        "0.8-0.9",
        "0.8-0.9",
        ">=0.9",
        ">=0.9",
    ]


def test_sample_fills_every_band_quota_without_repeats():
    sample = pick_sample(_rows())
    assert Counter(band(r["confidence"]) for r in sample) == BAND_QUOTAS
    assert len({r["business_id"] for r in sample}) == len(sample) == sum(BAND_QUOTAS.values())


def test_sample_meets_every_hard_case_floor():
    sample = pick_sample(_rows())
    for field, value, minimum in CASE_FLOORS:
        assert sum(r[field] == value for r in sample) >= minimum, value


def test_sample_is_reproducible_and_ignores_input_order():
    rows = _rows()
    first = [r["business_id"] for r in pick_sample(rows)]
    assert first == [r["business_id"] for r in pick_sample(list(reversed(rows)))]
    assert first != [r["business_id"] for r in pick_sample(rows, seed=1)]


def test_sample_takes_what_exists_when_a_band_is_short():
    rows = [r for r in _rows() if r["confidence"] >= 0.6][:30]
    sample = pick_sample(rows)
    assert not any(band(r["confidence"]) == "<0.6" for r in sample)


def test_sheet_hides_claudes_answer():
    row = {**_rows()[0], "confidence": 0.71, "reason": "SECRET-REASON"}
    text = sheet([row], "kcne.duckdb")
    assert "Place 0" in text and "PR0000" in text
    assert "0.71" not in text and "SECRET-REASON" not in text and '"category"' not in text
