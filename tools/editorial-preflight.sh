#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

deps=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/jelly-template-tests.XXXXXX")
trap 'rm -rf -- "$deps"' EXIT
cp tools/template-test-deps/package*.json "$deps/"
npm ci --prefix "$deps" --ignore-scripts --no-audit --no-fund

TEST_NODE_MODULES="$deps/node_modules" node tools/test-ad-boundaries.mjs
node tools/test-editorial-gates.mjs
node tools/test-search-ui.mjs
node tools/validate-harness.mjs
node tools/verify-site-quality.mjs
