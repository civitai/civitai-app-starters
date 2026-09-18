export interface Viewer {
  id: number;
  username: string | null;
  status: 'active' | 'muted';
  /** `null` when the token carries no budget claim. */
  buzzBudget: number | null;
}

/** Why consent can never be granted in this environment. */
export type ConsentRefusal = 'ungrantable';

export type ViewerRequests = {
  GET_VIEWER: { params: Record<string, never>; result: { viewer: Viewer } };
};

export type ViewerNotifications = {
  REQUEST_SIGN_IN: { returnUrl?: string };
  REQUEST_CONSENT: { scopes?: string[] };
};

export type ViewerPushes = {
  /** `scopes` is advisory and may be empty; the message itself is the refusal. */
  CONSENT_UNAVAILABLE: { reason: ConsentRefusal; scopes: string[] };
};
