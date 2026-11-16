/**
 * Type-level contract for deep links into app state (HQ app_blocks_sdk_j1gc): the
 * SHARE_LINK / SHARE_LINK_RESULT pair, `search`/`hash` on the page context and on
 * ROUTE_CHANGED, and NAVIGATE's `replace`. Checked by `tsc -p tsconfig.typecheck.json`.
 */
import { expectTypeOf } from 'vitest';

import type {
  BlockShareLinkMethod,
  BlockShareLinkRequest,
  BlockShareLinkResult,
  BlockToParentMessage,
  BlockToParentMessageType,
  PageSlotContext,
  ParentToBlockMessage,
} from '../../src/blocks/index.js';

expectTypeOf<BlockShareLinkMethod>().toEqualTypeOf<'clipboard' | 'share' | 'none'>();

expectTypeOf<BlockShareLinkRequest>().toEqualTypeOf<{
  subPath?: string;
  search?: string;
  hash?: string;
}>();

expectTypeOf<BlockShareLinkResult>().toEqualTypeOf<{
  url: string;
  copied: boolean;
  method: BlockShareLinkMethod;
}>();

expectTypeOf<'SHARE_LINK'>().toExtend<BlockToParentMessageType>();
type ShareRequest = Extract<BlockToParentMessage, { type: 'SHARE_LINK' }>;
expectTypeOf<ShareRequest['payload']>().toEqualTypeOf<{
  requestId: string;
  subPath: string;
  search?: string;
  hash?: string;
}>();

type ShareReply = Extract<ParentToBlockMessage, { type: 'SHARE_LINK_RESULT' }>;
expectTypeOf<ShareReply['payload']>().toEqualTypeOf<{
  requestId: string;
  result?: BlockShareLinkResult;
  error?: string;
}>();

type RouteChanged = Extract<ParentToBlockMessage, { type: 'ROUTE_CHANGED' }>;
expectTypeOf<RouteChanged['payload']>().toEqualTypeOf<{
  subPath: string;
  search?: string;
  hash?: string;
}>();

type Navigate = Extract<BlockToParentMessage, { type: 'NAVIGATE' }>;
expectTypeOf<Navigate['payload']['replace']>().toEqualTypeOf<boolean | undefined>();

expectTypeOf<PageSlotContext['search']>().toEqualTypeOf<string | undefined>();
expectTypeOf<PageSlotContext['hash']>().toEqualTypeOf<string | undefined>();
