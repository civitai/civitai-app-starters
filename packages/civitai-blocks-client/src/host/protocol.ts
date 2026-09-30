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
};
