/**
 * Regression tests for the Buzz cost preview (civitai/civitai-app-starters#853,
 * #854). Runs the SHIPPED module `src/lib/estimate.ts` under `node --test`
 * (Node 24 strips the TypeScript types natively), plus a structural check that
 * the route and `<GenerateForm>` actually use it.
 *
 * Fixture costs are 6 and 17 — distinct from each other and from 0, so a
 * hardcoded literal cannot pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  canGenerate,
  costOrNull,
  createEstimateSequencer,
  estimateResponseBody,
  quoteFor,
} from '../src/lib/estimate.ts';

// --- #854: an absent cost is not a zero cost -------------------------------

test('estimate body: a snapshot without cost reports cost null, not 0', () => {
  const snapshot = { id: 'wf', status: 'unassigned' };
  assert.deepEqual(estimateResponseBody(snapshot), { cost: null, snapshot });
});

test('estimate body: a cost object without total reports cost null', () => {
  const snapshot = { id: 'wf', cost: {} };
  assert.equal(estimateResponseBody(snapshot).cost, null);
});

test('estimate body: a numeric total is passed through (6 and 17)', () => {
  assert.equal(estimateResponseBody({ cost: { total: 6 } }).cost, 6);
  assert.equal(estimateResponseBody({ cost: { total: 17 } }).cost, 17);
});

test('estimate body: an explicit 0 stays 0', () => {
  assert.equal(estimateResponseBody({ cost: { total: 0 } }).cost, 0);
});

test('costOrNull: non-numbers and non-finite numbers are null', () => {
  for (const value of [undefined, null, '17', Number.NaN, Infinity, {}]) {
    assert.equal(costOrNull(value), null, `costOrNull(${String(value)})`);
  }
  assert.equal(costOrNull(17), 17);
  assert.equal(costOrNull(0), 0);
});

// --- #853: the quote belongs to the prompt it priced ------------------------

test('Generate is disabled on a fresh form before any estimate', () => {
  assert.equal(canGenerate({ busy: false, prompt: 'Prompt B', quote: null }), false);
});

test('Generate is enabled for a numeric estimate of exactly the current prompt', () => {
  const quote = { prompt: 'Prompt B', cost: 17 };
  assert.equal(canGenerate({ busy: false, prompt: 'Prompt B', quote }), true);
  assert.deepEqual(quoteFor(quote, 'Prompt B'), quote);
});

test('editing the prompt invalidates the earlier estimate', () => {
  const quote = { prompt: 'Prompt A', cost: 6 };
  assert.equal(quoteFor(quote, 'Prompt B'), null);
  assert.equal(canGenerate({ busy: false, prompt: 'Prompt B', quote }), false);
  // Whitespace is part of what was priced: the request sends the raw prompt.
  assert.equal(canGenerate({ busy: false, prompt: 'Prompt A ', quote }), false);
});

test('an estimate without a cost leaves Generate disabled', () => {
  const quote = { prompt: 'Missing cost', cost: null };
  assert.deepEqual(quoteFor(quote, 'Missing cost'), quote);
  assert.equal(canGenerate({ busy: false, prompt: 'Missing cost', quote }), false);
});

test('an explicit 0 Buzz estimate allows Generate', () => {
  const quote = { prompt: 'Explicit zero', cost: 0 };
  assert.equal(canGenerate({ busy: false, prompt: 'Explicit zero', quote }), true);
});

test('Generate is disabled while busy or for a blank prompt', () => {
  const quote = { prompt: 'Prompt B', cost: 17 };
  assert.equal(canGenerate({ busy: true, prompt: 'Prompt B', quote }), false);
  const blank = { prompt: '  ', cost: 6 };
  assert.equal(canGenerate({ busy: false, prompt: '  ', quote: blank }), false);
});

test('a response to an estimate discarded by Reset is stale', () => {
  const seq = createEstimateSequencer();
  const held = seq.begin('Held A');
  assert.equal(seq.isCurrent(held), true);
  seq.invalidate(); // Reset while the estimate is in flight
  assert.equal(seq.isCurrent(held), false);
});

test('a response to an older estimate is stale once a newer one starts', () => {
  const seq = createEstimateSequencer();
  const first = seq.begin('Prompt A');
  const second = seq.begin('Prompt B');
  assert.equal(seq.isCurrent(first), false);
  assert.equal(seq.isCurrent(second), true);
  assert.equal(second.prompt, 'Prompt B');
});

test('the late Held A reply cannot price Prompt B (issue #853 sequence)', () => {
  const seq = createEstimateSequencer();
  let quote = null;
  const settle = (ticket, cost) => {
    if (seq.isCurrent(ticket)) quote = { prompt: ticket.prompt, cost };
  };
  const held = seq.begin('Held A');
  seq.invalidate(); // Reset
  settle(held, 6); // the old reply lands after the user typed Prompt B
  assert.equal(quote, null);
  assert.equal(canGenerate({ busy: false, prompt: 'Prompt B', quote }), false);
  // Control: an explicit estimate of Prompt B prices it.
  settle(seq.begin('Prompt B'), 17);
  assert.deepEqual(quote, { prompt: 'Prompt B', cost: 17 });
  assert.equal(canGenerate({ busy: false, prompt: 'Prompt B', quote }), true);
});

// --- SEAM: the route and the form use this module ---------------------------
// Structural, not behavioural: it proves the shipped files call the tested
// functions, so the tests above are not about dead code. It cannot prove the
// form renders correctly; the reporter's browser repro covers that by hand.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('seam: the estimate route builds its body with estimateResponseBody', () => {
  const src = read('../src/app/api/generate/estimate/route.ts');
  assert.match(src, /from '@\/lib\/estimate'/);
  assert.match(src, /NextResponse\.json\(estimateResponseBody\(snapshot\)\)/);
  assert.doesNotMatch(src, /\?\?\s*0/, 'the route must not default a missing cost to 0');
});

test('seam: GenerateForm gates Generate and stale replies through the module', () => {
  const src = read('../src/components/GenerateForm.tsx');
  assert.match(src, /from '@\/lib\/estimate'/);
  assert.match(src, /disabled=\{!canGenerate\(\{ busy, prompt, quote \}\)\}/);
  assert.match(src, /if \(!sequencer\.isCurrent\(ticket\)\) return;/);
  assert.match(src, /sequencer\.invalidate\(\)/);
  assert.match(src, /costOrNull\(json\.cost\)/);
  assert.doesNotMatch(src, /previewCost/, 'the unkeyed previewCost state must not come back');
});
