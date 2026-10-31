/**
 * Pins the block-scope list `starters/examples/scopes-api/README.md` teaches to
 * the `scopes` enum of the VENDORED canonical manifest schema.
 *
 * WHY THIS EXISTS
 * ===============
 * That README used to hand-type the list. The schema gained
 * `goods:read:self` and `goods:purchase:self` and the README did not, so the
 * example that exists to teach "which scopes are there" taught an incomplete
 * set while every check stayed green. A hand-typed copy of an enum drifts the
 * first time the enum moves; this makes the drift a red test instead.
 *
 * WHAT IS CHECKED
 * ===============
 * The backticked tokens between `<!-- scopes-enum:start -->` and
 * `<!-- scopes-enum:end -->` must EQUAL the schema enum — same members, same
 * order, no duplicates. Order is pinned too, so regenerating the block from the
 * enum is the one way to satisfy it.
 *
 * The vendored schema (`packages/civitai-app-sdk/schemas/app-block/v1.json`) is
 * the oracle rather than the live URL: this suite runs offline, and the
 * `schema-drift` CI job already keeps that file byte-identical to the canonical.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './fixture.mjs';

const README = 'starters/examples/scopes-api/README.md';
const SCHEMA = 'packages/civitai-app-sdk/schemas/app-block/v1.json';
const START = '<!-- scopes-enum:start -->';
const END = '<!-- scopes-enum:end -->';

/** Backticked tokens inside the marked block; throws if the markers are missing. */
export function readMarkedScopes(markdown) {
  const a = markdown.indexOf(START);
  const b = markdown.indexOf(END);
  if (a === -1 || b === -1 || b < a) {
    throw new Error(`${README}: the ${START} … ${END} block is missing or out of order`);
  }
  return [...markdown.slice(a + START.length, b).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

function schemaScopes() {
  const schema = JSON.parse(readFileSync(join(REPO_ROOT, SCHEMA), 'utf8'));
  const e = schema?.properties?.scopes?.items?.enum;
  assert.ok(Array.isArray(e), `${SCHEMA}: properties.scopes.items.enum is not an array`);
  return e;
}

describe('scopes-api README scope list', () => {
  test('equals the vendored schema scopes enum (members AND order)', () => {
    const enumScopes = schemaScopes();
    // Positive control: an empty enum would make an empty README block "pass".
    assert.ok(enumScopes.length >= 10, `expected a real scopes enum, got ${enumScopes.length} entries`);
    const listed = readMarkedScopes(readFileSync(join(REPO_ROOT, README), 'utf8'));
    assert.deepEqual(
      listed,
      enumScopes,
      `${README} lists a different scope set than ${SCHEMA}. Regenerate the marked block from the enum.`,
    );
  });

  test('NEGATIVE CONTROL: the comparison sees a missing scope', () => {
    const enumScopes = schemaScopes();
    const doc = `${START}\n${enumScopes.slice(0, -1).map((s) => `\`${s}\``).join(', ')}\n${END}`;
    assert.notDeepEqual(readMarkedScopes(doc), enumScopes);
  });

  test('NEGATIVE CONTROL: missing markers throw instead of reading as empty', () => {
    assert.throws(() => readMarkedScopes('no markers here'), /missing or out of order/);
  });
});
