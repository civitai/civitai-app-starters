#!/usr/bin/env bash
#
# Drift-check: the vendored App Blocks document-store contract MUST stay
# byte-identical to the one civitai.com serves at
# https://civitai.com/schemas/app-block/storage-contract.v1.json — the request
# table the platform runs against its real storage handlers, and that
# `@civitai/sdk`'s suite runs against `createFakeStorage` and the client.
#
# The same contract as check-canonical-schema.sh: fails loudly if
#   - the served URL is unreachable / returns a non-200 (the contract is expected
#     live; a non-200 fails the job rather than silently passing), or
#   - the vendored copy differs from the served one in any byte.
#
# Its WRITE twin is scripts/revendor-storage-contract.sh, run by the scheduled
# `revendor-canonical-schema.yml` workflow.
#
# Run locally:  ./scripts/check-storage-contract.sh
# Used by CI:   .github/workflows/ci.yml (schema-drift job).
set -euo pipefail

CONTRACT_URL="https://civitai.com/schemas/app-block/storage-contract.v1.json"
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
http_code="$(curl -sS -w '%{http_code}' -o "$tmp" "$CONTRACT_URL" || true)"

if [[ "$http_code" != "200" ]]; then
  echo "ERROR: storage contract fetch failed (HTTP ${http_code:-000}) from $CONTRACT_URL" >&2
  echo "       The contract is expected to be live; failing the check." >&2
  exit 1
fi

if ! diff -u "$VENDORED" "$tmp"; then
  echo >&2
  echo "ERROR: the vendored storage contract has DRIFTED from the served one." >&2
  echo "       Vendored: $VENDORED" >&2
  echo "       Served:   $CONTRACT_URL" >&2
  echo "       Sync it: ./scripts/revendor-storage-contract.sh, then make the fake pass it." >&2
  exit 1
fi

echo "OK: vendored storage contract is byte-identical to the served one."
