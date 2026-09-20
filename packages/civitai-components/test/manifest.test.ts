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
  name?: string;
  tagName?: string;
  superclass?: { name: string; module?: string };
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
  .flatMap((file) => {
    const source = readFileSync(join(elementsDir, file), 'utf8');
    const tags = Object.fromEntries(
      [...source.matchAll(/const (\w+)\s*=\s*'(civitai-[a-z-]+)'/g)].map((m) => [m[1], m[2]!])
    );
    return [...source.matchAll(/defineElement\((\w+),/g)]
      .map(([, constant]) => tags[constant!])
      .filter((tag): tag is string => tag != null);
  });

describe('custom-elements.json', () => {
  it('documents exactly the elements this package registers', () => {
    expect(documented.map((d) => d.tagName).sort()).toEqual([...registered].sort());
  });

  it('is not empty, so a broken analyzer run cannot pass silently', () => {
    expect(documented.length).toBeGreaterThan(0);
  });

  /**
   * A module may define more than one element (tabs and its panel), and one
   * module may merely MENTION another's tag — the region creates toasts — so
   * match the tag's own declaration rather than any occurrence of the string.
   */
  const sourceFor = (tag: string): string => {
    const declares = new RegExp(`const \\w+\\s*=\\s*'${tag}'`);
    for (const file of readdirSync(elementsDir).filter((f) => /^civitai-.*(?<!\.define)\.ts$/.test(f))) {
      const source = readFileSync(join(elementsDir, file), 'utf8');
      if (declares.test(source)) return source;
    }
    throw new Error(`no source declares ${tag}`);
  };

  /**
   * A subclass inherits its superclass's contract and the manifest records it
   * there, so `<civitai-switch>` documents what `<civitai-checkbox>` declares.
   */
  const contractSource = (tag: string): string => {
    const sources = [sourceFor(tag)];
    let superclass = documented.find((d) => d.tagName === tag)?.superclass;
    while (superclass?.module?.startsWith('/src/')) {
      const file = join(pkgRoot, superclass.module.replace(/^\//, '').replace(/\.js$/, '.ts'));
      sources.push(readFileSync(file, 'utf8'));
      superclass = declarations.find((d) => d.name === superclass!.name)?.superclass;
    }
    return sources.join('\n');
  };

  it.each(registered)('%s documents attributes that exist in its source', (tag) => {
    const declaration = documented.find((d) => d.tagName === tag)!;
    const source = contractSource(tag);
    for (const attribute of declaration.attributes ?? []) {
      expect(source, `${tag} documents ${attribute.name}`).toContain(attribute.name);
    }
  });

  it.each(registered)('%s documents parts that exist in its template', (tag) => {
    const declaration = documented.find((d) => d.tagName === tag)!;
    const source = contractSource(tag);
    for (const part of declaration.cssParts ?? []) {
      expect(source, `${tag} documents part ${part.name}`).toContain(`part="${part.name}"`);
    }
  });
});
