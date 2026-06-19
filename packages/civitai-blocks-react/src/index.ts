/**
 * `@civitai/blocks-react` — React hooks + iframe transport for Civitai App Blocks.
 *
 * Pair with `@civitai/app-sdk/blocks` (framework-agnostic contract). Hooks
 * land in a follow-up commit; this commit ships the transport layer so the
 * platform side can integration-test against a real iframe receiver.
 */

export { IframeTransport } from './internal/iframeTransport.js';
export type { IframeTransportOptions } from './internal/iframeTransport.js';

export { InlineTransport } from './internal/inlineTransport.js';

export { BlockTransportDetector, readAllowedOriginsFromEnv } from './internal/detector.js';
export type { DetectOptions } from './internal/detector.js';

export { getTransport } from './internal/singleton.js';

export { sendTypedRequest } from './internal/transport.js';
export type {
  BlockSnapshot,
  BlockTransport,
  OutboundRequest,
} from './internal/transport.js';

// Hooks
export { useBlockContext } from './hooks/useBlockContext.js';
export { useBlockSettings } from './hooks/useBlockSettings.js';
export { useBlockToken } from './hooks/useBlockToken.js';
export { useBuzzWorkflow } from './hooks/useBuzzWorkflow.js';
export { useBlockResize } from './hooks/useBlockResize.js';
export { useBuzzPurchase } from './hooks/useBuzzPurchase.js';
export { useCheckpointPicker } from './hooks/useCheckpointPicker.js';
export { useResourcePicker } from './hooks/useResourcePicker.js';
export { useCivitaiNavigate } from './hooks/useCivitaiNavigate.js';
export { useRequestSignIn } from './hooks/useRequestSignIn.js';
export { useRequestConsent } from './hooks/useRequestConsent.js';
export { useBlockAnalytics } from './hooks/useBlockAnalytics.js';
export { useAppStorage } from './hooks/useAppStorage.js';
export type {
  AppStorageKeyEntry,
  AppStorageListResult,
  AppStorageQuota,
  UseAppStorage,
} from './hooks/useAppStorage.js';
