#!/usr/bin/env node
/**
 * custom-elements.json -> @civitai/elements-react's JSX types.
 *
 * WHY TYPES AND NOT WRAPPERS. Wrapper components exist to paper over two React
 * defects that React 19 fixed, both MEASURED in
 * `test/react19-custom-elements.browser.test.tsx`
 * against react-dom 19.2.6:
 *   1. a non-primitive or boolean prop on a custom element is set as a
 *      PROPERTY, not a stringified attribute — so `options={[…]}` works;
 *   2. an `on<name>` prop attaches a real listener for the event `<name>`
 *      verbatim (`onchange` -> `change`, `oncivitai-foo` -> `civitai-foo`).
 * With those two, a wrapper would only add a component tree layer, a second
 * ref hop and a published runtime to keep in sync. So this emits `.d.ts` and
 * nothing else.
 *
 * The one place a wrapper WOULD have helped is the camelCase/lowercase event
 * split documented on `eventProps` below; the generator handles it by typing
 * the two spellings differently instead, which costs no runtime.
 *
 * WHERE THIS LIVES, and why it moved. It used to sit in `@civitai/elements`
 * and write across the package boundary into this one — so this package could
 * not regenerate its own source, and `pnpm --filter @civitai/elements-react
 * generate` shelled into a sibling's `scripts/`. A package whose generator
 * lives somewhere else is a boundary with nothing behind it. The generator now
 * lives with its OUTPUT and READS the sibling's published artifact
 * (`custom-elements.json`), which is the direction the Custom Elements
 * Manifest exists to support: upstream publishes a manifest, downstream
 * bindings generate from it.
 *
 * Run: pnpm --filter @civitai/elements-react generate
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const reactPkg = join(here, '..');
const elementsPkg = join(reactPkg, '..', 'civitai-elements');

/**
 * Both paths are overridable so the parity test can run the REAL generator
 * against a temp manifest and a temp output directory. Without that it would
 * have to overwrite `src/generated/jsx.ts` in the working tree and restore it
 * in a `finally` — a tracked source file left corrupted by any crash, in a
 * repo where other agents and sessions share the checkout.
 */
