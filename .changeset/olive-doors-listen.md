---
'@civitai/sdk': minor
---

A block-scoped token for a signed-in viewer no longer stops `initialize()`. The
0.4.0 guard rejected it outright, and that was wrong for two reasons measured
since:

- **It rejected the DEFAULT host configuration.** The OAuth mint is behind
  `APP_BLOCK_OAUTH_TOKENS_ENABLED`, which defaults **false**, so a block that had
  declared `auth: "oauth"` correctly still received the block JWT — and then could
  not start at all, including on the `blocks/*` routes and `app.storage` that token
  is the *required* credential for.
- **It deadlocked the `consent_required` fallback.** That path exists so a block
  can ask for consent, and it is only reachable for a signed-in viewer, so the
  guard fired before the prompt could be shown. `app.requestGrants()` reaches the
  host's consent dialog on a block token; it just has to be handed to you first.

The diagnostic is not gone — it moved to the surface that actually cannot serve
the token, which is where the SDK can say something true:

| Surface | Holding a block token, signed in |
|---|---|
| `app.storage.*`, `app.site` on `blocks/…` and `models/{id}` | Work. Unchanged |
| the rest of `app.site` (`/api/v1`) | The API's own 401/403, with the `auth: "oauth"` opt-in appended to the message. `ApiError`'s `status` and `body` are untouched, so a caller can still branch on them |
| `app.orchestration.*` | Rejects **before** the request with a `CivitaiError` naming the opt-in. The orchestrator accepts no block token on any route, so this destination — unlike a path-addressed `/api/v1` route — is known without making the call |
| `app.requestGrants(...)` | Works |

Anonymous viewers and hosts that send no `kind` behave exactly as before: no
OAuth token is minted for an anonymous viewer whatever the manifest says, so the
manifest is not their fix, and an absent `kind` is not evidence of a block token.

New: `initialize({ requireOAuthToken: true })` restores the eager refusal, for a
block whose first screen already needs an OAuth-only surface. 🔴 Not a
precaution — wherever the host's flag is off it makes the block fail to load for
every signed-in viewer, including one that only uses `storage`.

⚠ One case the SDK cannot explain, and does not pretend to: a *public* `/api/v1`
route such as `images` ignores an unusable token and answers **anonymously**
rather than refusing. Nothing observable at the client seam separates that from a
successful authenticated read. Prefer the `blocks/*` twin.

**Minor, not patch, deliberately.** Nothing that worked stops working, but
whether `initialize()` throws is observable, and under 0.x a `^0.4.0` pin
resolves `>=0.4.0 <0.5.0` — so a minor is the boundary that stops this reaching
an existing pin silently. Bumping the range is the opt-in.
