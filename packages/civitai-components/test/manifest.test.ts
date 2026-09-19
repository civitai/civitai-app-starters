/**
 * The manifest is the published contract — what the docs pages generate from —
 * so a new element or a renamed attribute has to show up as a diff in it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import manifest from '../custom-elements.json' with { type: 'json' };

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const elementsDir = join(pkgRoot, 'src/elements');

interface Declaration {
  customElement?: boolean;
  tagName?: string;
  attributes?: { name: string }[];
  cssParts?: { name: string }[];
}

const declarations = (manifest.modules as { declarations?: Declaration[] }[]).flatMap(
  (module) => module.declarations ?? []
);
const documented = declarations.filter((d) => d.customElement);

/** Tags the package actually registers, read from the element sources. */
const registered = readdirSync(elementsDir)
  .filter((file) => /^civitai-.*(?<!\.define)\.ts$/.test(file))
  .map((file) => /const TAG\s*=\s*'([^']+)'/.exec(readFileSync(join(elementsDir, file), 'utf8'))?.[1])
  .filter((tag): tag is string => tag != null);

describe('custom-elements.json', () => {
  it('documents exactly the elements this package registers', () => {
    expect(documented.map((d) => d.tagName).sort()).toEqual([...registered].sort());
  });

  it('is not empty, so a broken analyzer run cannot pass silently', () => {
    expect(documented.length).toBeGreaterThan(0);
  });

  it.each(registered)('%s documents attributes that exist in its source', (tag) => {
    const declaration = documented.find((d) => d.tagName === tag)!;
    const source = readFileSync(join(elementsDir, `${tag}.ts`), 'utf8');
    for (const attribute of declaration.attributes ?? []) {
      expect(source, `${tag} documents ${attribute.name}`).toContain(attribute.name);
    }
  });

  it.each(registered)('%s documents parts that exist in its template', (tag) => {
    const declaration = documented.find((d) => d.tagName === tag)!;
    const source = readFileSync(join(elementsDir, `${tag}.ts`), 'utf8');
    for (const part of declaration.cssParts ?? []) {
      expect(source, `${tag} documents part ${part.name}`).toContain(`part="${part.name}"`);
    }
  });
});
