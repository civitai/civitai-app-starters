/**
 * A backtick inside a `css` tagged template ENDS the literal, and the failure
 * surfaces as an unrelated type error hundreds of lines away. Measured three
 * times while writing these elements, so it is a guard rather than a habit.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const elementsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'elements');
const sources = readdirSync(elementsDir).filter((name) => name.endsWith('.ts'));

/** The spans of every css`…` literal, found by matching backtick depth. */
function cssBlocks(source: string): string[] {
  const blocks: string[] = [];
  const opener = /\bcss`/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    const start = match.index + match[0].length;
    const end = source.indexOf('`', start);
    if (end === -1) break;
    blocks.push(source.slice(start, end));
    opener.lastIndex = end + 1;
  }
  return blocks;
}

describe('css templates', () => {
  it.each(sources)('%s closes every css literal on a real rule boundary', (name) => {
    const source = readFileSync(join(elementsDir, name), 'utf8');
    for (const block of cssBlocks(source)) {
      // A literal cut short by a stray backtick ends mid-rule; a real one ends
      // after its last closing brace.
      const tail = block.trimEnd();
      if (tail === '') continue;
      expect(tail.endsWith('}'), `${name}: a css literal ends with "${tail.slice(-40)}"`).toBe(true);
    }
  });
});
