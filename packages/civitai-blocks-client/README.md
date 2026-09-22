# `@civitai/blocks-client`

The v1 shape of the Civitai app SDK, developed here under a working name. It
will publish as `@civitai/app-sdk@1`; the `@civitai/app-sdk` 0.x in this repo is
a separate codebase and keeps its own releases.

```ts
import { initialize } from '@civitai/blocks-client';

const app = await initialize();

const picked = await app.host.openResourcePicker({ resourceType: 'Checkpoint' });
if (!picked) return;

const { air } = await app.site.get<{ air: string }>(`model-versions/mini/${picked.versionId}`);

if (!(await app.requestGrants(['ai:write:budgeted']))) return;

const submitted = await app.orchestration.submitWorkflow({
  steps: [{ $type: 'textToImage', input: { model: air, prompt: 'A lighthouse at dusk' } }],
});
const workflow = await app.orchestration.waitForWorkflow(submitted.id!);
```

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

> **Not yet end to end for blocks.** The host still mints a block-scoped JWT,
> which `/api/v1` and the orchestrator do not accept; they take API keys and
> OAuth tokens. Apps with one of those work today, from a browser or a server.

## Signing in outside civitai.com

A browser app signs the viewer in with Civitai itself: PKCE against
`auth.civitai.com`, no server and no client secret. Register the app as a
public OAuth client with its origins and redirect URL.

```ts
import { createSignIn, initialize } from '@civitai/blocks-client';

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

Host failures reject with a `BridgeError` carrying a `code` (`forbidden`,
`unauthenticated`, `rate-limited`, …). Timeouts are the host's to set; pass a
`signal` to cancel. `ApiError` and `BridgeError` both extend `CivitaiError`, so
one `catch` can tell a refusal from a bug.

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

`@civitai/blocks-client/testing` has `createFakeTransport()`: pass it as
`initialize({ transport })` and script the host's answers.

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
