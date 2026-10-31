import { BlockTransportDetector, type DetectOptions } from './detector.js';
import type { BlockTransport } from './transport.js';

let cached: BlockTransport | null = null;

/**
 * Whether a failed MOUNT-TIME connect (`useTransportConnection`) has already been
 * logged. Lives here, not in the hook, so `__resetTransport()` clears it with the
 * transport it describes: one log per transport lifecycle — once per page in
 * production, once per reset in tests. A latch that outlived the reset would
 * silence every misconfigured case in a test worker after the first.
 */
let connectFailureReported = false;

/**
 * Returns true the FIRST time it is called in this transport lifecycle, false
 * after. Internal — used by `useTransportConnection` to log a failed connect
 * once instead of once per hook instance.
 */
export function claimConnectFailureReport(): boolean {
  if (connectFailureReported) return false;
  connectFailureReported = true;
  return true;
}

/**
 * Returns the process-wide transport, instantiating it on first call.
 *
 * Hooks call this with no arguments — they get whatever the detector chose
 * (iframe vs inline) based on the runtime environment. Tests and starter
 * dev harnesses can pass explicit `DetectOptions` once before the first
 * hook call to override origin allowlists or inject a mock window.
 *
 * After the first call with options, later calls without options return
 * the same instance. A later call WITH different options is ignored — call
 * `__resetTransport()` (from `@civitai/blocks-react/testing`) first.
 */
export function getTransport(opts?: DetectOptions): BlockTransport {
  if (cached) return cached;
  cached = BlockTransportDetector.detect(opts);
  return cached;
}

/** Test-only. Production hooks never call this. */
export function __resetTransport(): void {
  // Some transports allocate listeners; dispose if possible.
  const disposable = cached as (BlockTransport & { dispose?: () => void }) | null;
  disposable?.dispose?.();
  cached = null;
  connectFailureReported = false;
}
