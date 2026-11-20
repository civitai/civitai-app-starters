/**
 * Compile-time coverage for the `GET_RESOURCE_FILE` → `RESOURCE_FILE_RESULT`
 * bridge (civitai/civitai-app-starters#664, phase 2).
 *
 * The shapes are the ones the issue's decisions fixed: a request names a
 * `modelVersionId` and optionally a `fileId`; a reply carries a `file`
 * (`meta`, up to 20 parsed `entries`, `truncated`) or one code from a CLOSED
 * seven-member error set. The `toEqualTypeOf` pins fail when a field or a code
 * is added, dropped or retyped, in either direction.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (run by `pnpm test`). Nothing
 * runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  BlockResourceFile,
  BlockResourceFileEntry,
  BlockResourceFileEntryFormat,
  BlockResourceFileErrorCode,
  BlockResourceFileMeta,
  BlockToParentMessage,
  ParentToBlockMessage,
} from '../../src/blocks/index.js';

// --- the closed error set: exactly seven codes ---
expectTypeOf<BlockResourceFileErrorCode>().toEqualTypeOf<
  'not-found' | 'forbidden' | 'unauthorized' | 'too-large' | 'parse-failed' | 'busy' | 'rate-limited'
>();

// --- an entry's detected graph format ---
expectTypeOf<BlockResourceFileEntryFormat>().toEqualTypeOf<'ui' | 'api' | 'unknown'>();

expectTypeOf<BlockResourceFileMeta>().toEqualTypeOf<{
  modelId: number;
  modelVersionId: number;
  fileId: number;
  fileName: string;
  modelName: string;
  versionName: string;
  creatorUsername: string | null;
}>();

expectTypeOf<BlockResourceFileEntry>().toEqualTypeOf<{
  path: string;
  format: BlockResourceFileEntryFormat;
  graph: unknown;
}>();

expectTypeOf<BlockResourceFile>().toEqualTypeOf<{
  meta: BlockResourceFileMeta;
  entries: BlockResourceFileEntry[];
  truncated: boolean;
}>();

// --- the request: `fileId` is optional ---
type GetResourceFile = Extract<BlockToParentMessage, { type: 'GET_RESOURCE_FILE' }>;
expectTypeOf<GetResourceFile['payload']>().toEqualTypeOf<{
  requestId: string;
  modelVersionId: number;
  fileId?: number;
}>();
const withoutFile: GetResourceFile = {
  type: 'GET_RESOURCE_FILE',
  payload: { requestId: 'r', modelVersionId: 1 },
};
const withFile: GetResourceFile = {
  type: 'GET_RESOURCE_FILE',
  payload: { requestId: 'r', modelVersionId: 1, fileId: 2 },
};
void withoutFile;
void withFile;

// --- the reply: a file, or a code from the closed set ---
type ResourceFileResult = Extract<ParentToBlockMessage, { type: 'RESOURCE_FILE_RESULT' }>;
expectTypeOf<ResourceFileResult['payload']>().toEqualTypeOf<{
  requestId: string;
  file?: BlockResourceFile;
  error?: BlockResourceFileErrorCode;
}>();
const freeText: ResourceFileResult = {
  type: 'RESOURCE_FILE_RESULT',
  // @ts-expect-error — the error channel is the closed code set, never free text.
  payload: { requestId: 'r', error: 'something went wrong' },
};
void freeText;
