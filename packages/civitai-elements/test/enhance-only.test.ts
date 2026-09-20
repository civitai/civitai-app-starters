/**
 * The STRUCTURAL half of constraint (a).
 *
 * `light-dom-children.test.ts` asserts the behaviour. This asserts that the
 * behaviour cannot regress by accident: the wrapper entrypoints' transitive
 * import graph must never reach a templating library. `ReactiveElement` has no
 * `render()` and no `lit-html` dependency, so a subclass literally has no code
 * path that writes children. If someone "just adds a render()" they must first
 * switch the base class, which moves `lit` into the graph and fails here.
 *
 * POSITIVE CONTROL: the same walk over `src/select.ts` MUST find `lit`. Without
 * it, a broken walker that resolves nothing would report a clean zero for the
 * wrappers and this guard would be wired to nothing.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', 'src');

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*['"]([^'"]+)['"]/g;

/** Walk the transitive import graph from an entry, returning every specifier. */
function specifiers(entry: string): { files: string[]; bare: Set<string> } {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(text))) {
      const spec = m[1] as string;
      if (spec.startsWith('.')) {
        const abs = resolve(dirname(file), spec).replace(/\.js$/, '.ts');
        if (existsSync(abs)) queue.push(abs);
        else throw new Error(`unresolved relative import ${spec} from ${file}`);
      } else {
        bare.add(spec);
      }
    }
  }
  return { files: [...seen], bare };
}

const TEMPLATING = ['lit', 'lit-html', 'lit-element'];

describe('wrapper primitives are enhance-only by construction', () => {
  it('POSITIVE CONTROL: the walker CAN see a templating import', () => {
    const { files, bare } = specifiers(resolve(src, 'select.ts'));
    expect(files.length).toBeGreaterThan(3);
    expect([...bare]).toContain('lit');
  });

  for (const entry of ['button.ts', 'stack.ts']) {
    it(`${entry} never reaches a templating library`, () => {
      const { files, bare } = specifiers(resolve(src, entry));
      // Guard the walk itself: an entry that resolved nothing would pass
      // vacuously.
      expect(files.length).toBeGreaterThan(3);
      for (const t of TEMPLATING) expect([...bare]).not.toContain(t);
    });
  }

  it('the wrapper base class defines no render()', async () => {
    const mod = await import('../src/internal/CivitaiEnhanceElement.js');
    const proto = mod.CivitaiEnhanceElement.prototype as unknown as Record<string, unknown>;
    expect('render' in proto).toBe(false);
    // …and it is not inherited from ReactiveElement either.
    let p: object | null = Object.getPrototypeOf(proto) as object | null;
    while (p) {
      expect(Object.prototype.hasOwnProperty.call(p, 'render')).toBe(false);
      p = Object.getPrototypeOf(p) as object | null;
    }
  });
});
