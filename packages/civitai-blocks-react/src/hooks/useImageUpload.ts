import { useCallback, useEffect, useRef } from 'react';

import type {
  BlockGenerationSourceImageInfo,
  BlockImageScanResult,
  BlockPendingImageInfo,
  BlockUploadedImageInfo,
  BlockUploadPurpose,
} from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest, subscribeTyped } from '../internal/transport.js';
import { PICKER_REQUEST_TIMEOUT_MS } from './useCheckpointPicker.js';

/**
 * Generous hook-side backstop for {@link BlockImageScanResult} delivery. The
 * host-side scan POLL budget is authoritative and the consuming app applies its
 * own (shorter) timeout; this only guards against a verdict that never arrives,
 * resolving RETRYABLE so a later re-call can still pick up a late verdict from
 * the buffer.
 */
const SCAN_STATUS_TIMEOUT_MS = PICKER_REQUEST_TIMEOUT_MS;

/** Options for {@link useImageUpload}. */
export interface UseImageUploadOptions {
  /**
   * Upload MODE (default `'display'`):
   *  - `'display'` — a PUBLIC image; the host returns a MODERATED
   *    {@link BlockUploadedImageInfo} (scanned clean, within the SFW ceiling).
   *  - `'generationSource'` — a PRIVATE img2img source; UNSCANNED, so the host
   *    returns ONLY the source shape {@link BlockGenerationSourceImageInfo}
   *    (`{ url, width, height }`).
   */
  purpose?: BlockUploadPurpose;
  /**
   * Opt in to the NON-BLOCKING `'display'` flow. When `true`, `open()` resolves
   * EARLY (on persist) with a {@link BlockPendingImageInfo} and the scan verdict
   * is delivered separately via `scanStatus()` (see the async overload). Only
   * meaningful for `'display'`; ignored for `'generationSource'` (that path has
   * no host-side scan). Absent/`false` keeps the legacy blocking behavior.
   */
  asyncScan?: boolean;
}

