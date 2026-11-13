#!/usr/bin/env bash
# Build the single Lambda deployment zip: ingestion/dist/lambda.zip
#
# Contents: handlers/ + sources/ + runtime dependencies from uv.lock (no dev deps), vendored for
# Python 3.12 on Amazon Linux (manylinux). Handler strings:
#   handlers.kc_inspections.handler, handlers.census_geocoder.handler, handlers.dispatch.handler
#
# Usage: ingestion/build.sh            (x86_64, the default)
#        LAMBDA_ARCH=aarch64 ingestion/build.sh
# File mtimes are normalised so identical inputs give an identical zip (stable source_code_hash).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCH="${LAMBDA_ARCH:-x86_64}"
case "$ARCH" in x86_64|aarch64) ;; *) echo "LAMBDA_ARCH must be x86_64 or aarch64" >&2; exit 2 ;; esac

DIST="$HERE/dist"
BUILD="$DIST/build"
ZIP="$DIST/lambda.zip"

rm -rf "$BUILD" "$ZIP"
mkdir -p "$BUILD"

uv export --project "$HERE" --frozen --no-dev --no-hashes --no-emit-project \
  --format requirements-txt -o "$DIST/requirements.txt" >/dev/null
uv pip install --quiet --target "$BUILD" --python-version 3.12 \
  --python-platform "${ARCH}-manylinux2014" --only-binary :all: -r "$DIST/requirements.txt"

rm -rf "$BUILD/bin" "$BUILD/.lock"  # console scripts and uv's lock file are not needed
cp -R "$HERE/handlers" "$HERE/sources" "$BUILD/"
find "$BUILD" -name '__pycache__' -type d -prune -exec rm -rf {} +
find "$BUILD" -exec touch -h -t 198001010000 {} +

(cd "$BUILD" && find . -type f | LC_ALL=C sort | zip -q -X -@ "$ZIP")
rm -rf "$BUILD"

echo "built $ZIP ($(du -h "$ZIP" | cut -f1), arch $ARCH)"
