/**
 * Test-only helpers for `@civitai/blocks-react`. Not part of the runtime
 * surface — block apps should never import from here.
 *
 * Subpath-exported so accidental production imports show up in code review.
 */

import { __resetTransport } from './internal/singleton.js';

export { __resetTransport as resetTransport };

/**
 * Builds a `MessageEvent` that mimics a parent-frame postMessage so tests can
 * exercise `IframeTransport.handleMessage` without a real cross-frame setup.
 */
export function mockParentMessage(
  data: unknown,
  origin: string,
): MessageEvent {
  return new MessageEvent('message', { data, origin, source: null });
}
