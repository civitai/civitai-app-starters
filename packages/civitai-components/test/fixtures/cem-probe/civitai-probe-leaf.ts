/**
 * Analyzer fixture, never imported at runtime: `ProbeMid` is the FIRST class
 * to declare `probeField`, initialised from an imported constant, and
 * `civitai-probe-leaf` inherits it one level down. The analyzer names the
 * right declarer here, so nothing re-points the entry — the leaf's copy still
 * needs the type and value the mid's initializer resolves to.
 */
import { LitElement } from 'lit';

import { defineElement } from '../../../src/elements/registry.js';

import { PROBE_DEFAULT } from './probe-base.js';

export abstract class ProbeMid extends LitElement {
  probeField = PROBE_DEFAULT;
}

const TAG = 'civitai-probe-leaf';

export class CivitaiProbeLeaf extends ProbeMid {}

export function defineCivitaiProbeLeaf(): void {
  defineElement(TAG, CivitaiProbeLeaf);
}
