/**
 * Guards WHERE the Buzz balance comes from, and WHAT the UI does when it is
 * unavailable — in every standalone OAuth starter.
 *
 * WHY THIS EXISTS
 * ===============
 * All four starters rendered `Buzz balance: —` for every real user, for the
 * whole life of the templates, because they read `balance` off `/api/v1/me`.
 * That endpoint has never returned one: civitai/civitai
 * `src/pages/api/v1/me.ts` sends `id, username, tier, status, isMember,
 * subscriptions`, plus conditionally `isModerator`, `email`/`emailVerified`
 * and the token-only `tokenScope`/`buzzLimit`/`subject`. `git log -S'balance'`
 * on that file is empty.
 *
 * 🔴 `buzzLimit` IS THE DECOY, NOT THE FIX. It is real, it IS on `/api/v1/me`,
 * and it is a per-token SPEND CAP chosen at OAuth consent — not a balance.
 * Relabelling it would reproduce the same defect with a field that exists,
 * which is strictly harder to spot. Rule 1 bans it from the projection for
 * exactly that reason.
 *
 * The balance lives behind the `buzz.getUserAccount` tRPC procedure
 * (`requiredScope: TokenScope.BuzzRead`), reachable through the SDK's
 * `fetchBuzzAccount()` — which already shipped, fully tested, and which ZERO
 * starters called.
 *
 * WHY A GUARD AND NOT JUST THE PROBE
 * ==================================
 * `starters/next-app/scripts/probe-expired-session.mjs` drives a REAL render
 * and asserts the real number appears (scenario C), that a 403 hides the row
 * (D), and that a token without the scope never asks (E). That is the
 * behavioural check, and it is worth more than everything below — but it
 * covers ONE of the four starters, because the other three have no CI-run
 * harness that can render them. This guard is what makes the other three
 * non-vacuous, and it runs in the required `Starter` matrix job via
 * `pnpm test:guards`.
 *
 * WHAT IT PINS
 * ============
 *   1. NO BALANCE ON THE `/api/v1/me` PROJECTION. Neither the `MeResponse`
 *      type nor the `getMe` return literal may declare a `balance`-ish key, or
 *      `buzzLimit`. The endpoint does not return one; a field that is always
 *      `undefined` is how this shipped.
 *   2. THE BALANCE HAS A REAL SOURCE. Each boundary file must call
 *      `fetchBuzzAccount(`.
 *   3. ABSENCE IS IN THE TYPE. The reader's declared return type must admit
 *      `null`, so `tsc` forces every caller to handle "no balance" instead of
 *      interpolating `undefined`.
 *   4. NO PLACEHOLDER IN THE UI. A file that renders the `Buzz balance:` row
 *      must not fall back to a dash / `null` / `undefined` / `0`, and must
 *      guard the row on a nullish check. 403 is an ordinary outcome for a
 *      third-party client; the row disappears.
 *   5. LEDGERS, SO A SITE CANNOT GO MISSING. The set of files rendering the
 *      row, and the set binding `initialBalance=`, are each asserted EXACTLY —
 *      failing when they grow OR shrink. The `initialBalance` ledger exists
 *      because that secondary display renders NOTHING when the value is
 *      absent, so it was invisible in review for the entire life of the bug.
 *   6. THE PROBE STUB TELLS THE TRUTH. `probe-expired-session.mjs`'s
 *      `/api/v1/me` payload must not invent a `balance`. It used to, which
 *      taught the wrong contract to the one CI check that answers that
 *      endpoint.
 *
 * 🔴 KNOWN LIMITS — a guard whose description is wider than its body is worse
 * than no guard, so:
 *   - IT READS TEXT, NOT TYPES. Rule 3 checks the spelling of the declared
 *     return type. A reader that returns `Promise<Maybe<number>>` reads as a
 *     violation (deliberately: the alias hides the contract), and one that
 *     returns `null` from a body typed `Promise<number>` is caught by `tsc`,
 *     not here.
 *   - RULE 4 IS PER-FILE, NOT PER-LINE. It asserts a nullish guard exists in a
 *     file that renders the row, not that the guard wraps that exact element.
 *     The probe's D arm is what proves the wrapping actually works, and it
 *     covers next-app only.
 *   - NOTHING HERE PROVES THE VALUE IS RIGHT. `fetchBuzzAccount` is unit-tested
 *     in the SDK; the number reaching the page is the probe's C arm.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { stripComments } from './lib/strip-comments.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The `/api/v1/me` boundaries. Asserted as a SUBSET of what the walk finds, so
 * a new starter is covered automatically and a rename fails loudly rather than
 * silently shrinking the scan. Same list as
 * `starter-me-projection.test.mjs`'s — the two guards check different
 * properties of the same four files and must not drift apart.
 */
