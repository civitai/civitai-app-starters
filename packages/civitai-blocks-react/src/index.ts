/**
 * `@civitai/blocks-react` — React hooks + iframe transport for Civitai Apps.
 *
 * Pair with `@civitai/app-sdk/blocks` (framework-agnostic contract). Hooks
 * land in a follow-up commit; this commit ships the transport layer so the
 * platform side can integration-test against a real iframe receiver.
 */

// FIRST import, on purpose. A block iframe has no `allow-same-origin`, so its
// document runs at an opaque origin where reading `localStorage` /
// `sessionStorage` THROWS — a failure mode that most often arrives via a
// third-party dependency, not the app's own code. Importing this installs an
// in-memory `Storage` over those globals when (and only when) they are broken,
// before the rest of the app's module graph runs. Inert everywhere else.
import '@civitai/app-sdk/safe-storage';

export { IframeTransport } from './transport/iframeTransport.js';
export type { IframeTransportOptions } from './transport/iframeTransport.js';

export { InlineTransport } from './transport/inlineTransport.js';

export { BlockTransportDetector, readAllowedOriginsFromEnv } from './transport/detector.js';
export type { DetectOptions } from './transport/detector.js';

export { getTransport } from './transport/singleton.js';

export { sendTypedRequest } from './transport/transport.js';
export type {
  BlockSnapshot,
  BlockTransport,
  OutboundRequest,
} from './transport/transport.js';

// Hooks
export { useBlockContext } from './hooks/useBlockContext.js';
export type { UseBlockContext } from './hooks/useBlockContext.js';
export { useBlockTheme } from './hooks/useBlockTheme.js';
export type { UseBlockTheme } from './hooks/useBlockTheme.js';
export { useBlockSettings } from './hooks/useBlockSettings.js';
export type { UseBlockSettings } from './hooks/useBlockSettings.js';
export { useBlockToken } from './hooks/useBlockToken.js';
export type { UseBlockToken } from './hooks/useBlockToken.js';
export { useHostOrigin } from './hooks/useHostOrigin.js';
export type { UseHostOrigin } from './hooks/useHostOrigin.js';
export {
  DEFAULT_WATCH_WAIT_SECONDS,
  useBuzzWorkflow,
  WorkflowEstimateError,
  WorkflowSubmitError,
} from './hooks/useBuzzWorkflow.js';
export type {
  SubmitWorkflowOptions,
  UseBuzzWorkflow,
  WatchWorkflowOptions,
  WorkflowSubmitErrorCode,
} from './hooks/useBuzzWorkflow.js';
export { useTip } from './hooks/useTip.js';
export type { TipParams, TipOptions, TipResult, UseTip } from './hooks/useTip.js';
export { useTipAllowance } from './hooks/useTipAllowance.js';
export type { TipAllowance, UseTipAllowance } from './hooks/useTipAllowance.js';
export { useBlockResize } from './hooks/useBlockResize.js';
export type { UseBlockResize } from './hooks/useBlockResize.js';
export { useBlockBreakpoint, resolveBlockTier } from './hooks/useBlockBreakpoint.js';
export type {
  BlockBreakpoint,
  BlockSizeTier,
  UseBlockBreakpoint,
} from './hooks/useBlockBreakpoint.js';
export { useBuzzPurchase } from './hooks/useBuzzPurchase.js';
export type { UseBuzzPurchase } from './hooks/useBuzzPurchase.js';
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
export { useSaveImage } from './hooks/useSaveImage.js';
export type { UseSaveImage, SaveImageInput } from './hooks/useSaveImage.js';
// Exported because `sendTypedRequest` (also exported) can throw it, and its own
// JSDoc says consumers need to distinguish "no reply" from "the host said no" —
// which they cannot do if they cannot name the type.
export { RequestTimeoutError } from './transport/transport.js';
export {
  useCollectionFollow,
  CollectionFollowError,
  COLLECTION_FOLLOW_ERROR_CODES,
  isCollectionFollowErrorCode,
} from './hooks/useCollectionFollow.js';
export type { UseCollectionFollow } from './hooks/useCollectionFollow.js';
export {
  useCreatePostFromApp,
  CreatePostError,
  CREATE_POST_ERROR_CODES,
  isCreatePostErrorCode,
} from './hooks/useCreatePostFromApp.js';
export type {
  UseCreatePostFromApp,
  BlockPostSource,
  BlockCreatePostRequest,
  BlockCreatePostResult,
  BlockCreatePostHostError,
} from './hooks/useCreatePostFromApp.js';
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
  BlockCollectionFollowErrorCode,
  BlockCollectionFollowResult,
} from '@civitai/app-sdk/blocks';
export { useCheckpointPicker } from './hooks/useCheckpointPicker.js';
export type { UseCheckpointPicker } from './hooks/useCheckpointPicker.js';
export { useResourcePicker } from './hooks/useResourcePicker.js';
export type { UseResourcePicker } from './hooks/useResourcePicker.js';
export { useImageUpload } from './hooks/useImageUpload.js';
export type {
  UseImageUpload,
  UseImageUploadAsyncScan,
  UseImageUploadGenerationSource,
  UseImageUploadOptions,
} from './hooks/useImageUpload.js';
export { useGenerationResources } from './hooks/useGenerationResources.js';
export type { UseGenerationResources } from './hooks/useGenerationResources.js';
export {
  GENERATION_RESOURCES_API_BASE,
  MAX_GENERATION_RESOURCE_IDS,
  buildGenerationResourcesUrl,
  responseToResources,
} from './api/generationResources.js';
export { useCivitaiNavigate } from './hooks/useCivitaiNavigate.js';
export type { UseCivitaiNavigate } from './hooks/useCivitaiNavigate.js';
export { useRequestSignIn } from './hooks/useRequestSignIn.js';
export type { UseRequestSignIn } from './hooks/useRequestSignIn.js';
export { useRequestConsent } from './hooks/useRequestConsent.js';
export type { UseRequestConsent } from './hooks/useRequestConsent.js';
export { useConsentUnavailable } from './hooks/useConsentUnavailable.js';
export type {
  UseConsentUnavailable,
  ConsentUnavailablePayload,
} from './hooks/useConsentUnavailable.js';
export { useBlockAnalytics } from './hooks/useBlockAnalytics.js';
export type { UseBlockAnalytics } from './hooks/useBlockAnalytics.js';
export { useDomainMaturity } from './hooks/useDomainMaturity.js';
export type { DomainMaturity, UseDomainMaturity } from './hooks/useDomainMaturity.js';
export { SfwGate } from './hooks/SfwGate.js';
export type { SfwGateProps } from './hooks/SfwGate.js';
export { useDirectLoad } from './hooks/useDirectLoad.js';
export type { UseDirectLoad, UseDirectLoadOptions } from './hooks/useDirectLoad.js';
export { hostToRunUrl, DIRECT_LOAD_TIMEOUT_MS } from './transport/directLoad.js';
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
