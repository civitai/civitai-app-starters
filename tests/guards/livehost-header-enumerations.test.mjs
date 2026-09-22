/**
 * Guards that the two enumerations in `liveHost.ts`'s header are MEASURED from
 * the file's own contents rather than typed, and still agree with it.
 *
 * WHY THIS EXISTS (#387, #14)
 * ===========================
 * The header carried two exhaustive-sounding claims, both written early and
 * neither re-measured as the file tripled in size:
 *
 *   1. "the only network it does is (a) `GET /api/v1/blocks/me` and (b) the
 *      four `blocks.{estimate,submit,poll,cancel}Workflow` tRPC mutations"
 *      — by the time #387 was filed the file called 29 tRPC procedures. The
 *      header itself listed several of them twenty lines further down, so the
 *      file contradicted its own claim in its own header.
 *
 *   2. "SCOPE — the ONE capability live mode cannot SERVE is OPEN_BUZZ_PURCHASE"
 *      — five other handlers already refused. (Corrected by #386/#410 before
 *      this guard landed; the bullet list it left behind was still typed, so it
 *      was one release away from drifting again. That is what this pins.)
 *
 * Neither claim was wrong when written. Both went wrong by the file moving
 * underneath them, which is the failure mode a typed list cannot survive and a
 * test can. `tsc` sees nothing here: a comment is not a code path.
 *
 * WHAT IT PINS
 * ============
 *   1. THE DERIVED BLOCK — the `--- BEGIN DERIVED ---` region of the header is
 *      REGENERATED from the source and compared as ONE normalised string. Not a
 *      keyword, not a count in isolation: a guard on a word is walkable by
 *      rewording, so the whole claim is pinned and a drift fails with the exact
 *      replacement text to paste.
 *
 *   2. THE REFUSAL BULLETS — the `• NAME — reason` rows under SCOPE are exactly
 *      the set of handlers that answer the block LOCALLY without touching the
 *      network, minus the declared {@link SERVED_LOCALLY} ledger. SET EQUALITY,
 *      so it fails when the set GROWS (a new refusal nobody documented) *or*
 *      SHRINKS (a bullet whose handler now really serves).
 *
 * 🔴 KNOWN LIMITS:
 *   - The refusal set is derived STRUCTURALLY (does the case body reach the
 *     network / the picker overlay / `dispatchToBlock`?), not from the prose.
 *     It proves a handler answers locally, never that the answer is an HONEST
 *     refusal rather than a fabricated success — `liveHost.test.tsx` owns that.
 *   - It reads source text, so a handler that reaches the network through some
 *     future third helper would be misread as a refusal. That is why the
 *     chokepoint COUNT is part of the derived block: adding a third `fetchImpl`
 *     call site fails test 1 and sends the next reader here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE_HOST = 'packages/civitai-blocks-react/src/internal/liveHost.ts';

/**
 * Cases that answer the block locally and are SERVING, not refusing. The only
 * legitimate row: `REQUEST_TOKEN` echoes the pasted dev token back, which is
 * the whole of what the live host owes that message — there is nothing to
 * fetch. Every other locally-answered case is a refusal, and must be one of the
 * bullets under SCOPE.
 *
 * 🔴 This ledger is itself asserted (test 3): a row that no longer answers
 * locally fails rather than silently shrinking the derived refusal set.
 */
const SERVED_LOCALLY = ['REQUEST_TOKEN'];

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const sorted = (xs) => [...xs].sort();

// ---------------------------------------------------------------------------
// EXTRACTORS — each is exported so the controls below can feed it a fixture.
// ---------------------------------------------------------------------------

/**
 * `case '<TYPE>':` blocks of the dispatch switch, each with its body text.
 *
 * 🔴 The LAST case is bounded at the switch's `default:`, not at EOF. Running
 * it to EOF swept in `teardown`, `Object.defineProperty` and every helper below
 * the switch, which silently reclassified the final case by whatever those
 * happened to call — a misread that depends on which handler someone appends
 * last. The control below pins this.
 */
