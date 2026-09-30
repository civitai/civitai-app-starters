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
 *   Rule 3  A LEDGER of every file that NAMES a silently-stripped token. Rules 1
 *           and 2 key on JSON syntax and would NOT have caught the original
 *           defect, which was prose: *"requires `allow-popups-to-escape-sandbox`
 *           in the manifest sandbox"*. The ledger fails when it GROWS (a new file
 *           started naming one — read it and check it says "don't") or SHRINKS
 *           (a documented warning was deleted). Asserting the SET, not a count,
 *           is what makes it unwalkable by rewording.
 *
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
 * 🔴 KNOWN LIMITS:
 *   - Rules 2 and 3 are text scans, not parses. They over-report rather than
 *     under-report, and fail with file:line.
 *   - `SPEC_SANDBOX_TOKENS` is the HTML sandbox keyword list as of writing. A
 *     keyword added to the spec later is invisible to rule 3 until added here —
 *     which is why rule 1, the one that matters most, does not depend on it
 *     (it tests membership of the grantable set directly, so an unknown token
 *     fails it whether or not the spec list knows the token).
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

/** The HTML `iframe[sandbox]` keyword set. Used only to derive rule 3's class. */
const SPEC_SANDBOX_TOKENS = new Set([
  'allow-downloads',
  'allow-forms',
  'allow-modals',
  'allow-orientation-lock',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-presentation',
  'allow-same-origin',
  'allow-scripts',
  'allow-storage-access-by-user-activation',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols',
]);

const DEFINE_BLOCK = join(REPO_ROOT, 'packages/civitai-app-sdk/src/manifest/defineBlock.ts');

/**
 * Read `defineBlock`'s BANNED_SANDBOX_TOKENS from source rather than copying it,
 * so the derived hazard class below tracks it. Fails loud: a parse that yields
 * nothing would silently WIDEN rule 3's ledger to include tokens `defineBlock`
 * already throws on, which is the "plausible-but-wrong output" failure mode.
 */
function readLoudlyRejectedTokens() {
  const src = readFileSync(DEFINE_BLOCK, 'utf8');
  const m = src.match(/BANNED_SANDBOX_TOKENS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, `BANNED_SANDBOX_TOKENS = new Set([...]) not found in ${DEFINE_BLOCK}`);
  const tokens = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
  assert.ok(
    tokens.length > 0,
    'parsed BANNED_SANDBOX_TOKENS as EMPTY — the source shape changed; fix this parser, ' +
      'because an empty set here silently widens rule 3 instead of failing.',
  );
  return new Set(tokens);
}

/**
 * The only dangerous class: declarable, accepted by every local and server
 * check, and then dropped with no error.
 */
function silentlyStrippedTokens() {
  const loud = readLoudlyRejectedTokens();
  return new Set(
    [...SPEC_SANDBOX_TOKENS].filter((t) => !HOST_ALLOWED_SANDBOX_TOKENS.has(t) && !loud.has(t)),
  );
}

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

// ── Rule 3: the ledger of files naming a silently-stripped token ──────────────

/**
 * Every file permitted to NAME a silently-stripped token, and why. All three
 * name `allow-popups-to-escape-sandbox` in order to tell the reader NOT to
 * declare it — which is the correction this ledger exists to hold in place.
 *
 * 🔴 An ASSERTED SET, not a count or a maximum. It fails in BOTH directions:
 *   GREW    a new file names one. Read it. If it recommends the token, that is
 *           the bug this guard was written for. If it warns against it, add it
 *           here with a reason.
 *   SHRANK  a warning was deleted. That is how the docs rot back to telling
 *           authors to declare an inert token — which is exactly what happened
 *           before this guard existed.
 */
