/**
 * `const app = await initialize()`, then `app.site`, `app.orchestration` and,
 * inside a civitai.com page, `app.host`. Outside one, `createSignIn()` gets the token.
 */

// 🔴 NOTHING IS IMPORTED FOR SIDE EFFECTS HERE, on purpose. This entry is pure
// re-exports, so `./dist/index.js` stays droppable and `import '@civitai/sdk'`
// stays inert in Node/SSR.
//
// The opaque-origin web-storage repair lives behind its own subpath,
// `@civitai/sdk/safe-storage` (`./safe-storage/index.ts`), and a block opts in
// with one line at the top of its entry module. Installing it from here would
// make every consumer of this package — server runtimes included — pay a side
// effect it never asked for, and would still not fix the ordering problem: a
// storage-touching dependency imported ABOVE `@civitai/sdk` evaluates first
// either way. See the README's "Web storage in a block".

export { initialize } from './app/index.js';
export type {
  AppClient,
  BlockAppClient,
  BlockInitializeOptions,
  StorageMode,
  TokenInitializeOptions,
} from './app/index.js';

export { createSignIn, SignInError } from './sign-in/index.js';
export type { SignIn, SignInOptions } from './sign-in/index.js';

export { SCOPES } from './session/index.js';
export type { GrantOptions, Scope, TokenOptions, TokenSource } from './session/index.js';
export type { SiteClient } from './site/index.js';
export type {
  SharedItem,
  SharedListQuery,
  SharedListResult,
  SharedStorageCallOptions,
  SharedStorageClient,
  SharedValue,
} from './shared-storage/index.js';
export type {
  StorageCallOptions,
  StorageClient,
  StorageKeyEntry,
  StorageListQuery,
  StorageListResult,
  StorageQuota,
} from './storage/index.js';
export { SubListingError } from './sub-listings/index.js';
export type {
  MySubListing,
  SubListingCallOptions,
  SubListingContentRating,
  SubListingErrorCode,
  SubListingStatus,
  SubListingsClient,
  SubListingUpsertInput,
  SubListingUpsertResult,
  SubListingWithdrawResult,
} from './sub-listings/index.js';
export { StorageError } from './doc-store/index.js';
export type {
  DocumentAuthor,
  DocumentCallOptions,
  DocumentListQuery,
  DocumentPage,
  DocumentStorage,
  DocumentWhereValue,
  StorageCollection,
  StorageCollectionInfo,
  StorageDocument,
  StorageErrorCode,
  StorageIndexType,
  StorageInfo,
  StorageLimits,
  StorageUsage,
  WriteOptions,
} from './doc-store/index.js';
export { estimatedCost, SubmissionUnconfirmedError } from './workflows/index.js';
export type {
  WorkflowCallOptions,
  WorkflowGetOptions,
  WorkflowListQuery,
  WorkflowListResult,
  WorkflowSubmitOptions,
  WorkflowWatchOptions,
  WorkflowsClient,
} from './workflows/index.js';
// The block workflow contract: the body `app.workflows` sends and the snapshot
// it resolves. Every name in the generated copy, pinned as a set by
// `test/workflows/seam.test.ts`.
export type {
  AiToolkitLrScheduler,
  AiToolkitOptimizerType,
  AiToolkitPlainEcosystem,
  AiToolkitTrainingParams,
  AiToolkitTrainingParamsBase,
  AppWorkflow,
  AppWorkflowImage,
  BlockModel3dOutput,
  BlockModelSubstitution,
  BlockPublishedModel,
  BlockSourceImage,
  BlockStepQuote,
  BlockStepToolCall,
  BlockTextToImageParams,
  BlockTrainedEpoch,
  BlockTrainingDatasetItem,
  BlockTrainingQuote,
  BlockWorkflowSnapshot,
  BlockWorkflowStepSnapshot,
  BuzzAccountType,
  InlineComfyNode,
  KnownBlockWorkflowErrorCode,
  ModelSubstitutionReason,
  WithWorkflowStepRefs,
  WorkflowBody,
  WorkflowBodyCustomComfy,
  WorkflowBodyCustomComfyInline,
  WorkflowBodyCustomComfyRecipe,
  WorkflowBodyPassThroughStep,
  WorkflowBodyStep,
  WorkflowBodyTextToImage,
  WorkflowBodyTraining,
  WorkflowBodyWorkflow,
  WorkflowBodyWorkflowStep,
  WorkflowStepRef,
} from './workflows/types.generated.js';
export { isTerminal, isTerminalStatus } from './orchestration/index.js';
export type {
  OrchestrationClient,
  Step,
  StepTemplate,
  WaitOptions,
  Workflow,
  WorkflowPage,
  WorkflowQuery,
  WorkflowStatus,
  WorkflowTemplate,
} from './orchestration/index.js';
export { createHost } from './host/index.js';
export type {
  ConsentRefusal,
  DownloadRequest,
  Host,
  HostCallOptions,
  ImageScanResult,
  NavigateScope,
  PendingImage,
  PickedResource,
  ResourcePickerType,
  SourceImage,
  UploadedImage,
} from './host/index.js';

export { ApiError } from './http/index.js';
export type { Http, Query, QueryValue, RequestOptions } from './http/index.js';
export { BridgeError, CivitaiError } from './core/errors.js';
export type { BridgeErrorCode, BridgeFailureCode } from './core/errors.js';

export { getTransport } from './core/get-transport.js';
export type { DetectOptions } from './core/get-transport.js';
export type { BlockSnapshot, BlockTransport } from './core/transport.js';
export type {
  BlockCheckpointInfo,
  BlockContext,
  BlockSettings,
  BlockToken,
  ColorDomain,
  ModelSlotContext,
  ModelSlotId,
  PageSlotContext,
  PageSlotId,
  ShowcaseImage,
  Theme,
  TokenKind,
  UnknownSlotContext,
  ViewerInfo,
} from './core/handshake.js';
