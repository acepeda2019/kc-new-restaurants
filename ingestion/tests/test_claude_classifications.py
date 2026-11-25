import gzip
import hashlib
import json
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx2
import pytest

from sources import claude_classifications as cc
from tests.conftest import BUCKET

RUN_DATE = "2026-11-17"
RUN_ID = "20261117T200000Z-abcd1234"

# Candidate rows shaped like transform's int_candidates (real businesses from the KC sample).
PANINO = {
    "business_id": "PFE-PR-501467",
    "business_name": "Panino",
    "program_identifier": None,
    "classification": "General Food Services",
    "rule_category": "needs_judgment",
    "address": "2105 N 45TH ST",
    "city_normalized": "SEATTLE",
    "zip5": "98103",
    "first_inspection_date": "2026-07-20",
    "first_inspection_type": "Routine Inspection/Field Review",
    "businesses_at_address": 2,
    "prior_businesses_at_address": '[{"business_id":"PFE-PR-3149957","name":"CANNOLO"}]',
    "pulled_on": "2026-11-17",
}
TRUCK = {
    **PANINO,
    "business_id": "PFE-PR-3151103",
    "business_name": "Crazy Taco",
    "classification": "Mobile Food Unit",
    "rule_category": "food_truck",
    "prior_businesses_at_address": "[]",
}
CURRY = {
    **PANINO,
    "business_id": "PFE-PR-501532",
    "business_name": "CURRY'S CULTURE INDIAN CUISINE",
    "prior_businesses_at_address": "[]",
}

ANSWER = {
    "category": "restaurant",
    "opening_type": "new_concept",
    "replaces_name": "CANNOLO",
    "likely_cuisine": "Italian",
    "confidence": 0.9,
    "reason": "Different name replacing Cannolo at the same address.",
}


def message(payload: dict | None, stop_reason: str = "end_turn") -> SimpleNamespace:
    text = json.dumps(payload) if payload is not None else ""
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        stop_reason=stop_reason,
        usage=SimpleNamespace(input_tokens=900, output_tokens=60),
    )


class FakeClient:
    """Stands in for anthropic.Anthropic: returns queued replies, records every request."""

    def __init__(self, replies: dict[str, Any]) -> None:
        self.replies = replies
        self.requests: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs: Any) -> Any:
        self.requests.append(kwargs)
        user = kwargs["messages"][0]["content"]
        for business_id, reply in self.replies.items():
            if business_id in user:
                if isinstance(reply, Exception):
                    raise reply
                return reply
        return message(ANSWER)


def api_error() -> anthropic.APIStatusError:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    return anthropic.APIStatusError(
        "overloaded", response=httpx2.Response(529, request=request), body=None
    )


def test_only_unseen_inputs_are_sent() -> None:
    client = FakeClient({})
    prior = {PANINO["business_id"]: (cc.input_hash(PANINO), cc.PROMPT_HASH)}
    records, failed = cc.classify_candidates([PANINO], prior, client)
    assert (records, failed) == ([], 0)
    assert client.requests == []


def test_changed_inputs_are_resent() -> None:
    client = FakeClient({})
    old = cc.input_hash({**PANINO, "business_name": "Panino Old"})
    prior = {PANINO["business_id"]: (old, cc.PROMPT_HASH)}
    records, failed = cc.classify_candidates([PANINO], prior, client)
    assert failed == 0
    assert [r["business_id"] for r in records] == [PANINO["business_id"]]
    assert len(client.requests) == 1


@pytest.mark.parametrize("prompt_hash", ["0123456789abcdef", None], ids=["changed", "pre-SAN-70"])
def test_a_prompt_change_resends_unchanged_inputs(prompt_hash: str | None) -> None:
    client = FakeClient({})
    prior = {PANINO["business_id"]: (cc.input_hash(PANINO), prompt_hash)}
    records, failed = cc.classify_candidates([PANINO], prior, client)
    assert failed == 0
    assert [r["prompt_hash"] for r in records] == [cc.PROMPT_HASH]


def test_prompt_hash_changes_with_the_prompt_schema_model_or_effort() -> None:
    base = (cc.MODEL, cc.EFFORT, cc.SYSTEM_PROMPT, cc.OUTPUT_SCHEMA)
    assert cc.prompt_hash(*base) == cc.PROMPT_HASH
    variants = [
        ("claude-haiku-9-9", *base[1:]),
        (base[0], "high", *base[2:]),
        (*base[:2], cc.SYSTEM_PROMPT + " ", base[3]),
        (*base[:3], {**cc.OUTPUT_SCHEMA, "required": []}),
    ]
    assert len({cc.prompt_hash(*v) for v in variants} | {cc.PROMPT_HASH}) == 5


def test_hash_ignores_the_pull_date() -> None:
    assert cc.input_hash(PANINO) == cc.input_hash({**PANINO, "pulled_on": "2026-11-18"})


def _with_priors(*priors: dict) -> dict:
    return {**PANINO, "prior_businesses_at_address": json.dumps(list(priors))}


A = {"business_id": "PFE-1", "name": "CANNOLO", "latest_inspection_date": "2026-07-01"}
B = {"business_id": "PFE-2", "name": "OLD DELI", "latest_inspection_date": "2026-07-01"}


def test_hash_ignores_the_order_of_prior_businesses() -> None:
    # Ties on latest_inspection_date have no fixed order upstream.
    assert cc.input_hash(_with_priors(A, B)) == cc.input_hash(_with_priors(B, A))


