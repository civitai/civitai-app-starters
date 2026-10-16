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

interface Entry {
  name: string;
  inheritedFrom?: { name: string; module?: string };
}

interface Declaration {
  kind?: string;
  customElement?: boolean;
  name?: string;
  tagName?: string;
  superclass?: { name: string; module?: string; package?: string };
  attributes?: Entry[];
  members?: Entry[];
  cssParts?: Entry[];
  events?: Entry[];
}

interface Module {
  path: string;
  declarations?: Declaration[];
  exports?: { kind: string; declaration?: { name: string } }[];
}

const modules = manifest.modules as Module[];
const declarations = modules.flatMap((module) => module.declarations ?? []);
/**
 * An element is a declaration with a TAG. `customElement` is not the test: the
 * schema lets a tagless class carry it, and the analyzer sets it on the
 * abstract `CivitaiElement` for extending LitElement.
 */
const documented = declarations.filter((d) => d.tagName !== undefined);

/**
 * The declaration a `superclass` names, found by its MODULE PATH only:
 * `superclass.module` is `/src/x.js`, a module's `path` is `src/x.ts`. Never by
 * name alone — a consumer cannot do that, so neither may the tests.
 */
const resolve = (ref: Declaration['superclass']): Declaration | undefined => {
  if (!ref?.module) return undefined;
  const path = ref.module.replace(/^\//, '').replace(/\.js$/, '.ts');
  return modules
    .find((module) => module.path === path)
    ?.declarations?.find((d) => d.name === ref.name);
};

/** Tags the package actually registers, read from the element sources. */
const elementSources = [elementsDir, join(pkgRoot, 'src/sdk')]
  .flatMap((dir) => readdirSync(dir).map((file) => join(dir, file)))
  .filter((path) => /\/civitai-[^/]*(?<!\.define)\.ts$/.test(path));

const registered = elementSources
  .flatMap((path) => {
    const source = readFileSync(path, 'utf8');
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
    for (const path of elementSources) {
      const source = readFileSync(path, 'utf8');
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
      superclass = resolve(superclass)?.superclass;
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

  /**
   * An event dispatched under a computed name (`new Event(type)`) reaches the
   * manifest named after the VARIABLE, and inheritance then puts it on every
   * element. A real event's name is a string literal somewhere up the chain.
   */
  it.each(registered)('%s documents events whose names its source spells', (tag) => {
    const declaration = documented.find((d) => d.tagName === tag)!;
    const source = contractSource(tag);
    for (const event of declaration.events ?? []) {
      expect(source, `${tag} documents event ${event.name}`).toContain(`'${event.name}'`);
    }
  });
});

/**
 * The shared attributes live on abstract base classes in their own modules. A
 * consumer reading the manifest — the CLI, an IDE — must find every attribute
 * an element accepts there, not by parsing compiled code, so each element has
 * to carry its base's attributes or point at a base the manifest declares.
 */
describe('custom-elements.json inheritance', () => {
  /** Own attributes plus every in-package ancestor's; an unresolvable one throws. */
  const attributesOf = (declaration: Declaration): Set<string> => {
    const names = new Set((declaration.attributes ?? []).map((a) => a.name));
    const ref = declaration.superclass;
    if (!ref?.module?.startsWith('/src/')) return names;
    const parent = resolve(ref);
    if (!parent) {
      throw new Error(`${declaration.name}'s superclass ${ref.name} is not in the manifest`);
    }
    for (const name of attributesOf(parent)) names.add(name);
    return names;
  };

  /** The ancestors a consumer can reach: each `superclass` resolved by module path. */
  const ancestorsOf = (declaration: Declaration): Declaration[] => {
    const chain: Declaration[] = [];
    for (let next = resolve(declaration.superclass); next; next = resolve(next.superclass)) {
      chain.push(next);
    }
    return chain;
  };
  const chainOf = (declaration: Declaration): string[] =>
    ancestorsOf(declaration).map((d) => d.name!);

  /** Which element classes extend `CivitaiField`, at any depth, read from the sources. */
  const fieldClassesInSource = (): string[] => {
    const parent = new Map<string, string>();
    for (const path of [...elementSources, join(elementsDir, 'field-base.ts')]) {
      for (const [, child, base] of readFileSync(path, 'utf8').matchAll(
        /class (\w+) extends (\w+)/g
      )) {
        parent.set(child!, base!);
      }
    }
    const isField = (name: string | undefined): boolean =>
      name === undefined ? false : name === 'CivitaiField' || isField(parent.get(name));
    return documented
      .map((d) => d.name!)
      .filter((name) => isField(parent.get(name)))
      .sort();
  };

  const field = declarations.find((d) => d.name === 'CivitaiField');

  /**
   * The attributes a class's OWN `static properties` declares, read from its
   * source — a `...Base.properties` spread is the base's, and `attribute: false`
   * declares none. This is the control: the manifest is not read off itself.
   */
  const sourceAttributes = (path: string, className: string): string[] => {
    const source = readFileSync(join(pkgRoot, path), 'utf8');
    const start = source.indexOf(`class ${className} `);
    if (start === -1) throw new Error(`${path} declares no class ${className}`);
    const block = /static override properties[^=]*=\s*\{([\s\S]*?)\};/.exec(source.slice(start));
    return [...(block?.[1] ?? '').matchAll(/(\w+): \{([^}]*)\}/g)]
      .filter(([, , options]) => !/attribute: false/.test(options!))
      .map(([, property, options]) => /attribute: '([^']+)'/.exec(options!)?.[1] ?? property!)
      .sort();
  };

  const modulePathOf = (name: string): string =>
    modules.find((module) => module.declarations?.some((d) => d.name === name))!.path;

  /**
   * Every `superclass` must lead somewhere a consumer can follow: a declaration
   * in this manifest at the module it names, or a root qualified by `package`
   * (`lit`, or `global:` for `HTMLElement`). An import alias or a re-export
   * barrel named as the module is a dead end.
   */
  it.each(documented.map((d) => d.tagName!))('%s names a superclass a consumer can resolve', (tag) => {
    const element = documented.find((d) => d.tagName === tag)!;
    for (const declaration of [element, ...ancestorsOf(element)]) {
      const ref = declaration.superclass;
      if (ref === undefined) continue;
      const reachable = ref.package !== undefined || resolve(ref) !== undefined;
      expect(reachable, `${declaration.name} extends ${JSON.stringify(ref)}`).toBe(true);
    }
  });

  it('declares the CivitaiField base with the attributes its source declares', () => {
    expect(field, 'CivitaiField is analysed').toBeDefined();
    const declared = sourceAttributes('src/elements/field-base.ts', 'CivitaiField');
    expect(declared.length, 'the source parse found the base attributes').toBeGreaterThan(0);
    expect((field?.attributes ?? []).map((a) => a.name).sort()).toEqual(declared);
  });

  /**
   * An attribute a subclass redeclares is ITS OWN — segmented-control narrows
   * `size` to its own type. The analyzer's inheritance pass marks such an entry
   * `inheritedFrom` the base and takes the base's type, unless corrected.
   */
  it.each(documented.map((d) => d.tagName!))('%s keeps the attributes it declares as its own', (tag) => {
    const element = documented.find((d) => d.tagName === tag)!;
    for (const name of sourceAttributes(modulePathOf(element.name!), element.name!)) {
      const entry = element.attributes?.find((a) => a.name === name);
      expect(entry, `<${tag}> documents ${name}`).toBeDefined();
      expect(entry?.inheritedFrom, `<${tag}> declares ${name} itself`).toBeUndefined();
    }
  });

  it('counts at least one redeclared attribute, so the case above is exercised', () => {
    const redeclared = documented.filter((element) =>
      sourceAttributes(modulePathOf(element.name!), element.name!).some((name) =>
        ancestorsOf(element).some((ancestor) =>
          ancestor.attributes?.some((a) => a.name === name && a.inheritedFrom === undefined)
        )
      )
    );
    expect(redeclared.map((d) => d.tagName)).toContain('civitai-segmented-control');
  });

  /**
   * An inherited entry names the NEAREST ancestor that declares it: a switch's
   * `value` is the checkbox's override, not the field's original.
   */
  it.each(documented.map((d) => d.tagName!))('%s names the nearest declaring ancestor', (tag) => {
    const element = documented.find((d) => d.tagName === tag)!;
    const chain = ancestorsOf(element);
    for (const kind of ['attributes', 'members', 'events'] as const) {
      for (const entry of element[kind] ?? []) {
        if (!entry.inheritedFrom) continue;
        const nearest = chain.find((ancestor) =>
          ancestor[kind]?.some((own) => own.name === entry.name && own.inheritedFrom === undefined)
        );
        expect(entry.inheritedFrom.name, `<${tag}> ${kind} ${entry.name}`).toBe(nearest?.name);
      }
    }
  });

  it('records CivitaiField as an ancestor of exactly the elements whose source extends it', () => {
    const inManifest = documented
      .filter((d) => chainOf(d).includes('CivitaiField'))
      .map((d) => d.name!)
      .sort();
    const inSource = fieldClassesInSource();
    expect(inSource.length, 'the source parse found field controls').toBeGreaterThan(0);
    expect(inManifest).toEqual(inSource);
  });

  it.each(fieldClassesInSource())('%s exposes every attribute CivitaiField declares', (name) => {
    const element = documented.find((d) => d.name === name)!;
    const base = (field?.attributes ?? []).map((a) => a.name);
    expect(base.length, 'CivitaiField declares attributes').toBeGreaterThan(0);
    const exposed = attributesOf(element);
    for (const attribute of base) {
      expect(exposed.has(attribute), `<${element.tagName}> exposes ${attribute}`).toBe(true);
    }
  });

  it('gives <civitai-text-input> the shared label, required and size', () => {
    const textInput = documented.find((d) => d.tagName === 'civitai-text-input')!;
    const exposed = attributesOf(textInput);
    for (const attribute of ['label', 'required', 'size']) {
      expect(exposed.has(attribute), attribute).toBe(true);
    }
  });

  /**
   * `CivitaiElement` re-dispatches the events in its `RETARGETED` list out of
   * every shadow root, so each is an event of the base and of every subclass.
   * Read the list here independently of the analyzer config that injects them.
   */
  const retargeted = (): string[] => {
    const lines = readFileSync(join(elementsDir, 'base.ts'), 'utf8').split('\n');
    const start = lines.findIndex((line) => line.startsWith('const RETARGETED'));
    const end = lines.findIndex((line, index) => index > start && line.startsWith('];'));
    return lines
      .slice(start + 1, end)
      .flatMap((line) => [...line.matchAll(/type:\s*'([^']+)'/g)].map((m) => m[1]!))
      .sort();
  };

  it('documents the events CivitaiElement re-dispatches, on the base and every subclass', () => {
    const types = retargeted();
    expect(types.length, 'the RETARGETED list parsed to some event types').toBeGreaterThan(0);

    const base = declarations.find((d) => d.name === 'CivitaiElement');
    expect((base?.events ?? []).map((e) => e.name).sort()).toEqual(types);

    const subclasses = declarations.filter((d) => chainOf(d).includes('CivitaiElement'));
    expect(subclasses.length, 'some declarations extend CivitaiElement').toBeGreaterThan(0);
    for (const subclass of subclasses) {
      const events = new Set((subclass.events ?? []).map((e) => e.name));
      for (const type of types) {
        expect(events.has(type), `${subclass.name} documents ${type}`).toBe(true);
      }
    }
  });

  it('keeps the base classes out of the tag set', () => {
    const bases = ['CivitaiElement', 'CivitaiField', 'CivitaiMediaElement'];
    const definitions = new Set(
      modules.flatMap((module) =>
        (module.exports ?? [])
          .filter((e) => e.kind === 'custom-element-definition')
          .map((e) => e.declaration?.name)
      )
    );
    for (const name of bases) {
      const declaration = declarations.find((d) => d.name === name);
      expect(declaration, `${name} is analysed`).toBeDefined();
      expect(declaration?.tagName, `${name} has no tag`).toBeUndefined();
      expect(definitions.has(name), `${name} is never defined`).toBe(false);
    }
    // Every tag anywhere in the manifest is one the package registers.
    const tagged = declarations.filter((d) => d.tagName).map((d) => d.tagName);
    expect(tagged.sort()).toEqual([...registered].sort());
  });
});

/**
 * `resolveInitializer` is the analyzer's INTERNAL marker for a field assigned
 * a variable; its own pass resolves and deletes it. The schema has no such key,
 * so finding one means a later step put back a stale copy of the entry.
 */
const resolveInitializerPaths = (value: unknown, path = '$'): string[] => {
  if (Array.isArray(value)) return value.flatMap((item, i) => resolveInitializerPaths(item, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key === 'resolveInitializer' ? [`${path}.${key}`] : []),
    ...resolveInitializerPaths(child, `${path}.${key}`),
  ]);
};

