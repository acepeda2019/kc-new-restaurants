"""Lambda: full pull of KC inspections to S3 raw.

Handler string ``handlers.kc_inspections.handler``.

Event (all optional): ``{"run_date": "YYYY-MM-DD", "run_id": "...", "force": false}``.
Returns the step result (``source, status, run_date, run_id, rows, pages, bytes, s3_keys``).
Raises on failure so Step Functions stops before dispatching dbt.
"""

from __future__ import annotations

import logging
from typing import Any

from sources import kc_inspections
from sources.common import (
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
    bucket = env("RAW_BUCKET", required=True)
    run_date = resolve_run_date(event.get("run_date"))
    run_id = validate_run_id(event.get("run_id") or new_run_id())
    try:
        return kc_inspections.extract(
            bucket=bucket,
            run_date=run_date,
            run_id=run_id,
            s3=s3_client(),
            app_token=env("SOCRATA_APP_TOKEN"),
            force=bool(event.get("force", False)),
        )
    except Exception as exc:
        log(
            logger,
            "extract_failed",
            logging.ERROR,
            source=kc_inspections.SOURCE,
            run_date=run_date,
            run_id=run_id,
            error=f"{type(exc).__name__}: {exc}",
        )
        raise
