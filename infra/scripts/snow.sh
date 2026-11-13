#!/usr/bin/env bash
# Thin wrapper around `snow sql` with a temporary key-pair connection built
# from environment variables, so no connection file or secret is written
# to the repo. Extra arguments are passed through (e.g. -f file, -q "...").
#
# Required env: SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PRIVATE_KEY_PATH,
#               SNOWFLAKE_ROLE, SNOWFLAKE_WAREHOUSE, SNOWFLAKE_DATABASE
set -euo pipefail

: "${SNOWFLAKE_ACCOUNT:?}" "${SNOWFLAKE_USER:?}" "${SNOWFLAKE_PRIVATE_KEY_PATH:?}"
: "${SNOWFLAKE_ROLE:?}" "${SNOWFLAKE_WAREHOUSE:?}" "${SNOWFLAKE_DATABASE:?}"

exec snow sql \
  --temporary-connection \
  --account "$SNOWFLAKE_ACCOUNT" \
  --user "$SNOWFLAKE_USER" \
  --authenticator SNOWFLAKE_JWT \
  --private-key-file "$SNOWFLAKE_PRIVATE_KEY_PATH" \
  --role "$SNOWFLAKE_ROLE" \
  --warehouse "$SNOWFLAKE_WAREHOUSE" \
  --database "$SNOWFLAKE_DATABASE" \
  "$@"
