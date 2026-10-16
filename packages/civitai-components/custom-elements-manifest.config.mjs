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

/**
 * The analyzer's inheritance pass gets two things wrong once a chain is longer
 * than one class: an entry a subclass DECLARES ITSELF is marked `inheritedFrom`
 * the base and takes the base's `type` (segmented-control's own `size` became
 * the field's `FieldSize`), and an inherited entry names the DEEPEST ancestor,
 * not the nearest one that declares it (a switch's `value` is the checkbox's,
 * not the field's). So record what each class declares before that pass, and
 * resolve every copied entry afterwards: its own, else its nearest declarer's.
 */
function createCivitaiElementsPlugin() {
  /** Class name → { module, own: { kind → entries } }, as declared. */
  const declared = new Map();

  const recordOwn = (moduleDoc) => {
    for (const declaration of moduleDoc.declarations ?? []) {
      if (declaration.kind !== 'class') continue;
      const own = {};
      for (const kind of INHERITED_KINDS) {
        if (declaration[kind]) own[kind] = structuredClone(declaration[kind]);
      }
      declared.set(declaration.name, {
        module: moduleDoc.path,
        superclass: declaration.superclass?.name,
        own,
      });
    }
  };

  const resolveInheritance = (declaration) => {
    const self = declared.get(declaration.name);
    if (!self) return;
    for (const kind of INHERITED_KINDS) {
      if (!declaration[kind]) continue;
      declaration[kind] = declaration[kind].map((entry) => {
        const own = self.own[kind]?.find((item) => item.name === entry.name);
        if (own) return structuredClone(own);
        for (
          let ancestor = declared.get(self.superclass), name = self.superclass;
          ancestor;
          name = ancestor.superclass, ancestor = declared.get(ancestor.superclass)
        ) {
          const found = ancestor.own[kind]?.find((item) => item.name === entry.name);
          if (found) {
            return { ...structuredClone(found), inheritedFrom: { name, module: ancestor.module } };
          }
        }
        return entry;
      });
    }
  };

  return {
    name: 'civitai-elements',
    moduleLinkPhase({ moduleDoc }) {
      linkModule(moduleDoc);
      recordOwn(moduleDoc);
    },
    packageLinkPhase({ customElementsManifest }) {
      for (const module of customElementsManifest.modules ?? []) {
        for (const declaration of module.declarations ?? []) {
          resolveInheritance(declaration);
          // `defineElement` is the only registration, so a class it never
          // named is no element. The analyzer marks any class that directly
          // extends LitElement as one — the abstract, tagless `CivitaiElement`.
          if (declaration.customElement && declaration.tagName === undefined) {
            delete declaration.customElement;
          }
        }
      }
    },
  };
}

export default {
  /**
   * The base classes are analysed too: an element's shared attributes (every
   * form control's `label`, `required`, `size`…) are declared there, and the
   * analyzer can only record what a subclass inherits from a class it has seen.
   * They define no tag, so the plugin keeps them out of the element set.
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
