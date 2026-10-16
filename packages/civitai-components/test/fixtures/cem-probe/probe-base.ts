/**
 * Analyzer fixture, never imported at runtime: a base declaring a member that
 * its subclass (`civitai-probe.ts`) redeclares with an IMPORTED default, the
 * shape `field-base.ts` and its controls would take with a shared constant.
 */
import { LitElement } from 'lit';

export type ProbeSize = 'sm' | 'md' | 'lg';

/** The subclass's default, resolved by the analyzer from this declaration. */
export const PROBE_DEFAULT: ProbeSize = 'md';

export abstract class ProbeBase extends LitElement {
  /** Wider than the subclass's own, so a base type copied over it is visible. */
  probeField: string = 'sm';
}
