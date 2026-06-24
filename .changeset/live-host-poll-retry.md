---
'@civitai/blocks-react': patch
---

fix(testing): `createLiveHost` no longer turns a transient poll transport error into a terminal `failed` workflow.

`dev:live` polls a workflow via the `blocks.pollWorkflow` tRPC mutation. Previously, ANY non-2xx response or network throw on a poll (a not-yet-rolled-out backend pod 401ing for a few seconds, a momentary network hiccup, a 5xx blip) was fabricated into a terminal `WORKFLOW_STATUS` snapshot with `status: 'failed'` — so a generation that succeeded server-side showed as FAILED in the block and the poll loop stopped. The round-5 dogfood hit exactly this (its success needed manual retries past bad pods).

The poll path now distinguishes a transport/infra blip from a genuine workflow failure: a real workflow failure is a 200 response whose snapshot is `status: 'failed'` (forwarded as-is, terminal), whereas any non-2xx / network throw is a transport error. Transport errors are retried with bounded exponential backoff (up to 4 attempts, ~1.75s worst case). If the backend stays unreachable after the retries, the host replies with a NON-terminal `processing` snapshot carrying the transient error (so the block's own poll loop keeps polling and the real outcome can still surface) — never a synthesized terminal `failed`. `ESTIMATE`/`SUBMIT`/`CANCEL` behavior is unchanged.
