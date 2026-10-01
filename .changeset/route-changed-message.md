---
'@civitai/blocks-react': minor
'@civitai/app-sdk': minor
'@civitai/sdk': minor
---

`ROUTE_CHANGED` is modelled: a page block can finally see where it navigated to.

The host has been sending this message since the page surface shipped
(civitai/civitai `src/components/AppBlocks/PageBlockHost.tsx` —
`send('ROUTE_CHANGED', { subPath })` in an effect gated on
`!initSentRef.current || status !== 'ready'` and keyed on `[subPath, status]`).
This SDK modelled it **nowhere**, so a block could not subscribe to it at all.
The consequence was the civitai#5209 shape: in production an app-scoped
`navigate()` moved the host's URL and the block never learned, because
`BLOCK_INIT` — which carries the initial `subPath` — is deduped by the transport
and could not deliver a second value.

New surfaces:

- **`@civitai/app-sdk`** — `ROUTE_CHANGED` on `ParentToBlockMessage`, payload
  `{ subPath: string }`. Declared beside `THEME_CHANGE`, the host→block push it
  is shaped after: no `requestId`, no reply, nothing awaits it.
- **`@civitai/blocks-react`** — **`useCivitaiRoute()`** (and its
  `UseCivitaiRoute` return type), returning the sub-path currently showing. The
  transport folds the push into `context.subPath`, so
  `useBlockContext().context.subPath` tracks the same value — there is one
  writer and one copy.
- **`@civitai/sdk`** — `ROUTE_CHANGED` on `HostMessage`, folded into the
  snapshot, so `app.context.subPath` is live and `onChange` reports it. **No
  `onRouteChange` and no `HostPushes` row**, matching `THEME_CHANGE`: a value the
  snapshot already holds is observed through the snapshot, and publishing a
  second reader of one value is how `app.context.subPath` and a callback end up
  disagreeing. `SUSPEND`/`RESUME` are in `HostPushes` because they carry no
  state.

**A value hook, not an `onRouteChanged` callback — and that follows from the
wire, not from taste.** The host sends the FIRST sub-path in
`BLOCK_INIT.context.subPath` and sends this message only on a later *change*. A
callback therefore cannot see where the block started, and a change that lands
before its subscription effect runs is lost — a block that looks subscribed and
misses the first move, which is the same failure wearing a different hat. The
sub-path also already lives in `context`, so a callback that did not update the
snapshot would leave `useBlockContext().context.subPath` frozen at its mount-time
value while the callback reported another — exactly the divergence
`applyThemeChange` exists to avoid, and the reason the push is folded in whatever
the hook's shape.

`''` is a real route (an app's own index) and the validator accepts it
deliberately: `isValidRouteChanged` checks for a string, not a non-empty one,
mirroring `isPageSlotContext`'s decision about the same field. Rejecting it would
drop every navigation back to the app root.

**Back-compat, both directions — purely additive.** An old block on a new host
has no handler and falls through the transport's no-op tail, keeping the
sub-path it got at init. A new block on an old host waits on nothing: the value
simply never moves. On a model slot the push cannot even apply — the transport
only ever UPDATES a `subPath` the context already carries and never introduces
one, so it never asserts a page context the host did not send.

🔴 **The dev host (`@civitai/blocks-react/live`) changes behaviour again, and
this replaces something that shipped earlier in this same release.** That earlier
revision dispatched a synthetic `popstate` after `pushState` *"since this SDK
models no `ROUTE_CHANGED`"*. It made a history-based router in the block
re-render — in `dev:live` and nowhere else, because no production host dispatches
a `popstate` for its own shallow push. That is civitai#5209's failure class with
its sign flipped, in a harness whose entire purpose in this release was to stop
diverging from production; a dev host that is KINDER than production is how that
bug stayed invisible in the first place. The synthetic event is gone and the dev
host now emits the real message, with the host's own three gates: after init,
only on a change, and only for a move of THIS frame (so neither
`scope: 'site'` nor `target: 'new_tab'` emits). It also reflects the viewer's own
back/forward, which production reports too — its effect is keyed on the resolved
sub-path, not on who asked for the move.

Also in the dev host: **the site-scope `/api/*` refusal now compares the DECODED
first segment**, like the host's `navigateSiteFirstSegmentIsRefused`, and refuses
a segment it cannot decode at all. It previously compared the raw spelling, so
`%61pi/auth/logout` was refused in production and followed in `dev:live`. The
branch mirrors a *published* refusal rather than guarding anything, which is why
it was fixed rather than deleted: a mirror that is wrong for one input shape is
worse than either having it or not. This is not the host's "two spellings of one
rule" case — that deleted a redundant raw fast path sitting *alongside* a decoded
comparison and provably unable to reach a verdict the survivor did not; here
there was one comparison and it was the wrong one.

`minor` on the same terms as the rest of this release: additive on the API axis
(a new hook, a new message type, no rename and nothing narrowed), with the one
behaviour change confined to `/live`, whose README is explicit that it is *"a
normal subpath of a `0.x` package where a minor may break it"* and whose runtime
symbol set — pinned by `test/subpathSurfaces.test.ts` — is unchanged.
