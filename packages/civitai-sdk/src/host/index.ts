import { createCaller, createListener, createNotifier } from '../core/messaging.js';
import { tokenFromWrapped, type BlockTransport } from '../core/transport.js';
import type { GrantOptions, Scope, Session, TokenOptions } from '../session/index.js';

import type {
  DownloadRequest,
  HostNotifications,
  HostPushes,
  HostRequests,
  ImageScanResult,
  PickedResource,
  ResourcePickerType,
  SourceImage,
  UploadedImage,
} from './protocol.js';

export type {
  ConsentRefusal,
  DownloadRequest,
  ImageScanResult,
  PickedResource,
  ResourcePickerType,
  SourceImage,
  UploadedImage,
} from './protocol.js';

const call = createCaller<HostRequests>();
const notify = createNotifier<HostNotifications>();
const on = createListener<HostPushes>();

export interface HostCallOptions {
  signal?: AbortSignal;
}

/**
 * An upload the host has stored but not yet finished moderating. The image
 * exists and its author can see it; nobody else may until `scan()` answers.
 */
export interface PendingImage {
  imageId: number;
  /** The author's own preview. Not for any other viewer until `scan()` says `scanned`. */
  url: string;
  /**
   * The host's verdict on this upload. Resolves once the host reaches one and
   * returns the same answer to every later call, so it is safe to re-read.
   *
   * 🔴 It waits as long as the host takes — the host is what bounds the scan,
   * and this package sets no deadline of its own. Pass a `signal` if your app
   * needs one; aborting gives up on the verdict, it does not decide it.
   */
  scan(opts?: HostCallOptions): Promise<ImageScanResult>;
}

/** Asking the host page to show its own UI. Data goes over the API, not here. */
export interface Host {
  /** Resizes the frame, clamped to the manifest's bounds. */
  resize(height: number): void;
  /** Keeps the frame as tall as `element` (the body by default). Returns a stop function. */
  autoResize(element?: Element): () => void;
  /** `fatal` swaps the block for the host's fallback, for a block that cannot continue. */
  reportError(message: string, args?: { fatal?: boolean }): void;
  /** Deep-links within this app's own sub-paths; the host refuses anything else. */
  navigate(path: string, args?: { target?: 'current' | 'new_tab' }): void;
  /** Fires `false` when the page hides and `true` when it returns. */
  onVisibilityChange(handler: (visible: boolean) => void): () => void;
  /** Starts sign-in; the block re-initialises as a signed-in viewer. */
  requestSignIn(args?: { returnUrl?: string }): void;
  /**
   * Saves to the viewer's device through the host, because a sandboxed frame
   * cannot. The host fetches only from origins it allowlists.
   */
  download(request: DownloadRequest, opts?: HostCallOptions): Promise<void>;
  /** civitai's own picker. Resolves the one resource chosen, or `null` if dismissed. */
  openResourcePicker(
    args: { resourceType: ResourcePickerType; baseModelGroup?: string },
    opts?: HostCallOptions,
  ): Promise<PickedResource | null>;
  /** `suggestedAmount` is a starting point the viewer can change. */
  openBuzzPurchase(
    args?: { suggestedAmount?: number },
    opts?: HostCallOptions,
  ): Promise<{ purchased: boolean }>;
  /**
   * civitai's own upload modal. The bytes go through the host's session, never
   * through the frame, and `null` means the viewer closed it without uploading.
   *
   * `purpose: 'generationSource'` uploads a PRIVATE img2img source: unscanned
   * here, scanned by the orchestrator when the workflow runs.
   */
  openImageUpload(
    args: { purpose: 'generationSource' },
    opts?: HostCallOptions,
  ): Promise<SourceImage | null>;
  /**
   * A PUBLIC image. The host stores it and moderates it afterwards, so this
   * resolves with a {@link PendingImage} — the image, plus the `scan()` that
   * answers whether anyone but its author may see it.
   */
  openImageUpload(
    args?: { purpose?: 'display' },
    opts?: HostCallOptions,
  ): Promise<PendingImage | null>;
}

