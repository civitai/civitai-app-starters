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
not incidental: **every** budget/cap exit on the server's submit path attaches
the quote it refused (the per-call `buzzBudget` gate, the per-user daily Buzz
cap, the per-app aggregate and velocity caps, the dev-tunnel session cap — on all
three body kinds, 14 sites in total), while `failureSnapshot(err)` never does.

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

## Behaviour changes to know before upgrading

- **Moderator review preview now rejects on submit**, as it already does on
  estimate: the host answers every workflow request there with
  `failureSnapshot('not available in review preview')`. A block without a `catch`
  turns a reviewer's first click into an unhandled rejection.
- **Mock-host submit knobs that simulate a THROWN server error now reject** —
  `generation.failNext`, `generation.failRate`, `failMode: 'some' | 'all'`, and
  `disallowedAccountTypes`. They emit the `failureSnapshot(err)` shape (no
  `cost`) because that is what the real backend produces: it has no generic
  submit-time failure *outcome*; every priced refusal is a budget/cap exit.
  Adding a cost to keep them resolving would make the mock simulate a reply the
  server never sends. The reason is unchanged and still fully recoverable, on
  `err.snapshot.error`.
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

## Known residual case, stated honestly

A **real** orchestrator workflow that comes back already `'failed'` at submit
time with no price also rejects. Its id is not lost — it rides on
`err.snapshot.workflowId`, so a caller that wants to `watch()` it still can.
There is no field on the wire that separates that from a `failureSnapshot(err)`,
and treating an unpriced failure as an error is the fail-closed reading on a
money path.
