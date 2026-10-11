import { useCallback } from 'react';

import { getTransport } from '../transport/singleton.js';

/** What {@link useBlockAnalytics} returns. */
export interface UseBlockAnalytics {
  /**
   * Send one custom event. Fire-and-forget: returns nothing, and nothing tells
   * you whether it was recorded. See {@link useBlockAnalytics}
   * for what is kept.
   */
  track: (eventName: string, properties?: Record<string, unknown>) => void;
}

/**
 * Custom events for your app's analytics panel. Fire-and-forget: the host
 * forwards the event and the block gets no acknowledgement, so never wait on
 * one or branch on it.
 *
 * 🔴 **Only what your manifest DECLARES is recorded.** Declare every event, and
 * every property it carries, under `analytics.events` in `block.manifest.json`.
 * The declaration is reviewed with the rest of the manifest, and events are
 * accepted against the APPROVED version:
 *
 * - **An undeclared event** is counted as dropped. Its name and properties are
 *   not stored; the owner sees only a count of drops.
 * - **A declared event keeps only its declared properties**, each only when the
 *   value has the declared type. An undeclared property, or a value of the
 *   wrong type, is dropped and the rest of the event is kept.
 * - **Property types are `enum`, `number` and `boolean`.** There is no free-text
 *   string: a string is kept only when it is one of the enum's declared values.
 *   So a prompt, an email or a username cannot be recorded. A `number` is not
 *   range-limited, so do not use one to carry an identifier.
 * - Names are lowercase snake_case: a letter, then up to 63 of `a-z`, `0-9`, `_`.
 *   At most 50 events per app and 10 properties per event.
 *
 * **Limits.** Each mount of your app may send at most 10 events per second and
 * 500 in total; the host batches events into bodies of at most 32 KiB. An event
 * over a limit is dropped in the browser and is not counted anywhere, so the
 * panel's numbers are floors. Events are recorded only from the production
 * site.
 *
 * **What owners see.** Aggregates in the app's analytics panel: per declared
 * event, the count, unique signed-in viewers, and the declared properties'
 * breakdowns. Signed-out viewers are counted as events but never identified,
 * and the team's own activity is excluded by default. Individual events are
 * never shown.
 *
 * **Check locally.** In `dev:live`, pass your manifest to `createLiveHost`
 * (`createLiveHost({ blockToken, manifest })`) and the console warns once per
 * undeclared event, undeclared property, or value of the wrong type.
 *
 * @example
 * // block.manifest.json
 * // "analytics": { "events": { "generate_clicked": { "properties": {
 * //   "mode": { "type": "enum", "values": ["txt2img", "img2img"] },
 * //   "batch": { "type": "number" } } } } }
 * const { track } = useBlockAnalytics();
 * track('generate_clicked', { mode: 'txt2img', batch: 4 });
 */
export function useBlockAnalytics(): UseBlockAnalytics {
  const track = useCallback((eventName: string, properties?: Record<string, unknown>) => {
    getTransport().sendMessage({ type: 'TRACK_EVENT', payload: { eventName, properties } });
  }, []);
  return { track };
}
