---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Long-poll the orchestrator instead of timer-polling it, and give blocks a push-shaped API.

**`@civitai/app-sdk` — `pollWorkflow` is now actually a long poll.**
It was documented as a "Server-side long-poll helper" and was a client-side
`setTimeout` loop re-reading the workflow every second with no `wait` parameter.
The orchestrator has supported `GET /v2/consumer/workflows/{id}?wait=<seconds>`
all along. `getWorkflow` gains `{ waitSeconds, signal }` and `pollWorkflow`
defaults to a 20s hold per attempt, re-arming across each 202 until the workflow
ends. On the default 30s budget that is ~2 requests instead of ~30, and terminal
status is detected when the workflow ends rather than on the next tick after it
ended. The return contract is unchanged, `waitSeconds: 0` restores the old
behaviour, and `intervalMs` is retained as a floor so a host that ignores `wait`
cannot turn the loop into a request storm. `signal` now reaches `fetch`, so a
held request is genuinely cancelled rather than merely abandoned.

The four starters gain this for free: they already pass `timeoutMs`, and the
hold is clamped down to whatever is left of that budget (so their `wait=0`
default path is byte-identical to today).

**`@civitai/app-sdk` — `POLL_WORKFLOW` accepts an optional `waitSeconds`.**
Additive and backward-compatible in both directions: a host that does not read
the field answers immediately as today, and a block that never sends it is
unaffected by a host that does. Only send it from a loop that awaits each poll.

**`@civitai/blocks-react` — `useBuzzWorkflow()` gains `watch()`.**
`watch(workflowId, { onUpdate, signal, waitSeconds, intervalMs, timeoutMs,
maxRetries })` resolves with the terminal snapshot and pushes every intermediate
one to `onUpdate`, replacing the `useEffect` + `setTimeout` backoff blocks used
to hand-write around `poll()`. The loop is sequential and non-overlapping by
construction — exactly one request per watched workflow is ever in flight, which
is what makes a long hold safe — and it absorbs a bounded burst of transient
poll failures instead of ending a generation on one blip. `poll()` is unchanged
and stays as the single-round-trip primitive.

Also corrects two false docstrings on `useBuzzWorkflow`: it no longer tells
callers to write their own polling loop, and `WorkflowBody` is now documented
with all three union members (the `kind: 'step'` arm shipped in
`@civitai/app-sdk@0.30.0` and was missing).