const outDir = process.env.CIVITAI_GEN_JSX_OUTDIR ?? join(reactPkg, 'src', 'generated');
const manifestPath =
  process.env.CIVITAI_GEN_JSX_MANIFEST ?? join(elementsPkg, 'custom-elements.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/** Only declarations that actually claim a tag: skips the two base classes. */
const elements = [];
for (const mod of manifest.modules ?? []) {
  for (const d of mod.declarations ?? []) {
    if (d.customElement && d.tagName) elements.push({ ...d, module: mod.path });
  }
}
elements.sort((a, b) => a.tagName.localeCompare(b.tagName));
if (elements.length === 0) throw new Error('[gen-jsx] manifest declares no tagged elements');

/** Map an element module path to the package subpath a consumer imports. */
function subpath(tagName) {
  return `@civitai/elements/${tagName.replace(/^civitai-/, '')}`;
}

function className(tagName) {
  return tagName
    .split('-')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('');
}

/**
 * Event names React registers in its synthetic system. ONLY these may also be
 * spelled camelCase (`onChange`).
 *
 * 🔴 THE TRAP THIS SET EXISTS FOR, measured on react-dom 19.2.6: for a custom
 * element React attaches an `on<Rest>` prop as a listener for the event named
 * `<Rest>` VERBATIM, case included. So a custom event `civitai-foo` is only
 * reachable as `oncivitai-foo`; writing `onCivitaiFoo` compiles, renders, and
 * listens for an event named `CivitaiFoo` that nothing ever dispatches —
 * silently dead. `onChange` works ONLY because `change` is a React-registered
 * event that still routes through the synthetic system on a custom element.
 * Emitting a camelCase alias for anything outside this set would generate a
 * type for a handler that can never fire.
 */
const REACT_SYNTHETIC = new Set([
  'change',
  'input',
  'click',
  'focus',
  'blur',
  'submit',
  'reset',
  'invalid',
]);

/**
 * `@fires {CustomEvent<Detail>} name - desc` -> typed handler props.
 *
 * 🔴 TWO SPELLINGS, TWO DIFFERENT RUNTIME SHAPES. Measured on react-dom 19.2.6
 * in real Chromium (`@civitai/elements-react`'s
 * react19-custom-elements.browser.test.tsx):
 *
 *   prop         listens for       receives                detail
 *   onchange     change            CustomEvent             PRESERVED
 *   onChange     change            SyntheticBaseEvent      undefined
 *   oninput      input             CustomEvent             PRESERVED
 *   onInput      input             SyntheticBaseEvent      undefined
 *   oncivitai-x  civitai-x         CustomEvent             PRESERVED
 *   onCivitaiX   CivitaiX          (never fires)           —
 *
 * React's rule: `on` + a LOWERCASE-initial remainder is attached with
 * `addEventListener` verbatim; `on` + an uppercase-initial remainder goes
 * through React's own system, which for a REGISTERED name (`Change` ->
 * `change`) wraps the event in a SyntheticEvent and for an unregistered one
 * attaches the literal capitalised name that nothing dispatches.
 *
 * So the generator emits BOTH spellings with HONEST types: the lowercase form
 * as `CustomEvent<Detail>`, the camelCase form as a SyntheticEvent whose
 * `currentTarget` is the element. Typing `onChange` as `CustomEvent<Detail>`
 * would compile, render, fire — and hand the consumer `e.detail === undefined`.
 * Omitting `onChange` entirely is worse: React users write it by reflex, it
 * DOES fire, and an unknown prop on a custom element is passed straight
 * through as an attribute with no error at all.
 */
function eventProps(el, cls) {
  const out = [];
  for (const e of el.events ?? []) {
    // The analyzer also infers events from any `dispatchEvent(new
    // CustomEvent(x))` it can see, including the base class's generic
    // `retarget(inner, type, detail)` — which it names after the PARAMETER
    // (`type`). Only `@fires`-documented events are real public API, and
    // `@fires` always carries a description here.
    if (!e.description) continue;
    const detail = /CustomEvent<\s*([^>]+)\s*>/.exec(e.type?.text ?? '');
    const t = detail ? `CustomEvent<${detail[1].trim()}>` : 'CustomEvent<unknown>';
    const doc = (e.description ?? '').split('\n')[0];
    out.push({
      name: `on${e.name}`,
      type: `(event: ${t}) => void`,
      doc: `${doc} Receives the real CustomEvent — read \`event.detail\`.`,
    });
    if (REACT_SYNTHETIC.has(e.name)) {
      out.push({
        name: `on${e.name[0].toUpperCase()}${e.name.slice(1)}`,
        type: `(event: React.SyntheticEvent<${cls}>) => void`,
        doc:
          `${doc} React wraps this spelling in a SyntheticEvent, so \`detail\` is ` +
          `UNDEFINED here — read \`event.currentTarget.value\`, or use ` +
          `\`on${e.name}\` for the CustomEvent.`,
      });
    }
  }
  return out;
}

/** Reactive properties, preferring the camelCase PROPERTY name. */
function propProps(el) {
  const attrByField = new Map();
  for (const a of el.attributes ?? []) if (a.fieldName) attrByField.set(a.fieldName, a.name);

  const out = [];
  const seen = new Set();
  for (const m of el.members ?? []) {
    if (m.kind !== 'field') continue;
    if (m.privacy && m.privacy !== 'public') continue;
    if (m.static) continue;
    // Getter-only members (`form`, `validity`, `willValidate`, …) are part of
    // the ELEMENT's surface but not of its JSX surface: writing `validity={…}`
    // in JSX would throw at runtime. CEM marks them `readonly`.
    if (m.readonly) continue;
    if (m.name.startsWith('#') || m.name.startsWith('_')) continue;
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    const type = (m.type?.text ?? 'unknown').replace(/\s+/g, ' ');
    const doc = (m.description ?? '').split('\n')[0];
    out.push({ name: m.name, type, doc, attr: attrByField.get(m.name) });
  }
  // Attributes with no matching field (documented via @attr only).
  for (const a of el.attributes ?? []) {
    if (a.fieldName && seen.has(a.fieldName)) continue;
    if (seen.has(a.name)) continue;
    seen.add(a.name);
    out.push({
      name: a.name,
      type: (a.type?.text ?? 'string').replace(/\s+/g, ' '),
      doc: (a.description ?? '').split('\n')[0],
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Type names that resolve from lib.dom / React and must NOT be imported from
 * an element subpath. Anything else capitalised in a property or event type is
 * a type the element's own module exports.
 */
const AMBIENT = new Set([
  'ValidityState',
  'HTMLFormElement',
  'HTMLElement',
  'ElementInternals',
  'CustomEvent',
  'Event',
  'Node',
  'Element',
  'Array',
  'Partial',
  'Readonly',
  'Record',
  'React',
]);

/** Capitalised identifiers in a type expression, minus the ambient ones. */
function referencedTypes(text) {
  return [...String(text).matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)]
    .map((m) => m[1])
    .filter((n) => !AMBIENT.has(n));
}

const lines = [];
lines.push('/* AUTOGENERATED from @civitai/elements custom-elements.json by');
lines.push('   scripts/gen-jsx-types.mjs. DO NOT EDIT.');
lines.push('   Regenerate: pnpm --filter @civitai/elements-react generate');
lines.push('   Guarded by test/generation-parity.test.ts. */');
lines.push('');
lines.push("import type * as React from 'react';");

// Per-subpath import sets: the element class plus every local type its props
// or event details mention.
const imports = new Map();
function need(tagName, name) {
  const key = subpath(tagName);
  if (!imports.has(key)) imports.set(key, new Set());
  imports.get(key).add(name);
}
for (const el of elements) {
  need(el.tagName, className(el.tagName));
  for (const p of propProps(el)) for (const t of referencedTypes(p.type)) need(el.tagName, t);
  for (const e of el.events ?? []) for (const t of referencedTypes(e.type?.text ?? '')) need(el.tagName, t);
}
for (const [from, names] of [...imports].sort()) {
  lines.push(`import type { ${[...names].sort().join(', ')} } from '${from}';`);
}
lines.push('');
lines.push('/**');
lines.push(' * Props every custom element accepts in React 19: the standard DOM');
lines.push(' * attributes plus `ref`/`key`/`children`. `class` is listed alongside');
lines.push(" * `className` because React 19 passes unknown attributes through verbatim");
lines.push(' * on custom elements, and hand-written HTML in the same codebase uses');
lines.push(' * `class`.');
lines.push(' */');
lines.push('interface CustomElementBaseProps<T extends HTMLElement> {');
lines.push('  ref?: React.Ref<T>;');
lines.push('  key?: React.Key;');
lines.push('  children?: React.ReactNode;');
lines.push('  className?: string;');
lines.push('  class?: string;');
lines.push('  id?: string;');
lines.push('  style?: React.CSSProperties;');
lines.push('  slot?: string;');
lines.push('  part?: string;');
lines.push('  title?: string;');
lines.push('  role?: React.AriaRole;');
lines.push('  tabIndex?: number;');
lines.push('  hidden?: boolean;');
lines.push('  onClick?: React.MouseEventHandler<T>;');
lines.push('  onFocus?: React.FocusEventHandler<T>;');
lines.push('  onBlur?: React.FocusEventHandler<T>;');
lines.push('  onKeyDown?: React.KeyboardEventHandler<T>;');
lines.push('  onKeyUp?: React.KeyboardEventHandler<T>;');
lines.push('}');
lines.push('');

for (const el of elements) {
  const cls = className(el.tagName);
  const props = propProps(el);
  const events = eventProps(el, cls);
  const summary = (el.description ?? '').split('\n')[0];
  lines.push('/**');
  if (summary) lines.push(` * ${summary}`);
  lines.push(` * \`<${el.tagName}>\` — props are set as PROPERTIES by React 19.`);
  lines.push(' */');
  lines.push(`export interface ${cls}Props extends CustomElementBaseProps<${cls}> {`);
  for (const p of props) {
    if (p.doc) lines.push(`  /** ${p.doc}${p.attr ? ` (attribute: \`${p.attr}\`)` : ''} */`);
    lines.push(`  ${p.name}?: ${p.type};`);
  }
  for (const e of events) {
    if (e.doc) lines.push(`  /** ${e.doc} */`);
    lines.push(`  ${JSON.stringify(e.name)}?: ${e.type};`);
  }
  lines.push('}');
  lines.push('');
}

lines.push("declare module 'react' {");
lines.push('  namespace JSX {');
lines.push('    interface IntrinsicElements {');
for (const el of elements) {
  lines.push(`      ${JSON.stringify(el.tagName)}: ${className(el.tagName)}Props;`);
}
lines.push('    }');
lines.push('  }');
lines.push('}');
lines.push('');
lines.push('export {};');
lines.push('');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'jsx.ts'), lines.join('\n'));
console.log(
  `[gen-jsx] wrote ${join('src', 'generated', 'jsx.ts')} for ${elements.length} elements: ${elements
    .map((e) => e.tagName)
    .join(', ')}`
);
