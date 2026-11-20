/**
 * Guards the `/api/v1/me` FETCH BOUNDARY in every standalone starter: the
 * upstream response must be PROJECTED down to the fields the app renders, and
 * the type that names that projection must be CLOSED.
 *
 * WHY THIS EXISTS (#389)
 * ======================
 * `starters/sveltekit-app/src/routes/+page.server.ts` returned the result of
 * `getMe()` from its `load` function unprojected. SvelteKit serialises EXACTLY
 * what `load` returns into the SSR payload embedded in the delivered HTML, so
 * every field `/api/v1/me` happens to return was public to anyone who could
 * read the page — while the page itself rendered two of them (`username`,
 * `balance`).
 *
 * 🔴 THE INVISIBILITY WAS THE INDEX SIGNATURE, not a missing field. All four
 * starters declared
 *
 *     export interface MeResponse {
 *       id?: number; username?: string; balance?: number;
 *       [key: string]: unknown;          // <- this
 *     }
 *
 * and `getMe` did `(await fetchMe(...)) as MeResponse` — A CAST, NOT A
 * PROJECTION. A cast renames the object; it does not rebuild it. So the runtime
 * object held everything upstream sent, the type ADMITTED everything upstream
 * sent, and neither a reader nor `tsc` could answer "what ships?". (The issue
 * guessed the leak was `email`; `next-app` was the only starter that even
 * DECLARED `email` — the index signature is worse than a named field precisely
 * because nothing can tell you what it covers.)
 *
 * WHAT THIS PINS, AND WHY IT IS THREE RULES RATHER THAN ONE
 * ========================================================
 * For every starter source that calls `fetchMe(`:
 *
 *   1. CLOSED TYPE — `getMe`'s declared return type has no index signature.
 *   2. REAL PROJECTION — `getMe` returns an OBJECT LITERAL. A `return x as T`
 *      satisfies rule 1 while leaving every upstream field on the object, which
 *      is the exact pre-fix shape.
 *   3. THEY AGREE — the literal's key set EQUALS the type's key set. This is
 *      the relationship the other two cannot express on their own: rule 1
 *      without rule 3 lets a closed type UNDERSTATE a wider projection (a type
 *      that lies is worse than an honest index signature, because it reads as
 *      a safety claim), and rule 2 without rule 3 is satisfied by a literal
 *      built with a spread.
 *
 * Silence is not compliance: a boundary this guard cannot PARSE is reported as
 * a violation, never skipped, and the boundary set's size is asserted — see
 * COVERAGE FLOOR below.
 *
 * 🔴 DELIBERATE DEPARTURE FROM #389's STATED CLOSING CONDITION. The issue asked
 * for "a test that renders the page with a fixture `me` containing a sentinel
 * value in a non-rendered field and asserts the sentinel does not appear in the
 * HTML". That needs a browser, a running SvelteKit server AND an authenticated
 * OAuth session; `sveltekit-app` ships Playwright e2e only (which needs a live
 * Civitai dev server with the `testing-login` provider) and no unit runner, so
 * the sentinel route means adding a test runner to a template developers copy
 * verbatim. This check is cheaper AND strictly stronger on the thing that
 * matters: SvelteKit serialises exactly what `load` returns, and after the fix
 * the unprojected object cannot reach `load` at all — it does not exist past
 * `getMe`. A sentinel test would have proved one route safe on one render; this
 * proves no route in any starter can forward the upstream object.
 *
 * 🔴 KNOWN LIMITS — state them, because a rule that reads as "no starter can
 * ever leak" while checking four files is the failure mode this repo keeps
 * finding:
 *   - SCOPE IS `fetchMe(` IN A STARTER `.ts`/`.tsx`. Another upstream endpoint
 *     wrapped the same careless way (`/api/v1/models`, a raw `callOrchestrator`
 *     whose response is returned wholesale) is NOT covered. The rule is about
 *     the `me` boundary because that is the one carrying account PII.
 *   - IT READS TEXT, NOT TYPES. `interface MeResponse extends Upstream` would
 *     re-open the type through the supertype and this guard would not see it;
 *     so would a type alias to an imported type (reported as unreadable, since
 *     no local declaration is found). `tsc` is what checks the projection
 *     COMPILES; this checks its SHAPE.
 *   - `.svelte` / `.tsx` COMPONENT bodies are scanned only for the `fetchMe(`
 *     call that puts a file in scope. The projection itself must live in a
 *     `getMe` function, which is the shape all four starters use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { stripComments } from './lib/strip-comments.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The starters that have a `/api/v1/me` boundary today. Asserted as a SUBSET of
 * what the walk finds, never used INSTEAD of the walk: a new starter is covered
 * automatically, and a rename that takes one out of scope fails here rather
 * than silently shrinking the scan to nothing.
 */
