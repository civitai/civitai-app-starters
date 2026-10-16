import { readFileSync } from 'node:fs';

const TAG_CONST_RE = /const (\w+)\s*=\s*'(civitai-[a-z-]+)'/g;
const DEFINE_RE = /defineElement\((\w+),\s*(\w+)\)/g;
/** `part="x"`, but never the `exportparts="a, b"` list. */
const PART_RE = /(?<!export)part="([^"]+)"/g;
const NAMED_SLOT_RE = /<slot\s+name="([^"]+)"/g;
/** `new Event(type, …)`: the analyzer records the VARIABLE's name as the event. */
const DYNAMIC_EVENT_RE = /new (?:Custom)?Event\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
/** The event types `CivitaiElement` re-dispatches across its shadow boundary. */
const RETARGETED_RE = /const RETARGETED\b[^=]*=\s*\[([\s\S]*?)\];/;
const RETARGETED_TYPE_RE = /\btype:\s*'([a-z]+)'/g;
/** Every list the analyzer's inheritance pass copies down a class chain. */
const INHERITED_KINDS = [
  'slots',
  'cssParts',
  'cssProperties',
  'attributes',
  'members',
  'events',
  'cssStates',
];

/**
 * An event dispatched under a computed name reaches the manifest named after
 * the identifier — every element would inherit a `type` event. Drop those, and
 * where the names are the module's retargeted list, record the real ones.
 */
function fixDynamicEvents(moduleDoc, source) {
  const dynamic = new Set([...source.matchAll(DYNAMIC_EVENT_RE)].map((m) => m[1]));
  if (dynamic.size === 0) return;
  const retargeted = [
    ...(source.match(RETARGETED_RE)?.[1] ?? '').matchAll(RETARGETED_TYPE_RE),
  ].map((m) => m[1]);

  for (const declaration of moduleDoc.declarations ?? []) {
    const events = declaration.events ?? [];
    const kept = events.filter((event) => !dynamic.has(event.name));
    if (kept.length === events.length) continue;
    for (const name of retargeted) {
      if (kept.some((event) => event.name === name)) continue;
      kept.push({
        name,
        type: { text: 'Event' },
        description: `A \`${name}\` from inside the shadow root, re-dispatched from the host (bubbling, composed) so it crosses the boundary.`,
      });
    }
    if (kept.length > 0) declaration.events = kept;
    else delete declaration.events;
  }
}

/**
 * These elements register through `defineElement(TAG, Ctor)` in a sibling
 * module, which the analyzer cannot see, and describe their parts and slots in
 * a Lit template. Read both from the source so nothing is restated in JSDoc.
 */
function linkModule(moduleDoc) {
  let source;
  try {
    source = readFileSync(moduleDoc.path, 'utf8');
  } catch {
    return;
  }

  fixDynamicEvents(moduleDoc, source);

  const tags = Object.fromEntries([...source.matchAll(TAG_CONST_RE)].map((m) => [m[1], m[2]]));
  const defined = [...source.matchAll(DEFINE_RE)]
    .map(([, constant, className]) => ({ tag: tags[constant], className }))
    .filter((entry) => entry.tag !== undefined);
  if (defined.length === 0) return;

  // Parts and slots are read from the whole module, so they can only be
  // attributed with confidence when the module defines exactly one element.
  const parts = [...new Set([...source.matchAll(PART_RE)].map((m) => m[1]))];
  const named = [...new Set([...source.matchAll(NAMED_SLOT_RE)].map((m) => m[1]))];
  const slots = named.map((name) => ({ name }));
  if (/<slot><\/slot>|<slot\s*\/>/.test(source)) slots.unshift({ name: '' });
  const sole = defined.length === 1;

  moduleDoc.exports ??= [];
  for (const { tag, className } of defined) {
    const declaration = moduleDoc.declarations?.find((d) => d.name === className);
    if (!declaration) continue;

    declaration.customElement = true;
    declaration.tagName = tag;
    if (sole && parts.length > 0) declaration.cssParts = parts.map((name) => ({ name }));
    if (sole && slots.length > 0) declaration.slots = slots;

    moduleDoc.exports.push({
      kind: 'custom-element-definition',
      name: tag,
      declaration: { name: className, module: moduleDoc.path },
    });
  }
}