export function caseBlocks(src) {
  const hits = [...src.matchAll(/^[ \t]+case '([A-Z][A-Z0-9_]*)':/gm)];
  const defaultAt = src.search(/^[ \t]+default:$/m);
  const end = defaultAt === -1 ? src.length : defaultAt;
  return hits.map((hit, i) => ({
    label: hit[1],
    body: src.slice(hit.index + hit[0].length, i + 1 < hits.length ? hits[i + 1].index : end),
  }));
}

/** Distinct tRPC procedure names passed to the two call helpers. */
export function trpcProcedures(src) {
  return sorted(
    new Set(
      [...src.matchAll(/callTrpc(?:Mutation|Data)\(\s*'([a-zA-Z][A-Za-z0-9.]*)'/g)].map(
        (m) => m[1],
      ),
    ),
  );
}

/** Distinct REST paths fetched directly (i.e. not through the tRPC chokepoint). */
export function restEndpoints(src) {
  return sorted(
    new Set([...src.matchAll(/fetchImpl\(\s*`\$\{baseUrl\}(\/api\/[^`?]*)`/g)].map((m) => m[1])),
  );
}

/** How many places in this file actually call `fetch`. */
export function fetchChokepoints(src) {
  return [...src.matchAll(/\bfetchImpl\(/g)].length;
}

/**
 * Cases that reply to the block without any network call and without opening
 * the picker overlay — i.e. the host answers out of its own head. Minus
 * {@link SERVED_LOCALLY}, this is the REFUSAL set.
 */
export function derivedRefusals(src) {
  const network = /\b(?:callTrpcMutation|callTrpcData|rawTrpcCall|fetchImpl|pollWithRetry)\(/;
  const picker = /\bopenPicker\(/;
  const replies = /\bdispatchToBlock\(/;
  return sorted(
    caseBlocks(src)
      .filter((c) => replies.test(c.body) && !network.test(c.body) && !picker.test(c.body))
      .map((c) => c.label)
      .filter((label) => !SERVED_LOCALLY.includes(label)),
  );
}

/** Cases that reply locally, refusals and `SERVED_LOCALLY` alike. */
export function locallyAnswered(src) {
  return sorted([...derivedRefusals(src), ...SERVED_LOCALLY]);
}

/**
 * The leading `/** … *\/` block comment — the header, and nothing else. Scoping
 * the bullet reader to it keeps a `•` written anywhere in the 2,000 lines of
 * handlers below from registering as a documented refusal.
 */
export function headerComment(src) {
  const end = src.indexOf('\n */');
  return end === -1 ? '' : src.slice(0, end + 4);
}

/** The `• NAME — reason` capability names typed under the header's SCOPE section. */
export function headerRefusalBullets(src) {
  return sorted(
    [...headerComment(src).matchAll(/^[ \t]*\*[ \t]+•[ \t]+([A-Z][A-Z0-9_]*)[ \t]+—/gm)].map(
      (m) => m[1],
    ),
  );
}

/** The header's derived region, as lines, with comment leader and padding stripped. */
export function headerDerivedBlock(src) {
  const m = src.match(/^[ \t]*\*[ \t]*--- BEGIN DERIVED ---[ \t]*$([\s\S]*?)^[ \t]*\*[ \t]*--- END DERIVED ---[ \t]*$/m);
  if (!m) return null;
  return m[1]
    .split('\n')
    .map((line) => line.replace(/^[ \t]*\*[ \t]?/, '').trimEnd())
    .filter((line) => line.length > 0);
}

/** What the header's derived region MUST say, computed from the source. */
export function renderDerivedBlock(src) {
  const procs = trpcProcedures(src);
  // Group by namespace (everything before the final segment), biggest first so
  // the rendering is deterministic regardless of insertion order.
  const groups = new Map();
  for (const p of procs) {
    const ns = p.slice(0, p.lastIndexOf('.'));
    groups.set(ns, (groups.get(ns) ?? 0) + 1);
  }
  const breakdown = [...groups.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ns, n]) => `${ns}.* (${n})`)
    .join(' + ');
  const cases = caseBlocks(src).length;
  const refusals = derivedRefusals(src).length;
  return [
    `fetch chokepoints ..... ${fetchChokepoints(src)}`,
    `REST endpoints ........ ${restEndpoints(src)
      .map((p) => `GET ${p}`)
      .join(', ')}`,
    `tRPC procedures ....... ${procs.length} = ${breakdown}`,
    `switch case labels .... ${cases}, of which ${refusals} REFUSE (enumerated under SCOPE below)`,
  ];
}

// ---------------------------------------------------------------------------
// CONTROLS — every assertion below compares derived sets, and an extractor
// wired to nothing returns `[]`/`0`, which would make the comparisons agree
// with an equally-empty regeneration. The reassuring zero has to be ruled out
// before any verdict here means anything.
// ---------------------------------------------------------------------------

test('CONTROL — the extractors find a real, non-trivial set (not a vacuous zero)', () => {
  const src = read(LIVE_HOST);
  // Floors, not exact counts — the file grows. A regex that stops matching
  // collapses to 0 and trips here long before it can make a claim vacuous.
  assert.ok(caseBlocks(src).length >= 40, `caseBlocks found ${caseBlocks(src).length}, expected >= 40`);
  assert.ok(
    trpcProcedures(src).length >= 25,
    `trpcProcedures found ${trpcProcedures(src).length}, expected >= 25`,
  );
  assert.ok(restEndpoints(src).length >= 1, 'restEndpoints found none');
  assert.ok(fetchChokepoints(src) >= 2, `fetchChokepoints found ${fetchChokepoints(src)}`);
  assert.ok(
    derivedRefusals(src).length >= 5,
    `derivedRefusals found ${derivedRefusals(src).length}, expected >= 5`,
  );
  assert.ok(
    headerRefusalBullets(src).length >= 5,
    `headerRefusalBullets found ${headerRefusalBullets(src).length}, expected >= 5`,
  );
  assert.ok(headerDerivedBlock(src) !== null, 'the header has no --- BEGIN DERIVED --- region');
});

test('CONTROL — the derived-block regeneration MOVES when the source moves', () => {
  // Positive control: feed a fixture whose numbers cannot equal the real
  // file's, and watch every line change. A renderer wired to constants would
  // emit the same text for both and survive every assertion in this file.
  // 🔴 Fixture shape matters: the REST fetch sits ABOVE the switch and a
  // `default:` closes it, exactly as in liveHost.ts. Dropping either would let
  // the last case absorb the fetch and score 0 refusals — which is how this
  // control first failed, and why `caseBlocks` now stops at `default:`.
  const fixture = `
      const res = await fetchImpl(\`\${baseUrl}/api/v1/probe\`, {});
      switch (t) {
          case 'ALPHA': {
            void callTrpcData('ns.one', {}, 'GET');
            return;
          }
          case 'BETA': {
            void callTrpcMutation('ns.two', {});
            return;
          }
          case 'GAMMA': {
            dispatchToBlock({ type: 'X' });
            return;
          }
          default:
            return;
      }
`;
  assert.deepEqual(renderDerivedBlock(fixture), [
    'fetch chokepoints ..... 1',
    'REST endpoints ........ GET /api/v1/probe',
    'tRPC procedures ....... 2 = ns.* (2)',
    'switch case labels .... 3, of which 1 REFUSE (enumerated under SCOPE below)',
  ]);
  // …and it is genuinely different from the real file's rendering.
  assert.notDeepEqual(renderDerivedBlock(fixture), renderDerivedBlock(read(LIVE_HOST)));
});

test('CONTROL — the refusal classifier separates served from refused', () => {
  const fixture = `
          case 'SERVED_VIA_TRPC': {
            void callTrpcData('ns.thing', {}, 'GET').then(() => dispatchToBlock({}));
            return;
          }
          case 'SERVED_VIA_PICKER': {
            openPicker({}, 'X_RESULT', '');
            return;
          }
          case 'FIRE_AND_FORGET': {
            win.location.assign('x');
            return;
          }
          case 'REFUSED_LOCALLY': {
            logOnce('k', 'nope');
            dispatchToBlock({ type: 'X_RESULT' });
            return;
          }
          default:
            return;
`;
  assert.deepEqual(derivedRefusals(fixture), ['REFUSED_LOCALLY']);

  // 🔴 The last case must NOT absorb the code after the switch. Without the
  // `default:` bound, `TRAILING_REFUSAL` below picks up the helper's
  // `callTrpcData` and is scored as SERVED — a silent, order-dependent misread.
  const trailing = `
          case 'TRAILING_REFUSAL': {
            dispatchToBlock({ type: 'X_RESULT' });
            return;
          }
          default:
            return;
      }
      async function helper() { return callTrpcData('ns.thing', {}, 'GET'); }
`;
  assert.deepEqual(derivedRefusals(trailing), ['TRAILING_REFUSAL']);
});

test('CONTROL — the header extractors read the header and do not invent rows', () => {
  const doc = (body) => `/**\n${body}\n */\nconst after = 1;`;
  assert.deepEqual(headerRefusalBullets(doc(' *   • FOO_BAR — because.\n *   • BAZ — reasons.')), [
    'BAZ',
    'FOO_BAR',
  ]);
  // Prose naming a type, and a bullet without the em-dash body, must not count.
  assert.deepEqual(headerRefusalBullets(doc(' * SAVE_IMAGE is refused.\n *   • NOT_A_ROW')), []);
  // 🔴 And a bullet BELOW the header — in the handlers — is not documentation.
  assert.deepEqual(
    headerRefusalBullets(`${doc(' * nothing')}\n// *   • SNEAKY_ONE — not in the header.`),
    [],
  );
  assert.equal(headerDerivedBlock(' * nothing here'), null);
  assert.deepEqual(
    headerDerivedBlock(' * --- BEGIN DERIVED ---\n * a ... 1\n *\n * --- END DERIVED ---'),
    ['a ... 1'],
  );
});

// ---------------------------------------------------------------------------
// THE CLAIMS
// ---------------------------------------------------------------------------

test("liveHost.ts's DERIVED header block still matches the file it describes", () => {
  const src = read(LIVE_HOST);
  const expected = renderDerivedBlock(src);
  assert.deepEqual(
    headerDerivedBlock(src),
    expected,
    `the --- BEGIN DERIVED --- block in liveHost.ts's header no longer matches the file.\n` +
      `        This block is MEASURED, not typed (#387): the header's old "the only network it\n` +
      `        does is … the four blocks.*Workflow mutations" survived the file growing to 29\n` +
      `        procedures precisely because nothing checked it.\n\n` +
      `        Paste exactly this between the BEGIN/END DERIVED markers (keeping the \` * \` leader):\n\n` +
      expected.map((l) => `          * ${l}`).join('\n') +
      `\n\n        If a line looks WRONG rather than merely stale, the code moved in a way worth\n` +
      `        reading: a third fetch chokepoint, a REST call escaping rawTrpcCall, or a handler\n` +
      `        that stopped serving. Fix the code, not this guard.`,
  );
});

test("the header's SCOPE bullets are EXACTLY the handlers that refuse", () => {
  const src = read(LIVE_HOST);
  assert.deepEqual(
    headerRefusalBullets(src),
    derivedRefusals(src),
    `the 🔴 SCOPE bullet list in liveHost.ts's header is no longer the set of capabilities the\n` +
      `        live host refuses.\n` +
      `        GREW  ⇒ a handler now answers the block locally without a network call and has no\n` +
      `                bullet. If it REFUSES, document it with a \`• NAME — why\` row. If it SERVES\n` +
      `                locally (like REQUEST_TOKEN), add it to SERVED_LOCALLY here with a reason.\n` +
      `        SHRANK ⇒ a bullet's handler now really serves the capability. Delete the bullet —\n` +
      `                a stale "cannot serve" row sends developers to dev:mock for a path that\n` +
      `                works, which is how #14 read for five releases.`,
  );
});

test('the SERVED_LOCALLY ledger still describes handlers that answer locally', () => {
  const src = read(LIVE_HOST);
  const local = locallyAnswered(src);
  assert.deepEqual(
    sorted(SERVED_LOCALLY).filter((label) => !local.includes(label)),
    [],
    `SERVED_LOCALLY names a case that no longer answers the block locally. A stale row here\n` +
      `        silently SHRINKS the derived refusal set, so a real refusal could lose its bullet\n` +
      `        with every assertion above still green. Drop the row.`,
  );
});
// NOTE: there is deliberately NO test asserting the header avoids the phrase
// "the only network it does is …". A guard on WORDS is walked by rewording, and
// it would read as coverage while providing none. What actually stops the claim
// from going stale is that the numbers above are measured, so any re-typed list
// has a measured block sitting next to it contradicting it.
