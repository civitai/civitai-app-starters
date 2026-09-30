/**
 * Guards every iframe-`sandbox` token this repo DECLARES or RECOMMENDS against
 * the host's real allowlist.
 *
 * WHY THIS EXISTS
 * ===============
 * civitai.com derives a block's `<iframe sandbox=…>` attribute in
 * `civitai:src/components/AppBlocks/sandbox.ts`:
 *
 *   export const ALLOWED_SANDBOX_TOKENS: ReadonlySet<string> = new Set([…]);
 *
 *   export function intersectSandbox(raw, trustTier) {
 *     const declared = (raw ?? '').split(/\s+/).filter((t) => ALLOWED_SANDBOX_TOKENS.has(t));
 *     …
 *   }
 *
 * That `.filter` is the whole mechanism, and it is **tier-independent**: a token
 * outside `ALLOWED_SANDBOX_TOKENS` is dropped for EVERY block at EVERY trust
 * tier. `trustTier` only decides whether `allow-same-origin` is ADDED (for
 * `internal`/`verified`). So a manifest can declare such a token, pass every
 * local and server check, and have it silently discarded at render.
 *
 * `starters/civitai-block-starter` shipped `allow-popups-to-escape-sandbox` for
 * exactly that reason — nothing anywhere rejected it — so every app scaffolded
 * from it inherited a declaration that could not do anything, and the
 * `useCivitaiNavigate` docs told authors to rely on it. Neither surface was
 * wrong about syntax; both were wrong about the host.
 *
 * THE THREE HAZARD CLASSES, AND WHY ONLY ONE IS SILENT
 * ===================================================
 * A sandbox token this repo might name falls into exactly one of:
 *
 *   GRANTABLE          in ALLOWED_SANDBOX_TOKENS — reaches the iframe. Fine.
 *   LOUDLY REJECTED    in `defineBlock`'s BANNED_SANDBOX_TOKENS — `defineBlock`
 *                      THROWS, so an author finds out immediately. A doc may
 *                      freely discuss these (they are discussed constantly:
 *                      `allow-same-origin` appears dozens of times as the
 *                      canonical "never do this"). Not this guard's business.
 *   SILENTLY STRIPPED  neither — passes `defineBlock`, passes the server, and
 *                      is then dropped by `intersectSandbox` with no error
 *                      anywhere. **This is the only dangerous class**, and it
 *                      is the class the starter shipped from.
 *
 * The third set is DERIVED here (spec tokens − grantable − loudly rejected)
 * rather than hand-listed, so it re-derives itself when either input moves.
 *
 * WHAT IS CHECKED
 * ===============
 *   Rule 1  Every `block.manifest.json`'s `iframe.sandbox` declares only
 *           GRANTABLE tokens. This is the scaffold-inheritance defect.
 *   Rule 2  Every JSON-shaped `"sandbox": "…"` literal in the doc/source corpus
 *           declares only GRANTABLE tokens — a tutorial that teaches a manifest
 *           value is a declaration an author will copy.
 * PINNED, AND THE STALENESS IS VISIBLE
 * ====================================
 * `HOST_ALLOWED_SANDBOX_TOKENS` below is a PINNED COPY. This guard is in
 * `test:guards`, which runs on a plain checkout with no network and no
 * civitai/civitai available, so it cannot read the host at check time — and a
 * required gate that fetches a live external file fails on someone else's
 * outage.
 *
 * The pin's staleness is not left to trust: `drift vs live civitai/civitai`
 * below reads the real `sandbox.ts` and asserts the pin still matches it. It
 * follows the sibling `design-system drift guard` job exactly — `CIVITAI_REPO`
 * points at a sparse checkout, `REQUIRE_DRIFT_GUARD=1` makes an absent or
 * unparseable source a FAILURE rather than a skip, and the job is ADVISORY
 * because it depends on a repo outside this PR.
 *
 * REMOVED — rule 3, a ledger of every file NAMING a silently-stripped token
 * ========================================================================
 * It existed because the original defect was PROSE ("requires
 * `allow-popups-to-escape-sandbox` in the manifest sandbox"), which rules 1 and
 * 2 key on JSON syntax and cannot see. It was deleted deliberately, not lost:
 *
 *   - It pinned WORDING, not a value. A ledger asserting the SET of files that
 *     mention a token fails when a warning is REWORDED or MOVED, so it taxed
 *     every future doc edit near this topic.
 *   - Measured recurrence: 4 commits in this repo's history ever touched
 *     `allow-popups-to-escape-sandbox`, and 2 touched any `iframe.sandbox`
 *     literal. The prose defect it guarded has occurred ONCE, and the retraction
 *     is now recorded inline at both sites that carried it.
 *   - Cost if it recurs: a doc sentence is wrong. Cost of the guard: a standing
 *     prose tax plus a fragile source-parse of another package's
 *     `BANNED_SANDBOX_TOKENS`, whose empty-match case needed its own assertion.
 *
 * Rules 1 and 2 are kept because they pin VALUES — a manifest field and a
 * `"sandbox": "…"` literal an author will copy — which is the half that caught
 * the scaffold-inheritance defect.
 *
 * 🔴 If a doc again tells authors to declare an ungrantable token, fix the doc.
 * Do not re-add a ledger: that trade was priced and declined.
 *
 * 🔴 KNOWN LIMITS:
 *   - Rule 2 is a text scan, not a parse. It over-reports rather than
 *     under-reports, and fails with file:line.
 *   - Neither rule depends on the HTML spec's keyword list: both test membership
 *     of the GRANTABLE set directly, so a token the spec adds later still fails
 *     them. (An earlier revision derived a "silently stripped" class from a
 *     pinned spec list; see the REMOVED note below for why that went.)
 *   - It says nothing about whether a GRANTABLE token is actually honoured in a
 *     given placement, or about anything the host does after intersection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * PINNED MIRROR of `civitai:src/components/AppBlocks/sandbox.ts`'s
 * `ALLOWED_SANDBOX_TOKENS`. Kept honest by the drift test at the bottom.
 */
