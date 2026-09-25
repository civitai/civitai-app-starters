# `@civitai/sdk`

The Civitai SDK: one client for the public API, the orchestrator and, inside a
civitai.com page, the host. The same code serves a block app and an app of your
own. It succeeds `@civitai/app-sdk`, whose 0.x releases continue from this repo
as a separate codebase.

```ts
import { initialize } from '@civitai/sdk';

const app = await initialize();

const picked = await app.host.openResourcePicker({ resourceType: 'Checkpoint' });
if (picked && (await app.requestGrants(['ai:write:budgeted']))) {
  const { air } = await app.site.get<{ air: string }>(`model-versions/mini/${picked.versionId}`);

  const submitted = await app.orchestration.submitWorkflow({
    steps: [
      {
        $type: 'textToImage',
        input: { model: air, prompt: 'A lighthouse at dusk', cfgScale: 7, seed: 1234 },
      },
    ],
  });
  const workflow = await app.orchestration.waitForWorkflow(submitted.id!);
  render(workflow);
}
```

> 🔴 **If you are a BLOCK, do not copy the `app.orchestration` call above.** That
> reaches the orchestrator directly and carries none of the controls the block
> path applies — the per-call Buzz budget, the per-viewer and per-app daily caps,
> the maturity clamp, and the `app-block:<appId>` attribution tag. Submit through
> `POST /api/v1/blocks/workflows/submit` instead. The substitution type-checks and
> passes tests, which is why it is worth saying here: the snippet above is written
> for an app that is its own principal, not for a block. `BREAKING.md` §*What a
> direct orchestrator call loses* has the detail.

An app calls the Civitai API and the orchestrator as the viewer, with a token.
Reading images, creating posts, running a workflow — all of it is an API call.
A block additionally asks its host page to show the host's own UI.

## `initialize()`

| Call | Where | Resolves |
|---|---|---|
| `initialize()` | A block on civitai.com | Once the host hands over the viewer, the slot and a token. Rejects with `BridgeError` `unavailable` if no host answers within `timeoutMs` (10s) |
| `initialize({ token, refresh?, requestGrants? })` | Anywhere else, typically your server | At once, with the OAuth access token you hold |
| `initialize(await createSignIn(...))` | A web app outside civitai.com | At once, as the viewer who signed in; see below |

Both give you:

| Member | What it is |
|---|---|
| `app.site` | The public REST API at `/api/v1`: `get`, `post`, `request` |
| `app.orchestration` | Workflows: `submitWorkflow`, `estimateWorkflow`, `getWorkflow`, `watchWorkflow`, `waitForWorkflow`, `cancelWorkflow`, `queryWorkflows` |
| `app.requestGrants(scopes)` | Asks for more scopes; resolves `false` when they cannot be granted |
| `app.getToken()` | For a call this client does not make |

A block's `app` also has `host`, `viewer`, `context`, `settings`, `theme` and
`onChange(listener)`. Outside a block they do not exist, and the types say so.

A block opts in by declaring `auth: "oauth"` in its `block.manifest.json`. The
host then hands it a real OAuth access token that `/api/v1`, the orchestrator
and the MCP accept, and consent — including `requestGrants` — goes through the
host's consent dialog.

### When the token is the block-scoped one

`initialize()` starts either way. A block-scoped token for a signed-in viewer is
**not** an error in itself: the host's OAuth mint is flag-gated, so an opted-in
block can legitimately receive the block token, and that token serves the
`/api/v1/blocks/*` routes it was minted for, `GET /api/v1/models/{id}`, and
`app.storage` — which an OAuth token cannot reach at all. What it does not reach
is the rest of `/api/v1`, the orchestrator or the MCP. So the refusal sits at the
surface, not at startup:

| You call | Holding a block token, signed in |
|---|---|
| `app.storage.*` | Works. This is the token app storage requires |
| `app.site` on `blocks/…` | Works. These are the routes the token was minted for |
| `app.site.get('me')` and the rest of `/api/v1` | The API's own 401/403, with `auth: "oauth"` named in the message. `status` and `body` are untouched, so a caller can still branch on them |
| `app.orchestration.*` | Rejects **before** the request with a `CivitaiError` naming `auth: "oauth"` — the orchestrator accepts no block token on any route, so there is nothing to learn from making the call |
| `app.requestGrants(...)` | Works. Goes to the host's consent dialog, so a `consent_required` fallback can still prompt |

