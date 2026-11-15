/**
 * Compile-time coverage for the `PERSIST_GENERATION_SOURCE` →
 * `GENERATION_SOURCE_PERSISTED` bridge (HQ task app_blocks_sdk_x7dw).
 *
 * The shapes are the operator-decided contract, shared with the host change: a
 * request names ONE output by `workflowId` + `imageIndex` (never a url); a
 * reply carries a `result` (`{ url, width, height, imageId, ready }`) or a
 * free-text `error`. The `toEqualTypeOf` pins fail when a field is added,
 * dropped or retyped, in either direction.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (run by `pnpm test`). Nothing
 * runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  BlockGenerationSourceImageInfo,
  BlockPersistGenerationSourceRequest,
  BlockPersistedGenerationSource,
  BlockSourceImage,
  BlockToParentMessage,
  BlockToParentMessageType,
  ParentToBlockMessage,
} from '../../src/blocks/index.js';

// --- what a block asks for: one output, by workflow + index ---
expectTypeOf<BlockPersistGenerationSourceRequest>().toEqualTypeOf<{
  workflowId: string;
  imageIndex: number;
}>();

// --- what the host returns ---
expectTypeOf<BlockPersistedGenerationSource>().toEqualTypeOf<{
  url: string;
  width: number;
  height: number;
  imageId: number;
  ready: boolean;
}>();

// It IS a generation source: usable wherever a `BlockSourceImage` is accepted
// (e.g. a `sourceImages` entry) without a cast.
expectTypeOf<BlockPersistedGenerationSource>().toExtend<BlockGenerationSourceImageInfo>();
expectTypeOf<BlockPersistedGenerationSource>().toExtend<BlockSourceImage>();

// --- the request on the wire ---
expectTypeOf<'PERSIST_GENERATION_SOURCE'>().toExtend<BlockToParentMessageType>();
type PersistRequest = Extract<BlockToParentMessage, { type: 'PERSIST_GENERATION_SOURCE' }>;
expectTypeOf<PersistRequest['payload']>().toEqualTypeOf<{
  requestId: string;
  workflowId: string;
  imageIndex: number;
}>();
// The wire payload is the request type plus the correlation id, and nothing else
// — in particular no url field a block could fill.
expectTypeOf<Omit<PersistRequest['payload'], 'requestId'>>().toEqualTypeOf<BlockPersistGenerationSourceRequest>();

// --- the reply on the wire ---
type PersistReply = Extract<ParentToBlockMessage, { type: 'GENERATION_SOURCE_PERSISTED' }>;
expectTypeOf<PersistReply['payload']>().toEqualTypeOf<{
  requestId: string;
  result?: BlockPersistedGenerationSource;
  error?: string;
}>();
