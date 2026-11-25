from __future__ import annotations

from collections import Counter

from evals.score_stored import at_threshold, grade, rate, report


def _label(**kw: str) -> dict[str, str]:
    base = {
        "business_id": "PR1",
        "category": "restaurant",
        "opening_type": "new_opening",
        "replaces_name": "",
        "likely_cuisine": "",
        "labelled_at": "2026-11-25",
        "note": "",
    }
    return {**base, **kw}


def _answer(**kw) -> dict:
    base = {
        "business_id": "PR1",
        "category": "restaurant",
        "opening_type": "new_opening",
        "replaces_name": None,
        "likely_cuisine": None,
        "confidence": 0.85,
    }
    return {**base, **kw}


def test_decision_needs_both_fields_but_shown_only_the_app_outcome():
    g = grade(_label(category="cafe_bakery_dessert"), _answer())
    assert (g["decision"], g["category"], g["opening_type"], g["shown"]) == (
        False,
        False,
        True,
        True,
    )
    g = grade(_label(category="excluded"), _answer())
    assert g["shown"] is False


def test_replaces_name_only_when_both_say_new_concept_ignoring_case():
    g = grade(
        _label(opening_type="new_concept", replaces_name="Sandy's Espresso"),
        _answer(opening_type="new_concept", replaces_name="SANDY'S ESPRESSO"),
    )
    assert g["replaces_name"] is True
    assert (
        grade(_label(), _answer(opening_type="new_concept", replaces_name="X"))["replaces_name"]
        is None
    )


def test_unsure_note_and_band_are_recorded():
    g = grade(_label(note="Unsure: could be a stall"), _answer(confidence=0.65))
    assert g["unsure"] is True and g["band"] == "0.6-0.8"


def test_threshold_scales_each_band_error_to_the_population():
    grades = [{"band": "0.8-0.9", "decision": d} for d in (True, True, True, False)] + [
        {"band": ">=0.9", "decision": True},
        {"band": "0.6-0.8", "decision": False},
    ]
    population = Counter({"0.6-0.8": 100, "0.8-0.9": 40, ">=0.9": 10})
    assert at_threshold(grades, population, 0.8) == (50, 10.0)
    assert at_threshold(grades, population, 0.6) == (150, 110.0)
    assert rate(grades, "decision") == (4, 6)


def test_report_lists_cuisine_disagreements_without_scoring_them():
    labels = [_label(likely_cuisine="Japanese")]
    text = report(labels, {"PR1": _answer(likely_cuisine="Sushi")}, Counter({"0.8-0.9": 1}))
    assert "label Japanese, Claude Sushi" in text
    assert "| cuisine |" not in text and "| decision | 1/1 (100%)" in text
