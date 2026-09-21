# Breaking changes

What an app gives up or rewrites moving from `@civitai/app-sdk` 0.x (with
`@civitai/blocks-react`) to this package. Keep it current as the host and the
API catch up.

## Data moved from the bridge to the API

A block used to ask the host for data over `postMessage`. It now calls the
public `/api/v1` API (`app.site`) and the orchestrator (`app.orchestration`)
itself, with the token `initialize()` gives it. Routes are added to `/api/v1` as apps need them, so several old
messages have no destination yet.

| Old message(s) | Now | Status |
|---|---|---|
| `GET_VIEWER` | `app.site.get('me')` | Route exists |
| `SUBMIT_WORKFLOW`, `ESTIMATE_WORKFLOW`, `POLL_WORKFLOW`, `CANCEL_WORKFLOW`, `QUERY_APP_WORKFLOWS`, `CANCEL_APP_WORKFLOW` | `app.orchestration` | Works with an OAuth token |
| `GET_IMAGES_BY_IDS` | `GET /api/v1/images` | Takes one `imageId`, not a list |
| `APP_STORAGE_*` | — | No v1 route |
| `SHARED_*` | — | No v1 route |
| `GET_BUZZ_BALANCE`, `GET_BUZZ_ACCOUNTS`, `GET_BUZZ_TRANSACTIONS` | — | No v1 route |
| `CREATE_POST_FROM_APP`, `PUBLISH_GENERATION_OUTPUTS` | — | No v1 route; both also showed a host confirmation per post, which an API call does not |
| `SET_COLLECTION_FOLLOW` | — | No v1 route |
| `GET_DAILY_COMPENSATION`, `GET_WILDCARD_PACK`, `TRACK_EVENT` | — | Not carried |

## What a direct orchestrator call loses

Submitting through the host went through civitai's own `blocks.submitWorkflow`,
which added controls a direct call does not get:

- **Spend caps.** A per-call `buzzBudget`, a per-viewer daily cap and a per-app
  daily cap, all enforced by civitai. A direct call has only the orchestrator's
  per-token budget, taken from the viewer's consent.
- **Attribution.** civitai tagged each workflow with the app and block it came
  from. The orchestrator records the token's OAuth client internally but not on
  the workflow, so per-app reporting needs an orchestrator change.

## Host UI still carried

On `app.host`: `requestSignIn`, `download` (was `SAVE_IMAGE`),
`openResourcePicker`, `openBuzzPurchase`, `resize`, `reportError`, `navigate`
and `onVisibilityChange`. Consent is `app.requestGrants` (was `requestConsent`).

Not carried: `OPEN_CHECKPOINT_PICKER` (use `openResourcePicker` with
`resourceType: 'Checkpoint'`), `SET_USER_CHECKPOINT` (inert on a page),
`OPEN_IMAGE_UPLOAD` (image-only; the site's upload takes media).

## Behaviour

| What | Before | Now |
|---|---|---|
| Host failures | free-text `error` on each reply | `BridgeError` with a `code` |
| Request deadlines | per-message client timeouts | none; pass an `AbortSignal` |
| A refused grant | rejected | resolves `false` |
| React hooks | 38 | none — plain functions; bind them in your framework |

## Waiting on the host

For a block to use the API at all, civitai has to:

1. Mint an OAuth access token for the app's own client (`appblk-<slug>`) and
   send it in `BLOCK_INIT` and `TOKEN_REFRESH`, instead of or beside the block
   JWT. The auth hub currently bars `appblk-*` clients from its flows.
2. Let a browser send `Authorization` to `/api/v1` from the app's registered
   origins; the public routes answer with a wildcard that does not cover it.
3. Add the `/api/v1` routes above as apps need them, and scope checks.

And the orchestrator has to check that a workflow belongs to the caller before
reading, changing or deleting it, which it does not today.
