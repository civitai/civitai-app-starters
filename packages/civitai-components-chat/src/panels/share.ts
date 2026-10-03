import type { SavedPanel } from './panel.js';
import { checkPanelSpec, normalizeValues, type PanelSpec, type PanelValues } from './spec.js';

/** A panel as it travels in a link: its latest version and values, and where it came from. */
export interface SharedPanel {
  v: 1;
  id: string;
  version: number;
  spec: PanelSpec;
  values: PanelValues;
}

const HASH = /(?:^#|&)panel=([A-Za-z0-9_-]+)/;
const HELD = 'cvt:shared-panel';
const MAX_ENCODED = 16_000;

export function sharedPanelOf(panel: Pick<SavedPanel, 'id' | 'versions' | 'values'>): SharedPanel {
  const spec = panel.versions.at(-1)!;
  // Image values name the author's own files, which the recipient cannot open.
  const values = Object.fromEntries(Object.entries(panel.values).filter(([key]) => spec.inputs[key]?.kind !== 'image'));
  return { v: 1, id: panel.id, version: panel.versions.length, spec, values };
}

export async function encodePanel(shared: SharedPanel): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(shared));
  const compressed = await new Response(new Response(bytes).body!.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return toBase64Url(new Uint8Array(compressed));
}

/** Reads a link's panel and checks it like one the assistant wrote; anything else is `null`. */
export async function decodePanel(encoded: string): Promise<SharedPanel | null> {
  if (encoded.length > MAX_ENCODED) return null;
  try {
    const stream = new Response(fromBase64Url(encoded)).body!.pipeThrough(new DecompressionStream('deflate-raw'));
    const raw = JSON.parse(await new Response(stream).text()) as Partial<SharedPanel>;
    if (raw?.v !== 1 || typeof raw.id !== 'string') return null;
    const checked = checkPanelSpec(raw.spec);
    if (!checked.spec) return null;
    const values = normalizeValues(checked.spec, raw.values ?? {});
    for (const [key, input] of Object.entries(checked.spec.inputs)) if (input.kind === 'image') values[key] = '';
    return { v: 1, id: raw.id.slice(0, 64), version: Number.isInteger(raw.version) ? raw.version! : 1, spec: checked.spec, values };
  } catch {
    return null;
  }
}

export async function panelLink(base: string, shared: SharedPanel): Promise<string> {
  return `${base.split('#')[0]}#panel=${await encodePanel(shared)}`;
}

/**
 * Moves a `#panel=` link out of the address bar into this tab's storage, so it survives a sign-in
 * redirect (which comes back without the hash). Call it before anything can redirect.
 */
export function holdSharedPanel(): void {
  const match = HASH.exec(globalThis.location?.hash ?? '');
  if (!match) return;
  try {
    globalThis.sessionStorage?.setItem(HELD, match[1]!);
  } catch {
    // Storage refused: the link still works when the viewer is already signed in.
  }
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
}

/** The panel a link brought, once; from the address bar or from {@link holdSharedPanel}. */
export async function takeSharedPanel(): Promise<SharedPanel | null> {
  let encoded = HASH.exec(globalThis.location?.hash ?? '')?.[1] ?? null;
  if (encoded) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  try {
    encoded ??= globalThis.sessionStorage?.getItem(HELD) ?? null;
    globalThis.sessionStorage?.removeItem(HELD);
  } catch {
    // Nothing held, or storage refused.
  }
  return encoded ? decodePanel(encoded) : null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
