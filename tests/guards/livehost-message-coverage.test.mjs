/**
 * Guards that EVERY block→parent message type is either handled or explicitly
 * REFUSED by `createLiveHost`, and that the live-vs-mock case-set difference is
 * a declared ledger rather than an accident.
 *
 * WHY THIS EXISTS (#386)
 * ======================
 * `liveHost.ts`'s dispatch switch ends in `default: return` — a fall-through
 * that sends NOTHING back. A block that sends a request the live host does not
 * `case` on therefore gets NO reply at all, and the hook sits on the request
 * until the protocol timeout (`DEFAULT_REQUEST_TIMEOUT_MS`, 30 s) and then
 * throws a generic `RequestTimeoutError`. The same call works under `dev:mock`,
 * so the developer's only evidence is "live is broken, somehow, after 30 s".
 *
 * That is how `SAVE_IMAGE`, `SHARED_GET` and `SHARED_REPORT` shipped silent:
 * nothing compared the two hosts' handled sets, and `tsc` cannot — a `switch`
 * over a widened `string` is exhaustive by construction.
 *
 * WHAT IT PINS
 * ============
 * Three claims, each a SET EQUALITY so it fails when the set grows *or*
 * shrinks. A one-directional "every X exists in Y" is the exact shape that let
 * an extra `./css/tabs` subpath ship in #359, so none of these is written that
 * way.
 *
 *   1. COVERAGE — every member of the protocol's own
 *      `BLOCK_TO_PARENT_MESSAGE_TYPES` is a `case` in `liveHost.ts`, except the
 *      declared {@link NO_REPLY_EXPECTED} rows. Those are the only types for
 *      which reaching `default: return` is CORRECT rather than a 30 s hang.
 *
 *   2. NO DEAD LABELS — `liveHost.ts` (and `mockHost.ts`) `case` on nothing the
 *      protocol does not declare. A typo'd label reads as coverage and is
 *      unreachable; the compile-time gate in `messages.ts` cannot see it,
 *      because the switch subject is a plain `string`.
 *
 *   3. THE ASYMMETRY — the live-only cases are EXACTLY
 *      {@link LIVE_ONLY_FIRE_AND_FORGET}, and there are NO mock-only cases.
 *      The asymmetry is deliberate and one-directional: a handful of types
 *      have no reply channel at all, so the mock is free to let them fall
 *      through while the live host still has real work to do for them. The
 *      reverse — a type the mock answers and the live host does not — is
 *      always the #386 bug.
 *
 * 🔴 KNOWN LIMITS:
 *   - This reads `case '<TYPE>':` labels out of the source text. It proves a
 *     case EXISTS, never that the case REPLIES correctly (or at all). The
 *     per-message behaviour is `liveHost.test.tsx`'s job. What this closes is
 *     the specific failure of a message having NO case, which is invisible to
 *     every other check in the repo.
 *   - A case that exists but `return`s without dispatching would pass here and
 *     still hang. That is a narrower, louder bug (it is visible in the case
 *     body) than an absent case, which is visible nowhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PROTOCOL = 'packages/civitai-app-sdk/src/blocks/messages.ts';
const LIVE_HOST = 'packages/civitai-blocks-react/src/internal/liveHost.ts';
const MOCK_HOST = 'packages/civitai-blocks-react/src/internal/mockHost.ts';

/**
 * Block→parent types with NO reply message anywhere in the protocol, so a host
 * that ignores one cannot leave a request pending. These are the ONLY rows for
 * which `default: return` is a correct outcome rather than a 30 s hang.
 *
 * Both are documented in `messages.ts` as explicitly ignorable:
 *   - `BLOCK_HELLO` — "a HINT, never a precondition. It carries no data,
 *     expects no reply […] a host that does not understand `BLOCK_HELLO`
 *     ignores it".
 *   - `BLOCK_MESSAGE_REJECTED` — "A host that does not handle this type
 *     degrades safely: its dispatcher records one `no_handler` and, because the
 *     payload carries no `requestId`, sends no NACK."
 *
 * Adding a row here is a claim that the type has no reply channel. Check
 * `ParentToBlockMessage` before you add one: if a `*_RESULT` exists, the type
 * belongs in a `case`, refused if it cannot be served.
 */
