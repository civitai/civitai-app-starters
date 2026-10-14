#!/usr/bin/env bash
#
# Re-vendor: copy the App Blocks document-store contract civitai.com serves
# (https://civitai.com/schemas/app-block/storage-contract.v1.json) over the
# vendored copy at packages/civitai-sdk/schemas/app-block/storage-contract.v1.json.
#
# The WRITE twin of scripts/check-storage-contract.sh (the read-only drift GUARD),
# and the sibling of scripts/revendor-canonical-schema.sh, whose behaviour it
# copies exactly. The guard enforces BYTE identity via `diff -u`, so this
# compares + copies RAW BYTES (cmp -s / cp), never jq-normalised.
#
# Behaviour:
#   - HTTP 200               -> re-vendor if the bytes differ; no-op if identical.
#   - HTTP 404/410           -> fail loudly (the URL likely moved).
#   - unreachable / other    -> skip quietly, exit 0 (transient: DNS, timeout,
#                               5xx, 429 — don't fail a scheduled job on a blip).
#   - empty / non-JSON-object body -> refuse to re-vendor (never blank the copy).
#
# 🔴 ONE DELIBERATE DIFFERENCE from the schema script: NO CHANGESET. That script
# writes one because the manifest schema it mirrors is PUBLISHED (tarball,
# `exports`, read by `defineBlock`). This file is not: it is outside
# `@civitai/sdk`'s `files`, read only by the package's own contract test, so a
# re-vendor changes no consumer and a changeset would publish an empty release.
# A contract change that needs the FAKE to change is a code change, and that PR
# carries its own changeset.
#
# Run locally:  ./scripts/revendor-storage-contract.sh
# Used by CI:   .github/workflows/revendor-canonical-schema.yml (same cron, same PR).
set -euo pipefail

CONTRACT_URL="${CONTRACT_URL:-https://civitai.com/schemas/app-block/storage-contract.v1.json}"
# `cd -P … >/dev/null`: see check-canonical-schema.sh (CDPATH echoes into `$(…)`).
REPO_ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
VENDORED="$REPO_ROOT/packages/civitai-sdk/schemas/app-block/storage-contract.v1.json"

if [[ ! -f "$VENDORED" ]]; then
  echo "ERROR: vendored contract not found at $VENDORED" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "Fetching the storage contract from $CONTRACT_URL ..."
code="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 30 "$CONTRACT_URL" || echo 000)"

case "$code" in
  200)
    ;;
  404|410)
    echo "ERROR: storage contract returned HTTP $code from $CONTRACT_URL — did the URL move?" >&2
    exit 1
    ;;
  *)
    echo "WARN: storage contract unreachable (HTTP $code) from $CONTRACT_URL — skipping (transient)." >&2
    exit 0
    ;;
esac

if [[ ! -s "$tmp" ]] || ! jq -e 'type == "object"' "$tmp" >/dev/null 2>&1; then
  echo "ERROR: storage contract body is empty or not a JSON object — refusing to re-vendor." >&2
  exit 1
fi

if cmp -s "$tmp" "$VENDORED"; then
  echo "vendored storage contract already byte-identical — nothing to do."
  exit 0
fi

cp "$tmp" "$VENDORED"
echo "re-vendored $VENDORED from $CONTRACT_URL"
