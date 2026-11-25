from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

from evals.thinking_compare import ArmClient, run_arm, summary

ANSWER = {
    "category": "restaurant",
    "opening_type": "new_opening",
    "replaces_name": None,
    "likely_cuisine": None,
    "confidence": 0.85,
    "reason": "a restaurant",
}
LABEL = {
    "business_id": "PR1",
    "category": "restaurant",
    "opening_type": "new_opening",
    "replaces_name": "",
    "likely_cuisine": "",
    "labelled_at": "2026-11-25",
    "note": "",
}
ROW = {"business_id": "PR1", "business_name": "Place", "prior_businesses_at_address": "[]"}


class Fake:
    def __init__(self, model: str = "claude-haiku-5-5", stop_reason: str = "end_turn") -> None:
        self.requests: list[dict] = []
        self.model, self.stop_reason = model, stop_reason
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs: Any) -> Any:
        self.requests.append(kwargs)
        return SimpleNamespace(
            model=self.model,
            stop_reason=self.stop_reason,
            content=[SimpleNamespace(type="text", text=json.dumps(ANSWER))],
            usage=SimpleNamespace(input_tokens=1000, output_tokens=100),
        )


def test_default_arm_sends_no_thinking_and_disabled_arm_turns_it_off():
    fake = Fake()
    run_arm("default", [LABEL], {"PR1": ROW}, fake)
    run_arm("disabled", [LABEL], {"PR1": ROW}, fake)
    assert "thinking" not in fake.requests[0]
    assert fake.requests[1]["thinking"] == {"type": "disabled"}
    assert fake.requests[0]["system"] == fake.requests[1]["system"]  # same production prompt


def test_arm_grades_answers_and_prices_usage():
    result = run_arm("default", [LABEL], {"PR1": ROW}, Fake())
    assert result["failed"] == 0 and result["grades"][0]["decision"] is True
    assert result["cost_usd"] == pytest.approx((1000 * 0.10 + 100 * 0.50) / 1_000_000)
    assert "| decision | 1/1 (100%) |" in summary([result])


def test_a_cut_off_answer_counts_as_failed():
    result = run_arm("default", [LABEL], {"PR1": ROW}, Fake(stop_reason="max_tokens"))
    assert result["failed"] == 1 and result["records"][0]["stop_reason"] == "max_tokens"


def test_a_substituted_model_stops_the_run():
    with pytest.raises(RuntimeError, match="aren't comparable"):
        ArmClient(Fake(model="claude-other"), None).create(model="claude-haiku-5-5")
