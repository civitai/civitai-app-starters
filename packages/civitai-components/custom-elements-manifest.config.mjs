import { readFileSync } from 'node:fs';

const TAG_RE = /const TAG\s*=\s*'([^']+)'/;
const DEFINE_RE = /defineElement\(TAG,\s*(\w+)\)/;
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

    const tag = TAG_RE.exec(source)?.[1];
    const className = DEFINE_RE.exec(source)?.[1];
    if (!tag || !className) return;

    const declaration = moduleDoc.declarations?.find((d) => d.name === className);
    if (!declaration) return;

    declaration.customElement = true;
    declaration.tagName = tag;

    const parts = [...new Set([...source.matchAll(PART_RE)].map((m) => m[1]))];
    if (parts.length > 0) declaration.cssParts = parts.map((name) => ({ name }));

    const named = [...new Set([...source.matchAll(NAMED_SLOT_RE)].map((m) => m[1]))];
    const slots = named.map((name) => ({ name }));
    if (/<slot><\/slot>|<slot\s*\/>/.test(source)) slots.unshift({ name: '' });
    if (slots.length > 0) declaration.slots = slots;

    moduleDoc.exports ??= [];
    moduleDoc.exports.push({
      kind: 'custom-element-definition',
      name: tag,
      declaration: { name: className, module: moduleDoc.path },
    });
  },
};

export default {
  globs: ['src/elements/civitai-*.ts'],
  exclude: ['src/elements/*.define.ts'],
  outdir: '.',
  litelement: true,
  plugins: [civitaiElements],
};