describe('custom-elements.json initializers', () => {
  it('carries no internal resolveInitializer key', () => {
    expect(resolveInitializerPaths(manifest)).toEqual([]);
  });

  /**
   * The package has no field initialised from an imported constant today, so
   * a committed fixture stands in: `civitai-probe` redeclares its base's
   * `probeField` as `= PROBE_DEFAULT`, imported from the base module. Run the
   * analyzer with this package's own plugin over it.
   */
  it('resolves an imported default on a redeclared field', async () => {
    const { create, ts } = await import('@custom-elements-manifest/analyzer');
    const { litPlugin } = await import(
      '@custom-elements-manifest/analyzer/src/features/framework-plugins/lit/lit.js'
    );
    const { createCivitaiElementsPlugin } = await import('../custom-elements-manifest.config.mjs');

    const files = ['probe-base.ts', 'civitai-probe.ts'].map((file) =>
      join('test/fixtures/cem-probe', file)
    );
    const probe = create({
      modules: files.map((file) =>
        ts.createSourceFile(file, readFileSync(join(pkgRoot, file), 'utf8'), ts.ScriptTarget.ES2015, true)
      ),
      plugins: [...litPlugin(), createCivitaiElementsPlugin()],
      context: { dev: false },
    }) as { modules: Module[] };

    expect(resolveInitializerPaths(probe)).toEqual([]);
    const element = probe.modules
      .flatMap((module) => module.declarations ?? [])
      .find((d) => d.tagName === 'civitai-probe');
    expect(element, 'the probe element was analysed').toBeDefined();
    const field = element?.members?.find((m) => m.name === 'probeField') as
      | (Entry & { default?: string; type?: { text: string } })
      | undefined;
    expect(field?.inheritedFrom, 'probeField is its own').toBeUndefined();
    expect(field?.default).toBe("'md'");
    expect(field?.type?.text).toBe('ProbeSize');
  });
});
