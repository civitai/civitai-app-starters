/**
 * PARITY GUARD — `@civitai/sdk`'s safe-storage module is a COPY of
 * `@civitai/app-sdk`'s, and this keeps the two bodies identical.
 *
 * WHY THIS EXISTS
 * ===============
 * `packages/civitai-sdk/src/safe-storage/index.ts` is a deliberate independent
 * copy of `packages/civitai-app-sdk/src/safe-storage/index.ts`. The duplication
 * is on purpose and is not going away: `@civitai/sdk` succeeds
 * `@civitai/app-sdk`, and a successor that imported its predecessor would drag
 * the whole 0.x surface back in (`AGENTS.md` — "It is a separate codebase …
 * do not move code between them").
 *
 * What WAS going away was any way to notice drift. Both modules carried a
 * docblock delegating the check to a human — *"if you fix a bug in one, check
 * the other"* — and nothing checked it. This module is the one place in either
 * package that decides whether a block survives an opaque origin at all, so a
 * bug fixed in one copy and not the other is a bug that stays shipped in
 * whichever package the fixer was not looking at. This converts the prose
 * instruction into a mechanical one.
 *
 * It also replaces duplicated coverage rather than adding to it. The module's
 * BEHAVIOUR is already pinned twice — by
 * `packages/civitai-app-sdk/test/safe-storage.test.ts` (the full unit suite)
 * and by `packages/civitai-blocks-react/test/safe-storage-sandbox.browser.test.ts`
 * (a real `sandbox="allow-scripts"` iframe, in a required CI job). Re-asserting
 * those same cases against a byte-identical copy measures nothing new;
 * asserting the copy is still a copy does.
 *
 * WHAT IT PINS
 * ============
 * The two files' bodies with all comments removed and blank lines dropped —
 * the whole normalised string, not a sample of it. Comments are free to differ
 * (they already do: each copy documents its own package's entry points), and
 * they SHOULD differ. Everything else must match exactly.
 *
 * 🔴 KNOWN LIMITS:
 *   - This is a TEXT identity check. It cannot tell you the shared body is
 *     CORRECT — only that the two copies agree. Correctness lives in the two
 *     behavioural suites named above.
 *   - 🔴 IT COMPARES `src/`, NOT `dist/`, and the browser test above runs
 *     **app-sdk's** artifact (`civitai-app-sdk/dist/safe-storage/index.js`),
 *     never `@civitai/sdk`'s. So "the sandbox test covers both packages" is a
 *     SOURCE-LEVEL inference across a seam nothing checks, and the two packages
 *     compile differently — app-sdk `module: ESNext` / `moduleResolution:
 *     Bundler` / `lib: ["ES2022"]`, sdk `module: NodeNext` /
 *     `lib: ["ES2022", "DOM"]`. Measured once, with both built: the two
 *     artifacts are 156 normalised lines each and byte-identical. A tsconfig
 *     change on either side can end that silently. Widening this guard to
 *     `dist/` was considered and NOT done: `pnpm test:guards` runs in the
 *     required matrix job BEFORE `pnpm install`, so there is no `dist/` to read
 *     — the choice would be a job that fails on every unbuilt tree or a test
 *     that skips itself. If the gap is ever closed, close it in the
 *     `public-types`-style post-build job, not here.
 *   - The comment stripper below is a scanner, not a parser. Its handling of
 *     regex literals uses the usual previous-significant-token heuristic and
 *     a keyword list; a regex literal in a position neither covers could be
 *     misread as division. The self-test at the bottom feeds it every literal
 *     form the modules use plus the awkward ones they do not, and a misparse
 *     fails LOUD (a spurious mismatch), never silently green.
 *   - Divergence is legitimate one day. When it is, DELETE this guard in the
 *     same commit and say why — do not weaken it to a subset comparison.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const COPIES = {
  '@civitai/sdk': 'packages/civitai-sdk/src/safe-storage/index.ts',
  '@civitai/app-sdk': 'packages/civitai-app-sdk/src/safe-storage/index.ts',
};

/** Keywords after which a `/` begins a regex literal, not a division. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do',
  'else', 'yield', 'await', 'throw', 'case',
]);

const isIdentChar = (ch) => /[A-Za-z0-9_$]/.test(ch);

/**
 * Remove every comment from TypeScript source, leaving all other bytes —
 * including type annotations — exactly where they were.
 *
 * Deliberately NOT esbuild/tsc: those erase type annotations as well, which
 * would make a divergence in a type signature invisible to this guard.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  // Tracks whether a `/` at the current position starts a regex literal.
  let lastSignificant = '';
  let lastWord = '';
  // Template-literal `${ … }` nesting: each entry is the brace depth at which
  // the enclosing template resumes.
  const templateStack = [];
  let braceDepth = 0;

  const regexAllowed = () => {
    if (lastSignificant === '') return true;
    if (REGEX_PRECEDING_KEYWORDS.has(lastWord)) return true;
    return !(isIdentChar(lastSignificant) || ')]}`\'"'.includes(lastSignificant));
  };

  const note = (ch) => {
    if (/\s/.test(ch)) return;
    lastSignificant = ch;
    lastWord = isIdentChar(ch) ? lastWord + ch : '';
  };

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < src.length) {
        out += src[i];
        if (src[i] === '\\') {
          out += src[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      note(quote);
      continue;
    }
    if (ch === '`') {
      out += ch;
      i += 1;
      templateStack.push(braceDepth);
      i = consumeTemplateBody(i);
      continue;
    }
    if (ch === '$' && next === '{' && templateStack.length > 0) {
      out += '${';
      i += 2;
      braceDepth += 1;
      lastSignificant = '{';
      lastWord = '';
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      // Regex literal: consume to the unescaped closing `/`, honouring `[...]`
      // character classes (a `/` inside one does not terminate it).
      out += ch;
      i += 1;
      let inClass = false;
      while (i < src.length) {
        out += src[i];
        if (src[i] === '\\') {
          out += src[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) {
          i += 1;
          break;
        }
        i += 1;
      }
      // Flags.
      while (i < src.length && isIdentChar(src[i])) {
        out += src[i];
        i += 1;
      }
      lastSignificant = '/';
      lastWord = '';
      continue;
    }

    if (ch === '{') braceDepth += 1;
    if (ch === '}') {
      // Closing the `${ … }` of a template puts us back in template TEXT, where
      // `//`, `'` and `/*` are ordinary characters.
      if (templateStack.length > 0 && templateStack[templateStack.length - 1] === braceDepth - 1) {
        braceDepth -= 1;
        out += '}';
        i = consumeTemplateBody(i + 1);
        continue;
      }
      braceDepth -= 1;
    }

    out += ch;
    note(ch);
    i += 1;
  }
  return out;

  /**
   * Copy raw template text from `start` until the template closes (consuming
   * the backtick) or a `${` opens (stopping ON the `$`). Template text is not
   * code: nothing in it starts a comment or a string.
   */
  function consumeTemplateBody(start) {
    let j = start;
    while (j < src.length) {
      if (src[j] === '\\') {
        out += src[j] + (src[j + 1] ?? '');
        j += 2;
        continue;
      }
      if (src[j] === '`') {
        out += '`';
        j += 1;
        templateStack.pop();
        note('`');
        break;
      }
      if (src[j] === '$' && src[j + 1] === '{') break;
      out += src[j];
      j += 1;
    }
    return j;
  }
}

