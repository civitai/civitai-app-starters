import { readFileSync } from 'node:fs';

const TAG_CONST_RE = /const (\w+)\s*=\s*'(civitai-[a-z-]+)'/g;
const DEFINE_RE = /defineElement\((\w+),\s*(\w+)\)/g;
/** `part="x"`, but never the `exportparts="a, b"` list. */
const PART_RE = /(?<!export)part="([^"]+)"/g;
const NAMED_SLOT_RE = /<slot\s+name="([^"]+)"/g;

/**
 * These elements register through `defineElement(TAG, Ctor)` in a sibling
 * module, which the analyzer cannot see, and describe their parts and slots in
 * a Lit template. Read both from the source so nothing is restated in JSDoc.
 */
const civitaiElements = {
  name: 'civitai-elements',
  moduleLinkPhase({ moduleDoc }) {
    let source;
    try {
      source = readFileSync(moduleDoc.path, 'utf8');
    } catch {
      return;
    }

    const tags = Object.fromEntries(
      [...source.matchAll(TAG_CONST_RE)].map((m) => [m[1], m[2]])
    );
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
  },
};

export default {
  globs: ['src/elements/civitai-*.ts'],
  exclude: ['src/elements/*.define.ts'],
  outdir: '.',
  litelement: true,
  plugins: [civitaiElements],
};