export function createHost(transport: BlockTransport): Host {
  return {
    resize: (height) => notify('RESIZE_IFRAME', { height }, { transport }),
    autoResize(element) {
      const target = element ?? globalThis.document?.body;
      if (!target || typeof ResizeObserver === 'undefined') return () => {};
      let sent = -1;
      const report = () => {
        const height = Math.ceil(target.getBoundingClientRect().height);
        if (height === sent) return;
        sent = height;
        notify('RESIZE_IFRAME', { height }, { transport });
      };
      const observer = new ResizeObserver(report);
      observer.observe(target);
      report();
      return () => observer.disconnect();
    },
    reportError: (message, args = {}) =>
      notify('BLOCK_ERROR', { message, fatal: args.fatal ?? false }, { transport }),
    navigate: (path, args = {}) =>
      notify('NAVIGATE', { path, target: args.target ?? 'current' }, { transport }),
    onVisibilityChange(handler) {
      const offSuspend = on(transport, 'SUSPEND', () => handler(false));
      const offResume = on(transport, 'RESUME', () => handler(true));
      return () => {
        offSuspend();
        offResume();
      };
    },
    requestSignIn: (args = {}) => notify('REQUEST_SIGN_IN', args, { transport }),
    async download(request, opts = {}) {
      await call('SAVE_IMAGE', request, { ...opts, transport });
    },
    async openResourcePicker(args, opts = {}) {
      return (await call('OPEN_RESOURCE_PICKER', args, { ...opts, transport })).selected ?? null;
    },
    async openBuzzPurchase(args = {}, opts = {}) {
      const { purchased } = await call('OPEN_BUZZ_PURCHASE', args, { ...opts, transport });
      return { purchased };
    },
    // Cast scoped to this one member: the interface overloads it so each
    // `purpose` names its own return, which one implementation signature cannot
    // express. Every other member here is still checked against `Host`.
    openImageUpload: ((
      args: { purpose?: 'display' | 'generationSource' } = {},
      opts: HostCallOptions = {},
    ) =>
      args.purpose === 'generationSource'
        ? openSourceUpload(transport, opts)
        : openDisplayUpload(transport, opts)) as Host['openImageUpload'],
  };
}

async function openSourceUpload(
  transport: BlockTransport,
  opts: HostCallOptions,
): Promise<SourceImage | null> {
  const { selected } = await call(
    'OPEN_IMAGE_UPLOAD',
    { purpose: 'generationSource' },
    { ...opts, transport },
  );
  return asSourceImage(selected);
}

/**
 * The public-image upload. Two things make it more than one `call`:
 *
 * The verdict is a PUSH the host sends on its own schedule, so the listener has
 * to be attached BEFORE the request goes out — a scan that finishes quickly can
 * land before the reply is read, and a verdict nobody heard is a verdict lost.
 *
 * And a host that does not know `asyncScan` answers the OLD way: it blocks its
 * modal on the scan and replies with a moderated image. That reply is a verdict
 * already reached, so it is stored as one; a caller written against `scan()`
 * gets its answer rather than waiting on a push no such host will ever send.
 */
function openDisplayUpload(
  transport: BlockTransport,
  opts: HostCallOptions,
): Promise<PendingImage | null> {
  let verdict: ImageScanResult | undefined;
  let imageId: number | undefined;
  /** Verdicts that arrived before the reply named our `imageId`, keyed by theirs. */
  const early = new Map<number, ImageScanResult>();
  const waiters = new Set<(result: ImageScanResult) => void>();

  const settle = (result: ImageScanResult) => {
    verdict = result;
    off();
    for (const waiter of [...waiters]) waiter(result);
    waiters.clear();
  };

  const off = on(transport, 'IMAGE_SCAN_RESOLVED', (push) => {
    if (verdict !== undefined) return; // the host emits once; honour the first
    if (typeof push?.imageId !== 'number') return;
    if (imageId === undefined) early.set(push.imageId, asScanResult(push.result));
    else if (push.imageId === imageId) settle(asScanResult(push.result));
  });

  const handle = (id: number, url: string): PendingImage => {
    imageId = id;
    const buffered = early.get(id);
    if (buffered !== undefined && verdict === undefined) settle(buffered);
    return {
      imageId: id,
      url,
      scan: ({ signal } = {}) =>
        new Promise<ImageScanResult>((resolve, reject) => {
          if (verdict !== undefined) return resolve(verdict);
          if (signal?.aborted) return reject(signal.reason);
          const deliver = (result: ImageScanResult) => {
            signal?.removeEventListener('abort', onAbort);
            resolve(result);
          };
          const onAbort = () => {
            waiters.delete(deliver);
            reject(signal!.reason);
          };
          waiters.add(deliver);
          signal?.addEventListener('abort', onAbort, { once: true });
        }),
    };
  };

  return (async () => {
    let selected;
    try {
      ({ selected } = await call('OPEN_IMAGE_UPLOAD', { asyncScan: true }, { ...opts, transport }));
    } catch (error) {
      off();
      throw error;
    }

    const pending = asPendingUpload(selected);
    if (pending) return handle(pending.imageId, pending.url);

    // A host that ignored `asyncScan` and scanned before replying.
    const moderated = asUploadedImage(selected);
    if (moderated) {
      const image = handle(moderated.imageId, moderated.url);
      if (verdict === undefined) settle({ status: 'scanned', image: moderated });
      return image;
    }

    // Dismissed, or a reply this flow cannot read as an image. Never invent a
    // handle: its `scan()` would have nothing to answer with.
    off();
    return null;
  })();
}