/** `/src/x.js`, as a superclass names it, → the `src/x.ts` a module's path is. */
const sourcePath = (specifier) => specifier.replace(/^\//, '').replace(/\.js$/, '.ts');

/** A relative import seen from `fromPath`, as a superclass `module` spells it. */
function resolveSpecifier(fromPath, specifier) {
  const parts = fromPath.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return `/${parts.join('/')}`;
}

/**
 * Make `superclass` point at a declaration the manifest holds. The analyzer
 * records the module a class was IMPORTED from, which need not declare it:
 *
 * - a re-export barrel (`export { CivitaiElement } from './base.js'`, the sdk
 *   elements' `internals`) is followed to the module that declares the class;
 * - an alias whose value is a global constructor (`HTMLElementBase`, which is
 *   `HTMLElement` cast for Node) becomes that global, as the schema spells a
 *   root: `{ name, package: 'global:' }`.
 *
 * Both are read from the sources, so a new barrel or alias needs no edit here.
 */
function resolveSuperclass(ref, declaresClass) {
  let current = ref;
  for (let hops = 0; hops < 8 && current?.module?.startsWith('/'); hops += 1) {
    const path = sourcePath(current.module);
    if (declaresClass(path, current.name)) return current;

    let source;
    try {
      source = readFileSync(path, 'utf8');
    } catch {
      return current;
    }

    const reexport = [...source.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)].find(
      ([, names]) => names.split(',').some((name) => name.trim() === current.name)
    );
    if (reexport) {
      current = { name: current.name, module: resolveSpecifier(path, reexport[2]) };
      continue;
    }

    const alias = new RegExp(`export const ${current.name}\\b[^=]*=\\s*([\\s\\S]*?);`).exec(source);
    const initializer = alias?.[1].trim();
    const root = initializer && (/^(\w+)$/.exec(initializer) ?? /as typeof (\w+)$/.exec(initializer));
    // Neither imported nor declared in the module, so the name is a global.
    const local =
      root &&
      new RegExp(
        `import[^;]*\\b${root[1]}\\b[^;]*from|\\b(?:class|const|let|var|function)\\s+${root[1]}\\b`
      ).test(source);
    if (root && !local) return { name: root[1], package: 'global:' };
    return current;
  }
  return current;
}

/**
 * The analyzer's inheritance pass gets two things wrong once a chain is longer
 * than one class: an entry a subclass DECLARES ITSELF is marked `inheritedFrom`
 * the base and takes the base's `type` (segmented-control's own `size` became
 * the field's `FieldSize`) and, when it has no doc of its own, the base's
 * `description` (pagination's own `change` read as the base's re-dispatched
 * one); and an inherited entry names the DEEPEST ancestor,
 * not the nearest one that declares it (a switch's `value` is the checkbox's,
 * not the field's).
 *
 * Only those fields are corrected. Everything else in an entry is the
 * analyzer's FINAL word — including what its own `resolveInitializers` pass
 * resolved, which runs after this plugin's module phase — so nothing recorded
 * here is ever copied in wholesale.
 */
