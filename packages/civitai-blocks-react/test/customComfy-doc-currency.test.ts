import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Doc-currency guard for the `customComfy` INLINE arm.
 *
 * 🔴 WHY A TEST READS SOURCE COMMENTS. `WorkflowBodyCustomComfy` became a real
 * discriminated union on `mode` in #215 — an app CAN ship its own ComfyUI graph
 * — but a doc comment is a claim no compiler checks, so three of them in this
 * package went on describing `customComfy` as a recipe-only
 * `{ kind, recipe, params }` shape after the code below them was fixed. That is
 * not a cosmetic gap: in a blind dogfood a developer working against the LIVE
 * inline feature read the equivalent claim, believed the doc over their own
 * instinct, and concluded the capability did not exist. The false sentence cost
 * more than the missing type did.
 *
 * 🔴 WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT. Two halves, because
 * either alone is satisfiable by an unrelated edit:
 *
 *   1. the specific recipe-only PHRASINGS are ABSENT — the exact strings that
 *      were there and were false;
 *   2. the SCOPED docblock (not the file — see below) NAMES the inline arm.
 *
 * Half 2 alone is a SPELLED guard: `mockHost.ts` mentions `mode: 'inline'` a
 * thousand lines away in `preferredAccountType`, so a whole-file `Contains`
 * check passed while the docblock under test was still wrong. So each block is
 * extracted first and asserted on in isolation. That is also why half 1 exists:
 * a phrase-absence check cannot be satisfied by prose added elsewhere.
 *
 * This does NOT try to prove the docs are correct — nothing can. It pins the
 * two specific regressions that actually happened.
 */

const SRC = join(__dirname, '../src');

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

/**
 * Extract the `/** … *\/` block immediately preceding `marker`. Scoping matters:
 * an assertion over the WHOLE file is satisfied by any mention anywhere, which
 * is exactly how a stale block hid next to a correct one.
 */
function docBlockBefore(source: string, marker: string): string {
  const at = source.indexOf(marker);
  expect(at, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const before = source.slice(0, at);
  const open = before.lastIndexOf('/**');
  expect(open, `no docblock precedes: ${marker}`).toBeGreaterThan(-1);
  return before.slice(open);
}

/** Extract the `//` comment run immediately preceding `marker`. */
function lineCommentsBefore(source: string, marker: string): string {
  const at = source.indexOf(marker);
  expect(at, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const lines = source.slice(0, at).split('\n');
  const out: string[] = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = (lines[i] ?? '').trim();
    if (line === '') continue;
    if (!line.startsWith('//')) break;
    out.unshift(line);
  }
  expect(out.length, `no line comments precede: ${marker}`).toBeGreaterThan(0);
  return out.join('\n');
}

/**
 * The exact recipe-only phrasings that were live on `main` and are false. Kept
 * as literals rather than a regex so a failure names the sentence to fix.
 */
const STALE_PHRASINGS: Array<[file: string, phrase: string]> = [
  // useBuzzWorkflow's JSDoc — the one a block author reads on hover.
  ['hooks/useBuzzWorkflow.ts', '`customComfy` recipe body (`{ kind, recipe, params }`)'],
  // createMockHost's docblock — "BOTH arms" naming two of three members, with
  // customComfy reduced to its recipe shape.
  ['internal/mockHost.ts', "it drives BOTH `WorkflowBody` arms"],
  ['internal/mockHost.ts', "`{ kind:'customComfy', recipe, params }`"],
  // The ESTIMATE_WORKFLOW handler comment, same shape.
  ['internal/mockHost.ts', 'AND `customComfy` ({ recipe, params })'],
];

describe('customComfy doc currency (the inline arm is LIVE)', () => {
  it.each(STALE_PHRASINGS)('%s no longer contains the recipe-only claim %j', (file, phrase) => {
    expect(read(file)).not.toContain(phrase);
  });

  it("useBuzzWorkflow's JSDoc names the inline arm, in that JSDoc", () => {
    const doc = docBlockBefore(read('hooks/useBuzzWorkflow.ts'), 'export function useBuzzWorkflow');
    expect(doc).toContain('WorkflowBodyCustomComfyInline');
    expect(doc).toContain("mode: 'inline'");
    // The correction is only useful if it says the capability EXISTS — a block
    // author's question is "can my app ship a graph?", not "is there a union?".
    expect(doc).toMatch(/ship its own\s+\*?\s*ComfyUI graph/);
  });

  it("createMockHost's docblock names both customComfy arms, in that docblock", () => {
    const doc = docBlockBefore(read('internal/mockHost.ts'), 'export function createMockHost');
    expect(doc).toContain('INLINE arm');
    expect(doc).toContain("mode:'inline'");
    expect(doc).toContain('RECIPE arm');
  });

  it("the ESTIMATE_WORKFLOW handler comment names both arms, in that comment", () => {
    const comment = lineCommentsBefore(
      read('internal/mockHost.ts'),
      "const body = typed.payload?.body ?? ({} as WorkflowBody);",
    );
    expect(comment).toContain('INLINE arm');
    expect(comment).toContain('RECIPE arm');
  });

  it('the docblock extractor is SCOPED, not a whole-file search (negative control)', () => {
    // 🔴 Validates the instrument. `preferredAccountType` sits ~1000 lines above
    // `createMockHost` and legitimately mentions `mode === 'inline'`, so a
    // whole-file `toContain` would pass even with the docblock under test still
    // stale — the exact false green this helper exists to avoid. Prove the
    // extractor genuinely excludes that region.
    const src = read('internal/mockHost.ts');
    expect(src).toContain("mode === 'inline'"); // present in the file…
    const doc = docBlockBefore(src, 'export function createMockHost');
    expect(doc).not.toContain("mode === 'inline'"); // …but NOT in the scoped block.
    // And the block is a real, bounded docblock rather than the whole prefix.
    expect(doc.startsWith('/**')).toBe(true);
    expect(doc.length).toBeLessThan(src.length / 2);
  });
});