const KNOWN_BOUNDARIES = [
  'starters/next-app/src/lib/civitai.ts',
  'starters/react-pwa/server/civitai.ts',
  'starters/svelte-pwa/server/civitai.ts',
  'starters/sveltekit-app/src/lib/civitai.ts',
];

/**
 * An index signature in any of its spellings. This is the thing the fix
 * REMOVED, so the detector has to fire on the exact pre-fix text and on the
 * variants someone would reach for next.
 */
const INDEX_SIGNATURE = /\[\s*[A-Za-z_$][\w$]*\s*(?:in\s+[^\]]+|:\s*(?:string|number|symbol))\s*\]\s*\??\s*:/;

/** `export async function getMe(…): Promise<Name> {` */
const GET_ME_DECL =
  /(?:export\s+)?async\s+function\s+getMe\s*\([^)]*\)\s*:\s*Promise\s*<\s*([A-Za-z_$][\w$]*)\s*>\s*\{/;

/** `interface Name {` / `type Name = {` — the local declaration of that type. */
const typeDecl = (name) =>
  new RegExp(`(?:interface\\s+${name}\\s*|type\\s+${name}\\s*=\\s*)\\{`);

/**
 * Body of the brace-delimited block whose opening `{` is at or after `from`.
 * Returns `{ body, open, close }` or null.
 *
 * Brace counting, not a parser: correct for the regions it is pointed at (a
 * TypeScript interface body and a `return { … }` literal), neither of which
 * contains a `{` inside a string or template literal in any starter. Comments
 * are already gone — {@link stripComments} runs first.
 */
function braceBody(code, from) {
  const open = code.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: code.slice(open + 1, i), open, close: i };
    }
  }
  return null;
}

/**
 * Split a member/property list on its TOP-LEVEL separators (`,` and `;`),
 * ignoring any that sit inside brackets. The projections this checks are
 * written as ternaries (`typeof raw?.username === 'string' ? raw.username :
 * undefined`), so a naive split on `:` or a depth-blind split on `,` would
 * mis-read them.
 */
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

/**
 * The declared/assigned KEYS of a member list, sorted. Index signatures are
 * NOT keys and are excluded here — rule 1 reports them separately, and letting
 * one through as a key named `[key` would make the rule-3 comparison fail for
 * the wrong reason.
 *
 * Exported so the controls can drive it directly.
 */