export function createCivitaiElementsPlugin() {
  /**
   * Class name → { module, superclass, own: kind → name → declared fields },
   * recorded before inheritance: just `type`, `privacy`, `description` and the
   * analyzer's pending `resolveInitializer`, the inputs to the correction below.
   */
  const declared = new Map();

  const recordOwn = (moduleDoc) => {
    for (const declaration of moduleDoc.declarations ?? []) {
      if (declaration.kind !== 'class') continue;
      const own = {};
      for (const kind of INHERITED_KINDS) {
        own[kind] = new Map(
          (declaration[kind] ?? []).map((entry) => [
            entry.name,
            structuredClone({
              type: entry.type,
              privacy: entry.privacy,
              description: entry.description,
              resolveInitializer: entry.resolveInitializer,
              default: entry.default,
            }),
          ])
        );
      }
      declared.set(declaration.name, {
        module: moduleDoc.path,
        superclass: declaration.superclass?.name,
        own,
      });
    }
  };

  /**
   * The variable a field's initializer names (`probeField = PROBE_DEFAULT`).
   * The analyzer's `resolveInitializers` looks it up by the IMPORT specifier,
   * `/x.js`, against module paths that are `x.ts`, so in a TypeScript package
   * it never finds it: the default stays the identifier and the type empty.
   */
  const initializerOf = (manifest, own) => {
    if (!own?.resolveInitializer?.module) return undefined;
    const path = sourcePath(own.resolveInitializer.module);
    return manifest.modules
      ?.find((module) => module.path === path)
      ?.declarations?.find((d) => d.name === own.default);
  };
  const initializerType = (manifest, own) => initializerOf(manifest, own)?.type;

  /** After `restoreOwn`: an own field initialised from an imported constant takes its value and type. */
  const resolveInitializers = (manifest, declaration) => {
    const self = declared.get(declaration.name);
    if (!self) return;
    for (const entry of declaration.members ?? []) {
      const own = self.own.members.get(entry.name);
      const variable = initializerOf(manifest, own);
      if (!variable || entry.inheritedFrom) continue;
      if (variable.default !== undefined && entry.default === own.default) {
        entry.default = variable.default;
      }
      if (!entry.type && variable.type) entry.type = variable.type;
    }
  };

  /** First: an entry the class declares itself is its own, with its own type and doc. */
  const restoreOwn = (manifest, declaration) => {
    const self = declared.get(declaration.name);
    if (!self) return;
    for (const kind of INHERITED_KINDS) {
      for (const entry of declaration[kind] ?? []) {
        const own = self.own[kind].get(entry.name);
        if (!own || !entry.inheritedFrom) continue;
        delete entry.inheritedFrom;
        const type = own.type ?? initializerType(manifest, own);
        if (type) entry.type = type;
        if (own.privacy) entry.privacy = own.privacy;
        else delete entry.privacy;
        if (own.description) entry.description = own.description;
        else delete entry.description;
      }
    }
  };

  /** Last: an inherited entry names, and carries the value of, its nearest declarer. */
  const nearestDeclarer = (manifest, declaration, byName) => {
    const self = declared.get(declaration.name);
    if (!self) return;
    for (const kind of INHERITED_KINDS) {
      for (const entry of declaration[kind] ?? []) {
        if (!entry.inheritedFrom) continue;
        let name = self.superclass;
        while (name && declared.has(name) && !declared.get(name).own[kind].has(entry.name)) {
          name = declared.get(name).superclass;
        }
        if (!name || !declared.has(name)) continue;
        const source = byName.get(name)?.[kind]?.find((item) => item.name === entry.name);
        if (entry.inheritedFrom.name !== name) {
          entry.inheritedFrom = { name, module: declared.get(name).module };
          if (source?.type) entry.type = source.type;
          if (source?.privacy) entry.privacy = source.privacy;
          else delete entry.privacy;
          if (source?.description) entry.description = source.description;
          else delete entry.description;
        }
        // A copy taken before the declarer's initializer was resolved.
        if (source && declared.get(name).own[kind].get(entry.name)?.resolveInitializer) {
          entry.default = source.default;
          if (source.type) entry.type = source.type;
        }
      }
    }
  };

  return {
    name: 'civitai-elements',
    moduleLinkPhase({ moduleDoc }) {
      linkModule(moduleDoc);
      recordOwn(moduleDoc);
    },
    packageLinkPhase({ customElementsManifest: manifest }) {
      const classes = (manifest.modules ?? []).flatMap((module) =>
        (module.declarations ?? []).filter((d) => d.kind === 'class')
      );
      const byName = new Map(classes.map((d) => [d.name, d]));
      const declaresClass = (path, name) =>
        manifest.modules?.some(
          (module) => module.path === path && module.declarations?.some((d) => d.name === name)
        ) ?? false;

      for (const declaration of classes) {
        if (declaration.superclass) {
          declaration.superclass = resolveSuperclass(declaration.superclass, declaresClass);
        }
        restoreOwn(manifest, declaration);
        resolveInitializers(manifest, declaration);
      }
      // After every class's own entries are right, since a nearest declarer's
      // entry is the source of its subclasses' copies.
      for (const declaration of classes) nearestDeclarer(manifest, declaration, byName);
    },
  };
}

export default {
  /**
   * The base classes are analysed too: an element's shared attributes (every
   * form control's `label`, `required`, `size`…) are declared there, and the
   * analyzer can only record what a subclass inherits from a class it has seen.
   * They define no tag, so none of them is in the tag set.
   */
  globs: [
    'src/elements/civitai-*.ts',
    'src/sdk/civitai-*.ts',
    'src/elements/base.ts',
    'src/elements/*-base.ts',
  ],
  exclude: ['src/elements/*.define.ts', 'src/sdk/*.define.ts'],
  outdir: '.',
  litelement: true,
  plugins: [createCivitaiElementsPlugin()],
};
