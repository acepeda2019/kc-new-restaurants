"""Lambda: geocode new KC addresses. Handler string ``handlers.census_geocoder.handler``.

Event: the KC handler's result (Step Functions passes it through), i.e. at least
``{"run_date": ..., "run_id": ..., "s3_keys": [...]}``; it may also be wrapped as
``{"kc_inspections": <result>}``. Without ``s3_keys`` the KC file of ``run_id`` (or the latest one
for ``run_date``) is used. Returns the step result; raises on failure.
"""

from __future__ import annotations

import logging
from typing import Any

from sources import census_geocoder
from sources.common import (
    OK_STATUSES,
    ExtractError,
    configure_logging,
    env,
    log,
    new_run_id,
    resolve_run_date,
    s3_client,
    validate_run_id,
)

logger = logging.getLogger(__name__)


def handler(event: dict[str, Any] | None, context: Any = None) -> dict[str, Any]:
    configure_logging()
    event = event or {}
    kc_result = event.get(census_geocoder.KC_SOURCE, event)
    bucket = env("RAW_BUCKET", required=True)
    run_date = resolve_run_date(kc_result.get("run_date"))
    run_id = validate_run_id(kc_result.get("run_id") or new_run_id())
    try:
        status = kc_result.get("status")
        if status is not None and status not in OK_STATUSES:
            raise ExtractError(f"KC step status is {status!r}; not geocoding")
        s3 = s3_client()
        kc_keys = [
            k for k in kc_result.get("s3_keys", []) if k.startswith("raw/kc_inspections/")
        ] or census_geocoder.find_kc_keys(s3, bucket, run_date, kc_result.get("run_id"))
        return census_geocoder.extract(
            bucket=bucket,
            run_date=run_date,
            run_id=run_id,
            kc_keys=kc_keys,
            s3=s3,
        )
    except Exception as exc:
        log(
            logger,
            "extract_failed",
            logging.ERROR,
            source=census_geocoder.SOURCE,
            run_date=run_date,
            run_id=run_id,
            error=f"{type(exc).__name__}: {exc}",
        )
        raise