const HOST_ALLOWED_SANDBOX_TOKENS = new Set([
  'allow-scripts',
  'allow-forms',
  'allow-popups',
  'allow-modals',
  'allow-pointer-lock',
  'allow-downloads',
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.turbo', 'coverage', '.next']);
const SCAN_EXTS = ['.md', '.mdx', '.ts', '.tsx', '.mjs', '.js', '.json', '.html'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

const ALL_FILES = walk(REPO_ROOT);
const rel = (abs) => relative(REPO_ROOT, abs).split(sep).join('/');

// ── Rule 1: every shipped manifest declares only grantable tokens ─────────────

/**
 * Coverage floor. At the time of writing: the block starter + 6 examples. A
 * bare "every manifest passed" is indistinguishable from "the walk found no
 * manifests", so the count is asserted — this is the positive control for the
 * corpus discovery itself.
 */
const MIN_MANIFESTS_WITH_SANDBOX = 7;

test('rule 1: every block.manifest.json declares only host-grantable sandbox tokens', () => {
  const manifests = ALL_FILES.filter((f) => f.endsWith('block.manifest.json'));
  const violations = [];
  let withSandbox = 0;

  for (const abs of manifests) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(abs, 'utf8'));
    } catch (err) {
      violations.push(`${rel(abs)}: not parseable JSON (${err.message})`);
      continue;
    }
    const sandbox = parsed?.iframe?.sandbox;
    if (typeof sandbox !== 'string') continue;
    withSandbox++;
    for (const token of sandbox.split(/\s+/).filter(Boolean)) {
      if (!HOST_ALLOWED_SANDBOX_TOKENS.has(token)) {
        violations.push(
          `${rel(abs)}: iframe.sandbox declares "${token}", which is NOT in the host's ` +
            'ALLOWED_SANDBOX_TOKENS — intersectSandbox() drops it at every trust tier, so the ' +
            'declaration cannot do anything. Remove it.',
        );
      }
    }
  }

  assert.ok(
    withSandbox >= MIN_MANIFESTS_WITH_SANDBOX,
    `coverage floor: found only ${withSandbox} manifest(s) declaring iframe.sandbox, expected ` +
      `at least ${MIN_MANIFESTS_WITH_SANDBOX}. Either the walk is broken or manifests moved — ` +
      'a green rule 1 over an empty corpus proves nothing.',
  );
  assert.deepEqual(violations, [], `ungrantable sandbox token(s) declared:\n${violations.join('\n')}`);
});

