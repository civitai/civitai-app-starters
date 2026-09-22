# @civitai/sdk

## 0.2.0

### Minor Changes

- 266a021: Add `@civitai/sdk` — the Civitai SDK for block apps and external apps alike,
  and the successor to `@civitai/app-sdk` 0.x, which keeps its own releases.

  `const app = await initialize()` is the one entry point. In a block it waits for
  the host to hand over the viewer, the slot and a token, and rejects if no host
  answers; `initialize({ token })` is the same client for an app that holds an
  OAuth token.

  - `app.site` calls the public `/api/v1` REST API by path, retrying once with a
    fresh token on a 401 and throwing `ApiError`.
  - `app.orchestration` submits, estimates, reads, watches, waits for, cancels and
    queries workflows, carrying the orchestrator's own `WorkflowTemplate` and
    `Workflow`. `watchWorkflow` is an async generator that yields each change
    until the workflow finishes, on held reads rather than a polling interval.
  - `app.requestGrants(scopes)` asks for more scopes and resolves `false` when they
    cannot be granted.
  - `app.host`, in a block only, asks for the host's own UI: `requestSignIn`,
    `download`, `openResourcePicker`, `openBuzzPurchase`, `resize`, `reportError`,
    `navigate` and `onVisibilityChange` — every one a message the host answers
    today, checked against a snapshot of its handler inventory.

  Not yet end to end for blocks: the host still mints a block JWT that `/api/v1`
  and the orchestrator do not accept. `BREAKING.md` lists what the host has to
  change and what an app gives up moving off the bridge.

- 266a021: `createSignIn()` signs a viewer in with Civitai from a browser app outside
  civitai.com — PKCE against `auth.civitai.com`, no server, no client secret — and
  is what `initialize()` takes. Tokens stay in memory and refresh themselves;
  `requestGrants` goes back to Civitai for scopes not yet granted.

### Patch Changes

- 266a021: Blocks now start inside civitai.red and civitai.green, and reading the parent
  origins from the environment no longer bundles every other `VITE_*` variable
  into the app.
