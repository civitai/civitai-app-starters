/**
 * Seam guard for the Buzz estimate in every standalone starter
 * (civitai/civitai-app-starters#853, #854): each estimate route and Generate
 * form must USE the decisions in that starter's `src/lib/estimate.ts`, which
 * `tests/estimate.test.mjs` tests behaviourally (one byte-identical module and
 * test per starter — `starter-shared-modules-parity.test.mjs`). Without this,
 * those tests could stay green over a module nothing calls.
 *
 * 🔴 STRUCTURAL, NOT BEHAVIOURAL. It reads source text, so it proves the calls
 * exist, not that the form renders correctly. The routes ARE checked
 * behaviourally too: each starter's `probe:expired-session` sends an estimate
 * whose snapshot has no cost and asserts `cost: null` on the wire. It lives
 * HERE, not in a starter's own `tests/`, because a starter is copied out
 * verbatim by `npx tiged`: a source-text match shipped there would go red on a
 * developer's first legitimate edit of their own copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STARTERS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'starters');
const read = (starter, rel) => readFileSync(resolve(STARTERS, starter, rel), 'utf8');

// --- the routes --------------------------------------------------------------

test('next-app estimate route builds its body with estimateResponseBody', () => {
  const src = read('next-app', 'src/app/api/generate/estimate/route.ts');
  assert.match(src, /import \{ estimateResponseBody \} from '@\/lib\/estimate';/);
  assert.match(src, /NextResponse\.json\(estimateResponseBody\(snapshot\)\)/);
  assert.doesNotMatch(src, /\?\?\s*0/, 'the route must not default a missing cost to 0');
});

test('sveltekit-app estimate route builds its body with estimateResponseBody', () => {
  const src = read('sveltekit-app', 'src/routes/api/generate/estimate/+server.ts');
  assert.match(src, /import \{ estimateResponseBody \} from '\$lib\/estimate';/);
  assert.match(src, /return json\(estimateResponseBody\(snapshot\)\);/);
  assert.doesNotMatch(src, /\?\?\s*0/, 'the route must not default a missing cost to 0');
});

for (const starter of ['react-pwa', 'svelte-pwa']) {
  test(`${starter} BFF estimate route reports a missing cost as null`, () => {
    const src = read(starter, 'server/app.ts');
    // The BFF compiles from `server/` alone and cannot import src/lib/estimate.ts.
    assert.match(src, /return c\.json\(\{ cost: snapshot\.cost\?\.total \?\? null, snapshot \}\);/);
    assert.doesNotMatch(src, /cost\?\.total\s*\?\?\s*0/, 'the route must not default a missing cost to 0');
  });
}

// --- the forms ---------------------------------------------------------------

const FORMS = {
  'next-app': { path: 'src/components/GenerateForm.tsx', from: "'@/lib/estimate'", kind: 'react' },
  'react-pwa': { path: 'src/components/GenerateForm.tsx', from: "'../lib/estimate'", kind: 'react' },
  'sveltekit-app': { path: 'src/lib/components/GenerateForm.svelte', from: "'$lib/estimate'", kind: 'svelte' },
  'svelte-pwa': { path: 'src/components/GenerateForm.svelte', from: "'../lib/estimate'", kind: 'svelte' },
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const [starter, { path, from, kind }] of Object.entries(FORMS)) {
  test(`${starter} GenerateForm gates Generate and stale replies through the module`, () => {
    const src = read(starter, path);
    assert.match(src, new RegExp(`from ${esc(from)};`));
    assert.match(src, /disabled=\{!canGenerate\(\{ busy, prompt, quote \}\)\}/);
    // Both the success and the error arm of the estimate drop a stale reply.
    assert.equal(src.match(/if \(!sequencer\.isCurrent\(ticket\)\) return;/g)?.length, 2);
    assert.match(src, /sequencer\.invalidate\(\);/);
    assert.match(
      src,
      kind === 'react'
        ? /setQuote\(\{ prompt: ticket\.prompt, cost: costOrNull\((json|res)\.cost\) \}\)/
        : /quote = \{ prompt: ticket\.prompt, cost: costOrNull\((json|res)\.cost\) \};/,
    );
    assert.doesNotMatch(src, /previewCost/, 'the unkeyed previewCost state must not come back');
  });

  test(`${starter} GenerateForm displays only the quote for the current prompt`, () => {
    const src = read(starter, path);
    // The one place a displayed cost may come from: the quote keyed to the prompt.
    assert.match(
      src,
      kind === 'react'
        ? /const currentQuote = quoteFor\(quote, prompt\);/
        : /const currentQuote = \$derived\(quoteFor\(quote, prompt\)\);/,
    );
    assert.match(
      src,
      kind === 'react'
        ? /const currentCost = currentQuote\?\.cost \?\? null;/
        : /const currentCost = \$derived\(currentQuote\?\.cost \?\? null\);/,
    );
    // Every rendered cost reads currentCost, never the unkeyed quote.
    assert.match(src, /`Generate\$\{currentCost != null \? ` \(≈ \$\{currentCost\} Buzz\)` : ''\}`/);
    assert.match(
      src,
      kind === 'react'
        ? /\{currentCost != null && phase === 'previewed' && \(/
        : /\{#if currentCost != null && phase === 'previewed'\}/,
    );
    assert.match(src, /This will cost <strong>\{currentCost\}<\/strong> Buzz\./);
    assert.doesNotMatch(src, /quote\?\.cost|quote\.cost/, 'a rendered cost must not read the unkeyed quote');
    // An estimate without a cost says so, accessibly.
    assert.match(
      src,
      kind === 'react'
        ? /\{currentQuote && currentCost == null && phase === 'previewed' && \(\s*<p role="status"[^>]*>\s*Estimate unavailable/
        : /\{#if currentQuote && currentCost == null && phase === 'previewed'\}\s*<p role="status"[^>]*>\s*Estimate unavailable/,
    );
  });
}
