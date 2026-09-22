/**
 * PURE (no fs writes) so the build writer and the parity test consume the same
 * source of truth. `@lit/react` derives props and their types from the element
 * class, so this only names the tag, the class and the events.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const pkgRoot = join(here, '..');
export const componentsRoot = join(pkgRoot, '..', 'civitai-components');

export interface EventBinding {
  prop: string;
  event: string;
  /** A `detail` type to import, for a typed handler argument. */
  detail?: string;
}

/**
 * Hand-maintained: events are not in the manifest, and a wrong name here is a
 * silently dead callback. Guard tests pin these against the element sources.
 */
export const EVENTS: Record<string, EventBinding[]> = {
  'civitai-alert': [{ prop: 'onClose', event: 'close' }],
  'civitai-collapse': [{ prop: 'onToggle', event: 'toggle' }],
  'civitai-confirm-dialog': [
    { prop: 'onConfirm', event: 'confirm' },
    { prop: 'onClose', event: 'close' },
  ],
  // Not `onLoad`/`onError`: React wires those itself on any host element, so
  // sharing the name would call the handler twice.
  'civitai-image': [
    { prop: 'onImageLoad', event: 'load' },
    { prop: 'onImageError', event: 'error' },
  ],
  'civitai-menu': [{ prop: 'onSelect', event: 'select', detail: 'MenuSelectDetail' }],
  'civitai-pagination': [{ prop: 'onChange', event: 'change' }],
  'civitai-modal': [{ prop: 'onClose', event: 'close' }],
  'civitai-reaction': [{ prop: 'onReact', event: 'react', detail: 'ReactionDetail' }],
  'civitai-tabs': [{ prop: 'onChange', event: 'change' }],
  'civitai-tag': [{ prop: 'onVote', event: 'vote', detail: 'TagVoteDetail' }],
  'civitai-toast': [{ prop: 'onClose', event: 'close' }],
};

/** The field base re-dispatches both out of every field's shadow root (R4). */
export const RETARGETED = ['change', 'invalid'] as const;

function bodyOf(file: string, className: string): string {
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf(`export class ${className} `);
  if (start === -1) return source;
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

/**
 * This class's body AND every superclass in the package: a subclass inherits
 * the events its base dispatches, and a React prop for them either way.
 */
export function classBody(tag: string): string {
  const entry = elements().find((e) => e.tag === tag);
  if (!entry) return '';

  const bodies = [bodyOf(join(componentsRoot, entry.path), entry.className)];
  let superclass = entry.superclass;
  const seen = new Set<string>();
  while (superclass?.module?.startsWith('/src/') && !seen.has(superclass.name)) {
    seen.add(superclass.name);
    const file = join(componentsRoot, superclass.module.replace(/^\//, '').replace(/\.js$/, '.ts'));
    bodies.push(bodyOf(file, superclass.name));
    superclass = elements().find((e) => e.className === superclass!.name)?.superclass;
  }
  return bodies.join('\n');
}

export const isField = (tag: string): boolean =>
  classBody(tag).includes('extends CivitaiField') || classBody(tag).includes('class CivitaiField');

// Read off the base class rather than listed by hand: a control that joins the
// field base gains both events, and a list would quietly not know.
for (const { tag } of elements()) {
  if (!isField(tag)) continue;
  EVENTS[tag] = [
    ...(EVENTS[tag] ?? []),
    { prop: 'onChange', event: 'change' },
    { prop: 'onInvalid', event: 'invalid' },
  ];
}

interface Declaration {
  tagName?: string;
  name?: string;
  superclass?: { name: string; module?: string };
}
interface Module {
  path: string;
  declarations?: Declaration[];
}

export interface ElementEntry {
  tag: string;
  className: string;
  /** The package export the class and its `/define` live behind. */
  specifier: string;
  /** Where the source sits: elements are not all in one folder. */
  path: string;
  superclass?: { name: string; module?: string };
}

export function elements(): ElementEntry[] {
  const manifest = JSON.parse(
    readFileSync(join(componentsRoot, 'custom-elements.json'), 'utf8')
  ) as { modules: Module[] };

  return manifest.modules
    .flatMap((module) =>
      (module.declarations ?? [])
        .filter((declaration) => declaration.tagName)
        .map((declaration) => ({
          tag: declaration.tagName!,
          className: declaration.name!,
          specifier: basename(module.path, '.ts'),
          path: module.path,
          superclass: declaration.superclass,
        }))
    )
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Acts as the viewer through @civitai/sdk, so it stays out of the barrel. */
export const usesSdk = (entry: ElementEntry): boolean => entry.path.startsWith('src/sdk/');

export const pascal = (tag: string): string =>
  tag.replace(/(^|-)([a-z])/g, (_, __, letter: string) => letter.toUpperCase());

const BANNER =
  '// AUTOGENERATED by scripts/build-react-bindings.ts. DO NOT EDIT.\n' +
  '// Regenerate: pnpm --filter @civitai/components-react build:bindings\n';

/** Filename -> contents, for every binding plus the barrel. */
export function bindingSources(): Map<string, string> {
  const out = new Map<string, string>();

  for (const { tag, className, specifier } of elements()) {
    const events = EVENTS[tag] ?? [];
    const details = [...new Set(events.map((e) => e.detail).filter(Boolean))] as string[];
    const typeImports = details.length > 0 ? `, ${details.map((d) => `type ${d}`).join(', ')}` : '';
    const eventLines = events
      .map(({ prop, event, detail }) =>
        detail
          ? `    ${prop}: '${event}' as EventName<CustomEvent<${detail}>>,`
          : `    ${prop}: '${event}',`
      )
      .join('\n');

    out.set(
      `${tag}.ts`,
      `${BANNER}
import { createComponent${events.some((e) => e.detail) ? ', type EventName' : ''} } from '@lit/react';
import * as React from 'react';

import { ${className} as ${className}Element${typeImports} } from '@civitai/components/${specifier}';
import '@civitai/components/${specifier}/define';

export const ${pascal(tag)} = createComponent({
  react: React,
  tagName: '${tag}',
  elementClass: ${className}Element,
  displayName: '${pascal(tag)}',
  events: {
${eventLines}
  },
});
`
    );
  }

  out.set(
    'index.ts',
    `${BANNER}
// Importing this barrel registers every presentational element. Import a single
// binding instead when bundle size matters, or for one that needs @civitai/sdk.
${elements()
  .filter((entry) => !usesSdk(entry))
  .map(({ tag }) => `export { ${pascal(tag)} } from './${tag}.js';`)
  .join('\n')}
`
  );

  return out;
}
