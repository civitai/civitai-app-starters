---
'@civitai/blocks-react': minor
'@civitai/app-sdk': minor
'@civitai/sdk': minor
---

`NAVIGATE` carries an explicit `scope`, defaulting to `'app'`.

The SDK side of the host contract merged in civitai/civitai#5250. `NAVIGATE`'s
payload is now `{ path, scope?, target }`, where `scope` selects the **space**
`path` is resolved in and `path` is a path *within* it:

- `'app'` — under the block's own route, pushed shallowly. **The default.**
- `'site'` — at the civitai.com root, non-shallow, the viewer leaves the app.
  Granted per-surface; `/api/*` is refused in this scope regardless.

A leading slash carries no meaning — the host normalises it away in *both*
scopes, so `'/settings'` and `'settings'` are one request. Intent lives in the
field, not in punctuation.

**Nothing an existing block sends changes meaning.** `scope` is omitted rather
than sent as `undefined` when a caller does not choose one, so an unscoped call
puts a byte-identical payload on the wire; and the host compares against the
literal `'site'` rather than validating against the union, so an absent *or
unknown* value fails closed onto `'app'`. Both spellings of a path were
app-scoped before this field existed, which is the whole reason the default is
`'app'` and not `'site'`.

`useCivitaiNavigate`'s second argument is widened from `'current' | 'new_tab'` to
that union *or* an options object (`{ scope, target }`). The two-argument call
shape keeps working unchanged; widening the parameter rather than adding an
overload keeps one published signature, so `UseCivitaiNavigate` still describes
the hook exactly. New exported types: `BlockNavigateScope`
(`@civitai/app-sdk/blocks`), `UseCivitaiNavigateOptions` (`@civitai/blocks-react`)
and `NavigateScope` (`@civitai/sdk`) — each required so the option is nameable
rather than inline.

🔴 **The dev host (`@civitai/blocks-react/live`) changes behaviour, and that is
the point.** It resolved *every* path against the backend origin — "so an in-app
path (`/models/123`) opens on the real site" — while production resolved the same
call under the block's own route. So `dev:live` and the published docs agreed with
each other and production was the odd one out, which is what made a platform bug
look like a block bug. It now mirrors the merged contract, `'app'` default
included: an unscoped path stays on the dev origin (`pushState`, and the real
`ROUTE_CHANGED` the host sends — see the separate changeset for that message;
an earlier revision of this change dispatched a synthetic `popstate` instead and
that was itself a divergence), `scope: 'site'` goes to the backend
origin, an unknown scope fails closed onto `'app'`, and — a second divergence in
the same handler — an absolute URL or protocol-relative path is now **dropped**
rather than followed, because the host refuses any scheme in either scope. The
host's hostile-path battery is deliberately *not* mirrored: it guards an untrusted
iframe, and `dev:live` has no untrusted party, so a second non-authoritative copy
of a security resolver would buy nothing and drift.

`minor` rather than `major` on the strength of the package's own published terms:
the one surface whose behaviour moves is `/live`, whose README "Stability of
`/live`" section reads *"a normal subpath of a `0.x` package where a minor may
break it, with the runtime symbol set pinned by `test/subpathSurfaces.test.ts` so
it cannot change silently"* — and that symbol set is unchanged here.

**No drift guard against the host's own `NavigateScope`, and the reason is not
the one first written down.** A guard comparing this SDK's two-member union
against `civitai/civitai`'s was priced and declined. The rationale recorded at
the time was wrong twice and is corrected here, because a wrong rationale is what
the next PR cites:

- It leaned on #498's precedent. That deleted a **self-referential tautology** —
  a literal compared against a literal, with no production code on either side.
  A host-union guard is the opposite shape: it compares against another repo's
  live source, which is a real claim that can really go stale.
- It offered `typecheck:readme` as covering the same ground. It does not.
  `typecheck:readme` pins **README ↔ this repo's union**; the question a drift
  guard answers is **SDK ↔ host**. Different operands, different question.

The decision stands, for the property neither bullet named: **drift fails closed
by construction.** The host resolves `obj.scope === 'site' ? 'site' : 'app'`, so
a host that gains a third space still honours this SDK (an unknown value lands in
`'app'`, the narrower one), and a host that *loses* `'site'` degrades to `'app'`
too. There is no divergence a guard would prevent — only one it would *announce*.
A guard here buys a notification, not a safety property, and its standing cost (a
third sparse path in the drift job, plus breakage every time the host moves that
file) is paid against that. The behaviour that makes the drift safe is pinned by
value instead, by the `an UNKNOWN scope fails CLOSED onto app, like the host`
test — an assertion about state, not about wording.

Also fixes an instrument, because this change tripped it:
`test/blocks/blockToParentMessageTypes.test.ts` stripped block comments *before*
line comments, so a `//` comment containing the two bytes `/*` — a path glob like
`/api/*` — opened a phantom block comment that ate the rest of the region.
Measured: the derived union went from 47 members to 27, failing the control with
`expected 27 to be greater than or equal to 40`, a number that names nothing about
the cause.