/** Comment-free, blank-line-free, trailing-whitespace-free source. */
function normalise(src) {
  return stripComments(src)
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.length > 0)
    .join('\n');
}

function read(relative) {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf8');
}

test('INSTRUMENT: the comment stripper can tell code apart, and ignores comments', () => {
  // NEGATIVE CONTROL — it must go red on a one-character code difference.
  assert.notEqual(
    normalise('const a = 1;'),
    normalise('const a = 2;'),
    'stripper reports two DIFFERENT bodies as equal — it is measuring nothing',
  );

  // …including one buried in a type annotation, which is precisely what an
  // esbuild/tsc-based normaliser would erase.
  assert.notEqual(
    normalise('let x: string | null = null;'),
    normalise('let x: string | undefined = undefined;'),
  );

  // POSITIVE CONTROL — comment-only differences must compare equal.
  assert.equal(
    normalise('/** one */\nconst a = 1; // trailing\n'),
    normalise('/* a completely different comment */\n\nconst a = 1;\n/* and another */\n'),
  );

  // Literal forms the scanner must not misread as comments or comment ends.
  const tricky = [
    String.raw`const url = 'https://example.com/a//b';`,
    String.raw`const re = /https?:\/\/[^/]+\/*/g;`,
    String.raw`const cls = /[/*]+/.test(s);`,
    String.raw`const div = a / b / c;`,
    String.raw`const s = "a /* not a comment */ b";`,
    String.raw`const t = ` + '`x${a / b}y`;',
    String.raw`const u = ` + "`no // comment ${'/* nor */'} here /* at all */`;",
  ].join('\n');
  assert.equal(normalise(tricky), tricky, 'a literal was mangled by the stripper');

  // And a comment adjacent to each of those still goes away.
  assert.equal(normalise(tricky.replace(/\n/g, ' // c\n') + ' // c'), tricky);
});

test('INSTRUMENT: both copies normalise to something substantial', () => {
  // Guards against the vacuous pass where a broken stripper returns '' for
  // both files and the identity assertion below succeeds on two empty strings.
  for (const [pkg, path] of Object.entries(COPIES)) {
    const lines = normalise(read(path)).split('\n');
    assert.ok(
      lines.length > 100,
      `${pkg}: ${path} normalised to only ${lines.length} lines — the stripper ate the code`,
    );
  }
});

test('the two safe-storage copies are byte-identical apart from comments', () => {
  const [[aPkg, aPath], [bPkg, bPath]] = Object.entries(COPIES);
  const a = normalise(read(aPath));
  const b = normalise(read(bPath));

  if (a === b) return;

  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const at = aLines.findIndex((line, i) => line !== bLines[i]);
  const shown = at === -1 ? Math.min(aLines.length, bLines.length) : at;

  assert.fail(
    [
      'SAFE-STORAGE COPY PARITY BROKEN.',
      '',
      `${aPath} and ${bPath} are deliberate copies of one another and have diverged.`,
      `First difference at normalised line ${shown + 1} (${aLines.length} vs ${bLines.length} lines):`,
      '',
      `  ${aPkg.padEnd(18)} ${JSON.stringify(aLines[shown] ?? '<end of file>')}`,
      `  ${bPkg.padEnd(18)} ${JSON.stringify(bLines[shown] ?? '<end of file>')}`,
      '',
      'Apply the change to BOTH copies. The duplication is deliberate — the two',
      'packages must not import each other — so the fix is to mirror it, not to',
      'share a module. If the divergence is intentional, delete this guard in the',
      'same commit and say why.',
    ].join('\n'),
  );
});
