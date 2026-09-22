/**
 * The host's side of the handshake, as it arrives on the wire. The shapes are
 * the host's and must track it.
 */

export type Theme = 'light' | 'dark';

/** Informational only — derive SFW from a browsing level, never from this. */
export type ColorDomain = 'green' | 'blue' | 'red';

export interface ViewerInfo {
  signedIn?: true;
  id: number;
  username: string | null;
  status?: 'active' | 'banned' | 'muted';
}

export type ModelSlotId = 'model.sidebar_top' | 'model.below_images' | 'model.actions_extra';
export type PageSlotId = 'app.page';

export interface ShowcaseImage {
  id: number;
  url: string;
  width: number;
  height: number;
  prompt: string | null;
  negativePrompt: string | null;
  cfgScale: number | null;
  steps: number | null;
  seed: number | null;
  sampler: string | null;
  /** Per-resource CLIP layer skip count (SD1/SDXL). Flux ignores it. */
  clipSkip: number | null;
}

export interface BlockCheckpointInfo {
  versionId: number;
  modelId: number;
  modelName: string;
  versionName: string;
  baseModel: string;
}

export interface ModelSlotContext {
  slotId: ModelSlotId;
  modelId: number;
  modelVersionId: number;
  modelName: string;
  modelType: string;
  modelNsfwLevel: number;
  theme?: Theme;
  checkpoint?: BlockCheckpointInfo | null;
  showcaseImages?: ShowcaseImage[];
}

export interface PageSlotContext {
  slotId: PageSlotId;
  entityType?: 'none';
  slug: string;
  subPath: string;
  viewerUserId: number | null;
  viewerUsername?: string | null;
  theme?: Theme;
}

/** A slot this package does not know; `slotId` is all that is guaranteed. */
export interface UnknownSlotContext {
  slotId: string;
}

export type BlockContext = ModelSlotContext | PageSlotContext | UnknownSlotContext;

export interface BlockSettings {
  publisherSettings: Record<string, unknown>;
  userSettings: Record<string, unknown>;
}

/** A token on the wire; `expiresAt` is ISO-8601 until the transport parses it. */
export interface WrappedToken {
  raw: string;
  scopes: string[];
  expiresAt: string;
  buzzBudget?: number;
}

export interface BlockToken {
  raw: string;
  scopes: string[];
  expiresAt: Date;
  buzzBudget?: number;
}

/**
 * The host still sends `blockId` and `appId`; they are build-time identity a
 * block reads from its own manifest, so they are not declared here.
 */
export interface BlockInitPayload {
  blockInstanceId: string;
  token: WrappedToken;
  context: BlockContext;
  settings: BlockSettings;
  /** `null` for anonymous viewers. */
  viewer: ViewerInfo | null;
  theme: Theme;
  renderMode: 'iframe' | 'inline';
  domain?: ColorDomain | null;
  /** Domain ceiling bitmask; `undefined` means fail closed to SFW. */
  maxBrowsingLevel?: number;
  /** The domain ceiling narrowed to this viewer. Always a subset of the above. */
  effectiveBrowsingLevel?: number;
}

/** Host messages the transport itself acts on. Domains own everything else. */
export type HostMessage =
  | { type: 'BLOCK_INIT'; payload: BlockInitPayload }
  | { type: 'TOKEN_REFRESH'; payload: { token: WrappedToken } }
  | { type: 'TOKEN_REFRESH_RESPONSE'; payload: { requestId: string; token: WrappedToken } }
  | { type: 'THEME_CHANGE'; payload: { theme: Theme } };

/** Discriminator only — the payload is still unvalidated wire data. */
export function isHostMessage<K extends HostMessage['type']>(
  data: unknown,
  type: K,
): data is Extract<HostMessage, { type: K }> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data as { type: unknown }).type === type
  );
}

const FRAGMENT_MARKER_KEY = 'civitai-block';
const FRAGMENT_VERSION = 'v1';
const FRAGMENT_KEYS = [FRAGMENT_MARKER_KEY, 'theme', 'renderMode', 'blockInstanceId'] as const;

export interface BlockInitFragment {
  theme?: Theme;
  renderMode?: 'iframe' | 'inline';
  blockInstanceId?: string;
}

/** `null` when the hash is not one the host wrote — it may be the app's own routing. */
function ourFragment(hash: string | null | undefined): URLSearchParams | null {
  if (typeof hash !== 'string' || hash.length === 0) return null;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (body.length === 0) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return null;
  }
  return params.get(FRAGMENT_MARKER_KEY) === FRAGMENT_VERSION ? params : null;
}

/**
 * The theme and render mode the host put in the URL so a block can paint before
 * `BLOCK_INIT` arrives. Frozen at mount — a later toggle arrives as
 * `THEME_CHANGE`, never as a re-navigation of a third-party frame.
 */
export function parseBlockInitFragment(hash: string | null | undefined): BlockInitFragment {
  const params = ourFragment(hash);
  if (!params) return {};

  const out: BlockInitFragment = {};
  const theme = params.get('theme');
  if (theme === 'light' || theme === 'dark') out.theme = theme;

  const renderMode = params.get('renderMode');
  if (renderMode === 'iframe' || renderMode === 'inline') out.renderMode = renderMode;

  const blockInstanceId = params.get('blockInstanceId');
  if (blockInstanceId) out.blockInstanceId = blockInstanceId;

  return out;
}

/** The hash with the host's own keys removed, or `null` when it wrote none. */
export function stripBlockInitFragment(hash: string | null | undefined): string | null {
  const params = ourFragment(hash);
  if (!params) return null;
  for (const key of FRAGMENT_KEYS) params.delete(key);
  return params.toString();
}
