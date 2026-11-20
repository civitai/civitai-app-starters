import { VERSION } from '../version.generated.js';

type Stamped = CustomElementConstructor & { civitaiElementsVersion?: string };

interface SharedRegistry {
  warned: Set<string>;
}

/**
 * Shared across every copy of this package on the page, so two bundled copies
 * warn once between them rather than once each.
 */
const SHARED = Symbol.for('civitai.elements');

function registry(): SharedRegistry {
  const host = globalThis as unknown as Record<symbol, SharedRegistry | undefined>;
  return (host[SHARED] ??= { warned: new Set() });
}

/**
 * A duplicate `customElements.define` throws, aborting the calling module and
 * leaving every LATER element in it unregistered — so conflicts no-op and warn.
 */
export function defineElement(tag: string, ctor: CustomElementConstructor): void {
  if (typeof customElements === 'undefined') return;

  (ctor as Stamped).civitaiElementsVersion = VERSION;

  const existing = customElements.get(tag) as Stamped | undefined;
  if (!existing) {
    customElements.define(tag, ctor);
    return;
  }

  const incumbent = existing.civitaiElementsVersion;
  const { warned } = registry();
  if (incumbent !== VERSION && !warned.has(tag)) {
    warned.add(tag);
    console.warn(
      `[civitai] <${tag}> is already defined by @civitai/components ${incumbent ?? '(unknown build)'}; ` +
        `this copy (${VERSION}) will not replace it. Deduplicate the package to avoid mixed behaviour.`
    );
  }
}

export { VERSION };
