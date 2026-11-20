/**
 * Compile-time coverage for a picked generation source kept as a private
 * SCANNED row (HQ task app_blocks_move_m9ze, civitai/civitai's
 * `app-block-source-scanned-rows`).
 *
 * `OPEN_IMAGE_UPLOAD { purpose: 'generationSource' }` keeps its reply shape,
 * `{ url, width, height }`, and gains two OPTIONAL fields the host sets when it
 * kept the file as a scanned row: `imageId` and `ready`. A single media image
 * carries the same two. The `toEqualTypeOf` pins fail when a field is added,
 * dropped, retyped or made required.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (run by `pnpm test`). Nothing
 * runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  BlockGenerationSourceImageInfo,
  BlockMediaUploadInfo,
  BlockUploadedGenerationSource,
  ParentToBlockMessage,
} from '../../src/blocks/index.js';

// --- the picker's answer: the source shape, plus the scanned row's two fields ---
expectTypeOf<BlockUploadedGenerationSource>().toEqualTypeOf<{
  url: string;
  width: number;
  height: number;
  imageId?: number;
  ready?: boolean;
}>();

// --- still a plain source, so it goes straight into `sourceImages` ---
expectTypeOf<BlockUploadedGenerationSource>().toMatchTypeOf<BlockGenerationSourceImageInfo>();

// --- the wire reply may carry it ---
type UploadResult = Extract<ParentToBlockMessage, { type: 'IMAGE_UPLOAD_RESULT' }>;
expectTypeOf<BlockUploadedGenerationSource>().toMatchTypeOf<
  NonNullable<UploadResult['payload']['selected']>
>();

// --- a media image kept as a scanned row ---
expectTypeOf<BlockMediaUploadInfo['imageId']>().toEqualTypeOf<number | undefined>();
expectTypeOf<BlockMediaUploadInfo['ready']>().toEqualTypeOf<boolean | undefined>();
