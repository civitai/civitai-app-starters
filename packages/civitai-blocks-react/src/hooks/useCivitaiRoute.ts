import { useTransportSnapshot } from './useBlockContext.js';

/**
 * What {@link useCivitaiRoute} returns. An alias — see `./returnTypeLedger.js`
 * for why every hook on the entry has one of these.
 */
export type UseCivitaiRoute = string;

/**
 * The sub-path below your app's root that is CURRENTLY showing, kept live for
 * the whole life of the block ON THE IFRAME TRANSPORT.
 *
 * The page surface owns the browser history; your block does not. You ask for a
 * move with {@link useCivitaiNavigate} (`scope: 'app'`, the default), the host
 * pushes it shallowly so your frame stays mounted — and this is how you learn
 * where you ended up. It also reports the moves you did NOT ask for: the
 * viewer's own back/forward, and a deep link the host resolved after init.
 *
 * Reads the SAME singleton transport snapshot {@link useBlockContext} does, so
 * it re-renders when the value changes. Two things set it:
 *
 *  1. `BLOCK_INIT` — `context.subPath`, the host's value at mount. The FIRST
 *     value always arrives here, never over a message;
 *  2. `ROUTE_CHANGED`, the host's push on every later change.
 *
 * It is the same value as `useBlockContext().context.subPath` on a page slot —
 * reach for this when the route is all you need, and because this hook's return
 * type is a plain `string` rather than a field on a union you have to narrow.
 *
 * ```tsx
 * const subPath = useCivitaiRoute();          // '' on your app's index
 * const [view, id] = subPath.split('/');      // 'compare/42' → ['compare', '42']
 * ```
 *
 * 🔴 `''` IS A REAL ROUTE — your app's own index — AND IT IS ALSO THE PRE-INIT
 * SENTINEL. The two are indistinguishable from this hook alone, exactly as
 * `'light'` is both a real theme and {@link useBlockTheme}'s pre-init value.
 * Gate on `useBlockContext().ready` if your first paint must tell them apart.
 *
 * 🔴 NO LEADING SLASH, and no slash-tolerance to lean on. The host sends the
 * segment below your app root — `'compare/42'`, not `'/compare/42'` — so
 * `subPath === 'compare/42'` is the comparison that works and
 * `subPath === '/compare/42'` is the one that silently never matches.
 *
 * 🔴 PAGE SLOT ONLY. A model-page slot has no route of its own, so this returns
 * `''` there and never moves. It is not a defect to debug: the host's own
 * `ROUTE_CHANGED` effect lives in `PageBlockHost`, and `ModelSlotContext` has no
 * `subPath` field for it to update.
 *
 * 🔴 OLD HOST: a host that never sends `ROUTE_CHANGED` simply never moves the
 * value — the hook degrades to the init sub-path, which is the behaviour every
 * page block had before the message existed. Nothing here awaits a message, so
 * there is no hang and no timeout.
 *
 * 🔴 INLINE TRANSPORT: the value is FROZEN at the init sub-path. v1 inline mode
 * receives no host pushes at all (`InlineTransport.onMessage` is a stub and
 * `subscribe` is a no-op, so nothing can emit), the same degradation as an old
 * host, and it lifts when v2 inline mode lands.
 *
 * 🔴 READ IT ON EVERY RENDER. A block that copies the value into state once at
 * mount — or routes imperatively in a mount-only effect — stays on the route it
 * started with and reproduces the symptom this message exists to end: the URL
 * moves and nothing renders.
 */
export function useCivitaiRoute(): UseCivitaiRoute {
  const context = useTransportSnapshot().context;
  // A PRESENCE test, not a slot-id test, and not a cast. `BlockContext` is a
  // union whose `UnknownSlotContext` arm declares `slotId` and nothing else, and
  // the pre-init `EMPTY_SNAPSHOT.context` is exactly that shape — so there is
  // genuinely no field to read before init, or on any slot but the page. The
  // `typeof` half is not belt-and-braces either: `UnknownSlotContext` would let
  // a host put any value on that key, and this hook's published return type is
  // `string`.
  if ('subPath' in context && typeof context.subPath === 'string') return context.subPath;
  return '';
}
