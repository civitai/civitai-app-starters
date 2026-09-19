import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BLOCK_TO_PARENT_MESSAGE_TYPES,
  OTHER_MESSAGE_TYPE_LABEL,
  boundBlockToParentMessageType,
} from '../../src/blocks/index.js';

/**
 * Runtime half of the `BLOCK_TO_PARENT_MESSAGE_TYPES` gate: the array is
 * re-DERIVED from the union's own source text and compared, so growth fails a test
 * that EXECUTES rather than only a typecheck.
 *
 * 🔴 WHY A SOURCE-DERIVED CHECK WHEN A TYPE-LEVEL ONE EXISTS. A union is erased at
 * runtime, so nothing this file imports can enumerate it — and the sibling
 * `.test-d.ts` proves the two agree only for the compiler, which means the proof
 * lives in a different tool from the one a reader runs as "the tests". Parsing the
 * declaration is the only way to ask the question at runtime. It is a genuinely
 * independent gate: it fails when the ARRAY is edited without the union, which the
 * embedded gate in `messages.ts` also catches, AND it is the only one of the four
 * that runs under plain `vitest run`.
 *
 * ⚠️ IT PARSES SOURCE, SO THE PARSE IS ITSELF UNDER TEST. A regex that matched
 * nothing would yield an empty set, and "the array contains everything in the
 * empty set" is the classic vacuous pass. The instrument assertions below —
 * a minimum member count, and a spot-check that two known members were actually
 * extracted — are what make a broken parse fail loudly instead of quietly.
 */

const MESSAGES_SOURCE = readFileSync(
  fileURLToPath(new URL('../../src/blocks/messages.ts', import.meta.url)),
  'utf8',
);

/**
 * Lower bound on the derived set, as a POSITIVE CONTROL on the parse. It is a
 * floor, not the exact count: pinning the exact number would turn every
 * legitimate protocol addition into two failures (this floor and the real
 * equality assertion), and only one of them would be informative.
 */
const MIN_EXPECTED_MESSAGE_TYPES = 40;

/**
 * Extract the `type: 'X'` discriminants declared inside the
 * `BlockToParentMessage` union, and only that union.
 *
 * Bounded to the region between the union's `export type BlockToParentMessage =`
 * and the `export type BlockToParentMessageType` alias that immediately follows
 * it — the file also declares the ~45-member PARENT→block union above, and
 * sweeping the whole file would mix the two directions into one set that matches
 * neither.
 *
 * Comments are stripped before matching: the region legitimately contains prose
 * (one comment says in as many words that a type it names is NOT a
 * `BlockToParentMessage`), and a prose mention must not become a protocol member.
 */
function deriveUnionMembersFromSource(): string[] {
  const start = MESSAGES_SOURCE.indexOf('export type BlockToParentMessage =');
  const end = MESSAGES_SOURCE.indexOf('export type BlockToParentMessageType');
  expect(start, 'BlockToParentMessage declaration not found — parse is broken').toBeGreaterThan(-1);
  expect(end, 'BlockToParentMessageType alias not found — parse is broken').toBeGreaterThan(start);

  const region = MESSAGES_SOURCE.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  return [...region.matchAll(/type:\s*'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1] as string);
}

describe('BLOCK_TO_PARENT_MESSAGE_TYPES', () => {
  it('parses the union out of source (instrument control, so nothing below can pass vacuously)', () => {
    const derived = deriveUnionMembersFromSource();
    expect(derived.length).toBeGreaterThanOrEqual(MIN_EXPECTED_MESSAGE_TYPES);
    // Two members that exist for unrelated reasons, so a regex that only ever
    // matched one shape of declaration still fails here: `BLOCK_READY` is declared
    // on a single line, `GET_IMAGES_BY_IDS` behind a long comment block.
    expect(derived).toContain('BLOCK_READY');
    expect(derived).toContain('GET_IMAGES_BY_IDS');
    // No duplicates — a duplicated discriminant would make the set comparison
    // below pass while the union genuinely declared the same type twice.
    expect(new Set(derived).size).toBe(derived.length);
  });

  it('matches the union EXACTLY — this test fails when the union grows', () => {
    // 🔴 THE POINT OF THE WHOLE FILE. Adding a message type to
    // `BlockToParentMessage` and not to the array lands here, as a named
    // difference. Both directions, because a dead array entry is its own defect:
    // it reads as coverage for a message the protocol cannot send.
    const derived = deriveUnionMembersFromSource().sort();
    expect([...BLOCK_TO_PARENT_MESSAGE_TYPES].sort()).toEqual(derived);
  });

  it('declares BLOCK_MESSAGE_REJECTED, the message the bound label serves', () => {
    expect(BLOCK_TO_PARENT_MESSAGE_TYPES).toContain('BLOCK_MESSAGE_REJECTED');
  });

  it('cannot collide with the `other` bucket', () => {
    // Every real type is SCREAMING_SNAKE_CASE, so the lowercase sentinel is safe —
    // asserted rather than left to the eye, because a future lowercase message
    // type would silently make one real type unreportable.
    expect(BLOCK_TO_PARENT_MESSAGE_TYPES as readonly string[]).not.toContain(
      OTHER_MESSAGE_TYPE_LABEL,
    );
    expect(OTHER_MESSAGE_TYPE_LABEL).toBe('other');
  });
});

describe('boundBlockToParentMessageType', () => {
  it('passes every declared type through unchanged', () => {
    for (const type of BLOCK_TO_PARENT_MESSAGE_TYPES) {
      expect(boundBlockToParentMessageType(type)).toBe(type);
    }
  });

  it.each([
    'GET_SOMETHING_THE_PROTOCOL_DOES_NOT_DECLARE',
    'get_images_by_ids',
    'GET_IMAGES_BY_IDS ',
    '',
  ])('clamps the undeclared value %o to `other`', (value) => {
    expect(boundBlockToParentMessageType(value)).toBe(OTHER_MESSAGE_TYPE_LABEL);
  });

  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf'])(
    'clamps the prototype key %o to `other`',
    (key) => {
      // 🔴 THE REASON THE LOOKUP IS A `Set` AND NOT AN OBJECT MAP. An
      // object-backed membership test answers truthily for inherited keys, so
      // ~12 prototype names would pass as "declared protocol types" and reach a
      // Prometheus label on a host that retains every distinct label set in heap
      // forever. Same bug class as civitai #3495.
      expect(boundBlockToParentMessageType(key)).toBe(OTHER_MESSAGE_TYPE_LABEL);
    },
  );

  it('clamps an over-length value, which would otherwise reject the whole beacon batch', () => {
    // The host's beacon schema caps `type` at 128 chars and rejects the WHOLE
    // batch above it, destroying every legitimate count flushed alongside. The
    // clamp collapses it to the 5-char bucket the server would have used anyway.
    const huge = 'A'.repeat(10_000);
    expect(boundBlockToParentMessageType(huge)).toBe(OTHER_MESSAGE_TYPE_LABEL);
    expect(boundBlockToParentMessageType(huge).length).toBeLessThan(128);
  });
});
