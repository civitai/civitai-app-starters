import { useCallback, useEffect, useRef, useState } from 'react';

import {
  useBlockContext,
  useBlockResize,
  useBuzzWorkflow,
  WorkflowEstimateError,
  WorkflowSubmitError,
} from '@civitai/blocks-react';
import { Alert, Button, Card, Group, Stack, Textarea } from '@civitai/blocks-react/ui';
import { isModelSlotContext } from '@civitai/app-sdk/blocks';
import type { BlockTextToImageParams, BlockWorkflowSnapshot, WorkflowBody } from '@civitai/app-sdk/blocks';

/**
 * buzz-workflow — generate an image and bill Buzz, the right way.
 *
 * The flow is estimate → (user confirms) → submit → poll → done, all
 * host-mediated (the block never holds an orchestrator token). Three rules
 * this example bakes in so you don't hit the bugs we did:
 *
 *  - GOTCHA #59: the estimate MUST build its params with the EXACT same logic
 *    as submit — same seed decision especially. The orchestrator whatif prices
 *    a CACHE HIT (identical workflow already generated) at 0 and a fresh job at
 *    full cost, and the seed is what decides cache-hit-ness. If the estimate
 *    uses a fixed seed but submit randomizes, the CTA quotes 0 while submit
 *    charges full. `buildParams(randomize)` is the single shared builder both
 *    call.
 *  - GOTCHA #8/#9/#10: `useBuzzWorkflow().status === 'confirming'` means
 *    "estimate landed, user reviewing" — that's IDLE, not busy. Only
 *    `estimating | submitting | polling` are busy. `result` is populated after
 *    estimate() too, so don't treat a non-null `result` as "queued". And the
 *    hook does NOT auto-poll — the caller runs the poll loop (below).
 *  - Non-blocking queue: submit returns immediately with `status: 'polling'`;
 *    we drop the job into a local queue and poll each entry on a backoff so the
 *    UI stays responsive and the user can fire more.
 */

const QUANTITY = 1;

