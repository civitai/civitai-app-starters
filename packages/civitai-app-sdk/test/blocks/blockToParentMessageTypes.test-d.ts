/**
 * Compile-time coverage for the two things about `BLOCK_TO_PARENT_MESSAGE_TYPES`
 * that only the compiler can check — and NOT the union mirror.
 *
 * ⚠️ AN EARLIER REVISION OF THIS FILE ALSO ASSERTED THE MIRROR, on the stated
 * premise that doing so made a growing union "fail a TEST and not only a build
 * step". That premise was FALSE: `tsconfig.typecheck.json` has
 * `"include": ["src/**\/*", "test/**\/*.test-d.ts"]`, so the `Exclude` gate
 * embedded in `src/blocks/messages.ts` is compiled by the very same `test:types`
 * run that compiles this file — i.e. by the same `pnpm test`. The distinction the
 * assertions existed for did not exist, and four gates over one fact needed a
 * warning label about their own ambiguity. They are gone; the mirror is held by
 * that embedded gate plus the runtime source-derived test in
 * `blockToParentMessageTypes.test.ts`, which is the only one that runs under plain
 * `vitest run`.
 *
 * What is left here is what neither of those two can express.
 */
import { expectTypeOf } from 'vitest';

import {
  OTHER_MESSAGE_TYPE_LABEL,
  boundBlockToParentMessageType,
  type BlockToParentMessageType,
} from '../../src/blocks/index.js';

// `BLOCK_MESSAGE_REJECTED` is a declared member of the union. A runtime test can
// only assert it is in the ARRAY; that the UNION declares it is a type-level fact.
expectTypeOf<'BLOCK_MESSAGE_REJECTED'>().toExtend<BlockToParentMessageType>();

// The clamp widens to `string` deliberately (a JS caller, or a block built against
// a newer protocol, must reach it rather than bypass it on the strength of a type
// it does not satisfy) — pinned so a well-meaning narrowing to
// `BlockToParentMessageType` is a test failure rather than a silent hole.
expectTypeOf(boundBlockToParentMessageType).parameter(0).toEqualTypeOf<string>();
// `typeof` rather than `expectTypeOf(value)`: passing the value lets TS widen the
// literal to `string` during inference, which would make this assertion pass for a
// const declared `: string` — i.e. green while the sentinel had lost its literal
// type and every downstream narrowing on it had quietly stopped working.
expectTypeOf<typeof OTHER_MESSAGE_TYPE_LABEL>().toEqualTypeOf<'other'>();
