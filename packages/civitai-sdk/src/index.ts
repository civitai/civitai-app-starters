/**
 * `const app = await initialize()`, then `app.site`, `app.orchestration` and,
 * inside a civitai.com page, `app.host`. Outside one, `createSignIn()` gets the token.
 */

export { initialize } from './app/index.js';
export type {
  AppClient,
  BlockAppClient,
  BlockInitializeOptions,
  TokenInitializeOptions,
} from './app/index.js';

export { createSignIn, SignInError } from './sign-in/index.js';
export type { SignIn, SignInOptions } from './sign-in/index.js';

export { SCOPES } from './session/index.js';
export type { GrantOptions, Scope, TokenOptions, TokenSource } from './session/index.js';
export type { SiteClient } from './site/index.js';
export { isQuotaRefusal } from './storage/index.js';
export type {
  StorageCallOptions,
  StorageClient,
  StorageKeyEntry,
  StorageListQuery,
  StorageListResult,
  StorageQuota,
} from './storage/index.js';
export { isTerminal } from './orchestration/index.js';
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
  PickedResource,
  ResourcePickerType,
} from './host/index.js';

export { ApiError } from './http/index.js';
export type { Query, QueryValue, RequestOptions } from './http/index.js';
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
  UnknownSlotContext,
  ViewerInfo,
} from './core/handshake.js';
