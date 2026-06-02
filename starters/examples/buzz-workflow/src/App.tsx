import { useCallback, useEffect, useRef, useState } from 'react';

import { useBlockContext, useBlockResize, useBuzzWorkflow } from '@civitai/blocks-react';
import type {
  BlockTextToImageParams,
  BlockWorkflowSnapshot,
  ModelSlotContext,
  WorkflowBody,
} from '@civitai/app-sdk/blocks';

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
  const { estimate, submit, poll, status } = useBuzzWorkflow();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  const model = ready ? (context as ModelSlotContext) : null;

  const [prompt, setPrompt] = useState('a serene mountain lake at golden hour');
  // After the first generation, the next Generate is a re-gen → randomize the
  // seed (a fresh job). The first gen reuses the showcase seed (a cache hit, 0).
  // estimate + submit both read THIS so they can't drift (gotcha #59).
  const [isRegenerate, setIsRegenerate] = useState(false);
  const [quotedCost, setQuotedCost] = useState<number | null>(null);
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
        if (!cancelled) setQuotedCost(snap.cost?.total ?? null);
      })
      .catch(() => {
        if (!cancelled) setQuotedCost(null);
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
      setQueue((q) =>
        q.map((it) =>
          it.localId === localId
            ? { ...it, workflowId: snap.workflowId, snapshot: snap, status: mapStatus(snap) }
            : it,
        ),
      );
    } catch {
      setQueue((q) =>
        q.map((it) => (it.localId === localId ? { ...it, status: 'error' } : it)),
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
          setQueue((q) =>
            q.map((q2) =>
              q2.localId === it.localId
                ? { ...q2, snapshot: snap, status: mapStatus(snap) }
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

  const cancelJob = useCallback((localId: string) => {
    // Client-side cancel: stop polling + clear the card. NOTE: in
    // @civitai/blocks-react >= 0.5.0 the hook also exposes
    // `cancel(workflowId)` for a REAL server-side orchestrator cancel
    // (gotcha #51) — call that too so the workflow stops spending Buzz:
    //   const { cancel } = useBuzzWorkflow();
    //   if (item.workflowId) cancel(item.workflowId).catch(() => {});
    // This example targets the buildable workspace SDK (no cancel yet) and
    // does the client-side half only.
    setQueue((q) => q.filter((it) => it.localId !== localId));
  }, []);

  if (!ready) {
    return (
      <div ref={rootRef} data-theme={theme} className="hw-root">
        Loading…
      </div>
    );
  }

  // `confirming` is IDLE — the button stays enabled (gotcha #8).
  const busy = status === 'estimating' || status === 'submitting';

  return (
    <div ref={rootRef} data-theme={theme} className="hw-root">
      <strong>Generate on {model?.modelName}</strong>

      <textarea
        className="hw-card"
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        style={{ resize: 'vertical', width: '100%' }}
      />

      <button onClick={handleGenerate} disabled={busy} style={buttonStyle}>
        Generate ·{' '}
        {quotedCost == null ? '…' : quotedCost === 0 ? 'free (cache hit)' : `${quotedCost} Buzz`}
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {queue.map((it) => (
          <div key={it.localId} className="hw-card" aria-label="Generating">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{labelFor(it.status)}</span>
              {!TERMINAL.has(it.status) ? (
                <button onClick={() => cancelJob(it.localId)} style={linkButtonStyle}>
                  Cancel
                </button>
              ) : null}
            </div>
            {it.snapshot?.imageUrls?.[0] ? (
              <img
                src={it.snapshot.imageUrls[0]}
                alt="result"
                style={{ width: '100%', borderRadius: 6, marginTop: 8 }}
              />
            ) : null}
            {it.snapshot?.autoClaim ? (
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                +{it.snapshot.autoClaim.amount} daily boost claimed
              </div>
            ) : null}
            {it.status === 'error' || it.snapshot?.status === 'failed' ? (
              <div style={{ color: '#e03131', fontSize: 12, marginTop: 4 }}>
                {it.snapshot?.error ?? 'generation failed'}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

interface QueueItem {
  localId: string;
  workflowId: string | null;
  snapshot: BlockWorkflowSnapshot | null;
  status: QueueStatus;
}
type QueueStatus = 'submitting' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'expired' | 'error';
const TERMINAL = new Set<QueueStatus>(['succeeded', 'failed', 'canceled', 'expired', 'error']);

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

const buttonStyle = {
  padding: '8px 14px',
  border: 'none',
  borderRadius: 6,
  background: '#1971c2',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
} as const;

const linkButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
  fontSize: 12,
} as const;