const KNOWN_BOUNDARIES = [
  'starters/next-app/src/lib/civitai.ts',
  'starters/react-pwa/server/civitai.ts',
  'starters/svelte-pwa/server/civitai.ts',
  'starters/sveltekit-app/src/lib/civitai.ts',
];

/**
 * EXACT ledger of the files that render the signed-in balance row. Grows OR
 * shrinks => fail. A starter that quietly drops the row is a regression too:
 * the fix is supposed to make the balance appear, not to delete the feature.
 */
const ROW_SITES = [
  'starters/next-app/src/app/page.tsx',
  'starters/react-pwa/src/App.tsx',
  'starters/svelte-pwa/src/App.svelte',
  'starters/sveltekit-app/src/routes/+page.svelte',
];

/**
 * EXACT ledger of the `<GenerateForm initialBalance={…}>` bindings — the
 * SECOND display of the same number, in the cost-preview line.
 *
 * 🔴 THIS ONE RENDERS NOTHING WHEN THE VALUE IS ABSENT (`{initialBalance !=
 * null && …}`), so for the entire life of the bug it was not a dash anyone
 * could see — it was blank. A reviewer scanning for `—` would never find it.
 * That is the whole reason this ledger exists.
 */
const INITIAL_BALANCE_SITES = [...ROW_SITES];

/** The one CI check that answers `/api/v1/me`. */
const PROBE = 'starters/next-app/scripts/probe-expired-session.mjs';

/** A key that claims to be a balance, or the spend-cap decoy. */
const BALANCE_KEY = /^(balance|buzz|buzzBalance|buzzLimit)$/i;