const SILENT_TOKEN_MENTION_LEDGER = {
  'packages/civitai-blocks-react/README.md':
    'The propagating surface. developer.civitai.com generates its hooks reference with ' +
    '`description: readme.prose || jsdocDesc` / `example: readme.example || jsdocExample`, so this ' +
    "README SHADOWS the JSDoc. It warns authors off the token; if this entry disappears, the public " +
    'docs stop carrying the warning even if the JSDoc still does.',
  'packages/civitai-blocks-react/src/hooks/useCivitaiNavigate.ts':
    'The JSDoc twin of the README entry. Kept consistent with it deliberately — it is what an IDE ' +
    'shows, and what the generator falls back to if the README entry is ever removed.',
  'packages/civitai-app-sdk/test/manifest/divergences.test.ts':
    'Records why the removed third divergence case is gone: it cited the starter\'s own ' +
    'declaration of this token as the worked example of the looser-than-review arm.',
};

test('rule 3: only ledgered files name a silently-stripped sandbox token', () => {
  const silent = silentlyStrippedTokens();
  assert.ok(
    silent.has('allow-popups-to-escape-sandbox'),
    'derivation sanity: allow-popups-to-escape-sandbox must land in the silently-stripped class ' +
      '(it is in neither the host allowlist nor defineBlock\'s banned set). It did not, so the ' +
      'derivation is broken and this rule is measuring the wrong set.',
  );

  const mentions = new Map();
  for (const abs of ALL_FILES) {
    if (!SCAN_EXTS.some((e) => abs.endsWith(e))) continue;
    if (rel(abs).startsWith('tests/guards/manifest-sandbox-tokens')) continue; // this file
    // RELEASE NOTES, both shapes. A changeset IS the changelog entry — `changeset
    // version` moves its body into CHANGELOG.md and deletes the file — so the two
    // are one corpus. Both legitimately describe the correction in prose ("we
    // removed allow-popups-to-escape-sandbox because…"), neither is a place a
    // reader copies a manifest value from, and ledgering them would churn the
    // ledger on every release that mentions the token. Excluded on that reasoning,
    // not for convenience: the guard flagged this guard's OWN changeset first.
    if (rel(abs).includes('CHANGELOG.md')) continue;
    if (rel(abs).startsWith('.changeset/')) continue;
    const text = readFileSync(abs, 'utf8');
    for (const token of silent) {
      // Word-bounded so `allow-popups` never matches inside
      // `allow-popups-to-escape-sandbox`, and vice versa.
      if (new RegExp(`${token}(?![a-z-])`).test(text)) {
        if (!mentions.has(rel(abs))) mentions.set(rel(abs), new Set());
        mentions.get(rel(abs)).add(token);
      }
    }
  }

  const actual = [...mentions.keys()].sort();
  const ledgered = Object.keys(SILENT_TOKEN_MENTION_LEDGER).sort();

  const grew = actual.filter((f) => !ledgered.includes(f));
  const shrank = ledgered.filter((f) => !actual.includes(f));

  assert.deepEqual(
    actual,
    ledgered,
    'the silently-stripped-token mention ledger moved.\n' +
      (grew.length
        ? `\nNEW file(s) naming one — read each and check it WARNS rather than RECOMMENDS:\n` +
          grew.map((f) => `  + ${f}  (${[...mentions.get(f)].join(', ')})`).join('\n') +
          '\nIf it warns, add it to SILENT_TOKEN_MENTION_LEDGER with a reason.\n'
        : '') +
      (shrank.length
        ? `\nREMOVED file(s) that used to warn — a deleted warning is how this rots back:\n` +
          shrank.map((f) => `  - ${f}`).join('\n') +
          '\nIf the removal is intended, drop it from SILENT_TOKEN_MENTION_LEDGER too.\n'
        : ''),
  );
});

// ── Staleness: the pinned allowlist vs the live host ─────────────────────────

const CIVITAI_REPO = process.env.CIVITAI_REPO ?? '/home/zach/workspace/civit/civitai';
const HOST_SANDBOX_TS = join(CIVITAI_REPO, 'src/components/AppBlocks/sandbox.ts');
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
