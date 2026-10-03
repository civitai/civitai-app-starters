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
# 🔴 `patch`. YOU ARE READING THE THIRD RATIONALE FOR THIS ONE WORD. Two are
# dead; both are recorded so nobody derives a fourth from the same mistake.
#
#   DEAD 1 — "`patch`, because this mirrors BYTES; a type change would earn the
#   minor." Right answer, incomplete reason: it never asked which DIRECTION the
#   schema moved, which is the only thing that decides the level.
#   DEAD 2 — "`minor`, because the nested-property ledger aborts the bot on an
#   ADDITIVE change, so only constraint TIGHTENINGS reach here." FALSIFIED by
#   measurement, and it inverted the truth. This repo types the field FIRST, on
#   purpose: `packages/civitai-app-sdk/CHANGELOG.md` (0.56.0) says "This lands
#   AHEAD of the schema bytes on purpose, and that ordering is the point" and
#   names this very ledger as the reason. A pre-typed additive change therefore
#   PASSES the ledger — it is the DESIGNED bot path, not an abort — and it is the
#   case that produced the incident this block exists for. Enumerated over every
#   `chore(sdk): re-vendor` commit to the vendored schema: additive or
#   description-only in every one; zero unattended tightenings.
#
# What is actually true is smaller than either dead draft, and the honest part is
# the limitation: THIS SCRIPT CANNOT TELL WHICH DIRECTION THE SCHEMA MOVED. It
# does not diff the schema; it copies bytes. So the level here is a DEFAULT
# matched to the measured population, not a judgement about the change in hand:
# the observed bot-path population is permissive, and pre-1.0 a caret pins the
# MINOR, so `minor` would withhold the corrected schema from every caret-pinned
# consumer — which is the exact failure this whole mechanism exists to end.
# `patch` delivers it. The residual risk is the inverse case, and it is handled
# by the 🔴 in the generated body rather than by a word here, because a word here
# cannot see the diff. Tightenings DO exist in this file's history (see
# `chore(sdk): re-vendor tightened …` and the decorative-scope removal) — they
# were human-driven, not bot-driven, which is why this is a default and not a
# claim that tightenings never happen.
CHANGESET_DIR="$REPO_ROOT/.changeset"
CHANGESET="$CHANGESET_DIR/revendor-canonical-schema-$(date -u +%Y-%m-%d).md"
mkdir -p "$CHANGESET_DIR"
# 🔴 The body deliberately does NOT interpolate $CANONICAL_URL. `changeset
# version` copies this text verbatim into the package CHANGELOG in a PUBLIC repo,
# and the URL is env-overridable — so a local run against an internal host would
# publish that hostname. The canonical URL is a constant; write it as one.
cat > "$CHANGESET" <<'EOF'
---
'@civitai/app-sdk': patch
---

Re-vendor the canonical App Block manifest schema from
https://civitai.com/schemas/app-block/v1.json.

The vendored schema is published — it ships in the tarball, is exported as
`./schemas/app-block/v1.json`, and `defineBlock` validates against it at
runtime — so mirroring the bytes only takes effect once the package is
released. This changeset is what releases them.

**Why `patch`.** This was written by `scripts/revendor-canonical-schema.sh`,
which copies bytes and CANNOT tell which direction the schema moved. `patch` is
the default because the measured population of unattended re-vendors is
permissive (additive or description-only), and because pre-1.0 a caret pins the
minor — so `minor` would withhold the corrected schema from every caret-pinned
consumer, which is the failure this mechanism exists to end.

🔴 **READ THE SCHEMA DIFF BEFORE MERGING.** If it TIGHTENS anything — a lowered
`maxLength`, a new `required` entry, a narrowed enum, a removed property — then
`patch` is wrong, because a manifest that validated before will start failing.
**Do not fix that by editing this file on this branch:** this PR's branch is
regenerated and force-pushed on every cron run (up to four a day), and the drift
is re-detected until the PR merges, so your commit is certain to be discarded.
Close this PR instead and land the re-vendor by hand with a `minor` changeset.
EOF
echo "wrote $CHANGESET (a re-vendor only reaches consumers once published)"
