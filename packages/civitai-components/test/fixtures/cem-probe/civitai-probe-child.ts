/**
 * Analyzer fixture, never imported at runtime: a grandchild of `ProbeBase` that
 * does NOT redeclare `probeField`, so it inherits `civitai-probe`'s own entry —
 * whose default the analyzer only resolves after copying it here.
 */
import { defineElement } from '../../../src/elements/registry.js';

import { CivitaiProbe } from './civitai-probe.js';

const TAG = 'civitai-probe-child';

export class CivitaiProbeChild extends CivitaiProbe {}

export function defineCivitaiProbeChild(): void {
  defineElement(TAG, CivitaiProbeChild);
}