export function keysOf(body) {
  const keys = [];
  for (const part of topLevelParts(body)) {
    if (INDEX_SIGNATURE.test(part)) continue;
    if (part.startsWith('...')) {
      // A SPREAD is the one shape that looks like a projection and is not one:
      // `{ ...raw, balance }` re-admits every upstream field. Surface it as a
      // key so rule 3 cannot compare EQUAL to a closed type.
      keys.push(part.replace(/\s+/g, ''));
      continue;
    }
    const key = part.split(':')[0].trim().replace(/\?$/, '').replace(/^['"`]|['"`]$/g, '');
    if (key) keys.push(key);
  }
  return keys.sort();
}

/**
 * Analyse one starter source that calls `fetchMe(`. Returns
 * `{ typeName, typeKeys, returnedKeys, problems }` — `problems` empty means
 * the boundary satisfies all three rules.
 *
 * Exported so every arm has a control that drives it with a literal: three of
 * the four problem shapes do not exist in the tree (that is the point of the
 * fix), so without these they would be unreachable code asserting nothing.
 *
 * @param {string} src RAW source; comments are stripped here.
 */
export function analyzeBoundary(src) {
  const code = stripComments(src);
  const problems = [];

  const decl = GET_ME_DECL.exec(code);
  if (!decl) {
    return {
      problems: [
        'no `async function getMe(…): Promise<Type> {` this guard can read. It calls ' +
          '`fetchMe(`, so it IS a `/api/v1/me` boundary — but the projection cannot be ' +
          'located, which means it is UNCHECKED rather than compliant. Give the wrapper ' +
          'that shape, or widen this guard in the same commit.',
      ],
    };
  }
  const typeName = decl[1];

  const typeMatch = typeDecl(typeName).exec(code);
  if (!typeMatch) {
    return {
      typeName,
      problems: [
        `\`getMe\` returns \`Promise<${typeName}>\` but there is no local ` +
          `\`interface ${typeName} { … }\` / \`type ${typeName} = { … }\` in the same file. ` +
          `An imported or inherited type can re-open the projection where this guard ` +
          `cannot see it.`,
      ],
    };
  }
  const typeBody = braceBody(code, typeMatch.index);
  if (!typeBody) {
    return { typeName, problems: [`could not read the body of \`${typeName}\``] };
  }

  // RULE 1 — the type is CLOSED.
  if (INDEX_SIGNATURE.test(typeBody.body)) {
    problems.push(
      `\`${typeName}\` carries an INDEX SIGNATURE, so it admits every field the upstream ` +
        `endpoint returns and nothing — not a reader, not \`tsc\` — can say what this app ` +
        `holds or serialises. This is the #389 shape verbatim. Declare only the fields the ` +
        `app renders.`,
    );
  }

  // RULE 2 — `getMe` PROJECTS: it returns an object literal, not a cast.
  const fnBody = braceBody(code, decl.index);
  const returnLiteral = fnBody && /\breturn\s*\{/.exec(fnBody.body);
  if (!returnLiteral) {
    problems.push(
      '`getMe` does not return an OBJECT LITERAL. `return (await fetchMe(…)) as ' +
        `${typeName}\` is the #389 shape: a cast renames the upstream object, it does not ` +
        'rebuild it, so every field it carries is still there at runtime and still ' +
        'serialisable. Pick the fields explicitly into a new object.',
    );
    return { typeName, typeKeys: keysOf(typeBody.body), problems };
  }

  const literal = braceBody(fnBody.body, returnLiteral.index);
  const typeKeys = keysOf(typeBody.body);
  const returnedKeys = keysOf(literal.body);

  // RULE 3 — the projection and the type AGREE.
  if (returnedKeys.join(',') !== typeKeys.join(',')) {
    problems.push(
      `the projection and the type disagree: \`getMe\` returns [${returnedKeys}] but ` +
        `\`${typeName}\` declares [${typeKeys}]. The type is the reviewable statement of ` +
        `what this app holds, so it must be neither wider nor narrower than what is ` +
        `actually built.`,
    );
  }

  return { typeName, typeKeys, returnedKeys, problems };
}

/** Recursively enumerate `.ts`/`.tsx` files under `dir`, skipping vendor trees. */
function walkSources(dir) {
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
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Every starter source that CALLS `fetchMe(` — the `/api/v1/me` boundaries.
 *
 * Discovered, not listed, so a new starter is covered the day it is added. The
 * call must survive {@link stripComments}: `fetchMe` is named in several
 * starters' prose (AGENTS.md is not scanned, but doc comments in these very
 * files are), and a MENTION is not a boundary.
 *
 * `root` is a parameter so a control can point the walk somewhere empty and
 * prove the floor assertion fires — a scan that finds nothing reports `[]`
 * identically to a scan that finds four clean files.
 */
export function meBoundaryFiles(root = join(REPO_ROOT, 'starters')) {
  return walkSources(root).filter((file) =>
    /\bfetchMe\s*\(/.test(stripComments(readFileSync(file, 'utf8'))),
  );
}

/** Assert the scan reached the boundaries it claims to check. Throws if not. */
export function assertBoundaryFloor(files) {
  const rels = files.map((f) => relative(REPO_ROOT, f));
  assert.ok(
    rels.length >= KNOWN_BOUNDARIES.length,
    `the \`/api/v1/me\` boundary scan found ${rels.length} file(s); ` +
      `${KNOWN_BOUNDARIES.length} are known to exist. A scan that finds nothing reports ` +
      `"no violations" — identical to a clean tree. Found:\n  ${rels.join('\n  ') || '(none)'}`,
  );
  for (const required of KNOWN_BOUNDARIES) {
    assert.ok(
      rels.includes(required),
      `the boundary scan does not reach ${required}. Either the file moved (update ` +
        `KNOWN_BOUNDARIES in the same commit) or the \`fetchMe(\` call it is found by is ` +
        `gone. Found:\n  ${rels.join('\n  ')}`,
    );
  }
  return rels;
}

test('POSITIVE CONTROL — the index-signature detector fires on real shapes, and not on prose', () => {
  // The exact pre-fix declaration, verbatim from `sveltekit-app` at 8b1c098.
  const prefix = `
export interface MeResponse {
  id?: number;
  username?: string;
  balance?: number;
  [key: string]: unknown;
}`;
  assert.ok(INDEX_SIGNATURE.test(prefix), 'the detector does not fire on the #389 declaration');

  // And on the spellings someone reaches for next. If any of these stops
  // matching, the real scan below still reports zero and looks clean.
  for (const shape of [
    '[k: string]: unknown;',
    '[key : string] : any;',
    '[index: number]: unknown;',
    '[sym: symbol]: unknown;',
    '[K in keyof Upstream]: unknown;',
    '[key: string]?: unknown;',
  ]) {
    assert.ok(INDEX_SIGNATURE.test(shape), `the detector missed an index signature: ${shape}`);
  }

  // NEGATIVE CONTROL — the fixed declarations must not trip it, or the rule is
  // unsatisfiable and gets deleted by the next person who hits it.
  for (const clean of [
    'username?: string;\n  balance?: number;',
    'const keys = obj[key];',
    'balance?: number;',
  ]) {
    assert.ok(!INDEX_SIGNATURE.test(clean), `the detector over-reported on: ${clean}`);
  }

  // 🔴 AND IT MUST NOT FIRE ON THE DOC COMMENTS THE FIX ITSELF ADDED. All four
  // guarded files now quote `[key: string]: unknown` in prose explaining why it
  // is absent. A guard that read raw source would be red on the fix that
  // satisfies it — so comment stripping is load-bearing here, not hygiene.
  const documented = `
/** CLOSED ON PURPOSE: no \`[key: string]: unknown\` index signature. */
export interface MeResponse {
  username?: string;
}`;
  assert.ok(
    !INDEX_SIGNATURE.test(stripComments(documented)),
    'an index signature MENTIONED in a doc comment is read as a real one — the guard is ' +
      'matching prose, so it can be both walked and falsely tripped by a reword',
  );
  assert.ok(
    INDEX_SIGNATURE.test(documented),
    'this control is vacuous unless the raw text really does contain the pattern',
  );
});

test('POSITIVE CONTROL — every rule fires on its own shape, and the fixed shape passes', () => {
  const FIXED = `
import { fetchMe } from '@civitai/app-sdk';
export interface MeResponse {
  username?: string;
  balance?: number;
}
export async function getMe(session: Session): Promise<MeResponse> {
  const raw = (await fetchMe({ accessToken: session.tokens.access_token })) as Record<string, unknown> | null;
  return {
    username: typeof raw?.username === 'string' ? raw.username : undefined,
    balance: typeof raw?.balance === 'number' ? raw.balance : undefined,
  };
}`;
  const fixed = analyzeBoundary(FIXED);
  assert.deepEqual(fixed.problems, [], 'the FIXED shape is reported as a violation');
  assert.deepEqual(fixed.typeKeys, ['balance', 'username']);
  assert.deepEqual(fixed.returnedKeys, ['balance', 'username']);

  // RULE 1 — an index signature, projection otherwise intact.
  const open = analyzeBoundary(FIXED.replace('  balance?: number;', '  balance?: number;\n  [key: string]: unknown;'));
  assert.equal(open.problems.length, 1, `expected exactly the rule-1 problem, got: ${open.problems}`);
  assert.match(open.problems[0], /INDEX SIGNATURE/);

  // RULE 2 — the #389 cast. This is the shape a "closed type" rule alone
  // cannot see: the type is fine and every upstream field still ships.
  const cast = analyzeBoundary(`
import { fetchMe } from '@civitai/app-sdk';
export interface MeResponse {
  username?: string;
  balance?: number;
}
export async function getMe(session: Session): Promise<MeResponse> {
  return (await fetchMe({ accessToken: session.tokens.access_token })) as MeResponse;
}`);
  assert.equal(cast.problems.length, 1, `expected exactly the rule-2 problem, got: ${cast.problems}`);
  assert.match(cast.problems[0], /does not return an OBJECT LITERAL/);

  // RULE 3, WIDER — the projection carries a field the type does not declare.
  // The closed type reads as a safety claim and is simply false.
  const wider = analyzeBoundary(
    FIXED.replace(
      '    balance: typeof raw?.balance === ',
      '    email: typeof raw?.email === \'string\' ? raw.email : undefined,\n    balance: typeof raw?.balance === ',
    ),
  );
  assert.equal(wider.problems.length, 1, `expected exactly the rule-3 problem, got: ${wider.problems}`);
  assert.match(wider.problems[0], /projection and the type disagree/);
  assert.match(wider.problems[0], /email/);

  // RULE 3, SPREAD — the literal that looks like a projection and is not one.
  // `{ ...raw }` re-admits every upstream field while satisfying rules 1 and 2.
  const spread = analyzeBoundary(
    FIXED.replace('  return {', '  return {\n    ...raw,'),
  );
  assert.equal(spread.problems.length, 1, `expected exactly the rule-3 problem, got: ${spread.problems}`);
  assert.match(spread.problems[0], /\.\.\.raw/);

  // RULE 3, NARROWER — the type declares a field the projection never builds.
  const narrower = analyzeBoundary(FIXED.replace('  username?: string;\n', '  username?: string;\n  id?: number;\n'));
  assert.equal(narrower.problems.length, 1, `expected exactly the rule-3 problem, got: ${narrower.problems}`);
  assert.match(narrower.problems[0], /disagree/);

  // UNREADABLE IS A VIOLATION, NOT A SKIP — the three shapes that would
  // otherwise leave a boundary unchecked while the suite stays green.
  for (const [label, src, expected] of [
    ['no getMe wrapper', 'const me = await fetchMe({});', /cannot be located/],
    [
      'the type is imported rather than declared',
      "import type { MeResponse } from './types';\nexport async function getMe(s: Session): Promise<MeResponse> {\n  return { username: undefined };\n}",
      /no local/,
    ],
    [
      'getMe has no declared return type',
      'export async function getMe(s: Session) {\n  return { username: undefined };\n}',
      /cannot be located/,
    ],
  ]) {
    const r = analyzeBoundary(src);
    assert.ok(r.problems.length > 0, `an unreadable boundary was silently accepted: ${label}`);
    assert.match(r.problems[0], expected, `wrong diagnosis for: ${label}`);
  }
});

test('POSITIVE CONTROL — the key extractor reads ternary projections and interface bodies', () => {
  // A depth-blind split on `:` reads `typeof raw?.username === 'string' ? … : …`
  // as a key named `typeof raw?.username === 'string' ? raw.username`. If this
  // ever regresses, rule 3 fails everywhere for the wrong reason.
  assert.deepEqual(
    keysOf(
      "\n    username: typeof raw?.username === 'string' ? raw.username : undefined,\n" +
        '    balance: typeof raw?.balance === \'number\' ? raw.balance : undefined,\n  ',
    ),
    ['balance', 'username'],
  );
  assert.deepEqual(keysOf('\n  username?: string;\n  balance?: number;\n'), ['balance', 'username']);
  // An index signature is not a key — it is rule 1's business.
  assert.deepEqual(keysOf('\n  username?: string;\n  [key: string]: unknown;\n'), ['username']);
  // A spread IS surfaced, so rule 3 cannot compare equal past one.
  assert.deepEqual(keysOf('\n    ...raw,\n    balance,\n  '), ['...raw', 'balance']);
});

test('POSITIVE CONTROL — the boundary scan finds a NON-ZERO number of boundaries, and fails loudly when pointed at nothing', () => {
  const rels = assertBoundaryFloor(meBoundaryFiles());
  assert.ok(rels.length > 0, 'the scan found zero `/api/v1/me` boundaries');

  // 🔴 THE ZERO CONTROL. A renamed file, a moved starters/ directory or a
  // broken `fetchMe(` pattern all produce an EMPTY set, and an empty set has
  // no violations. Pointed at a path that does not exist, the floor must
  // THROW rather than report a clean run.
  const bogus = meBoundaryFiles(join(REPO_ROOT, 'starters-does-not-exist'));
  assert.deepEqual(bogus, [], 'the walk invented files under a nonexistent root');
  assert.throws(
    () => assertBoundaryFloor(bogus),
    /boundary scan found 0 file/,
    'an empty boundary set passed the floor — a zero from this guard is then ' +
      'indistinguishable from a clean tree',
  );
});

test('RULE — every starter `/api/v1/me` boundary projects into a CLOSED type', () => {
  const files = meBoundaryFiles();
  assertBoundaryFloor(files);

  const offenders = [];
  const checked = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const { problems, typeName, typeKeys } = analyzeBoundary(readFileSync(file, 'utf8'));
    if (problems.length === 0) {
      checked.push(`${rel} — ${typeName} { ${typeKeys.join(', ')} }`);
      continue;
    }
    for (const p of problems) offenders.push(`${rel} — ${p}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `A starter holds more of the \`/api/v1/me\` response than it renders.\n\n` +
      `The upstream object must be PROJECTED at the fetch boundary, into a type with no\n` +
      `index signature, whose key set matches what is actually built. Projecting at the\n` +
      `call site instead fixes one route and leaves the same defect one file away — which\n` +
      `is exactly how #389 shipped: \`sveltekit-app\`'s \`load\` returned the unprojected\n` +
      `object and SvelteKit serialised all of it into the delivered HTML.\n\n` +
      `    ${offenders.join('\n    ')}\n`,
  );

  // The coverage claim, asserted rather than assumed: the deepEqual above
  // reports `[]` whether it examined four boundaries or none.
  assert.equal(
    checked.length,
    files.length,
    `examined ${checked.length} of ${files.length} boundaries:\n  ${checked.join('\n  ')}`,
  );
});
