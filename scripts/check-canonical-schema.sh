#!/usr/bin/env bash
#
# Drift-check: the vendored App Block manifest schema MUST stay byte-identical
# to the server-published canonical at https://civitai.com/schemas/app-block/v1.json
# (the single source of truth shared by the platform validator + the `civitai` CLI).
#
# Fails loudly if:
#   - the canonical URL is unreachable / returns a non-200 (the canonical is
#     expected live; a non-200 fails the job rather than silently passing), or
#   - the vendored copy differs from the live canonical in any byte.
#
# Run locally:  ./scripts/check-canonical-schema.sh
# Used by CI:   .github/workflows/ci.yml (schema-drift job).
set -euo pipefail

CANONICAL_URL="https://civitai.com/schemas/app-block/v1.json"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDORED="$REPO_ROOT/packages/civitai-app-sdk/schemas/app-block/v1.json"

if [[ ! -f "$VENDORED" ]]; then
  echo "ERROR: vendored schema not found at $VENDORED" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "Fetching canonical schema from $CANONICAL_URL ..."
http_code="$(curl -sS -w '%{http_code}' -o "$tmp" "$CANONICAL_URL" || true)"

if [[ "$http_code" != "200" ]]; then
  echo "ERROR: canonical schema fetch failed (HTTP ${http_code:-000}) from $CANONICAL_URL" >&2
  echo "       The canonical schema is expected to be live; failing the check." >&2
  exit 1
fi

if ! diff -u "$VENDORED" "$tmp"; then
  echo >&2
  echo "ERROR: vendored schema has DRIFTED from the canonical." >&2
  echo "       Vendored: $VENDORED" >&2
  echo "       Canonical: $CANONICAL_URL" >&2
  echo "       Sync it: curl -sS \"$CANONICAL_URL\" -o \"$VENDORED\"" >&2
  exit 1
fi

echo "OK: vendored schema is byte-identical to the live canonical."
