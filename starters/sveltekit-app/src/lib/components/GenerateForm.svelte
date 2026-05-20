<script lang="ts">
  import {
    DEFAULT_MODEL_AIR,
    extractImageUrls,
    type WorkflowSnapshot,
  } from '@civitai/app-sdk/orchestrator';
  import { onDestroy } from 'svelte';

  let { initialBalance }: { initialBalance?: number } = $props();

  type Phase = 'idle' | 'estimating' | 'previewed' | 'submitting' | 'polling' | 'done' | 'error';

  const SERVER_WAIT_MS = 25_000;
  const OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

  let prompt = $state('A close-up oil painting of a mossy stone fox, dappled forest light');
  let phase = $state<Phase>('idle');
  let error = $state<string | null>(null);
  let previewCost = $state<number | null>(null);
  let workflowId = $state<string | null>(null);
  let snapshot = $state<WorkflowSnapshot | null>(null);

  let abort: AbortController | null = null;
  onDestroy(() => abort?.abort());

  async function estimate() {
    phase = 'estimating';
    error = null;
    previewCost = null;
    try {
      const res = await fetch('/api/generate/estimate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      previewCost = json.cost;
      phase = 'previewed';
    } catch (err) {
      error = err instanceof Error ? err.message : 'unknown error';
      phase = 'error';
    }
  }

  async function longPollUntilDone(id: string) {
    abort?.abort();
    const controller = new AbortController();
    abort = controller;

    const deadline = Date.now() + OVERALL_TIMEOUT_MS;
    try {
      while (Date.now() < deadline) {
        const res = await fetch(
          `/api/workflow/${encodeURIComponent(id)}?wait=${SERVER_WAIT_MS}`,
          { signal: controller.signal },
        );
        const json = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(json));
        snapshot = json.snapshot as WorkflowSnapshot;
        if (json.done) {
          phase = 'done';
          return;
        }
      }
      throw new Error('polling timeout');
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      error = err instanceof Error ? err.message : 'unknown error';
      phase = 'error';
    }
  }

  async function submit() {
    phase = 'submitting';
    error = null;
    snapshot = null;
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      workflowId = json.workflowId;
      phase = 'polling';
      longPollUntilDone(json.workflowId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'unknown error';
      phase = 'error';
    }
  }

  function reset() {
    abort?.abort();
    phase = 'idle';
    error = null;
    previewCost = null;
    workflowId = null;
    snapshot = null;
  }

  const imageUrls = $derived(extractImageUrls(snapshot));

  const busy = $derived(phase === 'estimating' || phase === 'submitting' || phase === 'polling');
</script>

<section class="flex flex-col gap-4">
  <label class="flex flex-col gap-1 text-sm">
    <span class="font-medium">Prompt</span>
    <textarea
      class="min-h-[5rem] rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      bind:value={prompt}
      disabled={busy}
    ></textarea>
    <span class="text-xs text-zinc-500">
      Model: <code class="font-mono">{DEFAULT_MODEL_AIR}</code> (edit
      <code class="mx-1 font-mono">src/lib/civitai.ts</code> to change)
    </span>
  </label>

  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      onclick={estimate}
      disabled={busy || !prompt.trim()}
      class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      {phase === 'estimating' ? 'Estimating…' : 'Preview Buzz cost'}
    </button>
    <button
      type="button"
      onclick={submit}
      disabled={busy || !prompt.trim()}
      class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
    >
      {phase === 'submitting'
        ? 'Submitting…'
        : phase === 'polling'
          ? 'Generating…'
          : `Generate${previewCost != null ? ` (≈ ${previewCost} Buzz)` : ''}`}
    </button>
    {#if phase !== 'idle'}
      <button
        type="button"
        onclick={reset}
        class="ml-auto text-xs text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        Reset
      </button>
    {/if}
  </div>

  {#if previewCost != null && phase === 'previewed'}
    <p class="text-sm text-zinc-600 dark:text-zinc-400">
      This will cost <strong>{previewCost}</strong> Buzz.
      {#if initialBalance != null}
        <span class="ml-1">Your balance: {initialBalance} Buzz.</span>
      {/if}
    </p>
  {/if}

  {#if phase === 'polling'}
    <p class="text-sm text-zinc-600 dark:text-zinc-400">
      Workflow <code class="font-mono">{workflowId}</code> — {snapshot?.status ?? 'queued'}…
    </p>
  {/if}

  {#if phase === 'error' && error}
    <pre
      class="overflow-auto rounded-md bg-red-50 p-3 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">{error}</pre>
  {/if}

  {#if phase === 'done'}
    <div class="flex flex-col gap-2">
      <p class="text-sm text-zinc-600 dark:text-zinc-400">
        Status: <strong>{snapshot?.status}</strong>
        {#if snapshot?.cost?.total != null}
          — spent {snapshot.cost.total} Buzz.
        {/if}
      </p>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {#each imageUrls as url (url)}
          <img
            src={url}
            alt="Generated"
            class="rounded-md border border-zinc-200 dark:border-zinc-800"
          />
        {/each}
      </div>
      {#if imageUrls.length === 0 && snapshot}
        <p class="text-sm text-zinc-500">No images in the response. Workflow snapshot:</p>
        <pre class="overflow-auto rounded-md bg-zinc-100 p-3 text-xs dark:bg-zinc-900">{JSON.stringify(
            snapshot,
            null,
            2,
          )}</pre>
      {/if}
    </div>
  {/if}
</section>