def test_hash_ignores_a_prior_business_being_reinspected() -> None:
    assert cc.input_hash(_with_priors(A)) == cc.input_hash(
        _with_priors({**A, "latest_inspection_date": "2026-11-18"})
    )


def test_hash_changes_when_a_prior_business_appears_or_changes() -> None:
    assert cc.input_hash(_with_priors(A)) != cc.input_hash(_with_priors(A, B))
    assert cc.input_hash(_with_priors(A)) != cc.input_hash(_with_priors({**A, "name": "CANNOLO 2"}))


def test_hash_unchanged_for_a_candidate_without_priors() -> None:
    # Keeps existing fingerprints valid for places with no prior businesses (no re-check).
    no_priors = {**PANINO, "prior_businesses_at_address": "[]"}
    legacy = json.dumps(cc.candidate_input(no_priors), sort_keys=True, default=str)
    assert cc.input_hash(no_priors) == hashlib.sha256(legacy.encode()).hexdigest()


def test_record_fields_and_enums() -> None:
    client = FakeClient({TRUCK["business_id"]: message({**ANSWER, "category": "food_truck"})})
    records, failed = cc.classify_candidates([PANINO, TRUCK], {}, client)
    assert failed == 0
    for r in records:
        assert set(r) == {
            "business_id",
            "input_hash",
            "prompt_hash",
            "model",
            "classified_at",
            "category",
            "opening_type",
            "replaces_name",
            "likely_cuisine",
            "confidence",
            "reason",
        }
        assert r["category"] in cc.CATEGORIES
        assert r["opening_type"] in cc.OPENING_TYPES
        assert 0 <= r["confidence"] <= 1
        assert len(r["reason"]) <= 120
        assert r["model"] == "claude-haiku-5-5"
    request = client.requests[0]
    assert request["model"] == "claude-haiku-5-5"
    assert request["output_config"]["format"]["type"] == "json_schema"
    assert "temperature" not in request


def test_candidate_is_sent_as_delimited_data() -> None:
    client = FakeClient({})
    cc.classify_candidates([PANINO], {}, client)
    user = client.requests[0]["messages"][0]["content"]
    assert "<candidate>" in user and "</candidate>" in user
    assert "CANNOLO" in user


def test_failures_are_counted_not_raised() -> None:
    client = FakeClient(
        {
            TRUCK["business_id"]: api_error(),
            CURRY["business_id"]: message(None, stop_reason="refusal"),
        }
    )
    records, failed = cc.classify_candidates([PANINO, TRUCK, CURRY], {}, client)
    assert failed == 2
    assert [r["business_id"] for r in records] == [PANINO["business_id"]]


def test_out_of_range_confidence_is_a_failure() -> None:
    client = FakeClient({PANINO["business_id"]: message({**ANSWER, "confidence": 1.7})})
    records, failed = cc.classify_candidates([PANINO], {}, client)
    assert (records, failed) == ([], 1)


def test_lands_one_write_once_file(s3) -> None:
    client = FakeClient({})
    result = cc.extract(
        bucket=BUCKET,
        run_date=RUN_DATE,
        run_id=RUN_ID,
        candidates=[PANINO, CURRY],
        s3=s3,
        client=client,
    )
    key = f"raw/claude_classifications/dt={RUN_DATE}/{RUN_ID}.jsonl.gz"
    assert result["s3_keys"] == [key]
    assert result["rows"] == 2 and result["failed"] == 0
    assert s3.test_puts[-1]["IfNoneMatch"] == "*"
    body = gzip.decompress(s3.get_object(Bucket=BUCKET, Key=key)["Body"].read())
    assert [json.loads(line)["business_id"] for line in body.splitlines()] == [
        PANINO["business_id"],
        CURRY["business_id"],
    ]

    # A second run on the same inputs reads the prior file and sends nothing.
    client2 = FakeClient({})
    again = cc.extract(
        bucket=BUCKET,
        run_date=RUN_DATE,
        run_id="20261117T210000Z-abcd1234",
        candidates=[PANINO, CURRY],
        s3=s3,
        client=client2,
    )
    assert client2.requests == []
    assert again["status"] == "nothing_new" and again["s3_keys"] == []


def test_records_landed_before_prompt_hash_are_resent(s3) -> None:
    old = {"business_id": PANINO["business_id"], "input_hash": cc.input_hash(PANINO)}
    body = json.dumps({**old, "classified_at": "2026-11-19T20:00:00+00:00"}).encode()
    key = f"raw/claude_classifications/dt=2026-11-19/{RUN_ID}.jsonl.gz"
    s3.put_object(Bucket=BUCKET, Key=key, Body=gzip.compress(body), IfNoneMatch="*")
    assert cc.load_prior(s3, BUCKET) == {PANINO["business_id"]: (old["input_hash"], None)}
    client = FakeClient({})
    cc.extract(
        bucket=BUCKET, run_date=RUN_DATE, run_id=RUN_ID, candidates=[PANINO], s3=s3, client=client
    )
    assert len(client.requests) == 1


@pytest.fixture
def no_candidates() -> list[dict]:
    return []


def test_no_candidates_writes_nothing(s3, no_candidates: list[dict]) -> None:
    result = cc.extract(
        bucket=BUCKET,
        run_date=RUN_DATE,
        run_id=RUN_ID,
        candidates=no_candidates,
        s3=s3,
        client=FakeClient({}),
    )
    assert result["status"] == "nothing_new"
    assert "Contents" not in s3.list_objects_v2(Bucket=BUCKET, Prefix="raw/claude_classifications/")
