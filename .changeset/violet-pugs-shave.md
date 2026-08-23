---
'@civitai/blocks-react': minor
---

fix(blocks-react): an ERRORED submit must reject, not resolve a workflow that was never queued (civitai/civitai-app-starters#251)

The `submit` half of civitai/civitai#4159. PR #250 fixed `estimate`; this closes
the same information loss on `submit`.

## Root cause

`useBuzzWorkflow().submit()` resolved **every** failure-shaped reply. Two
different things produce one and they are **indistinguishable by `status`** —
both report `'failed'`:

| producer | what it means | carries `cost`? |
| --- | --- | --- |
| budget / spend-cap rejection | a legitimate **outcome** the block recovers from (open a top-up flow) | **yes** — the price the server declined to charge |
| a caught server exception, posted as the host's `failureSnapshot(err)` | the submit **errored**; nothing was queued, nothing was charged | **no** |

So a block branching on `snap.status === 'failed'` could not tell "you can't
afford this" from "the request failed", and one gating a money control on
`typeof snap.cost?.total === 'number'` saw the same dead-control shape #250
fixed for `estimate`.

## The discriminator

`cost` presence, and it was already on the wire — no new field. The asymmetry is
not incidental: **all 13** `status: 'failed'` sites on the server's submit path
attach a price. Twelve are budget/cap exits (the per-call `buzzBudget` gate, the
per-user daily Buzz cap, the per-app aggregate and velocity caps, the dev-tunnel
session cap — across all three body kinds); the thirteenth is the
**missing-price-quote** exit, which is not a cap at all but is priced just the
same. `failureSnapshot(err)` never carries a price.

🔴 **Not every priced refusal is affordability.** The per-app velocity limit, the
per-app aggregate daily cap, a fail-closed "temporarily unavailable" deny and a
missing price quote are priced, resolving outcomes that buying Buzz cannot fix.
Docs and examples branch before offering a top-up.

## The change

`submit()` rejects with the newly exported `WorkflowSubmitError` when the reply
is failure-shaped **and** carries no numeric `cost.total`. `err.code`
(`'exception'`) is the structural discriminator and `err.snapshot` is the host's
raw reply, so nothing reachable before is lost.

**Both clauses of the guard are load-bearing**, and each has its own control in
the test file:

- dropping `status === 'failed'` would reject every ordinary in-flight reply —
  `{ workflowId:'wf_…', status:'pending' }` is cost-less too;
- dropping the cost test would reject the budget rejection and **break the
  top-up recovery flow**, which is the one thing #251 says must not break. The
  scope-pin test #250 left behind (`submit() still RESOLVES a budget rejection`)
  survives this change **unaltered** and is that clause's killing test.

The cost test is `typeof … !== 'number'`, never `!snapshot.cost?.total`: `0` is a
real price and falsy.

`result` is published **before** the rejection, so a failed submit can never
leave a previous submit's workflow sitting in `result`.

**Where the reason lives: `err.snapshot.error`.** `err.message` is deliberately a
generic developer-facing constant naming only the code — the lesson from #253,
where two real apps piped `WorkflowEstimateError.message` straight into rendered
UI. Raw upstream text (Prisma/`pg` constraint names among it) can reach
`snapshot.error`, and `message` is what an uncaught rejection prints and what a
third-party block's error reporter ships upstream by default. A regression test
built from a realistic `Unique constraint failed: Key (email)=(…)` fixture
asserts the raw string is preserved verbatim on `.snapshot.error` and absent from
`message` fragment by fragment.

## Two codes, because they differ on whether MONEY MOVED

`err.code` is the branch target and it is **not** a formality:

- `'exception'` — the host built the reply itself (`failureSnapshot(err)`, which
  hardcodes `workflowId: 'failed'`), from a `catch` **or** a non-catch
  short-circuit such as the moderator-review nack. It means **the host had no
  workflow to report — not that nothing happened**. Usually nothing was queued or
  charged and a retry is fine, but a **lost response** (the server's own catch
  concedes a retry "DID create a workflow server-side despite a lost response"),
  an **in-progress idempotency CONFLICT**, or a **transient 5xx/408/429/401** on
  `dev:live` all land here. Retry with the SAME `idempotencyKey`, and never
  render "nothing was charged" as a certainty.
- `'workflow-failed'` — a REAL orchestrator id came back failed and unpriced
  (`snapshotFromWorkflow` omits `cost` on any non-numeric total). 🔴 **Buzz may
  already be committed**: server-side, *any* resolved submit keeps its
  reservation "regardless of snapshot status", with no refund on a non-throwing
  failed snapshot, and `finalizeGenIdempotency` runs on that path. So this arm
  must not tell the viewer it was free, and must not auto-retry — `submit()`
  mints a fresh `idempotencyKey` per call, so a blind retry is a SECOND
  reservation. Read `err.snapshot.workflowId` and poll it — after checking it is
  not `'whatif'`, which the server also treats as a non-workflow sentinel (it
  emits `workflow.id ?? 'whatif'` and skips persistence/settle on either).

Classification is **fail-safe in ONE direction only**, and an earlier draft
overstated it: an id that is not the host's `'failed'` sentinel falls to
`'workflow-failed'`, so an unrecognised shape never buys the reassuring reading.
The converse does not hold — the sentinel arm is itself reachable by cases where
money may have moved, which is why its copy is now hedged rather than absolute.

The sentinel is matched with `===`, never a prefix test: relaxing it to
`.startsWith(...)` would reclassify a real workflow whose id merely begins with
`failed`, and that WIDENING survived the whole suite until a `'failed-x'` fixture
was added. Three widening mutants were found in this PR by looking for the shape
deliberately — a delete-only mutation sweep sees none of them.

`err.message` is one template for both codes and deliberately makes **no claim
about money** — an earlier draft read "submit did not queue a workflow", which is
false for the second arm.

## Behaviour changes to know before upgrading

- **Moderator review preview now rejects on submit**, as it already does on
  estimate: the host answers every workflow request there with
  `failureSnapshot('not available in review preview')`. A block without a `catch`
  turns a reviewer's first click into an unhandled rejection.
- **Mock-host submit knobs that simulate a THROWN server error now reject** —
  `generation.failNext`, `generation.failRate`, `failMode: 'some'`, and
  `disallowedAccountTypes`. They emit the host's `failureSnapshot(err)` shape
  (the `'failed'` sentinel id, no `cost`), so they reject with
  `code: 'exception'`. The reason is unchanged and still fully recoverable, on
  `err.snapshot.error`.
  (`failMode: 'all'` / `'insufficient'` are the *priced* arm and still RESOLVE.)
  🔴 **Correction to an earlier draft of these notes**: the claim that "the real
  backend has no generic submit-time failure outcome" was **wrong**. It does have
  generic transient failures — a fail-closed `unavailable` deny and a
  missing-price-quote exit — but it returns them as **priced, resolving**
  snapshots. That is a shape the mock does not yet simulate; the knobs above
  model a thrown error, which is a different thing.
- **Mock-host failure snapshots now carry the real `workflowId: 'failed'`
  sentinel** instead of a synthetic `wf_fail_N`. Required for correctness, not
  tidiness: a made-up id classifies as `'workflow-failed'`, i.e. as a real
  workflow with possibly-committed spend.
- **Balance / `insufficient` mock paths still RESOLVE** — they model a priced
  refusal, and they now carry the `cost` the real server sends (see the fixture
  fix below).

## Also in this change

- **New mock-host knob `generation.failSubmitException` (+
  `failSubmitExceptionMessage`)** — the estimate-side `failEstimate`'s twin.
  Until now an *errored* submit was unreachable in every local harness: the
  balance / `insufficient` knobs model a budget rejection, which resolves, so a
  block author testing "what if submit goes wrong" only ever exercised the arm
  that never throws. That gap is a large part of how this stayed invisible. The
  knob is covered end-to-end through the real hook + transport, with a negative
  control asserting submits behave normally when it is unset.
- **Fixture fidelity fix — the mock host's insufficient-Buzz snapshot was missing
  its `cost`.** The real server quotes the price at every budget/cap exit; the
  mock did not. Left alone, the fix would have made the mock's own top-up path
  reject, i.e. the local harness that exists to exercise the recovery flow could
  no longer reach it.
- **Pre-existing defect fixed in the `buzz-purchase` example harness**: its
  insufficient-budget reply used `workflowId: ''`, which the SDK's inbound
  validator DROPS — so the reply never resolved the pending request and the
  demo's insufficient path hung to the transport's 120s timeout rather than
  showing the top-up CTA. It now uses the real `'failed'` sentinel and carries a
  `cost`, matching the server.

## What this does NOT change

The budget-rejection arm. It resolves, exactly as before, and the recovery flow
blocks depend on is untouched.

## Correction to an earlier draft

An earlier draft of these notes said a real failed workflow was indistinguishable
from a `failureSnapshot(err)` and called it an accepted residual. **That was
wrong.** The wire does separate them: every host-synthesised failure goes through
`failureSnapshot()`, which hardcodes `workflowId: 'failed'`, while
`snapshotFromWorkflow` returns the real `workflow.id`. That is what
`'workflow-failed'` is keyed on, and it is why the money language can now be
correct per code instead of uniformly optimistic.
