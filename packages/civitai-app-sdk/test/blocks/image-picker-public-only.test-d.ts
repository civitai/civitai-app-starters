/**
 * Compile-time coverage for `OPEN_IMAGE_PICKER`'s `publicOnly` request field.
 *
 * This is a TYPE test: compiled by `tsc -p tsconfig.typecheck.json` (the
 * `test:types` script, run by `pnpm test`). `isMessage` is a DISCRIMINATOR-ONLY
 * guard and `tsconfig.json` EXCLUDES `test/`, so no runtime test can see
 * whether the payload declares the field. This file is the instrument that
 * goes red when the field is missing or loses its type.
 *
 * What it pins:
 *  - `publicOnly` is an OPTIONAL key of the request payload (absent stays valid,
 *    so every existing caller keeps compiling);
 *  - its type is exactly `boolean | undefined`: `true` and `false` are both
 *    sendable, and a non-boolean is a compile error;
 *  - the request's other keys are unchanged.
 */
import { expectTypeOf } from 'vitest';

import type { BlockToParentMessage } from '../../src/blocks/messages.js';
import type { BlockImagePickerSource } from '../../src/blocks/types.js';

type PickerPayload = Extract<BlockToParentMessage, { type: 'OPEN_IMAGE_PICKER' }>['payload'];

expectTypeOf<PickerPayload['publicOnly']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<PickerPayload>().toEqualTypeOf<{
  requestId: string;
  sources?: BlockImagePickerSource[];
  multiple?: { max: number };
  publicOnly?: boolean;
}>();

// Absent, true and false are all valid requests.
export const absent: BlockToParentMessage = {
  type: 'OPEN_IMAGE_PICKER',
  payload: { requestId: 'p' },
};
export const publicOnly: BlockToParentMessage = {
  type: 'OPEN_IMAGE_PICKER',
  payload: { requestId: 'p', sources: ['posted'], multiple: { max: 3 }, publicOnly: true },
};
export const notPublicOnly: BlockToParentMessage = {
  type: 'OPEN_IMAGE_PICKER',
  payload: { requestId: 'p', publicOnly: false },
};

export const stringFlag: BlockToParentMessage = {
  type: 'OPEN_IMAGE_PICKER',
  // @ts-expect-error `publicOnly` is a boolean, not a string.
  payload: { requestId: 'p', publicOnly: 'true' },
};