Anonymous viewers are untouched: no OAuth token is minted for one whatever the
manifest says, so the manifest is not their fix — `host.requestSignIn()` is. A
host that predates the `kind` field sends none, and behaves as it always did.

> ⚠ Two limits on that middle row, and neither is a bug to be tuned away.
>
> **The SDK does not know which `/api/v1` routes accept the token**, so its
> message does not say. The route is a string this client never interprets, and
> which routes are dual-auth is the server's to change without a release here —
> so the message names `blocks/*` (the token's own mint namespace) and states
> plainly that the rest is not known from here, leaving the advice conditional:
> *if* this path needs an OAuth token, declare it. `GET /api/v1/models/{id}` is
> in fact accepted — it is the one dual-auth route today — so a refusal there
> gets the same conditional annotation; `BREAKING.md` records the route map as it
> stood when this version was published, and the `models:read:self` binding that
> route applies.
>
> **"Does not reach" is not always "refuses."** A *public* route such as
> `/api/v1/images` ignores an unusable token and answers **anonymously** instead
> of erroring. Nothing at the client seam tells that apart from a successful
> authenticated read, so prefer the `blocks/*` twin.

## Signing in outside civitai.com

A browser app signs the viewer in with Civitai itself: PKCE against
`auth.civitai.com`, no server and no client secret. Register the app as a
public OAuth client with its origins and redirect URL.

```ts
import { createSignIn, initialize } from '@civitai/sdk';

const auth = await createSignIn({ clientId, scopes: ['user:read:self', 'ai:write:budgeted'] });
if (!auth.signedIn) {
  button.onclick = () => auth.signIn();
  if (auth.returning) auth.signIn();
} else {
  const app = await initialize(auth);
}
```

`createSignIn` finishes the return from Civitai when the page has just come
back from it, and takes `code` and `state` out of the address bar. Tokens live
in memory only and refresh themselves; storage holds only the sign-in in flight
and a flag that the viewer signed in before (`returning`). Signing in again is
a quick round trip, since Civitai remembers the consent. `requestGrants` goes
back to Civitai for anything not yet granted.

Only scopes with an OAuth equivalent can be asked for: `user:read:self`,
`models:read:self`, `ai:write:budgeted`, `buzz:read:self`, `posts:write:self`
and `social:tip:self`. The storage and collection scopes belong to blocks.
`/api/v1` and the orchestrator both accept these tokens from any origin.

## The API

Routes are addressed by path, so a route `/api/v1` gains needs no release here:

```ts
const images = await app.site.get('images', { query: { limit: 20, username: 'civitai' } });
```

A `401` is retried once with a fresh token. Any other failure is an `ApiError`
carrying `status`, the parsed `body`, and the server's own message.

## App storage

`app.storage` is the viewer's own key/value store, scoped to this app and this
block instance. It needs the block token the host mints — an app holding an
OAuth access token has no per-viewer app storage — and an anonymous viewer is
refused, so gate on `app.viewer` rather than reading an empty page as "nothing
stored".

```ts
await app.storage.set('draft:latest', { prompt, steps: 30 });
const draft = await app.storage.get<Draft>('draft:latest'); // null when unset
const { keys, nextCursor } = await app.storage.list({ prefix: 'draft:' });
const quota = await app.storage.getQuota();
```

Three properties the surface is built around:

- **Every failure rejects.** Nothing here resolves to mean "not written", and
  nothing resolves to mean "could not read". A malformed success throws a
  `CivitaiError`; a refusal is an `ApiError` carrying `status`. A caller that
  must not act on a partial view branches on the rejection, never on an empty
  result.
- **`nextCursor` is present exactly when there may be more rows**, and is passed
  through untouched. Its absence is your proof a scan completed. Page it
  yourself, with a bound — the client adds no iterator, because the truncation
  policy is the caller's to choose.
- **`set`'s `sizeBytes` is the wire unit; `getQuota`'s `usedBytes` is the stored
  unit.** They are not a fixed multiple — measured, a numeric-heavy value stores
  up to 44.4x its wire size — so summing `sizeBytes` under-counts your quota.
  `getQuota()` is the authority, and it reports neither the key-length cap nor
  the per-value cap.

A write refused for size or quota arrives as `413`, whichever ceiling fired — the
server names which one only in prose, so test the status, not the message:

```ts
try {
  await app.storage.set('draft:latest', huge);
} catch (error) {
  if (error instanceof ApiError && error.status === 413) askTheUserToFreeSpace();
  else throw error;
}
```

## The orchestrator

Steps are typed by `$type`: `input` is checked against that step's own input,
and narrowing a returned step on `$type` types its `output`. The union is
generated from `@civitai/orchestration-client` (`npm run gen:steps`), so a step
type the orchestrator gains arrives with a client update and no code here.

An output is listed before it exists — check `available` before showing it.

```ts
for await (const workflow of app.orchestration.watchWorkflow(id)) {
  render(workflow); // now, then each time it changes, until a final status
}
```

`watchWorkflow` reads the workflow, then holds each further read open on the
orchestrator until something changes (`?until=change`), and yields only when
it did. `waitForWorkflow` is its last value — a failed workflow resolves, it
does not throw. Both wait out a brief outage and give up on a refusal; break out
of the loop or pass a `signal` to stop.

> An orchestrator without `until=change` holds each read until the workflow
> finishes or 20s pass, so mid-run progress arrives up to 20s late.

[`examples/generate.ts`](./examples/generate.ts) runs all of it from a server:
`pnpm build && CIVITAI_TOKEN=… node examples/generate.ts [modelVersionId] [prompt]`,
with `ORCHESTRATION_URL` / `CIVITAI_SITE_URL` to point it at a local stack.

## Grants

Scopes are typed (`Scope`, and the list as `SCOPES`), so a misspelt scope fails
to compile rather than being quietly refused.

In a block, `requestGrants` opens the host's consent dialog and resolves once
the re-minted token carries the scopes. A viewer who closes the dialog sends
nothing, so pass a `signal` to bound the wait. Given a token, `requestGrants`
is yours to supply — typically re-running your OAuth authorize flow with the
wider scope — and refuses without one.

## The host

| Call | What the host does |
|---|---|
| `resize(height)` | Resizes the frame, clamped to the manifest |
| `autoResize(element?)` | Keeps the frame as tall as the body (or `element`); returns a stop function |
| `reportError(message, { fatal })` | `fatal` swaps the block for the host's fallback |
| `navigate(path, { target })` | Deep-links within this app's own sub-paths |
| `onVisibilityChange(handler)` | Reports the page hiding and returning |
| `requestSignIn({ returnUrl })` | Starts sign-in; the block re-initialises signed in |
| `download({ url, filename })` | Saves to the viewer's device — a sandboxed frame cannot |
| `openResourcePicker({ resourceType })` | civitai's own picker; resolves the one pick, or `null` |
| `openBuzzPurchase({ suggestedAmount })` | The purchase flow; resolves `{ purchased }` |
| `openImageUpload()` | The upload modal; resolves a `PendingImage`, or `null` |
| `openImageUpload({ purpose: 'generationSource' })` | The same modal for a private img2img source; resolves `{ url, width, height }` |
| `publishGenerationOutputs({ workflowId, imageIndexes })` | Publishes your own workflow's outputs, behind the host's confirmation; resolves the new image ids |

Host failures reject with a `BridgeError` carrying a `code` (`forbidden`,
`unauthenticated`, `rate-limited`, …). Timeouts are the host's to set; pass a
`signal` to cancel. `ApiError` and `BridgeError` both extend `CivitaiError`, so
one `catch` can tell a refusal from a bug.

### Uploading an image

The host owns the upload: it opens its own modal, takes the file through the
viewer's session and hands back what it stored. The frame never sees the bytes.

A **public** image is moderated *after* it is stored, so `openImageUpload()`
resolves as soon as the image exists and the verdict comes from `scan()`:

```ts
const app = await initialize();

const image = await app.host.openImageUpload();
if (image) {
  showTheAuthorTheirOwnPreview(image.url);

  const verdict = await image.scan({ signal: AbortSignal.timeout(600_000) });
  if (verdict.status === 'scanned') publish(verdict.image);
  else if (verdict.status === 'blocked') tellThemWhy(verdict.reason);
  else offerToTryAgain(verdict.message);
}
```

🔴 `scanned` is the only verdict that clears the image for anyone but its
author. `blocked` is the host refusing it; `error` is the host not answering —
neither is a pass, so branch on `scanned`, never on "not blocked". `scan()`
waits as long as the host takes and this package imposes no deadline of its
own, which is why the snippet passes a signal.

A **generation source** is private and unscanned here — the orchestrator scans
it when the workflow runs — so it needs no verdict, and comes back as a url and
the image's real dimensions. A step takes the two separately: `sourceImage` is
the url, and the dimensions are the step's own:

```ts
const app = await initialize();

const source = await app.host.openImageUpload({ purpose: 'generationSource' });
if (source) {
  await app.orchestration.submitWorkflow({
    steps: [
      {
        $type: 'textToImage',
        input: {
          model: 'urn:air:sdxl:checkpoint:civitai:101055@128078',
          prompt: 'the same lighthouse, at dawn',
          cfgScale: 7,
          seed: 1234,
          sourceImage: source.url,
          width: source.width,
          height: source.height,
        },
      },
    ],
  });
}
```

### Publishing a generation

Outputs of a workflow your app ran can become public images, and the host asks
the viewer first. Needs `ai:write:budgeted` — an app trusted to spend their
Buzz on a generation is trusted to publish what it produced.

```ts
const app = await initialize();

const imageIds = await app.host.publishGenerationOutputs(
  { workflowId, imageIndexes: [0, 2] },
  { signal: AbortSignal.timeout(600_000) },
);
```

🔴 **Outputs are named by index, never by url.** The host re-derives that this
viewer and this app own the workflow and resolves the urls itself — a frame at
an opaque origin naming its own blob to publish would be a different feature
entirely. Omit `imageIndexes` to publish every output; an unusable list is
refused here rather than sent, because the host reads one it cannot parse as
*publish everything*.

The host holds its confirmation in front of a person, so this waits as long as
they take and nothing here cuts it short — pass a `signal`, as above, for the
bound your app wants. A viewer who declines rejects the call.

⚠ Publishing is best-effort per image: an output that fails is skipped rather
than failing the call, so `imageIds` can be **shorter** than what you selected
and nothing says which index dropped. Compare lengths; do not pair ids to
indexes.

## Parent origins

Messages are accepted only from an allowlisted parent origin. The allowlist is
read from `VITE_` / `NEXT_PUBLIC_` / `PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS` at
build time, falling back to the canonical civitai.com origins when there is no
build step. To override at runtime, call `getTransport({ allowedParentOrigins })`
before `initialize()`; options apply on first use only.

Wildcards take the form `https://*.example.com` and match subdomains on a dot
boundary. A port never matches a wildcard — list a ported parent as an exact
entry.

## Testing

`@civitai/sdk/testing` has `createFakeTransport()`: pass it as
`initialize({ transport })` and script the host's answers.

There is no published fake for app storage, on purpose. The seam is `fetch`, so
pass your own `fetch` to `initialize({ token, fetch })` and the client's URLs,
bodies, statuses and date revival are all real — which a fake replacing the
`storage` client would not be. Two things to get right in one you write:

- **Make the page size small** (2 or 3, not the server's 50). A page that holds
  every fixture is exactly how a caller that never forwards `cursor` passes a
  whole green suite.
- **Put `updatedAt` on the wire as an ISO string**, as `res.json()` does. Hand
  the client a `Date` and its revival becomes unobservable, since
  `new Date(aDate)` is a `Date`.

This SDK's own suite keeps one at
[`test/support/fake-app-storage.ts`](./test/support/fake-app-storage.ts); it is
not exported, because four of the five fleet apps that store per-viewer state
need knobs it does not have (injected latency, prefix-targeted refusals, quota
overrides, a cursor it ignores, a read that never settles). Copy it if it helps.

## Checks

- `npm run api` regenerates [`api/public-api.md`](./api/public-api.md) from the
  compiler's own declarations; CI fails when it is stale.
- `npm run check:parity` fails when a message sent here has no handler in the
  host, checked against a committed snapshot of civitai's handler inventory.
  Refresh it with `npm run snapshot:host`.
- `npm run check:layering` keeps `core` free of any domain.
- `npm run check:steps` fails when the step unions no longer match the
  installed `@civitai/orchestration-client`.

See [`BREAKING.md`](./BREAKING.md) for what an app gives up moving from
`@civitai/app-sdk` 0.x and `@civitai/blocks-react`.

## License

MIT
