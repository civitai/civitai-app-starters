/**
 * Compile-time pin for `mine` on the `SHARED_LIST` request payload
 * (civitai/civitai#5354 Q3, server half merged as civitai/civitai#5361).
 *
 * This is a TYPE test, and it has to be: compiled by
 * `tsc -p tsconfig.typecheck.json` (the `test:types` script, run by
 * `pnpm test`, run by the required `SDK` CI job). There is nothing to execute.
 *
 * 🔴 WHY A RUNTIME TEST CANNOT SEE THIS DEFECT, AND WHY IT IS NOT IN
 * `shared-messages.test.ts`. The defect being fixed is that a published client
 * could not SPELL `mine` — the server honoured it on three surfaces and no block
 * could send it. That is purely a declaration: `isMessage` discriminates on
 * `type` alone and never reads the payload, so every runtime assertion over a
 * `SHARED_LIST` literal passes with or without the field. Worse, nothing in this
 * package type-checks `test/**\/*.test.ts` at all — `tsconfig.typecheck.json`
 * includes `src/**\/*` plus `*.test-d.ts`, and `vitest.config.ts` includes
 * `test/**\/*.test.ts` — so a literal written there carrying `mine: true` is not
 * evidence of anything. It compiles because it is never compiled. A first draft
 * of this change put the assertion there with a comment claiming otherwise.
 *
 * WHAT IT PINS
 * ============
 *  1. `mine` EXISTS on the payload and is typed `boolean | undefined` — the red
 *     half: without the field, the literal below is
 *     `Object literal may only specify known properties`.
 *  2. It is OPTIONAL, not merely `boolean | undefined`-valued. Every existing
 *     caller omits it and the whole-board listing is the default, so a required
 *     `mine` would be a breaking change to every block already on the bridge.
 *  3. It is NOT `any` and NOT a string. The host guards narrow with
 *     `typeof … === 'boolean'` / `=== true`, and the tRPC procedure takes
 *     `z.boolean()`. The `'true'`/`'false'` literal union belongs to the REST
 *     route, NOT here, and conflating the two is the mistake this pins against.
 *  4. The payload's FULL shape, exactly — `toEqualTypeOf` is invariant, so this
 *     also fails when an arg is dropped or a new one lands unpinned.
 *  5. A LEDGER: the set of `SHARED_*` request payloads carrying `mine` is
 *     exactly `{ SHARED_LIST }`. A per-type check only covers what someone
 *     thought to list; this derives the set from the union and fails when it
 *     grows (a sibling gained an unpinned author filter) or shrinks.
 *
 * 🔴 `mine` IS A BOOLEAN RATHER THAN A USER ID, AND THE REASON IS YAGNI, NOT A
 * CAPABILITY BOUNDARY. `SharedStorageItemWire` already carries `authorUserId` on
 * every listed row, so enumerating one author is ALREADY possible by paging the
 * board — the cost this parameter removes. A `mine=<userId>` form would make
 * that cheap, not possible. Do not write a security framing around it; that
 * claim was shipped once on the server side and retracted. Authoritative prose:
 * `listSharedRows`' JSDoc in civitai/civitai
 * `src/server/routers/apps-shared.router.ts`.
 */
import { expectTypeOf } from 'vitest';

import type {
  BlockToParentMessage,
  BlockToParentMessageType,
} from '../../src/blocks/messages.js';

type RequestPayload<T extends BlockToParentMessageType> = Extract<
  BlockToParentMessage,
  { type: T }
>['payload'];

/**
 * The keys of `T` that may be OMITTED.
 *
 * `{} extends Pick<T, K>` is true only when `K` is declared with `?`. It is
 * deliberately NOT `undefined extends T[K]`, which a REQUIRED
 * `mine: boolean | undefined` also satisfies — a different contract (the block
 * must send the key) and not the one every existing caller relies on.
 */
type OptionalKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never;
}[keyof T];

type SharedList = RequestPayload<'SHARED_LIST'>;

// The line that goes red if the member is renamed or dropped outright.
expectTypeOf<SharedList>().not.toBeNever();

// 1 + 4. The field exists, and the whole arg set is pinned invariantly.
expectTypeOf<SharedList>().toEqualTypeOf<{
  requestId: string;
  prefix?: string;
  limit?: number;
  cursor?: string;
  mine?: boolean;
}>();

// 2. OPTIONAL — the omitted form every existing caller sends.
expectTypeOf<'mine'>().toExtend<OptionalKeys<SharedList>>();
const bare: SharedList = { requestId: 'r' };
void bare;

// …and the populated form, as a value.
const narrowed: SharedList = { requestId: 'r', prefix: 'p', limit: 10, cursor: 'c', mine: true };
void narrowed;

// `false` is a legal value, not just `true` — it is the server's own default
// (`mine ?? false`) and must not be typed as a `true`-only flag.
const explicitFalse: SharedList = { requestId: 'r', mine: false };
void explicitFalse;

// 3. Optional is not `any`, and not a string.
expectTypeOf<SharedList['mine']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<SharedList['mine']>().not.toBeAny();

// @ts-expect-error — the REST route's `'true'`/`'false'` string form is NOT the
// bridge's. tRPC takes a real boolean; a string here is a zod rejection, and the
// live host's `typeof … === 'boolean'` guard drops it before it gets that far.
const stringMine: SharedList = { requestId: 'r', mine: 'true' };
void stringMine;

// @ts-expect-error — nor a user id. See the header: boolean by choice.
const idMine: SharedList = { requestId: 'r', mine: 7 };
void idMine;

// @ts-expect-error — `requestId` stays REQUIRED; a request with nothing to
// correlate a reply against is not a request.
const noId: SharedList = { mine: true };
void noId;

// ─────────────────────────────────────────────────────────────────────────────
// 5. LEDGER — exactly one request payload carries `mine`
// ─────────────────────────────────────────────────────────────────────────────

type MineBearingRequestType = {
  [T in BlockToParentMessageType]: 'mine' extends keyof RequestPayload<T> ? T : never;
}[BlockToParentMessageType];

expectTypeOf<MineBearingRequestType>().toEqualTypeOf<'SHARED_LIST'>();

// 🔴 And it is optional on every member of that set, derived rather than
// hand-listed — so a second payload that lands a REQUIRED `mine` fails here even
// before anyone adds a section for it above.
type MineRequiredAnywhere = {
  [T in MineBearingRequestType]: 'mine' extends OptionalKeys<RequestPayload<T>> ? never : T;
}[MineBearingRequestType];

expectTypeOf<MineRequiredAnywhere>().toBeNever();
