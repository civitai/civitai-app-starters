---
'@civitai/blocks-react': minor
---

`useBlockToken().refresh()` now resolves WITH the new `BlockToken` — the
401-retry path this SDK documents was re-sending the stale JWT.

`refresh()` returned `Promise<void>`. It forced a token mint and resolved once
the new token was applied to the transport snapshot, but it handed the caller
nothing, so the documented retry could only reach for the `raw` already in
scope:

```tsx
let res = await doFetch(raw);
if (res.status === 401) {
  await refresh();
  res = await doFetch(raw);   // ← the SAME stale token
}
```

That `raw` is a `const` captured by the closure the callback is already
executing in. Awaiting `refresh()` updates the snapshot and re-renders the
component, but it cannot reassign that binding — a re-render creates a *new*
closure while the in-flight one keeps its old value. So the retry re-sent the
token that had just been rejected and 401'd for exactly the reason the first
call did, making the retry path inert. The resolved token is the only in-scope
handle on the fresh JWT, which is why it is now returned:

```tsx
let res = await doFetch(raw);
if (res.status === 401) {
  const fresh = await refresh();
  res = await doFetch(fresh.raw);
}
```

The resolved value is read off the transport snapshot, not re-parsed from the
reply, so it is the very `BlockToken` the next render observes — `scopes` and
`buzzBudget` included, not just `raw`.

**MINOR, not a breaking change — verified rather than assumed.** This widens the
return type, so every existing call shape still compiles: `await refresh()`
ignoring the value, `void refresh()`, `.then(() => …)`, destructure-then-call,
and passing `refresh` where a `() => void` callback is expected (TypeScript's
return-type-`void` rule covers that last one). The one class that does break is
explicitly annotating a location as `Promise<void>` —
`const r: () => Promise<void> = refresh` — because `Promise<BlockToken>` is not
assignable to `Promise<void>`. There is no such annotation anywhere in this
repo, and no test asserted the resolved value was `undefined`.

Also corrects the pattern everywhere this repo taught it: the hook's JSDoc
(`@returns` and the `@example`), `packages/civitai-blocks-react/README.md`, and
the `scopes-api` example's `App.tsx` and `README.md`.

> `developer.civitai.com`'s `apps/reference/hooks.md` carries the old example in
> a GENERATED region. It is fixed by publishing this change, bumping the docs
> pin, and re-running `gen:appblocks:md` — a follow-up that can only start after
> this is on npm.
