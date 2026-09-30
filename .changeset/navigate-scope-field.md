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
included: an unscoped path stays on the dev origin (`pushState` plus a `popstate`,
since this SDK models no `ROUTE_CHANGED`), `scope: 'site'` goes to the backend
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

Also fixes an instrument, because this change tripped it:
`test/blocks/blockToParentMessageTypes.test.ts` stripped block comments *before*
line comments, so a `//` comment containing the two bytes `/*` — a path glob like
`/api/*` — opened a phantom block comment that ate the rest of the region.
Measured: the derived union went from 47 members to 27, failing the control with
`expected 27 to be greater than or equal to 40`, a number that names nothing about
the cause.
