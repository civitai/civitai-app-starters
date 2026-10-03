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
#   - HTTP 200               -> re-vendor if the bytes differ, AND write a
#                               changeset so the mirror actually ships (see the
#                               block at the bottom); no-op if already identical,
#                               and a no-op writes NO changeset.
#   - HTTP 404/410           -> fail loudly (the canonical URL likely moved).
#   - unreachable / other    -> skip quietly, exit 0 (transient: DNS, timeout,
#                               5xx, 429 — don't fail a scheduled job on a blip).
#   - empty / non-JSON-object body -> refuse to re-vendor (never blank the mirror).
#
# Only the re-vendor path writes a changeset: the vendored schema is PUBLISHED
# (tarball + public export + read at runtime by `defineBlock`), so bytes that are
# mirrored but never released do not reach a single consumer.
#
# Run locally:  ./scripts/revendor-canonical-schema.sh
# Used by CI:   .github/workflows/revendor-canonical-schema.yml (weekly cron).
set -euo pipefail

CANONICAL_URL="${CANONICAL_URL:-https://civitai.com/schemas/app-block/v1.json}"
# `cd -P … >/dev/null` — see the same line in check-canonical-schema.sh: a bare
# `cd` with CDPATH set echoes the directory into the `$(…)` capture.
REPO_ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
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

# 🔴 MIRRORING THE BYTES IS HALF THE JOB — WITHOUT A CHANGESET THIS NEVER SHIPS.
#
# The vendored copy is not an internal build input: it is published. It ships in
# the tarball (`files: [… "schemas" …]`), is a public export
# (`./schemas/app-block/v1.json`), and `defineBlock` READS IT AT RUNTIME
# (`src/manifest/defineBlock.ts`, CANONICAL_SCHEMA_PATH). So a re-vendor that is
# merged but never released leaves every installed copy of this package
# validating against the OLD schema, indefinitely — and because `goods.items`
# sets `additionalProperties: false`, that stale copy REJECTS a field the server
# has started to require, rather than merely failing to check it.
#
# Measured 2026-10-03: `goods[].justification` went live, #529 re-vendored the
# bytes with no changeset, and the published `@civitai/app-sdk@0.56.0` therefore
# rejected a manifest the platform REQUIRES for `kind: "app_unlock"` — so the
# first paid app could not be authored through the documented path. That is the
# incident this block exists to prevent, and it is structural: nothing else in
# the chain adds a changeset, so a re-vendor PR could never publish.
#
# Deterministic filename, deliberately: the workflow reuses ONE branch
# (`automation/revendor-canonical-schema`), so a fixed name is overwritten on a
# re-run instead of accumulating a changeset per run. `changeset version`
# consumes the file at release, so it does not linger.
#
# `patch`, not `minor`: this mirrors BYTES. A canonical change that adds a field
# also needs that field on `BlockManifestV1` — a human step this script does not
# do (and one the SDK's own nested-property ledger test fails loudly on), and
# that type change is what would earn a minor.
CHANGESET_DIR="$REPO_ROOT/.changeset"
CHANGESET="$CHANGESET_DIR/revendor-canonical-schema.md"
mkdir -p "$CHANGESET_DIR"
cat > "$CHANGESET" <<EOF
---
'@civitai/app-sdk': patch
---

Re-vendor the canonical App Block manifest schema from $CANONICAL_URL.

The vendored schema is published — it ships in the tarball, is exported as
\`./schemas/app-block/v1.json\`, and \`defineBlock\` validates against it at
runtime — so mirroring the bytes only takes effect once the package is
released. This changeset is what releases them.
EOF
echo "wrote $CHANGESET (a re-vendor only reaches consumers once published)"
