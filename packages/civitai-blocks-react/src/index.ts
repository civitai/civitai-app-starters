/**
 * `@civitai/blocks-react` — React hooks + iframe transport for Civitai Apps.
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
export { useHostOrigin } from './hooks/useHostOrigin.js';
export { useBuzzWorkflow } from './hooks/useBuzzWorkflow.js';
export { useBlockResize } from './hooks/useBlockResize.js';
export { useBuzzPurchase } from './hooks/useBuzzPurchase.js';
export { useBuzzBalance } from './hooks/useBuzzBalance.js';
export type { BuzzBalance, UseBuzzBalance } from './hooks/useBuzzBalance.js';
export { useViewer } from './hooks/useViewer.js';
export type { UseViewer } from './hooks/useViewer.js';
export { useBuzzTransactions } from './hooks/useBuzzTransactions.js';
export type { BuzzTransaction, UseBuzzTransactions } from './hooks/useBuzzTransactions.js';
export { useBuzzAccounts } from './hooks/useBuzzAccounts.js';
export type { UseBuzzAccounts } from './hooks/useBuzzAccounts.js';
export { useDailyCompensation } from './hooks/useDailyCompensation.js';
export type { UseDailyCompensation } from './hooks/useDailyCompensation.js';
export { useWildcardPack, WildcardPackError } from './hooks/useWildcardPack.js';
export type { UseWildcardPack } from './hooks/useWildcardPack.js';
export { useAppWorkflows } from './hooks/useAppWorkflows.js';
export type { UseAppWorkflows } from './hooks/useAppWorkflows.js';
export { usePublishGenerationOutputs } from './hooks/usePublishGenerationOutputs.js';
export type { UsePublishGenerationOutputs } from './hooks/usePublishGenerationOutputs.js';
export { useGatedImages } from './hooks/useGatedImages.js';
export type { UseGatedImages } from './hooks/useGatedImages.js';
export type {
  BlockBuzzTransaction,
  BlockBuzzAccount,
  BlockDailyCompensationResource,
  BlockWildcardPack,
  BlockWildcardPackErrorCode,
  AppWorkflow,
  AppWorkflowImage,
  AppWorkflowsParams,
  BlockGatedImage,
} from '@civitai/app-sdk/blocks';
export { useCheckpointPicker } from './hooks/useCheckpointPicker.js';
export { useResourcePicker } from './hooks/useResourcePicker.js';
export { useImageUpload } from './hooks/useImageUpload.js';
export { useGenerationResources } from './hooks/useGenerationResources.js';
export {
  GENERATION_RESOURCES_API_BASE,
  MAX_GENERATION_RESOURCE_IDS,
  buildGenerationResourcesUrl,
  responseToResources,
} from './api/generationResources.js';
export { useCivitaiNavigate } from './hooks/useCivitaiNavigate.js';
export { useRequestSignIn } from './hooks/useRequestSignIn.js';
export { useRequestConsent } from './hooks/useRequestConsent.js';
export { useBlockAnalytics } from './hooks/useBlockAnalytics.js';
export { useDomainMaturity } from './hooks/useDomainMaturity.js';
export type { DomainMaturity } from './hooks/useDomainMaturity.js';
export { SfwGate } from './hooks/SfwGate.js';
export type { SfwGateProps } from './hooks/SfwGate.js';
export { useDirectLoad } from './hooks/useDirectLoad.js';
export type { UseDirectLoadOptions } from './hooks/useDirectLoad.js';
export { hostToRunUrl, DIRECT_LOAD_TIMEOUT_MS } from './internal/directLoad.js';
export { useAppStorage } from './hooks/useAppStorage.js';
export type {
  AppStorageKeyEntry,
  AppStorageListResult,
  AppStorageQuota,
  UseAppStorage,
} from './hooks/useAppStorage.js';
export { useSharedStorage } from './hooks/useSharedStorage.js';
export type {
  SharedAppendValue,
  SharedListItem,
  SharedListResult,
  UseSharedStorage,
} from './hooks/useSharedStorage.js';