const NO_REPLY_EXPECTED = ['BLOCK_HELLO', 'BLOCK_MESSAGE_REJECTED'];

/**
 * Types `liveHost` cases on and `mockHost` deliberately does not. Every row is
 * FIRE-AND-FORGET from the block's side — no `requestId`, no reply — so the
 * mock letting them fall through costs nothing, while the live host has real
 * work to do (a `NAVIGATE` actually navigates; `BLOCK_READY`/`RESIZE_IFRAME`
 * are grouped into an explicit no-op so a reader can see they were considered).
 *
 * 🔴 THE ASYMMETRY IS ONE-DIRECTIONAL BY DESIGN. This list may be non-empty;
 * the mock-only list may NOT (see the test below). A type the mock answers and
 * the live host does not is a 30 s hang in `dev:live` for code that works in
 * `dev:mock` — #386 exactly.
 */
const LIVE_ONLY_FIRE_AND_FORGET = [
  'BLOCK_ERROR',
  'BLOCK_READY',
  'NAVIGATE',
  'RESIZE_IFRAME',
  'TRACK_EVENT',
];

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** The protocol's declared block→parent message types, sorted unique. */
export function protocolTypes(src) {
  const block = src.match(
    /export const BLOCK_TO_PARENT_MESSAGE_TYPES = \[([\s\S]*?)\] as const;/,
  );
  if (!block) return [];
  return [...new Set([...block[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]))].sort();
}

/** The `case '<TYPE>':` labels a host source switches on, sorted unique. */
export function caseLabels(src) {
  return [...new Set([...src.matchAll(/\bcase '([A-Z][A-Z0-9_]*)':/g)].map((m) => m[1]))].sort();
}

const sorted = (xs) => [...xs].sort();
const minus = (a, b) => a.filter((x) => !b.includes(x));

// ---------------------------------------------------------------------------
// CONTROLS — a broken extractor returns `[]`, and EVERY subset assertion below
// passes vacuously on an empty set. The reassuring zero is indistinguishable
// from "wired to nothing" until something watches the number move.
// ---------------------------------------------------------------------------

test('CONTROL — the extractors find a real, non-trivial set (not a vacuous zero)', () => {
  const proto = protocolTypes(read(PROTOCOL));
  const live = caseLabels(read(LIVE_HOST));
  const mock = caseLabels(read(MOCK_HOST));
  // Floors, not exact counts: the protocol grows. A regex that stops matching
  // drops to 0 and trips these long before it can make a coverage claim vacuous.
  assert.ok(proto.length >= 40, `protocol extractor found ${proto.length} types — expected >= 40`);
  assert.ok(live.length >= 40, `liveHost extractor found ${live.length} cases — expected >= 40`);
  assert.ok(mock.length >= 35, `mockHost extractor found ${mock.length} cases — expected >= 35`);
  // And the anchors the regexes depend on are really present.
  assert.ok(proto.includes('SUBMIT_WORKFLOW'), 'protocol list is missing a known member');
  assert.ok(live.includes('SUBMIT_WORKFLOW'), 'liveHost cases are missing a known member');
});

test('CONTROL — the case extractor reads labels and does not invent them', () => {
  assert.deepEqual(caseLabels(`case 'FOO': case 'BAR_BAZ':`), ['BAR_BAZ', 'FOO']);
  // Lower-case discriminants, string comparisons and prose must not register.
  assert.deepEqual(caseLabels(`case 'textToImage': x === 'SUBMIT_WORKFLOW'; // case 'NOPE'`), []);
  assert.deepEqual(caseLabels('nothing here'), []);
});

test('CONTROL — the protocol extractor is anchored to the array, not the file', () => {
  assert.deepEqual(
    protocolTypes(`export const BLOCK_TO_PARENT_MESSAGE_TYPES = ['A_B', 'C'] as const;`),
    ['A_B', 'C'],
  );
  // No array ⇒ empty, which the floor control above turns into a loud failure
  // rather than a silent pass.
  assert.deepEqual(protocolTypes(`const OTHER = ['A_B'] as const;`), []);
});

