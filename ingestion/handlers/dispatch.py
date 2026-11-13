"""Lambda: send the GitHub ``repository_dispatch``. Handler string ``handlers.dispatch.handler``.

Event: the extract step results, as a list ``[kc_result, geocoder_result]``, as
``{"results": [...]}``, or as ``{"kc_inspections": {...}, "census_geocoder": {...}}``.
Raises (no dispatch) unless every required step succeeded.
"""

from __future__ import annotations

import logging
from typing import Any

from sources import dispatch
from sources.common import configure_logging, env, log

logger = logging.getLogger(__name__)


def handler(event: Any, context: Any = None) -> dict[str, Any]:
    configure_logging()
    repo = env("GITHUB_REPO", required=True)
    secret_arn = env("GITHUB_TOKEN_SECRET_ARN", required=True)
    try:
        import boto3

        return dispatch.dispatch(
            event=event,
            repo=repo,
            secret_arn=secret_arn,
            secrets_client=boto3.client("secretsmanager"),
        )
    except Exception as exc:
        log(
            logger,
            "dispatch_failed",
            logging.ERROR,
            source="dispatch",
            repo=repo,
            error=f"{type(exc).__name__}: {exc}",
        )
        raise
