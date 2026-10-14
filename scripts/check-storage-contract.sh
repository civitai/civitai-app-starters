#!/usr/bin/env bash
#
# Drift-check: the vendored App Blocks document-store contract MUST stay
# byte-identical to the one civitai.com serves at
# https://civitai.com/schemas/app-block/storage-contract.v1.json — the request
# table the platform runs against its real storage handlers, and that
# `@civitai/sdk`'s suite runs against `createFakeStorage` and the client.
#
# Same contract as check-canonical-schema.sh (byte identity, `diff -u`), with ONE
# deliberate difference while the routes are unreleased:
#
#   - HTTP 200 from civitai.com -> diff against it. This is the steady state.
#   - HTTP 404 from civitai.com -> the contract is not served yet (it ships with
#     the release that ships the routes). Diff against civitai/civitai `main`
#     instead, where the file lives at public/schemas/app-block/, and SAY SO.
#     🔴 Once civitai.com serves the file, this branch must stop being reachable:
#     re-run this check after the release and delete the fallback, so a 404 then
#     fails like the canonical schema's does.
#   - anything else            -> fail (the source is expected reachable).
#
# Run locally:  ./scripts/check-storage-contract.sh
# Used by CI:   .github/workflows/ci.yml (schema-drift job).
set -euo pipefail

SERVED_URL="https://civitai.com/schemas/app-block/storage-contract.v1.json"
MAIN_URL="https://raw.githubusercontent.com/civitai/civitai/main/public/schemas/app-block/storage-contract.v1.json"
# `cd -P … >/dev/null`: see check-canonical-schema.sh (CDPATH echoes into `$(…)`).
REPO_ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
VENDORED="$REPO_ROOT/packages/civitai-sdk/schemas/app-block/storage-contract.v1.json"

if [[ ! -f "$VENDORED" ]]; then
  echo "ERROR: vendored contract not found at $VENDORED" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

fetch() {
  curl -sS -o "$tmp" -w '%{http_code}' --max-time 30 "$1" || echo 000
}

echo "Fetching the served contract from $SERVED_URL ..."
code="$(fetch "$SERVED_URL")"
source_url="$SERVED_URL"
if [[ "$code" == "404" ]]; then
  echo "NOTE: civitai.com does not serve the contract yet (HTTP 404) — the storage routes are"
  echo "      unreleased. Checking against civitai/civitai main instead; re-check after release."
  source_url="$MAIN_URL"
  code="$(fetch "$MAIN_URL")"
fi

if [[ "$code" != "200" ]]; then
  echo "ERROR: contract fetch failed (HTTP ${code:-000}) from $source_url" >&2
  exit 1
fi

if ! diff -u "$VENDORED" "$tmp"; then
  echo >&2
  echo "ERROR: the vendored storage contract has DRIFTED from $source_url." >&2
  echo "       Re-vendor the bytes (curl -sS \"$source_url\" -o \"$VENDORED\"), update the pinned" >&2
  echo "       sha256 in packages/civitai-sdk/test/doc-store/contract.test.ts, and make the fake pass it." >&2
  exit 1
fi

echo "OK: vendored storage contract is byte-identical to $source_url."
