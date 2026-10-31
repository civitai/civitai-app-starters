/**
 * The bindings are generated; the one thing generation cannot check is the
 * hand-written event map, where a wrong name is a silently dead callback.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EVENTS,
  RETARGETED,
  bindingSources,
  classBody,
  elements,
  isField,
  pkgRoot,
} from '../scripts/bindings.js';

const srcRoot = join(pkgRoot, 'src');
const bindingsDir = join(srcRoot, 'elements');
const entries = elements();

const dispatched = (tag: string): string[] =>
  [...classBody(tag).matchAll(/new (?:Custom)?Event\('([a-z-]+)'/g)].map((m) => m[1]!);

const fires = (tag: string): Set<string> =>
  new Set([...dispatched(tag), ...(isField(tag) ? RETARGETED : [])]);

const bound = (tag: string): Set<string> => new Set((EVENTS[tag] ?? []).map((e) => e.event));

describe('generated React bindings', () => {
  it('covers every registered element', () => {
    const files = readdirSync(bindingsDir)
      .filter((name) => name.startsWith('civitai-'))
      .map((name) => name.replace(/\.ts$/, ''))
      .sort();
    expect(files).toEqual(entries.map((e) => e.tag));
  });

  it('matches a fresh generation, so a hand edit cannot survive', () => {
    for (const [name, contents] of bindingSources()) {
      expect(
        readFileSync(join(bindingsDir, name), 'utf8'),
        `${name} is stale — run \`pnpm --filter @civitai/components-react build:bindings\``
      ).toBe(contents);
    }
  });

  /**
   * The supersession guard. The custom elements are the design system and this
   * package is strictly downstream of them, so every module under `src/` must
   * be either the entry barrel or a GENERATED binding. A hand-written React
   * component re-added here would be a second implementation of a component
   * that already exists as an element — which is exactly the divergence that
   * cost us mismatched close-button gating, three different SegmentedControl
   * role models and two-of-six keyboard nav before the layers were collapsed.
   *
   * Asserts the whole file set, so it fails when a file is ADDED as well as
   * when one goes missing — a guard on a name list would walk past a new file
   * called something its author picked.
   */
  it('src holds only the entry and generated bindings — no second implementation', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(join(dir, d.name)) : [relative(srcRoot, join(dir, d.name))]
      );
    const expected = ['index.ts', join('elements', 'index.ts')]
      .concat(entries.map((e) => join('elements', `${e.tag}.ts`)))
      .sort();
    expect(walk(srcRoot).sort()).toEqual(expected);
  });

  it.each(entries.map((e) => e.tag))('%s binds no event its element never fires', (tag) => {
    for (const event of bound(tag)) {
      expect(fires(tag).has(event), `${tag} binds "${event}", which it never dispatches`).toBe(true);
    }
  });

  it.each(entries.map((e) => e.tag))('%s binds every event its element fires', (tag) => {
    for (const event of fires(tag)) {
      expect(bound(tag).has(event), `${tag} fires "${event}" with no React prop for it`).toBe(true);
    }
  });
});
