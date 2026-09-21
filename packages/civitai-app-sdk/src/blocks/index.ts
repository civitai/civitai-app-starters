/**
 * `@civitai/app-sdk/blocks` — framework-agnostic contract for Civitai Apps.
 *
 * This subpath exports the manifest type, scope strings and postMessage
 * protocol. Hooks and transport implementations live in a separate package (see
 * `@civitai/blocks-react`) so this module stays usable from any runtime — Node,
 * browsers, workers — with no React dependency and no runtime dependencies at
 * all. Build-time manifest validation lives at `@civitai/app-sdk/manifest`
 * (node-only); see the note on `BlockManifestError` below.
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

/**
 * `defineBlock` MOVED to `@civitai/app-sdk/manifest` (a NODE-ONLY subpath) in
 * the release that closed #330. It now validates by compiling the vendored
 * canonical schema with Ajv instead of maintaining a hand-written mirror of it,
 * which needs `node:fs` and a runtime dependency — neither of which belongs on
 * this browser-facing, zero-dependency surface. Most callers want the Vite
 * plugin at `@civitai/app-sdk/vite` rather than the function.
 *
 * `BlockManifestError` stays exported here, from its own module, so
 * `instanceof` means the same thing on both subpaths.
 */
export { BlockManifestError } from './manifestError.js';

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
  effectiveBrowsingCeiling,
} from './browsingLevel.js';
export type { BrowsingLevelKey, BrowsingLevelBit, ColorDomain } from './browsingLevel.js';

export {
  APP_STORAGE_MAX_VALUE_BYTES,
  APP_STORAGE_MAX_BYTES,
  APP_STORAGE_MAX_ROWS,
} from './appStorageLimits.js';

/**
 * {@link classifyAppStorageError} — the matcher a block branches on — plus the
 * four rejection messages a MOCK HOST has to emit. The wire carries a
 * host-authored message, never the TRPC code; see `appStorageErrors.ts` for the
 * measurement, and #343 for the bug it closes.
 *
 * 🔴 **THE PUBLIC BRANCHING SURFACE IS THE REASON, NOT THE STRING.** A block
 * switches on {@link AppStorageRejectionReason}; it never needs to hold a host
 * message. So this barrel deliberately exports LESS than
 * `appStorageErrors.ts` does, and the omissions are each a decision:
 *
 * - `APP_STORAGE_HOST_ERROR_MESSAGES` — the frozen array. Publishing it invites
 *   `MESSAGES.includes(err.message)`, which is EQUALITY against a snapshot and
 *   stops matching the day the host moves its per-value cap. That is the
 *   matcher shape #343 exists to eliminate; `classifyAppStorageError` is
 *   strictly wider (see its note on the per-value FAMILY).
 * - `isAppStorageHostErrorMessage` — a thin `classifyAppStorageError(…) !==
 *   null`. Its only caller is `tests/guards/app-storage-error-strings.test.mjs`,
 *   which imports the module by FILE PATH.
 * - `APP_STORAGE_ERROR_APP_QUOTA_EXCEEDED` / `_APP_ROW_LIMIT` — the app-wide
 *   umbrella pair. No mock in this repository can emit them (nothing models the
 *   umbrella), and a block reaches them through the `'app-quota-exceeded'` /
 *   `'app-row-limit'` reasons, which ARE exported.
 * - `appStorageValueTooLargeMessage` — the builder, so a test can prove the
 *   per-value string is DERIVED from `APP_STORAGE_MAX_VALUE_BYTES` rather than
 *   hardcoded.
 *
 * All five stay exported from `appStorageErrors.ts` itself, so a test or a
 * guard reaches them by path. Adding one here later is a `minor`; removing one
 * once published is not.
 */
export {
  APP_STORAGE_ERROR_VALUE_TOO_LARGE,
  APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED,
  APP_STORAGE_ERROR_USER_ROW_LIMIT,
  APP_STORAGE_ERROR_REQUEST_FAILED,
  classifyAppStorageError,
} from './appStorageErrors.js';
export type { AppStorageRejectionReason } from './appStorageErrors.js';

export {
  BLOCK_INIT_FRAGMENT_MARKER_KEY,
  BLOCK_INIT_FRAGMENT_VERSION,
  BLOCK_INIT_FRAGMENT_KEYS,
  encodeBlockInitFragment,
  parseBlockInitFragment,
  stripBlockInitFragment,
} from './initFragment.js';
export type { BlockInitFragment } from './initFragment.js';

export {
  isMessage,
  BLOCK_TO_PARENT_MESSAGE_TYPES,
  OTHER_MESSAGE_TYPE_LABEL,
  boundBlockToParentMessageType,
} from './messages.js';
export type {
  BlockInitPayload,
  BlockToParentMessage,
  BlockToParentMessageType,
  ConsentUnavailablePayload,
  ConsentUnavailableReason,
  ParentToBlockMessage,
  ParentToBlockMessageType,
  SharedStorageItemWire,
  SharedStorageValue,
  WrappedToken,
  BlockBuzzTransactionsParams,
  BlockDailyCompensationParams,
  AppWorkflowsParams,
} from './messages.js';

/**
 * Runtime narrowing for the `slotId`-discriminated {@link BlockContext} union.
 * Values, not types — a slot context crosses a `postMessage` boundary, so its
 * static shape is a claim the guard is what actually checks.
 */
export { isModelSlotContext, isPageSlotContext } from './types.js';

/**
 * The sign-in gate, spelled once. Blocks, docs and starters call this instead
 * of open-coding `viewer !== null` or `viewer?.signedIn === true`; see its doc
 * in `types.ts` for which of the two it uses and why.
 */
export { isSignedIn } from './types.js';

export type {
  BlockContext,
  KnownSlotId,
  ModelSlotId,
  PageSlotContext,
  PageSlotId,
  UnknownSlotContext,
  BlockManifest,
  BlockManifestV1,
  BlockSettings,
  BlockToken,
  ContentRating,
  ManifestBooleanField,
  ManifestIframe,
  ManifestNumberField,
  ManifestPage,
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
  WorkflowBodyCustomComfyRecipe,
  WorkflowBodyCustomComfyInline,
  InlineComfyNode,
  WorkflowBodyStep,
  WorkflowBodyPassThroughStep,
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
  BlockCollectionFollowErrorCode,
  BlockCollectionFollowResult,
  BlockPostSource,
  BlockCreatePostRequest,
  BlockCreatePostResult,
  BlockCreatePostHostError,
} from './types.js';