// ── Rule 2: JSON-shaped sandbox literals in docs and source ───────────────────

const MIN_DOC_SANDBOX_LITERALS = 1;

test('rule 2: every documented "sandbox": "…" literal declares only grantable tokens', () => {
  const violations = [];
  let found = 0;

  for (const abs of ALL_FILES) {
    if (!SCAN_EXTS.some((e) => abs.endsWith(e))) continue;
    if (abs.endsWith('block.manifest.json')) continue; // rule 1 owns those
    if (rel(abs).startsWith('tests/guards/manifest-sandbox-tokens')) continue; // this file
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(/"sandbox"\s*:\s*"([^"]*)"/);
      if (!m) return;
      found++;
      for (const token of m[1].split(/\s+/).filter(Boolean)) {
        if (!HOST_ALLOWED_SANDBOX_TOKENS.has(token)) {
          violations.push(
            `${rel(abs)}:${i + 1}: documented sandbox literal declares "${token}", which the ` +
              'host strips at every trust tier. A reader will copy this into a real manifest.',
          );
        }
      }
    });
  }

  assert.ok(
    found >= MIN_DOC_SANDBOX_LITERALS,
    `coverage floor: found ${found} documented "sandbox": "…" literal(s), expected at least ` +
      `${MIN_DOC_SANDBOX_LITERALS}. The scan matched nothing, so its PASS is vacuous.`,
  );
  assert.deepEqual(violations, [], `ungrantable sandbox token(s) documented:\n${violations.join('\n')}`);
});

// ── Staleness: the pinned allowlist vs the live host ─────────────────────────

const CIVITAI_REPO = process.env.CIVITAI_REPO ?? '';
// No default: this repo is PUBLIC, so a contributor's local checkout path does not
// belong in it — and a default that happens to exist on ONE machine makes this test
// PASS there and SKIP everywhere else, which is the more expensive half of the bug.
const HOST_SANDBOX_TS = CIVITAI_REPO
  ? join(CIVITAI_REPO, 'src/components/AppBlocks/sandbox.ts')
  : '';
const REQUIRE_DRIFT_GUARD = process.env.REQUIRE_DRIFT_GUARD === '1';

test('drift: the pinned allowlist matches live civitai/civitai', (t) => {
  if (!existsSync(HOST_SANDBOX_TS)) {
    assert.ok(
      !REQUIRE_DRIFT_GUARD,
      `REQUIRE_DRIFT_GUARD=1 but ${HOST_SANDBOX_TS} is absent. CI sparse-checks-out ` +
        'civitai/civitai for this; if the path moved, re-point it rather than dropping the check.',
    );
    t.skip(`civitai checkout not found at ${CIVITAI_REPO} — set CIVITAI_REPO to enable`);
    return;
  }

  const src = readFileSync(HOST_SANDBOX_TS, 'utf8');
  const m = src.match(/ALLOWED_SANDBOX_TOKENS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, `ALLOWED_SANDBOX_TOKENS = new Set([...]) not found in ${HOST_SANDBOX_TS}`);
  const live = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]).sort();

  assert.ok(
    live.length > 0,
    'parsed the host allowlist as EMPTY — the source shape changed. An empty parse would make ' +
      'this comparison vacuous, so it fails instead.',
  );
  assert.deepEqual(
    live,
    [...HOST_ALLOWED_SANDBOX_TOKENS].sort(),
    'HOST_ALLOWED_SANDBOX_TOKENS has drifted from civitai/civitai. Update the pin in this file, ' +
      'then re-check every manifest and doc — a token LEAVING the host allowlist makes existing ' +
      'declarations inert, which is the defect this guard exists to catch.',
  );
});
