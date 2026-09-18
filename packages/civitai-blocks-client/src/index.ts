/**
 * Host bridge for Civitai Apps. `import * as civitai` reads as
 * `civitai.buzz.getAccounts()`; `import { buzz }` tree-shakes identically.
 */

export * as buzz from './buzz/index.js';
export * as orchestration from './orchestration/index.js';
export * as storage from './storage/index.js';

export { BridgeError } from './core/errors.js';
export type { BridgeErrorCode, BridgeFailureCode } from './core/errors.js';

export { getTransport } from './core/get-transport.js';
export type { CallOptions } from './core/messaging.js';
export type { Live } from './core/live.js';
export type { DetectOptions } from './core/get-transport.js';
export type {
  BlockSnapshot,
  BlockTransport,
  ReplyFraming,
  RequestOptions,
} from './core/transport.js';
