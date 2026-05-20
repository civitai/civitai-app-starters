'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_MODEL_AIR,
  extractImageUrls,
  type WorkflowSnapshot,
} from '@civitai/app-sdk/orchestrator';

type Phase = 'idle' | 'estimating' | 'previewed' | 'submitting' | 'polling' | 'done' | 'error';

// How long the BFF holds each long-poll request open before returning.
// Server caps this; keep it under typical proxy timeouts (Vercel: 60s).
const SERVER_WAIT_MS = 25_000;
// Overall ceiling for the wait — once exceeded we give up and surface an error.
const OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

export function GenerateForm({ initialBalance }: { initialBalance?: number }) {
  const [prompt, setPrompt] = useState(
    'A close-up oil painting of a mossy stone fox, dappled forest light',
  );
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewCost, setPreviewCost] = useState<number | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const estimate = useCallback(async () => {
    setPhase('estimating');
    setError(null);
    setPreviewCost(null);
    try {
      const res = await fetch('/api/generate/estimate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      setPreviewCost(json.cost);
      setPhase('previewed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
      setPhase('error');
    }
  }, [prompt]);

  const longPollUntilDone = useCallback(async (id: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const deadline = Date.now() + OVERALL_TIMEOUT_MS;
    try {
      while (Date.now() < deadline) {
        const res = await fetch(
          `/api/workflow/${encodeURIComponent(id)}?wait=${SERVER_WAIT_MS}`,
          { signal: controller.signal },
        );
        const json = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(json));
        setSnapshot(json.snapshot as WorkflowSnapshot);
        if (json.done) {
          setPhase('done');
          return;
        }
      }
      throw new Error('polling timeout');
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'unknown error');
      setPhase('error');
    }
  }, []);

  const submit = useCallback(async () => {
    setPhase('submitting');
    setError(null);
    setSnapshot(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      setWorkflowId(json.workflowId);
      setPhase('polling');
      longPollUntilDone(json.workflowId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
      setPhase('error');
    }
  }, [prompt, longPollUntilDone]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase('idle');
    setError(null);
    setPreviewCost(null);
    setWorkflowId(null);
    setSnapshot(null);
  }, []);

  const imageUrls = extractImageUrls(snapshot);

  const busy = phase === 'estimating' || phase === 'submitting' || phase === 'polling';

  return (
    <section className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Prompt</span>
        <textarea
          className="min-h-[5rem] rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy}
        />
        <span className="text-xs text-zinc-500">
          Model: <code className="font-mono">{DEFAULT_MODEL_AIR}</code> (edit
          <code className="mx-1 font-mono">src/lib/civitai.ts</code> to change)
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={estimate}
          disabled={busy || !prompt.trim()}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {phase === 'estimating' ? 'Estimating…' : 'Preview Buzz cost'}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !prompt.trim()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {phase === 'submitting'
            ? 'Submitting…'
            : phase === 'polling'
              ? 'Generating…'
              : `Generate${previewCost != null ? ` (≈ ${previewCost} Buzz)` : ''}`}
        </button>
        {phase !== 'idle' && (
          <button
            type="button"
            onClick={reset}
            className="ml-auto text-xs text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Reset
          </button>
        )}
      </div>

      {previewCost != null && phase === 'previewed' && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This will cost <strong>{previewCost}</strong> Buzz.
          {initialBalance != null && (
            <span className="ml-1">Your balance: {initialBalance} Buzz.</span>
          )}
        </p>
      )}

      {phase === 'polling' && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Workflow <code className="font-mono">{workflowId}</code> —{' '}
          {snapshot?.status ?? 'queued'}…
        </p>
      )}

      {phase === 'error' && error && (
        <pre className="overflow-auto rounded-md bg-red-50 p-3 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </pre>
      )}

      {phase === 'done' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Status: <strong>{snapshot?.status}</strong>
            {snapshot?.cost?.total != null && <> — spent {snapshot.cost.total} Buzz.</>}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {imageUrls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt="Generated"
                className="rounded-md border border-zinc-200 dark:border-zinc-800"
              />
            ))}
          </div>
          {imageUrls.length === 0 && snapshot && (
            <>
              <p className="text-sm text-zinc-500">
                No images in the response. Workflow snapshot:
              </p>
              <pre className="overflow-auto rounded-md bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </section>
  );
}