function asSourceImage(value: unknown): SourceImage | null {
  const v = value as Partial<SourceImage> | undefined;
  return typeof v?.url === 'string' && typeof v.width === 'number' && typeof v.height === 'number'
    ? { url: v.url, width: v.width, height: v.height }
    : null;
}

function asPendingUpload(value: unknown): { imageId: number; url: string } | null {
  const v = value as { status?: unknown; imageId?: unknown; url?: unknown } | undefined;
  return v?.status === 'pending' && typeof v.imageId === 'number' && typeof v.url === 'string'
    ? { imageId: v.imageId, url: v.url }
    : null;
}

function asUploadedImage(value: unknown): UploadedImage | null {
  const v = value as Partial<UploadedImage> | undefined;
  return typeof v?.imageId === 'number' &&
    typeof v.url === 'string' &&
    typeof v.nsfwLevel === 'number' &&
    typeof v.contentRating === 'string'
    ? {
        imageId: v.imageId,
        url: v.url,
        nsfwLevel: v.nsfwLevel,
        contentRating: v.contentRating,
      }
    : null;
}

/**
 * 🔴 The only way into {@link ImageScanResult}, and it fails CLOSED in both
 * directions: `blocked` is kept exactly as the host sent it, and nothing
 * becomes `scanned` without a readable image to back the claim. A verdict this
 * cannot read is an `error` — which is not a pass — rather than dropped, since
 * a dropped verdict leaves `scan()` waiting on a push the host has already sent.
 */
function asScanResult(value: unknown): ImageScanResult {
  const v = value as { status?: unknown; image?: unknown; reason?: unknown; message?: unknown };
  if (v?.status === 'blocked') {
    return { status: 'blocked', ...(typeof v.reason === 'string' ? { reason: v.reason } : {}) };
  }
  if (v?.status === 'scanned') {
    const image = asUploadedImage(v.image);
    return image
      ? { status: 'scanned', image }
      : { status: 'error', message: 'the host reported a scan with no image' };
  }
  return { status: 'error', ...(typeof v?.message === 'string' ? { message: v.message } : {}) };
}

/** The token the host minted for this block, kept current as the host rotates it. */
export function createHostSession(transport: BlockTransport): Session {
  return {
    async getToken({ fresh, signal }: TokenOptions = {}) {
      if (!fresh) return transport.snapshot.get().token.raw;
      const { blockInstanceId } = transport.snapshot.get();
      const { token } = await call('REQUEST_TOKEN', { blockInstanceId }, { transport, signal });
      return tokenFromWrapped(token).raw;
    },
    requestGrants: (scopes, opts = {}) => requestGrants(transport, scopes, opts),
  };
}

/**
 * The host re-mints the token once the viewer consents, so a grant arrives as
 * a token carrying the scopes. A viewer who closes the dialog sends nothing,
 * so pass a `signal` to bound the wait.
 */
function requestGrants(
  transport: BlockTransport,
  scopes: readonly Scope[],
  { signal }: GrantOptions,
): Promise<boolean> {
  const granted = () => {
    const held = new Set(transport.snapshot.get().token.scopes);
    return scopes.every((scope) => held.has(scope));
  };
  if (granted()) return Promise.resolve(true);
  if (signal?.aborted) return Promise.reject(signal.reason);

  return new Promise<boolean>((resolve, reject) => {
    const release: (() => void)[] = [];
    const settle = (finish: () => void) => {
      for (const off of release) off();
      finish();
    };

    release.push(transport.snapshot.subscribe(() => granted() && settle(() => resolve(true))));
    release.push(on(transport, 'CONSENT_UNAVAILABLE', () => settle(() => resolve(false))));
    if (signal) {
      const onAbort = () => settle(() => reject(signal.reason));
      signal.addEventListener('abort', onAbort, { once: true });
      release.push(() => signal.removeEventListener('abort', onAbort));
    }

    notify('REQUEST_CONSENT', { scopes: [...scopes] }, { transport });
  });
}
