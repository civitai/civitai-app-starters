/**
 * `@civitai/app-sdk/blocks` — framework-agnostic contract for Civitai Apps.
 *
 * This subpath exports the manifest type, scope strings, postMessage protocol,
 * and the `defineBlock` validator. Hooks and transport implementations live in
 * a separate package (see `@civitai/blocks-react`) so this module stays usable
 * from any runtime — Node, browsers, workers — with no React dependency.
 */

// FIRST import, on purpose. Blocks are framed at an opaque origin (sandbox
// without `allow-same-origin`), where touching `localStorage`/`sessionStorage`
// THROWS — including from third-party dependencies nobody can guard from the
// outside. Importing this repairs those globals before anything else in the
// block's module graph can trip over them. It is inert wherever storage works
// or is absent (Node/SSR/workers); see `../safe-storage/index.ts`.
import '../safe-storage/index.js';

export { installSafeStorage, createMemoryStorage } from '../safe-storage/index.js';
export type { SafeStorageInstallResult, SafeStorageName } from '../safe-storage/index.js';

export { defineBlock, BlockManifestError } from './defineBlock.js';
export type { DefineBlockConfig } from './defineBlock.js';

export {
  BLOCK_SCOPES,
  BLOCK_SCOPE_PATTERN,
  BLOCK_CATEGORIES,
  BLOCK_TAGLINE_MAX_LENGTH,
} from './scopes.js';
export type { BlockScope, BlockScopeKey, BlockCategory } from './scopes.js';

export {
  BrowsingLevel,
  SFW_LEVELS,
  NSFW_LEVELS,
  isSfwCeiling,
  isLevelAllowed,
} from './browsingLevel.js';
export type { BrowsingLevelKey, BrowsingLevelBit, ColorDomain } from './browsingLevel.js';

export { isMessage } from './messages.js';
export type {
  BlockInitPayload,
  BlockToParentMessage,
  BlockToParentMessageType,
  ParentToBlockMessage,
  ParentToBlockMessageType,
  SharedStorageItemWire,
  SharedStorageValue,
  WrappedToken,
  BlockBuzzTransactionsParams,
  BlockDailyCompensationParams,
  AppWorkflowsParams,
} from './messages.js';

export type {
  BlockContext,
  BlockManifest,
  BlockManifestV1,
  BlockSettings,
  BlockToken,
  ContentRating,
  ManifestAsset,
  ManifestBooleanField,
  ManifestIframe,
  ManifestNumberField,
  ManifestPreview,
  ManifestSettingField,
  ManifestSettings,
  ManifestStringField,
  ManifestTarget,
  ModelSlotContext,
  SettingScope,
  SettingWidget,
  Theme,
  ViewerInfo,
  BlockCheckpointInfo,
  BlockResourceInfo,
  BlockResourcePickerType,
  BlockSourceImage,
  BlockUploadedImageInfo,
  BlockGenerationSourceImageInfo,
  BlockPendingImageInfo,
  BlockImageScanResult,
  BlockUploadPurpose,
  BlockTextToImageParams,
  BlockWorkflowSnapshot,
  BuzzAccountType,
  ShowcaseImage,
  WorkflowBody,
  WorkflowBodyTextToImage,
  WorkflowBodyCustomComfy,
  WorkflowBodyStep,
  WorkflowStatus,
  BlockBuzzTransaction,
  BlockBuzzAccount,
  BlockDailyCompensationResource,
  BlockViewer,
  BlockWildcardPack,
  BlockWildcardPackErrorCode,
  AppWorkflow,
  AppWorkflowImage,
  BlockGatedImage,
} from './types.js';