/** Per-upload scan-tracking entry (keyed by `imageId` in the hook's internal map). */
interface ScanEntry {
  /**
   * The `requestId` the SDK generated for this upload's `OPEN_IMAGE_UPLOAD`
   * (echoed back on `IMAGE_UPLOAD_RESULT`). An inbound `IMAGE_SCAN_RESOLVED` is
   * honored ONLY when it matches BOTH this `requestId` (unguessable — forgery
   * resistance) AND the `imageId` (the map key — app-facing correlation).
   */
  requestId: string;
  /** The buffered verdict once it arrives (host emits AT MOST ONCE per request). */
  verdict?: BlockImageScanResult;
  /** `scanStatus()` callers awaiting a verdict that hasn't landed yet. */
  waiters: Array<{
    resolve: (r: BlockImageScanResult) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>;
}

/**
 * A verdict is TERMINAL when the host has reached a final answer (`scanned` /
 * `blocked`) — the block will never poll it again. An `error` verdict is
 * transient/retryable, so its entry is KEPT so `scanStatus()` can be re-called.
 * Terminal entries are EVICTED from the tracking map once delivered (see below)
 * so a long-lived block doing many uploads can't grow the map unbounded.
 */
function isTerminalVerdict(v: BlockImageScanResult): boolean {
  return v.status === 'scanned' || v.status === 'blocked';
}

/**
 * Drives the platform-side image-upload flow for App Blocks (Design 1 —
 * host-chrome). Mirrors {@link useResourcePicker}: `open` asks the host to open
 * its OWN native upload modal; the iframe never handles the bytes. The upload
 * routes through civitai's session-authed pipeline; the host is what decides
 * how the image is scanned/returned based on the requested `purpose`.
 *
 * The RETURN of `open()` is typed by `purpose` / `asyncScan`:
 *  - default / `'display'` (BLOCKING) → resolves with a MODERATED
 *    {@link BlockUploadedImageInfo} (imageId/nsfwLevel/contentRating/url), or
 *    `null` when the user dismissed the modal without a successful upload. The
 *    returned `url` is a Civitai-hosted image URL usable directly as a
 *    `WorkflowBody.sourceImage.url`.
 *  - `'display'` + `asyncScan: true` (NON-BLOCKING) → resolves EARLY (on persist)
 *    with a {@link BlockPendingImageInfo} (`status:'pending'`, imageId, url), or
 *    `null` on dismiss. The image is AUTHOR-PREVIEW-ONLY until the scan verdict —
 *    obtain it with `scanStatus(handle)`. Do NOT persist the image to a
 *    cross-user surface until `scanStatus` resolves `'scanned'`.
 *  - `'generationSource'` → resolves with the source
 *    {@link BlockGenerationSourceImageInfo} (`{ url, width, height }`, UNSCANNED —
 *    the orchestrator scans it at gen time), or `null` on dismiss. Feed it
 *    straight into a `WorkflowBody.sourceImage` for an img2img graph.
 *
 * Human-interactive, so it uses the same generous {@link PICKER_REQUEST_TIMEOUT_MS}
 * as the pickers (the host still resolves earlier on upload/dismiss/close).
 * Host-mediated, same trust model as `useResourcePicker` / `useBuzzWorkflow`.
 *
 * Backward-compatible: when `purpose` is omitted the hook sends NO `purpose`
 * field on `OPEN_IMAGE_UPLOAD`, so an older host (which normalizes an absent
 * purpose to `'display'`) behaves exactly as before.
 *
 * @example
 * // display (moderated public image) — default, BLOCKING
 * const { open } = useImageUpload();
 * const img = await open();
 * if (!img) return;                       // user dismissed
 * await submit({ kind: 'textToImage', modelId, modelVersionId,
 *   sourceImage: { url: img.url, width: 1024, height: 1024 }, params: { prompt } });
 *
 * @example
 * // display (NON-BLOCKING) — early handle now, scan verdict streamed
 * const { open, scanStatus } = useImageUpload({ asyncScan: true });
 * const handle = await open();            // BlockPendingImageInfo | null
 * if (!handle) return;
 * // …show the author their own preview immediately…
 * const verdict = await scanStatus(handle);
 * if (verdict.status === 'scanned') persistBackground(verdict.image);   // clean
 * else if (verdict.status === 'blocked') showRejected(verdict.reason);  // terminal
 * else retryLater(verdict.message);       // transient — re-call scanStatus(handle)
 *
 * @example
 * // generationSource (private img2img source, unscanned)
 * const { open } = useImageUpload({ purpose: 'generationSource' });
 * const src = await open();               // { url, width, height } | null
 * if (!src) return;
 * await submit({ kind: 'textToImage', modelId, modelVersionId,
 *   sourceImage: src, params: { prompt } });
 */
export function useImageUpload(options: { purpose: 'generationSource' }): {
  open: () => Promise<BlockGenerationSourceImageInfo | null>;
};
export function useImageUpload(options: { purpose?: 'display'; asyncScan: true }): {
  /** Early-resolve handle (image persisted, NOT yet scanned) or `null` (dismissed). */
  open: () => Promise<BlockPendingImageInfo | null>;
  /**
   * Resolve the async scan verdict for a handle returned by `open()`. Re-callable
   * for retry: the host emits the verdict once and the hook buffers it, so a
   * re-call after an `'error'`/timeout re-awaits (or immediately returns) the same
   * verdict. An unknown/expired handle resolves to a retryable `'error'`.
   */
  scanStatus: (handle: BlockPendingImageInfo) => Promise<BlockImageScanResult>;
};
export function useImageUpload(options?: { purpose?: 'display' }): {
  open: () => Promise<BlockUploadedImageInfo | null>;
};
export function useImageUpload(options?: UseImageUploadOptions): {
  open: () => Promise<
    BlockUploadedImageInfo | BlockGenerationSourceImageInfo | BlockPendingImageInfo | null
  >;
  // Optional on the IMPLEMENTATION signature so the non-async overloads (which
  // return `{ open }` only) stay compatible; the async overload types it required.
  scanStatus?: (handle: BlockPendingImageInfo) => Promise<BlockImageScanResult>;
} {
  const purpose = options?.purpose;
  const asyncScan = options?.asyncScan === true && purpose !== 'generationSource';

  // Per-instance scan tracking, keyed by imageId. Persists across renders; a
  // verdict is correlated back to its upload by imageId + the generated requestId.
  const scansRef = useRef<Map<number, ScanEntry>>(new Map());

  // Mount ONE listener for the host→block IMAGE_SCAN_RESOLVED push. The transport
  // invokes this ONLY AFTER the message has cleared BOTH the origin allowlist and
  // the payload validator (see IframeTransport.handleMessage), and we ADDITIONALLY
  // honor a verdict only if it matches a request this hook instance originated
  // (matching requestId + imageId), so concurrent instances coexist and a
  // forged/replayed verdict is ignored.
  useEffect(() => {
    const scans = scansRef.current;
    const unsubscribe = subscribeTyped(
      getTransport(),
      'IMAGE_SCAN_RESOLVED',
      ({ requestId, imageId, result }) => {
        const entry = scans.get(imageId);
        if (!entry || entry.requestId !== requestId) return; // not ours / forged
        if (entry.verdict) return; // host emits once — honor only the first
        entry.verdict = result;
        const hadWaiters = entry.waiters.length > 0;
        for (const w of entry.waiters) {
          clearTimeout(w.timeoutId);
          w.resolve(result);
        }
        entry.waiters = [];
        // Evict a TERMINAL verdict once it has been delivered to a live caller
        // (bounded-memory: L1). If nobody was waiting yet (verdict arrived before
        // scanStatus() was called), keep it BUFFERED so the eventual scanStatus()
        // can still read it — that read then evicts it (see scanStatus below).
        // `error` verdicts are always kept (retryable).
        if (hadWaiters && isTerminalVerdict(result)) scans.delete(imageId);
      },
    );
    return () => {
      unsubscribe();
      for (const entry of scans.values()) {
        for (const w of entry.waiters) clearTimeout(w.timeoutId);
      }
    };
  }, []);

  const open = useCallback(async () => {
    if (asyncScan) {
      // Omit `purpose` (display byte-compat) but opt into the early-resolve flow.
      const { requestId, selected } = await sendTypedRequest(
        getTransport(),
        { type: 'OPEN_IMAGE_UPLOAD', payload: { asyncScan: true } },
        'IMAGE_UPLOAD_RESULT',
        { timeoutMs: PICKER_REQUEST_TIMEOUT_MS },
      );
      if (!selected) return null; // dismissed

      // NEW host: an early-resolve pending handle. Track it and wait for the push.
      if ('status' in selected && selected.status === 'pending') {
        scansRef.current.set(selected.imageId, { requestId, waiters: [] });
        const handle: BlockPendingImageInfo = {
          status: 'pending',
          imageId: selected.imageId,
          url: selected.url,
        };
        return handle;
      }

      // OLD host (ignored asyncScan): it blocking-resolved a MODERATED image. Wrap
      // it in a pending-shaped handle AND pre-buffer a `scanned` verdict so
      // scanStatus() resolves immediately — no hang. (Compat matrix case 2.)
      if ('imageId' in selected && typeof selected.imageId === 'number') {
        const moderated = selected as BlockUploadedImageInfo;
        scansRef.current.set(moderated.imageId, {
          requestId,
          verdict: { status: 'scanned', image: moderated },
          waiters: [],
        });
        const handle: BlockPendingImageInfo = {
          status: 'pending',
          imageId: moderated.imageId,
          url: moderated.url,
        };
        return handle;
      }

      // Any other shape on a display request (e.g. an unexpected source-only
      // payload) → treat as dismissed rather than fabricate a handle.
      return null;
    }

    // ---- Existing BLOCKING behavior (unchanged) ----
    // Omit `purpose` for the default/display mode so the wire stays
    // byte-compatible with an older host that predates the field.
    const payload = purpose === 'generationSource' ? { purpose } : {};
    const { selected } = await sendTypedRequest(
      getTransport(),
      { type: 'OPEN_IMAGE_UPLOAD', payload },
      'IMAGE_UPLOAD_RESULT',
      { timeoutMs: PICKER_REQUEST_TIMEOUT_MS },
    );
    // Normalize the "dismissed" case to an explicit null so callers can
    // `if (!img) return;` without an `undefined` ambiguity.
    return selected ?? null;
  }, [asyncScan, purpose]);

  const scanStatus = useCallback(
    (handle: BlockPendingImageInfo): Promise<BlockImageScanResult> => {
      const entry = scansRef.current.get(handle.imageId);
      if (!entry) {
        // No tracked upload for this handle (a foreign/expired handle, or the
        // hook remounted). Retryable rather than a hang.
        return Promise.resolve({ status: 'error', message: 'unknown or expired upload handle' });
      }
      if (entry.verdict) {
        const buffered = entry.verdict;
        // A BUFFERED terminal verdict (the push arrived before this call) is
        // consumed here — evict it so the map doesn't grow (L1). `error` stays
        // (retryable). See isTerminalVerdict + the push handler above.
        if (isTerminalVerdict(buffered)) scansRef.current.delete(handle.imageId);
        return Promise.resolve(buffered);
      }
      return new Promise<BlockImageScanResult>((resolve) => {
        const timeoutId = setTimeout(() => {
          entry.waiters = entry.waiters.filter((w) => w.timeoutId !== timeoutId);
          resolve({ status: 'error', message: 'scan status timed out' });
        }, SCAN_STATUS_TIMEOUT_MS);
        entry.waiters.push({ resolve, timeoutId });
      });
    },
    [],
  );

  return { open, scanStatus };
}
