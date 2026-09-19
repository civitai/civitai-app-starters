/**
 * The bindings are generated; the one thing generation cannot check is the
 * hand-written event map, where a wrong name is a silently dead callback.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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

const bindingsDir = join(pkgRoot, 'src', 'elements');
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
