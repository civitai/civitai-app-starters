/** Analyzer fixture, never imported at runtime: see `probe-base.ts`. */
import { defineElement } from '../../../src/elements/registry.js';

import { PROBE_DEFAULT, ProbeBase } from './probe-base.js';

const TAG = 'civitai-probe';

export class CivitaiProbe extends ProbeBase {
  override probeField = PROBE_DEFAULT;
}

export function defineCivitaiProbe(): void {
  defineElement(TAG, CivitaiProbe);
}