/** `export async function getBuzzBalance(…): Promise<X> {` */
const READER_DECL =
  /(?:export\s+)?async\s+function\s+getBuzzBalance\s*\([^)]*\)\s*:\s*Promise\s*<([^>]*)>\s*\{/;

/** `export async function getMe(…): Promise<Name> {` */
const GET_ME_DECL =
  /(?:export\s+)?async\s+function\s+getMe\s*\([^)]*\)\s*:\s*Promise\s*<\s*([A-Za-z_$][\w$]*)\s*>\s*\{/;

const typeDecl = (name) =>
  new RegExp(`(?:interface\\s+${name}\\s*|type\\s+${name}\\s*=\\s*)\\{`);

/** Body of the brace-delimited block whose opening `{` is at or after `from`. */
function braceBody(code, from) {
  const open = code.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return null;
}

/** Split a member list on its TOP-LEVEL `,`/`;`, ignoring bracketed regions. */
function topLevelParts(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth -= 1;
    if (depth === 0 && (ch === ',' || ch === ';')) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Declared/assigned keys of a member list. Exported so controls can drive it. */
export function keysOf(body) {
  return topLevelParts(body)
    .filter((p) => !p.startsWith('...'))
    .map((p) => p.split(':')[0].trim().replace(/\?$/, '').replace(/^['"`]|['"`]$/g, ''))
    .filter(Boolean)
    .sort();
}

/**
 * Rules 1-3 over one `/api/v1/me` boundary source. Returns `problems` — empty
 * means compliant. Exported so every arm has a control driven by a literal:
 * the violating shapes no longer exist in the tree (that is the point of the
 * fix), so without controls those branches would assert nothing.
 */
export function analyzeBoundary(src) {
  const code = stripComments(src);
  const problems = [];

  // --- RULE 1: no balance-ish key on the /api/v1/me projection -------------
  const meDecl = GET_ME_DECL.exec(code);
  if (!meDecl) {
    problems.push(
      'no `async function getMe(…): Promise<Type> {` this guard can read, so rule 1 ' +
        'is UNCHECKED rather than satisfied. Give the wrapper that shape, or widen ' +
        'this guard in the same commit.',
    );
  } else {
    const typeMatch = typeDecl(meDecl[1]).exec(code);
    const typeKeys = typeMatch ? keysOf(braceBody(code, typeMatch.index) ?? '') : null;
    const meBody = braceBody(code, meDecl.index) ?? '';
    const retMatch = /\breturn\s*\{/.exec(meBody);
    const retKeys = retMatch ? keysOf(braceBody(meBody, retMatch.index) ?? '') : null;

    if (typeKeys === null) {
      problems.push(
        `\`getMe\` returns \`Promise<${meDecl[1]}>\` with no local declaration of that ` +
          `type, so rule 1 cannot see what it admits.`,
      );
    }
    if (retKeys === null) {
      problems.push('`getMe` does not return an object literal, so rule 1 cannot read it.');
    }
    for (const [where, keys] of [
      [`type \`${meDecl[1]}\``, typeKeys],
      ['the `getMe` projection', retKeys],
    ]) {
      for (const key of keys ?? []) {
        if (!BALANCE_KEY.test(key)) continue;
        problems.push(
          `${where} declares \`${key}\`, sourced from \`/api/v1/me\`. That endpoint ` +
            `returns NO balance — the field is always \`undefined\`, which is how every ` +
            `starter shipped \`Buzz balance: —\`. And \`buzzLimit\`, which it DOES ` +
            `return, is a per-token SPEND CAP set at consent, not a balance. Read the ` +
            `balance with \`fetchBuzzAccount()\` instead.`,
        );
      }
    }
  }

  // --- RULE 2: the balance has a real source -------------------------------
  if (!/\bfetchBuzzAccount\s*\(/.test(code)) {
    problems.push(
      'this starter never calls `fetchBuzzAccount(`. The SDK helper exists, is tested, ' +
        'and hits `buzz.getUserAccount` — the only place a balance can be read. Without ' +
        'it there is nothing to render.',
    );
  }

  // --- RULE 3: absence is in the type --------------------------------------
  const reader = READER_DECL.exec(code);
  if (!reader) {
    problems.push(
      'no `async function getBuzzBalance(…): Promise<…> {`. The balance read must be a ' +
        'named function with a DECLARED return type, because that type is what forces ' +
        'callers to handle a missing balance.',
    );
  } else if (!/\bnull\b/.test(reader[1])) {
    problems.push(
      `\`getBuzzBalance\` returns \`Promise<${reader[1].trim()}>\`, which cannot express ` +
        `"no balance". A third-party client without the \`BuzzRead\` scope gets a 403 — ` +
        `an ORDINARY outcome, not an error — so the type must admit \`null\` and every ` +
        `caller must be made to handle it.`,
    );
  }

  return { problems };
}

/**
 * Rule 4 over one UI source that renders the balance row.
 *
 * Exported for the same reason: the tree no longer contains a violation.
 */
export function analyzeRowSite(src) {
  const problems = [];
  // Comments are NOT stripped for the placeholder scan on purpose: these files
  // now DESCRIBE the em-dash bug in prose, and stripping would be required for
  // a naive `includes('—')`. The pattern below is anchored to the rendered row
  // (`Buzz balance:` … `??`), which prose cannot form.
  const placeholder = /Buzz balance:[\s\S]{0,80}?\?\?\s*['"`]?(—|-|0|null|undefined|N\/A)/;
  if (placeholder.test(src)) {
    problems.push(
      'the balance row falls back to a PLACEHOLDER. `Buzz balance: —` is the bug ' +
        'verbatim — it reads as "your balance is unknown/broken" to a user whose client ' +
        'simply was not granted `BuzzRead`. Render nothing at all.',
    );
  }
  if (!/(!=\s*null|!==\s*null|!==\s*undefined)/.test(stripComments(src))) {
    problems.push(
      'no nullish guard in a file that renders the balance row. A 403 from ' +
        '`buzz.getUserAccount` must make the row DISAPPEAR, which needs an explicit ' +
        '`!= null` check around it.',
    );
  }
  return { problems };
}

/** Recursively enumerate source files under `dir`, skipping vendor trees. */
function walkSources(dir, exts = ['.ts', '.tsx', '.svelte']) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
          continue;
        }
        walk(full);
      } else if (entry.isFile() && exts.some((e) => entry.name.endsWith(e))) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** Every starter source that CALLS `fetchMe(` — discovered, not listed. */
export function meBoundaryFiles(root = join(REPO_ROOT, 'starters')) {
  return walkSources(root, ['.ts', '.tsx']).filter((file) =>
    /\bfetchMe\s*\(/.test(stripComments(readFileSync(file, 'utf8'))),
  );
}

/**
 * Every starter source that renders the signed-in `Buzz balance:` row.
 *
 * 🔴 ANCHORED ON THE MARKUP, NOT THE PHRASE, and NOT via `stripComments`.
 * The bare phrase appears in prose in all four `civitai.ts` boundary files
 * (they now quote `Buzz balance: —` when explaining the bug), so a phrase match
 * over-collects. Stripping comments is not the answer either: these files are
 * `.tsx`/`.svelte` whose JSX/markup text contains raw apostrophes
 * (`Couldn't load profile`), which a JS-string-aware lexer mis-parses. The
 * label immediately followed by `<strong>` is something only the rendered row
 * has, and something prose cannot accidentally form.
 */
export function rowSiteFiles(root = join(REPO_ROOT, 'starters')) {
  return walkSources(root).filter((file) =>
    /Buzz balance:\s*<strong>/.test(readFileSync(file, 'utf8')),
  );
}

/** Every starter source that binds `initialBalance=` on a component. */
export function initialBalanceSiteFiles(root = join(REPO_ROOT, 'starters')) {
  return walkSources(root).filter((file) =>
    /initialBalance=\{/.test(readFileSync(file, 'utf8')),
  );
}

const rel = (files) => files.map((f) => relative(REPO_ROOT, f)).sort();

test('POSITIVE CONTROL — every rule fires on its own violating shape, and the fixed shape passes', () => {
  const FIXED = `
import { fetchBuzzAccount, fetchMe } from '@civitai/app-sdk';
export interface MeResponse {
  username?: string;
}
export async function getMe(session: Session): Promise<MeResponse> {
  const raw = (await fetchMe({ accessToken: session.tokens.access_token })) as Record<string, unknown> | null;
  return {
    username: typeof raw?.username === 'string' ? raw.username : undefined,
  };
}
export async function getBuzzBalance(session: Session): Promise<number | null> {
  try {
    const accounts = await fetchBuzzAccount({ accessToken: session.tokens.access_token });
    return accounts[0]?.balance ?? null;
  } catch {
    return null;
  }
}`;
  assert.deepEqual(analyzeBoundary(FIXED).problems, [], 'the FIXED shape is reported as a violation');

  // RULE 1 — the exact pre-fix declaration + projection.
  const onMe = analyzeBoundary(
    FIXED.replace('  username?: string;\n}', '  username?: string;\n  balance?: number;\n}').replace(
      "    username: typeof raw?.username === 'string' ? raw.username : undefined,",
      "    username: typeof raw?.username === 'string' ? raw.username : undefined,\n    balance: typeof raw?.balance === 'number' ? raw.balance : undefined,",
    ),
  );
  assert.equal(onMe.problems.length, 2, `expected both rule-1 sites, got: ${onMe.problems}`);
  for (const p of onMe.problems) assert.match(p, /returns NO balance/);

  // RULE 1, THE DECOY — `buzzLimit` IS on /api/v1/me, so a "does the endpoint
  // return it" rule would pass this. It is a spend cap, not a balance.
  const decoy = analyzeBoundary(
    FIXED.replace('  username?: string;\n}', '  username?: string;\n  buzzLimit?: number;\n}').replace(
      "    username: typeof raw?.username === 'string' ? raw.username : undefined,",
      "    username: typeof raw?.username === 'string' ? raw.username : undefined,\n    buzzLimit: typeof raw?.buzzLimit === 'number' ? raw.buzzLimit : undefined,",
    ),
  );
  assert.equal(decoy.problems.length, 2, `expected both decoy sites, got: ${decoy.problems}`);
  for (const p of decoy.problems) assert.match(p, /SPEND CAP/);

  // RULE 2 — no source for the balance at all (the pre-fix tree, exactly).
  const noSource = analyzeBoundary(
    FIXED.replace("import { fetchBuzzAccount, fetchMe }", "import { fetchMe }")
      .replace(/export async function getBuzzBalance[\s\S]*$/, ''),
  );
  assert.ok(
    noSource.problems.some((p) => /never calls `fetchBuzzAccount\(`/.test(p)),
    `rule 2 did not fire: ${noSource.problems}`,
  );
  assert.ok(
    noSource.problems.some((p) => /no `async function getBuzzBalance/.test(p)),
    `rule 3 did not fire on a missing reader: ${noSource.problems}`,
  );

  // RULE 2 IS NOT SATISFIED BY A MENTION. `fetchBuzzAccount` is named in every
  // starter's own doc comments now; a guard reading raw text would be green on
  // a file that only TALKS about it.
  const mentionOnly = analyzeBoundary(
    FIXED.replace("import { fetchBuzzAccount, fetchMe }", "import { fetchMe }").replace(
      /export async function getBuzzBalance[\s\S]*$/,
      '// TODO: call fetchBuzzAccount({ accessToken }) one day\n',
    ),
  );
  assert.ok(
    mentionOnly.problems.some((p) => /never calls `fetchBuzzAccount\(`/.test(p)),
    `a commented-out call satisfied rule 2: ${mentionOnly.problems}`,
  );

  // RULE 3 — a reader whose type cannot express "no balance".
  const notNullable = analyzeBoundary(
    FIXED.replace('getBuzzBalance(session: Session): Promise<number | null>', 'getBuzzBalance(session: Session): Promise<number>'),
  );
  assert.equal(notNullable.problems.length, 1, `expected exactly rule 3, got: ${notNullable.problems}`);
  assert.match(notNullable.problems[0], /must admit `null`/);

  // UNREADABLE IS A VIOLATION, NOT A SKIP.
  const noGetMe = analyzeBoundary('const me = await fetchMe({});');
  assert.ok(noGetMe.problems.some((p) => /UNCHECKED rather than satisfied/.test(p)));
});

test('POSITIVE CONTROL — rule 4 fires on the placeholder row and on a missing nullish guard', () => {
  const DASHED = `<p>Buzz balance: <strong>{me.balance ?? '—'}</strong></p>`;
  const r = analyzeRowSite(DASHED);
  assert.ok(r.problems.some((p) => /PLACEHOLDER/.test(p)), `rule 4 missed the dash: ${r.problems}`);

  for (const fallback of ["?? '-'", '?? 0', '?? null', '?? undefined', "?? 'N/A'"]) {
    const src = `<p>Buzz balance: <strong>{me.balance ${fallback}}</strong></p>`;
    assert.ok(
      analyzeRowSite(src).problems.some((p) => /PLACEHOLDER/.test(p)),
      `rule 4 missed the fallback spelling: ${fallback}`,
    );
  }

  // The FIXED shape passes — a rule nobody can satisfy gets deleted.
  const FIXED = `{buzzBalance != null && (<p>Buzz balance: <strong>{buzzBalance}</strong></p>)}`;
  assert.deepEqual(analyzeRowSite(FIXED).problems, [], 'the fixed row is reported as a violation');

  // And a guarded row with NO nullish check is still a violation.
  const unguarded = analyzeRowSite(`<p>Buzz balance: <strong>{buzzBalance}</strong></p>`);
  assert.ok(
    unguarded.problems.some((p) => /no nullish guard/.test(p)),
    `a row with no guard passed: ${unguarded.problems}`,
  );
});

test('POSITIVE CONTROL — every scan finds a NON-ZERO set, and fails loudly when pointed at nothing', () => {
  // 🔴 THE ZERO CONTROL. A renamed file or a broken pattern produces an EMPTY
  // set, and an empty set has no violations.
  const nowhere = join(REPO_ROOT, 'starters-does-not-exist');
  for (const [label, fn] of [
    ['meBoundaryFiles', meBoundaryFiles],
    ['rowSiteFiles', rowSiteFiles],
    ['initialBalanceSiteFiles', initialBalanceSiteFiles],
  ]) {
    assert.ok(fn().length > 0, `${label} found nothing in the real tree`);
    assert.deepEqual(fn(nowhere), [], `${label} invented files under a nonexistent root`);
  }
});

test('RULE 1-3 — every starter reads the balance from buzz.getUserAccount, never from /api/v1/me', () => {
  const files = meBoundaryFiles();
  const rels = rel(files);
  assert.ok(
    rels.length >= KNOWN_BOUNDARIES.length,
    `the boundary scan found ${rels.length} file(s); ${KNOWN_BOUNDARIES.length} are known ` +
      `to exist. Found:\n  ${rels.join('\n  ') || '(none)'}`,
  );
  for (const required of KNOWN_BOUNDARIES) {
    assert.ok(rels.includes(required), `the scan does not reach ${required}. Found:\n  ${rels.join('\n  ')}`);
  }

  const offenders = [];
  let checked = 0;
  for (const file of files) {
    const { problems } = analyzeBoundary(readFileSync(file, 'utf8'));
    if (problems.length === 0) {
      checked += 1;
      continue;
    }
    for (const p of problems) offenders.push(`${relative(REPO_ROOT, file)} — ${p}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `A starter is sourcing its Buzz balance from an endpoint that does not return one.\n\n` +
      `    ${offenders.join('\n    ')}\n`,
  );
  assert.equal(checked, files.length, `examined ${checked} of ${files.length} boundaries`);
});

test('RULE 4-5 — the balance row exists in every starter, degrades to nothing, and keeps its second site', () => {
  assert.deepEqual(
    rel(rowSiteFiles()),
    [...ROW_SITES].sort(),
    'the set of files rendering the `Buzz balance:` row changed. Growing is fine once you ' +
      'add it here; SHRINKING means a starter silently lost the feature this fix exists to ' +
      'deliver.',
  );

  assert.deepEqual(
    rel(initialBalanceSiteFiles()),
    [...INITIAL_BALANCE_SITES].sort(),
    'the set of `initialBalance={…}` bindings changed. This is the SECOND display of the ' +
      'balance (the cost-preview line) and it renders NOTHING when the value is absent — ' +
      'so if it goes missing, no screenshot and no reviewer will ever notice.',
  );

  const offenders = [];
  let checked = 0;
  for (const file of rowSiteFiles()) {
    const { problems } = analyzeRowSite(readFileSync(file, 'utf8'));
    if (problems.length === 0) {
      checked += 1;
      continue;
    }
    for (const p of problems) offenders.push(`${relative(REPO_ROOT, file)} — ${p}`);
  }
  assert.deepEqual(offenders, [], `\n    ${offenders.join('\n    ')}\n`);
  assert.equal(checked, ROW_SITES.length, `examined ${checked} of ${ROW_SITES.length} row sites`);
});

test('RULE 6 — the expired-session probe stubs the REAL /api/v1/me response', () => {
  const path = join(REPO_ROOT, PROBE);
  assert.ok(existsSync(path), `${PROBE} is missing — it is the only CI check that answers /api/v1/me`);
  const code = stripComments(readFileSync(path, 'utf8'));

  // The stub payload: the object handed to JSON.stringify inside the
  // `/api/v1/me` branch. Read from the branch guard to the end of that
  // `res.end(` call, so the sibling buzz branch (which legitimately DOES carry
  // a balance) is not scanned.
  const start = code.indexOf("'/api/v1/me'");
  assert.notEqual(start, -1, 'the probe no longer has an /api/v1/me branch this guard can find');
  const next = code.indexOf("'/api/trpc/buzz.getUserAccount'", start);
  const stub = code.slice(start, next === -1 ? code.length : next);

  assert.ok(
    !/\bbalance\b/.test(stub),
    'the probe stubs a `balance` on `/api/v1/me`. The real endpoint has never returned ' +
      'one, and this stub is the only place in CI that answers it — so it teaches the ' +
      'wrong contract to every reader and to every future assertion written against it. ' +
      'It is how the four starters came to read `balance` from the wrong endpoint.\n\n' +
      `stub:\n${stub.trim()}`,
  );

  // POSITIVE CONTROL for the slice: the region really does contain the fields
  // the endpoint DOES return, so a zero above is not a fact about an empty
  // slice.
  for (const field of ['username', 'subscriptions', 'isMember']) {
    assert.ok(stub.includes(field), `the scanned /api/v1/me stub region is missing \`${field}\` — the slice is wrong, not the stub`);
  }

  // And the buzz branch must be there at all, or scenarios C/D/E are vacuous.
  assert.ok(
    code.includes("'/api/trpc/buzz.getUserAccount'"),
    'the probe no longer stubs buzz.getUserAccount, so its balance scenarios cannot run',
  );
});
