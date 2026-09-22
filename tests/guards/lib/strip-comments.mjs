/**
 * Comment stripping for the source-reading starter guards.
 *
 * TWO guards read starter SOURCE TEXT and must be able to tell code from prose:
 * `starter-signin-gate.test.mjs` (rule B — a gate MENTIONED in a doc comment
 * once satisfied it) and `starter-me-projection.test.mjs` (whose subject is an
 * index signature that both guarded files now describe, verbatim, in their own
 * doc comments). One copy, so a fix to the lexer fixes both.
 *
 * Its controls live with the guards that use it —
 * `starter-signin-gate.test.mjs` has four dedicated POSITIVE/NEGATIVE CONTROL
 * tests over this function, and `starter-me-projection.test.mjs` adds one for
 * the index-signature case. This module is deliberately NOT named `*.test.mjs`
 * so `pnpm test:guards`'s glob does not try to run it as a suite.
 */

/**
 * Remove every comment, replacing it with equivalent whitespace so line numbers
 * survive. String and template literals are tracked so a `//` inside a URL or a
 * quoted example is NOT treated as a comment.
 *
 * 🔴 THIS FUNCTION IS THE FIX FOR A WALKABLE RULE. Everything the guards match,
 * they match against the OUTPUT of this. A gate quoted in a doc comment is
 * therefore invisible to a "does it call the predicate" check and, equally,
 * cannot trip a "does it open-code one" check — which is what makes those two
 * halves mean what they say.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === ch) {
          closed = true;
          break;
        }
        // A single/double-quoted string cannot span a newline, so a quote with
        // no partner before the line ends is not a string at all.
        if (ch !== '`' && src[j] === '\n') break;
        j += 1;
      }
      // 🔴 AN UNPAIRED QUOTE IS ORDINARY TEXT, NOT A ONE-LINE STRING. An
      // earlier revision stopped the scan at the newline but still COPIED
      // everything up to it verbatim, so a lone apostrophe in JSX prose
      // (`<p>Here's the viewer</p>`) or in a regex literal (`/it's/`) shielded
      // every `//` later on that line from being stripped — and a gate
      // mentioned in such a comment then satisfied the call check. Emit the
      // quote as a plain character and resume scanning from the next one so the
      // rest of the line is still examined.
      if (!closed) {
        out += ch;
        i += 1;
        continue;
      }
      out += src.slice(i, Math.min(j + 1, src.length));
      i = Math.min(j + 1, src.length);
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}
