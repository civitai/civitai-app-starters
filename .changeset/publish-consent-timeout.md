---
'@civitai/blocks-react': patch
---

Fix `usePublishGenerationOutputs()` rejecting mid-consent-dialog, which billed the viewer for outputs that reached nothing.

`PUBLISH_GENERATION_OUTPUTS` is consent-gated: the host opens its own "publish to
the shared grid?" confirm and replies only on an explicit human click or dismiss.
The hook passed no `timeoutMs`, so it inherited the transport's
`DEFAULT_REQUEST_TIMEOUT_MS` of 30 seconds — the budget for a fast protocol
round-trip, not for a person noticing a modal and reading it. Past 30s the bridge
rejected with `IframeTransport: request "PUBLISH_GENERATION_OUTPUTS" timed out
after 30000ms` while the dialog was still on screen. The generation itself had
already succeeded and been billed, and a dead publish bridge has no refund path,
so the charge stood and the outputs were lost (civitai/civitai#4158, reproduced
2 of 2 across different models, ecosystems and prices).

`publish()` now passes the same 10-minute human-interaction bound the pickers and
the image upload already used. It still does not hang: the host resolves the
instant the viewer acts, and the ceiling still bounds an abandoned dialog.

Two more changes ride along, both internal:

- `useBuzzPurchase().openPurchaseModal()` had the identical defect — its reply
  arrives when the viewer closes a purchase modal, and on the 30s default it
  rejected mid-checkout, reading to the block as "purchase failed" for a purchase
  that may have succeeded.
- `PICKER_REQUEST_TIMEOUT_MS` is renamed `HUMAN_INTERACTION_TIMEOUT_MS` and moved
  to `internal/requestTimeouts.ts`, alongside a TOTAL bucketing of every
  block→parent message type into `human` / `protocol` / `no-reply`. The old name
  described the first caller rather than the property that selects the timeout,
  which is how a consent confirm failed to read as "a picker" to the author who
  omitted it. **No public API changes** — the constant is not reachable by
  consumers: it was never re-exported from the package entry point, and the
  `exports` map declares no deep subpath, so a deep import fails at resolution
  with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