export function App() {
  const { ready, context, theme } = useBlockContext();
  const { estimate, submit, poll, cancel, status } = useBuzzWorkflow();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  // Keep <html> in step with the host theme (see hello-world for the why).
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  // NARROW, don't cast: `isModelSlotContext` is a runtime check that the host
  // really sent a model slot with every field a generation body needs. A cast
  // would hand `undefined` ids to the orchestrator on any other slot.
  const model = ready && isModelSlotContext(context) ? context : null;

  const [prompt, setPrompt] = useState('a serene mountain lake at golden hour');
  // After the first generation, the next Generate is a re-gen → randomize the
  // seed (a fresh job). The first gen reuses the showcase seed (a cache hit, 0).
  // estimate + submit both read THIS so they can't drift (gotcha #59).
  const [isRegenerate, setIsRegenerate] = useState(false);
  const [quotedCost, setQuotedCost] = useState<number | null>(null);
  // App-owned copy for why there is no price, chosen by `estimateFailureMessage`.
  const [estimateNote, setEstimateNote] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  // Shared param builder — the ONLY place params are constructed, so estimate
  // and submit are guaranteed identical. `randomize` omits the seed (the
  // orchestrator then picks a fresh one → fresh job → full cost). A fixed seed
  // reuses the cached workflow → cache hit → 0 (gotcha #59).
  const buildBody = useCallback(
    (randomize: boolean): WorkflowBody | null => {
      if (!model) return null;
      const params: BlockTextToImageParams = {
        prompt,
        steps: 25,
        cfgScale: 7,
        // round dimensions to /64 — the orchestrator U-Net rejects non-/64
        // dims with "Width must be divisible by 64" (gotcha #19).
        width: round64(1024),
        height: round64(1024),
        quantity: QUANTITY,
        // Omit `seed` to randomize; include a fixed one to (try to) cache-hit.
        ...(randomize ? {} : { seed: 1234567 }),
      };
      return { kind: 'textToImage', modelId: model.modelId, modelVersionId: model.modelVersionId, params };
    },
    [model, prompt],
  );

  // Re-quote whenever the inputs OR the regenerate decision change, so the CTA
  // shows the cost of what the NEXT submit will actually do.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const body = buildBody(isRegenerate);
    if (!body) return;
    estimate(body)
      .then((snap) => {
        if (cancelled) return;
        setQuotedCost(snap.cost?.total ?? null);
        setEstimateNote(null);
      })
      .catch((err: unknown) => {
        // 🔴 BRANCH ON THE ERROR'S `code`, NEVER ON ITS PROSE. Since blocks-react
        // 0.43 an unusable estimate REJECTS with a `WorkflowEstimateError`; its
        // `code` is the only stable branch target. `snapshot.error` is the
        // server's own reason (unsanitised: log it, never render it) and
        // `message` is developer-facing and not a contract.
        if (err instanceof WorkflowEstimateError) {
          console.warn(`[buzz-workflow] estimate ${err.code}:`, err.snapshot.error ?? '(no reason given)');
        } else {
          console.warn('[buzz-workflow] estimate did not complete:', err);
        }
        if (cancelled) return;
        setQuotedCost(null);
        setEstimateNote(estimateFailureMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ready, buildBody, isRegenerate, estimate]);

  const handleGenerate = useCallback(async () => {
    const body = buildBody(isRegenerate);
    if (!body) return;
    const localId = crypto.randomUUID();
    // Optimistically enqueue a pending card BEFORE submit resolves.
    setQueue((q) => [{ localId, workflowId: null, snapshot: null, status: 'submitting' }, ...q]);
    try {
      const snap = await submit(body);
      // 🔴 LOG AND CLASSIFY BEFORE `setQueue`, NOT INSIDE IT. A state updater must
      // be PURE: React double-invokes it in StrictMode, so a `console.warn` in
      // there prints every developer diagnostic twice in dev — and example code
      // is exactly where an impure updater gets copied from.
      if (snap.status === 'failed') logServerReason('submit', snap);
      const viewerMessage = snap.status === 'failed' ? submitFailureMessage(snap) : undefined;
      setQueue((q) =>
        q.map((it) =>
          it.localId === localId
            ? {
                ...it,
                workflowId: snap.workflowId,
                snapshot: snap,
                status: mapStatus(snap),
                ...(viewerMessage ? { viewerMessage } : {}),
              }
            : it,
        ),
      );
    } catch (err) {
      // 🔴 THE ERROR IS NO LONGER SWALLOWED. This used to be a bare `catch {}`,
      // which threw away the only diagnostic a failed submit produces — so the
      // card said "generation failed" and nothing, anywhere, said why.
      logServerReason('submit', err instanceof WorkflowSubmitError ? err.snapshot : null, err);
      const outcome = submitRejectionOutcome(err);
      setQueue((q) =>
        q.map((it) =>
          it.localId === localId
            ? outcome.pollWorkflowId
              ? // A workflow probably exists: track it like any other submit so
                // the poll loop below reports its REAL fate, instead of guessing.
                {
                  ...it,
                  workflowId: outcome.pollWorkflowId,
                  status: 'processing',
                  viewerMessage: outcome.viewerMessage,
                }
              : { ...it, status: 'error', viewerMessage: outcome.viewerMessage }
            : it,
        ),
      );
    }
    // The first gen is done → the next one is a re-gen (gotcha #59).
    setIsRegenerate(true);
  }, [buildBody, isRegenerate, submit]);

  // Poll every non-terminal queue entry on a backoff. The hook does NOT
  // auto-poll — this is the caller's job (gotcha #10).
  useEffect(() => {
    const pending = queue.filter((it) => it.workflowId && !TERMINAL.has(it.status));
    if (pending.length === 0) return;
    const timers = pending.map((it) =>
      window.setTimeout(async () => {
        try {
          const snap = await poll(it.workflowId!);
          // Classify + log OUTSIDE the updater (see the submit arm), and use the
          // POLL message — the submit discriminator does not hold here. A card
          // that is being polled BECAUSE its submit was rejected 'workflow-failed'
          // keeps its own, more cautious copy: that one must not invite a retry.
          if (snap.status === 'failed') logServerReason('poll', snap);
          const viewerMessage =
            snap.status === 'failed' ? (it.viewerMessage ?? pollFailureMessage()) : undefined;
          setQueue((q) =>
            q.map((q2) =>
              q2.localId === it.localId
                ? {
                    ...q2,
                    snapshot: snap,
                    status: mapStatus(snap),
                    ...(viewerMessage ? { viewerMessage } : {}),
                  }
                : q2,
            ),
          );
        } catch {
          /* transient — the next tick retries */
        }
      }, 2500),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [queue, poll]);

  const cancelJob = useCallback(
    (localId: string) => {
      // Real server-side cancel (gotcha #51): `cancel(workflowId)` asks the
      // host to STOP the workflow on the orchestrator — not just untrack it
      // client-side — so the job stops spending Buzz. The host re-derives
      // ownership from the viewer's token, so a block can only cancel
      // workflows the viewer owns. cancel is best-effort: if the workflow
      // already finished, it rejects, but we still clear the card.
      const item = queue.find((it) => it.localId === localId);
      if (item?.workflowId) {
        cancel(item.workflowId).catch(() => {
          /* already finished / transient — the card is cleared regardless */
        });
      }
      setQueue((q) => q.filter((it) => it.localId !== localId));
    },
    [queue, cancel],
  );

  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;

  // `confirming` is IDLE — the button stays enabled (gotcha #8).
  const busy = status === 'estimating' || status === 'submitting';

  return (
    <div ref={rootRef} data-theme={theme} style={{ padding: 16 }}>
      <Stack gap={8}>
        <strong>Generate on {model?.modelName}</strong>

        <Textarea label="Prompt" minRows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />

        <div>
          <Button onClick={handleGenerate} disabled={busy}>
            Generate ·{' '}
            {quotedCost == null ? '…' : quotedCost === 0 ? 'free (cache hit)' : `${quotedCost} Buzz`}
          </Button>
        </div>
        {estimateNote ? <small style={dimmed}>{estimateNote}</small> : null}

        {queue.map((it) => (
          <Card key={it.localId} aria-label="Generating">
            <Stack gap={8}>
              <Group justify="space-between">
                <span>{labelFor(it.status)}</span>
                {!TERMINAL.has(it.status) ? (
                  <Button variant="subtle" size="sm" onClick={() => cancelJob(it.localId)}>
                    Cancel
                  </Button>
                ) : null}
              </Group>
              {it.snapshot?.imageUrls?.[0] ? (
                <img src={it.snapshot.imageUrls[0]} alt="result" style={{ width: '100%', borderRadius: 6 }} />
              ) : null}
              {it.snapshot?.autoClaim ? (
                <small style={dimmed}>+{it.snapshot.autoClaim.amount} daily boost claimed</small>
              ) : null}
              {it.status === 'error' || it.snapshot?.status === 'failed' ? (
                // 🔴 APP-OWNED COPY ONLY. This used to render `it.snapshot?.error`
                // — a server-authored, unsanitised string — straight into markup.
                // The server's own words are logged for the developer by
                // `logServerReason`; they must not reach a viewer.
                <Alert color="error">{it.viewerMessage ?? 'The generation failed. Please try again.'}</Alert>
              ) : null}
            </Stack>
          </Card>
        ))}
      </Stack>
    </div>
  );
}

interface QueueItem {
  localId: string;
  workflowId: string | null;
  snapshot: BlockWorkflowSnapshot | null;
  status: QueueStatus;
  /**
   * Viewer-facing copy THIS APP owns, chosen by {@link submitFailureMessage}
   * or {@link pollFailureMessage} depending on which phase observed the failure.
   *
   * 🔴 IT EXISTS SO `snapshot.error` NEVER REACHES THE SCREEN. That field is
   * server-authored and UNSANITISED — civitai's own error handling documents
   * that raw upstream text, database constraint and column names among it, can
   * reach it. This card used to render it directly.
   */
  viewerMessage?: string;
}
type QueueStatus = 'submitting' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'expired' | 'error';
const TERMINAL = new Set<QueueStatus>(['succeeded', 'failed', 'canceled', 'expired', 'error']);

/**
 * Viewer copy THIS APP owns for an estimate that produced no price.
 *
 * - `'failed'`  — the estimate did not succeed: usually the server refused this
 *   configuration (its reason is on `snapshot.error`, logged above). Retrying the
 *   same inputs will not help, so say so.
 * - `'no-cost'` — the reply was not a failure but carried no price. Nothing for
 *   the viewer to fix; the quote may come back on the next change.
 * - anything else — the request itself did not complete (a timeout, say).
 */
function estimateFailureMessage(err: unknown): string {
  if (err instanceof WorkflowEstimateError) {
    return err.code === 'failed'
      ? "This generation can't be priced as configured. Try a different prompt or settings."
      : 'No price is available right now.';
  }
  return "Couldn't reach Civitai to price this generation.";
}

/**
 * Log the server's own words for the developer. Never rendered.
 *
 * 🔴 THE RAW TEXT IS LOGGED, NOT DISCARDED. Deleting it would trade a leak for a
 * blind spot: the server's reason is the only thing that explains WHY a specific
 * config will not run, so it has to stay reachable in a developer surface.
 */
function logServerReason(where: string, snap: BlockWorkflowSnapshot | null, thrown?: unknown) {
  if (snap?.error) console.warn(`[buzz-workflow] ${where} — server reason:`, snap.error);
  if (thrown) console.warn(`[buzz-workflow] ${where} threw:`, thrown);
}

/**
 * What to show — and whether there is anything to poll — when `submit()`
 * REJECTS (as opposed to resolving a priced refusal, handled above).
 *
 * 🔴 NOT EVERY REJECTION MAY SAY "TRY AGAIN". The three arms differ on MONEY, so
 * they get different copy (the same split as the `buzz-purchase` example):
 *   - `'workflow-failed'` — a workflow probably exists and Buzz MAY ALREADY BE
 *     COMMITTED. Inviting a retry would mint a fresh idempotency key and reserve
 *     a SECOND time. Poll the returned id instead — unless it is `'whatif'`, the
 *     server's non-workflow sentinel, which has nothing behind it to poll.
 *   - `'exception'` — the host had no workflow to report; usually nothing was
 *     queued, so a retry is the sensible recovery.
 *   - anything else is transport-level (most likely the request timeout), and a
 *     timed-out submit may well have been queued and charged: most cautious copy.
 */
function submitRejectionOutcome(err: unknown): { viewerMessage: string; pollWorkflowId?: string } {
  if (err instanceof WorkflowSubmitError) {
    if (err.code === 'workflow-failed') {
      const id = err.snapshot.workflowId;
      return {
        viewerMessage:
          'The generation was submitted but did not complete. Check your generation history before retrying.',
        ...(id && id !== 'whatif' ? { pollWorkflowId: id } : {}),
      };
    }
    return { viewerMessage: 'Could not start the generation. Please try again.' };
  }
  return {
    viewerMessage: 'We lost contact before the generation was confirmed. Check your generation history before trying again.',
  };
}

/**
 * Viewer copy THIS APP owns for a failed SUBMIT reply.
 *
 * 🔴 THE `cost` TEST IS ONLY MEANINGFUL ON THE SUBMIT REPLY — see
 * {@link pollFailureMessage} for why it must not be reused on a poll. The host
 * enforces budget and cap rules BEFORE forwarding to the orchestrator, so a
 * `failed` submit carrying a price is the host declining to spend: a documented
 * OUTCOME, not a crash.
 *
 * 🔴 NEVER "NOT ENOUGH BUZZ". A resolved priced refusal is a spend CAP or limit
 * (the per-call budget — whose error text literally reads "insufficient buzz
 * budget" — a daily or per-app cap, a velocity limit, a transient deny, a
 * missing quote), and buying Buzz raises none of them. A viewer who is genuinely
 * out of Buzz makes `submit` REJECT instead. So the copy is cause-neutral and
 * never matches on the server's wording.
 *
 * 🔴 AND "NOTHING WAS CHARGED" ONLY FOR THE SENTINEL. The `'failed'` sentinel id
 * means the host refused before anything ran. A REAL workflow id means a run was
 * created and came back failed, and Buzz may have been spent. (This example
 * submits text-to-image, so it never sees the unconfirmed-TRAINING reply, which
 * also uses the sentinel — see `useBuzzWorkflow`'s `submit` docs.)
 */
function submitFailureMessage(snap: BlockWorkflowSnapshot): string {
  if (snap.workflowId === 'failed') {
    return 'This generation was not started, and nothing was charged. Please try again later.';
  }
  return 'This generation failed. Check your generation history before trying again.';
}

/**
 * Viewer copy for a failure observed while POLLING.
 *
 * 🔴 DO NOT APPLY THE PRICED-REFUSAL TEST HERE. Budget and cap enforcement
 * happens before the workflow is ever forwarded, so a `failed` on a POLL is the
 * orchestrator reporting that the generation itself failed — a model error, a
 * node crash, a step timeout. And a submitted workflow IS priced, so its
 * snapshot carries a `cost` (the server reads exactly that field as the
 * workflow's realized spend when it settles). Reusing the submit discriminator
 * here therefore renders "a spending limit was reached" for a crash — a false
 * cause, implying nothing was spent, for a workflow that may well have been
 * charged.
 */
function pollFailureMessage(): string {
  return 'The generation failed. Please try again.';
}

function mapStatus(snap: BlockWorkflowSnapshot): QueueStatus {
  if (snap.status === 'pending') return 'processing';
  return snap.status;
}

function labelFor(s: QueueStatus): string {
  switch (s) {
    case 'submitting':
      return 'Submitting…';
    case 'processing':
      return 'Generating…';
    case 'succeeded':
      return 'Done';
    case 'failed':
    case 'error':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    case 'expired':
      return 'Expired';
  }
}

/** Round to the nearest multiple of 64 — orchestrator U-Net requirement (gotcha #19). */
function round64(n: number): number {
  return Math.max(64, Math.round(n / 64) * 64);
}

const dimmed = { color: 'var(--civitai-color-text-dimmed)' } as const;
