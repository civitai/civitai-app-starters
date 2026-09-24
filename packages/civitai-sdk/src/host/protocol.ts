import type { WrappedToken } from '../core/handshake.js';

export type ResourcePickerType = 'Checkpoint' | 'LORA';

/** The one resource the viewer picked. Discovery only: nothing here is an entitlement. */
export interface PickedResource {
  versionId: number;
  modelId: number;
  modelName: string;
  versionName: string;
  baseModel: string;
  modelType: string;
  strength?: number;
  minStrength?: number;
  maxStrength?: number;
  trainedWords?: string[];
  clipSkip?: number | null;
}

export interface DownloadRequest {
  /** An own-output URL. The host allowlists the origin it will fetch. */
  url: string;
  filename?: string;
}

/** Why consent can never be granted in this environment. */
export type ConsentRefusal = 'ungrantable';

/**
 * An uploaded image the host has finished moderating. `nsfwLevel` and
 * `contentRating` are the host's verdict, so a block renders by them rather
 * than judging the image itself.
 */
export interface UploadedImage {
  imageId: number;
  /** The host's browsing-level bitmask for this image. */
  nsfwLevel: number;
  contentRating: 'g' | 'pg' | 'pg13' | 'r' | 'x';
  url: string;
}

/**
 * A private img2img source. The host stores it UNSCANNED — the orchestrator
 * scans it when the workflow runs — so it carries no moderation verdict and
 * belongs in a generation step, not on a surface other viewers can see.
 *
 * A step takes the url and the dimensions separately: `sourceImage` is the url,
 * and `width`/`height` are the step's own.
 */
export interface SourceImage {
  url: string;
  width: number;
  height: number;
}

/**
 * The host's moderation verdict on an upload, reached after the upload itself
 * has already resolved.
 *
 * 🔴 `scanned` is the ONLY value that clears an image for a surface other
 * viewers can see. `blocked` is the host refusing it, and `error` is the host
 * declining to answer — neither is a pass, and a caller that reads "not
 * blocked" as clean has inverted the guarantee.
 */
export type ImageScanResult =
  | { status: 'scanned'; image: UploadedImage }
  | { status: 'blocked'; reason?: string }
  | { status: 'error'; message?: string };

export type HostRequests = {
  SAVE_IMAGE: { params: DownloadRequest; result: { ok?: boolean } };
  OPEN_RESOURCE_PICKER: {
    params: { resourceType: ResourcePickerType; baseModelGroup?: string };
    result: { selected?: PickedResource };
  };
  OPEN_BUZZ_PURCHASE: {
    params: { suggestedAmount?: number };
    result: { purchased: boolean; newBalance?: number };
  };
  /**
   * The host's own upload modal; the frame never handles the bytes.
   *
   * `purpose` is sent ONLY for `'generationSource'`. The host normalises an
   * absent — or unrecognised — purpose to `'display'`, so omitting it keeps the
   * display call byte-identical to the wire hosts have answered all along.
   *
   * `asyncScan` makes the host resolve on persist and stream the verdict as an
   * `IMAGE_SCAN_RESOLVED` push. The host ignores it for `'generationSource'`,
   * which has no scan at all.
   */
  OPEN_IMAGE_UPLOAD: {
    params: { purpose?: 'generationSource'; asyncScan?: true };
    result: {
      selected?: UploadedImage | SourceImage | { status: 'pending'; imageId: number; url: string };
    };
  };
  REQUEST_TOKEN: { params: { blockInstanceId: string }; result: { token: WrappedToken } };
};

export type HostNotifications = {
  RESIZE_IFRAME: { height: number };
  BLOCK_ERROR: { message: string; fatal: boolean };
  NAVIGATE: { path: string; target: 'current' | 'new_tab' };
  REQUEST_SIGN_IN: { returnUrl?: string };
  REQUEST_CONSENT: { scopes?: string[] };
};

export type HostPushes = {
  /** The page is hidden; stop timers and polling until `RESUME`. */
  SUSPEND: undefined;
  RESUME: undefined;
  /** `scopes` is advisory and may be empty; the message itself is the refusal. */
  CONSENT_UNAVAILABLE: { reason: ConsentRefusal; scopes: string[] };
  /**
   * The verdict on an `asyncScan` upload, once per upload the host accepted.
   * It arrives long after that upload's own reply, which is why it is a push.
   *
   * `requestId` echoes the `OPEN_IMAGE_UPLOAD` it belongs to, but the transport
   * owns request ids and hands none out, so this client correlates on
   * `imageId` — the id it was given in the reply.
   */
  IMAGE_SCAN_RESOLVED: { requestId: string; imageId: number; result: ImageScanResult };
};