// ---------------------------------------------------------------------------
// THE LEDGER
// ---------------------------------------------------------------------------

test('every block→parent message type is handled or explicitly refused in liveHost', () => {
  const proto = protocolTypes(read(PROTOCOL));
  const live = caseLabels(read(LIVE_HOST));
  const mustHandle = minus(proto, NO_REPLY_EXPECTED);

  assert.deepEqual(
    minus(mustHandle, live),
    [],
    `liveHost.ts has NO \`case\` for the message type(s) above, so a block sending one gets\n` +
      `NOTHING back: the request falls through \`default: return\` and the hook hangs to the\n` +
      `30 s protocol timeout, then throws a generic RequestTimeoutError — while the SAME code\n` +
      `works under dev:mock. That is #386.\n\n` +
      `        Fix it one of two ways, both of which satisfy this guard:\n` +
      `          • SERVE it — forward to the real procedure (see the SHARED_* block).\n` +
      `          • REFUSE it — \`logOnce\` + an honest reply on the type's own *_RESULT channel\n` +
      `            (see SET_COLLECTION_FOLLOW / CREATE_POST_FROM_APP / GET_WILDCARD_PACK).\n` +
      `        Only add it to NO_REPLY_EXPECTED if the protocol declares NO reply for it.`,
  );

  // The other direction: a case label the protocol does not declare is dead
  // code that READS as coverage. `tsc` cannot see it — the switch subject is a
  // widened `string`, so every label type-checks.
  assert.deepEqual(
    minus(live, proto),
    [],
    `liveHost.ts cases on (a) message type(s) BLOCK_TO_PARENT_MESSAGE_TYPES does not declare.\n` +
      `        Either it is a typo — the case is unreachable and the real message still hangs —\n` +
      `        or the protocol array is missing a member. Fix whichever is wrong; do not widen\n` +
      `        this assertion.`,
  );
});

test('mockHost cases on nothing the protocol does not declare', () => {
  const proto = protocolTypes(read(PROTOCOL));
  assert.deepEqual(minus(caseLabels(read(MOCK_HOST)), proto), []);
});

test('the live/mock case-set difference is EXACTLY the declared fire-and-forget ledger', () => {
  const live = caseLabels(read(LIVE_HOST));
  const mock = caseLabels(read(MOCK_HOST));

  // 🔴 GROW *and* SHRINK. `deepEqual` against the ledger fails both ways: a new
  // live-only case that nobody classified, and a ledger row the code no longer
  // backs. A one-directional `every mock case exists in live` would be green
  // for the second and is the #359 shape.
  assert.deepEqual(
    minus(live, mock),
    sorted(LIVE_ONLY_FIRE_AND_FORGET),
    `the set of types liveHost cases on and mockHost does not has CHANGED.\n` +
      `        Expected exactly: ${sorted(LIVE_ONLY_FIRE_AND_FORGET).join(', ')}.\n` +
      `        GREW  ⇒ a new live-only case. Is it fire-and-forget (no requestId, no reply)?\n` +
      `                If so add it to LIVE_ONLY_FIRE_AND_FORGET with a reason. If it HAS a\n` +
      `                reply channel, mockHost owes a case too or dev:mock will hang on it.\n` +
      `        SHRANK ⇒ mockHost grew a case, or liveHost lost one. Drop the stale ledger row.`,
  );

  // The mock-only direction is the #386 bug itself and has no legitimate
  // instance: every mock-served type has a reply channel, so a live host with
  // no case for it hangs the block for 30 s. There is deliberately no ledger to
  // add a row to.
  assert.deepEqual(
    minus(mock, live),
    [],
    `mockHost answers the message type(s) above and liveHost has no case for them, so the\n` +
      `        SAME block code resolves under dev:mock and hangs 30 s under dev:live before a\n` +
      `        generic RequestTimeoutError. This list must stay empty — serve it or refuse it in\n` +
      `        liveHost.ts; there is no ledger row to add here.`,
  );
});
