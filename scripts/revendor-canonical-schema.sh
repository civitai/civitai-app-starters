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
# Used by CI:   .github/workflows/revendor-canonical-schema.yml — cron
#               `37 */6 * * *`, i.e. FOUR runs a day. (This line said "weekly"
#               until 2026-10-03; the workflow moved off weekly deliberately and
#               carries its own rationale. Read the `cron:` line, not this one.)
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
# The vendored copy is PUBLISHED (tarball + `exports` + read at runtime by
# `defineBlock`), so bytes merged but never released reach no consumer, and with
# `additionalProperties: false` a stale published copy REJECTS a newly-required
# field rather than ignoring it. The measured incident and the full reasoning
# live once, in `tests/guards/revendor-emits-changeset.test.mjs` — do not
# re-narrate it here.
#
# DATED filename, matching `scripts/sync-orchestrator-catalogs.mjs` (which has
# written a changeset after a successful sync since before this script did).
# ⚠ An earlier revision of this block used a FIXED name and justified it as
# "the workflow reuses one branch, so a fixed name is overwritten instead of
# accumulating". That rationale was wrong AND the fixed name was unsafe:
# `create-pull-request` regenerates the branch from base on every run, so
# changesets never accumulated and there was nothing to overwrite — while
# `cat >` on a fixed path TRUNCATES whatever is already there, which is exactly
# where a hand-authored changeset for the same mechanism lands. Do not reinstate
# a fixed name to "avoid accumulation"; the accumulation it prevents cannot
# happen.
#
# `minor`, matching the same sibling, and the reason is an ASYMMETRY in what can
# reach this line. The SDK's nested-property ledger test
# (`test/manifest/canonical-derivation.test.ts`) FAILS when the canonical grows a
# property that `BlockManifestV1` does not type — and the workflow runs the full
# SDK suite before opening a PR. So an ADDITIVE canonical change aborts the bot
# and gets a human. What silently survives to here is the class the ledger cannot
# see: a tightened bound, a new `required` entry, a narrowed enum — i.e. changes
# that make a manifest which previously VALIDATED start failing. Those are the
# breaking ones, so the automated default must be the breaking level; pre-1.0 a
# caret pins the minor, so `minor` is what stops a consumer's build moving under
# them. A reviewer who has read the diff and sees it is permissive-only may
# downgrade this to `patch` before merging.
CHANGESET_DIR="$REPO_ROOT/.changeset"
CHANGESET="$CHANGESET_DIR/revendor-canonical-schema-$(date -u +%Y-%m-%d).md"
mkdir -p "$CHANGESET_DIR"
cat > "$CHANGESET" <<EOF
---
'@civitai/app-sdk': minor
---

Re-vendor the canonical App Block manifest schema from $CANONICAL_URL.

The vendored schema is published — it ships in the tarball, is exported as
\`./schemas/app-block/v1.json\`, and \`defineBlock\` validates against it at
runtime — so mirroring the bytes only takes effect once the package is
released. This changeset is what releases them.

**Why \`minor\`.** This was written by \`scripts/revendor-canonical-schema.sh\`,
which cannot classify the change's direction. An additive canonical change would
have failed the SDK's nested-property ledger and never reached here, so what does
reach here is the class that ledger cannot see — a tightened bound, a new
\`required\`, a narrowed enum — which can make a previously-valid manifest start
failing. 🔴 **Read the schema diff before merging**: if it is permissive-only,
downgrade this to \`patch\` and say so here.
EOF
echo "wrote $CHANGESET (a re-vendor only reaches consumers once published)"
