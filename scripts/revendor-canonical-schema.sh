#!/usr/bin/env bash
#
# Re-vendor: copy the server-published canonical App Block manifest schema
# (https://civitai.com/schemas/app-block/v1.json — the single source of truth
# shared by the platform validator + the `civitai` CLI) over the vendored copy
# at packages/civitai-app-sdk/schemas/app-block/v1.json.
#
# This is the WRITE twin of scripts/check-canonical-schema.sh (the read-only
# drift GUARD). The guard enforces BYTE identity via `diff -u`; this script
# therefore compares + copies RAW BYTES (cmp -s / cp), never jq-normalized —
# so a re-vendor here always satisfies the guard.
#
# Behaviour:
#   - HTTP 200               -> re-vendor if the bytes differ (else no-op).
#   - HTTP 404/410           -> fail loudly (the canonical URL likely moved).
#   - unreachable / other    -> skip quietly, exit 0 (transient: DNS, timeout,
#                               5xx, 429 — don't fail a scheduled job on a blip).
#   - empty / non-JSON-object body -> refuse to re-vendor (never blank the mirror).
#
# Run locally:  ./scripts/revendor-canonical-schema.sh
# Used by CI:   .github/workflows/revendor-canonical-schema.yml (weekly cron).
set -euo pipefail

CANONICAL_URL="${CANONICAL_URL:-https://civitai.com/schemas/app-block/v1.json}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDORED="$REPO_ROOT/packages/civitai-app-sdk/schemas/app-block/v1.json"

if [[ ! -f "$VENDORED" ]]; then
  echo "ERROR: vendored schema not found at $VENDORED" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "Fetching canonical schema from $CANONICAL_URL ..."
code="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 30 "$CANONICAL_URL" || echo 000)"

case "$code" in
  200)
    ;;
  404|410)
    echo "ERROR: canonical schema returned HTTP $code from $CANONICAL_URL — did the canonical URL move?" >&2
    exit 1
    ;;
  *)
    echo "WARN: canonical schema unreachable (HTTP $code) from $CANONICAL_URL — skipping (transient)." >&2
    exit 0
    ;;
esac

# Guard against a 200 with an empty or non-object body before overwriting the
# mirror (`jq empty` exits 0 on a 0-byte file, which would blank it).
if [[ ! -s "$tmp" ]] || ! jq -e 'type == "object"' "$tmp" >/dev/null 2>&1; then
  echo "ERROR: canonical schema body is empty or not a JSON object — refusing to re-vendor." >&2
  exit 1
fi

# BYTE compare (mirror the guard's `diff -u` byte semantics, not jq-normalized).
if cmp -s "$tmp" "$VENDORED"; then
  echo "vendored schema already byte-identical to the canonical — nothing to do."
  exit 0
fi

cp "$tmp" "$VENDORED"
echo "re-vendored $VENDORED from $CANONICAL_URL"
