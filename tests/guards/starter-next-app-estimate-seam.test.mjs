/**
 * Seam guard for the next-app Buzz estimate (civitai/civitai-app-starters#853,
 * #854): the estimate route and `<GenerateForm>` must USE the decisions in
 * `starters/next-app/src/lib/estimate.ts`, which
 * `starters/next-app/tests/estimate.test.mjs` tests behaviourally. Without this,
 * those tests could stay green over a module nothing calls.
 *
 * 🔴 STRUCTURAL, NOT BEHAVIOURAL. It reads source text, so it proves the calls
 * exist, not that the form renders correctly. It lives HERE, not in the
 * starter's own `tests/`, because the starter is copied out verbatim by
 * `npx tiged`: a source-text match shipped there would go red on a developer's
 * first legitimate edit of their own copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STARTER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'starters', 'next-app');
const read = (rel) => readFileSync(resolve(STARTER, rel), 'utf8');

test('next-app estimate route builds its body with estimateResponseBody', () => {
  const src = read('src/app/api/generate/estimate/route.ts');
  assert.match(src, /import \{ estimateResponseBody \} from '@\/lib\/estimate';/);
  assert.match(src, /NextResponse\.json\(estimateResponseBody\(snapshot\)\)/);
  assert.doesNotMatch(src, /\?\?\s*0/, 'the route must not default a missing cost to 0');
});

test('next-app GenerateForm gates Generate and stale replies through the module', () => {
  const src = read('src/components/GenerateForm.tsx');
  assert.match(src, /from '@\/lib\/estimate';/);
  assert.match(src, /disabled=\{!canGenerate\(\{ busy, prompt, quote \}\)\}/);
  // Both the success and the error arm of the estimate drop a stale reply.
  assert.equal(src.match(/if \(!sequencer\.isCurrent\(ticket\)\) return;/g)?.length, 2);
  assert.match(src, /sequencer\.invalidate\(\);/);
  assert.match(src, /setQuote\(\{ prompt: ticket\.prompt, cost: costOrNull\(json\.cost\) \}\)/);
  assert.doesNotMatch(src, /previewCost/, 'the unkeyed previewCost state must not come back');
});

test('next-app GenerateForm displays only the quote for the current prompt', () => {
  const src = read('src/components/GenerateForm.tsx');
  // The one place a displayed cost may come from: the quote keyed to the prompt.
  assert.match(src, /const currentQuote = quoteFor\(quote, prompt\);/);
  assert.match(src, /const currentCost = currentQuote\?\.cost \?\? null;/);
  // Every rendered cost reads currentCost, never the unkeyed quote.
  assert.match(src, /`Generate\$\{currentCost != null \? ` \(≈ \$\{currentCost\} Buzz\)` : ''\}`/);
  assert.match(src, /\{currentCost != null && phase === 'previewed' && \(/);
  assert.match(src, /This will cost <strong>\{currentCost\}<\/strong> Buzz\./);
  assert.doesNotMatch(src, /quote\?\.cost|quote\.cost/, 'a rendered cost must not read the unkeyed quote');
  // An estimate without a cost says so, accessibly.
  assert.match(
    src,
    /\{currentQuote && currentCost == null && phase === 'previewed' && \(\s*<p role="status"[^>]*>\s*Estimate unavailable/,
  );
});
