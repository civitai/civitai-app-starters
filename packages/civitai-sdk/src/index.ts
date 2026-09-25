/**
 * `const app = await initialize()`, then `app.site`, `app.orchestration` and,
 * inside a civitai.com page, `app.host`. Outside one, `createSignIn()` gets the token.
 */

// FIRST import, on purpose. A block is framed at an OPAQUE ORIGIN — civitai's
// `intersectSandbox` withholds `allow-same-origin` for every tier but
// `internal`/`verified`, and in v1 every approved block is `unverified` — where
// merely *reading* `localStorage`/`sessionStorage` throws a SecurityError,
// including from third-party dependencies nobody can guard from the outside.
// Importing this repairs those globals before anything else in the app's module
// graph can trip over them. It is inert wherever storage works or is absent
// (Node/SSR/workers); see `./safe-storage/index.ts`.
//
// 🔴 This is why `package.json` carries a `sideEffects` ALLOWLIST naming
// `./dist/index.js` and `./dist/safe-storage/index.js` rather than `false`. A
// bare `false` tells every bundler this module has no side effects, and the
// import below is exactly such a side effect. `test/safe-storage.test.ts` pins
// both the behaviour and the manifest value.
import './safe-storage/index.js';

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
export type {
  StorageCallOptions,
  StorageClient,
  StorageKeyEntry,
  StorageListQuery,
  StorageListResult,
  StorageQuota,
} from './storage/index.js';
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
  PendingImage,
  PickedResource,
  ResourcePickerType,
  SourceImage,
  UploadedImage,
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
  TokenKind,
  UnknownSlotContext,
  ViewerInfo,
} from './core/handshake.js';
