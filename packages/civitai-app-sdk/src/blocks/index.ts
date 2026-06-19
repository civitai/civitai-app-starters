/**
 * `@civitai/app-sdk/blocks` — framework-agnostic contract for Civitai App Blocks.
 *
 * This subpath exports the manifest type, scope strings, postMessage protocol,
 * and the `defineBlock` validator. Hooks and transport implementations live in
 * a separate package (see `@civitai/blocks-react`) so this module stays usable
 * from any runtime — Node, browsers, workers — with no React dependency.
 */

export { defineBlock, BlockManifestError } from './defineBlock.js';
export type { DefineBlockConfig } from './defineBlock.js';

export { BLOCK_SCOPES, BLOCK_SCOPE_PATTERN } from './scopes.js';
export type { BlockScope, BlockScopeKey } from './scopes.js';

export { isMessage } from './messages.js';
export type {
  BlockInitPayload,
  BlockToParentMessage,
  BlockToParentMessageType,
  ParentToBlockMessage,
  ParentToBlockMessageType,
  WrappedToken,
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
  BlockTextToImageParams,
  BlockWorkflowSnapshot,
  ShowcaseImage,
  WorkflowBody,
  WorkflowStatus,
} from './types.js';
