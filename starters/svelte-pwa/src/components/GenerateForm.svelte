<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    canGenerate,
    costOrNull,
    createEstimateSequencer,
    quoteFor,
    type Quote,
  } from '../lib/estimate';
  import { attemptFor, type Attempt } from '../lib/attempt-key';
  import { estimateCost, getWorkflow, submitGeneration } from '../lib/api';
  import {
    DEFAULT_MODEL_AIR,
    extractImageUrls,
    type WorkflowSnapshot,
  } from '@civitai/app-sdk/orchestrator';

  /**
   * The user's Buzz balance, or `null`/`undefined` when this app could not read
   * it — `BuzzRead` is optional at OAuth consent and a client without it gets a
   * 403 from `buzz.getUserAccount`. It comes from `getBuzzBalance()`, NEVER
   * from `/api/v1/me`, which returns no balance at all.
   *
   * 🔴 UNKNOWN RENDERS NOTHING, ON PURPOSE — the cost line below drops its
   * "Your balance: …" clause rather than printing a dash or a zero. That is why
   * this prop was silently invisible before the balance was ever wired up: it
   * was always `undefined`, so the clause never rendered and nobody could see
   * it was broken. `tests/guards/starter-buzz-balance-source.test.mjs` pins
   * where the value comes from so it cannot silently go back to always-undefined.
   */
  let { initialBalance }: { initialBalance?: number | null } = $props();

  type Phase = 'idle' | 'estimating' | 'previewed' | 'submitting' | 'polling' | 'done' | 'error';

  const SERVER_WAIT_MS = 25_000;
  const OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

  let prompt = $state('A close-up oil painting of a mossy stone fox, dappled forest light');
  let phase = $state<Phase>('idle');
  let error = $state<string | null>(null);
  // The last estimate, together with the prompt it priced. It is shown, and
  // unlocks Generate, only while the prompt is still exactly that prompt.
  let quote = $state<Quote | null>(null);
  // Orders estimate requests so a reply that arrives after Reset, or after a
  // newer estimate started, is dropped instead of pricing the current prompt.
  const sequencer = createEstimateSequencer();
  let workflowId = $state<string | null>(null);
  let snapshot = $state<WorkflowSnapshot | null>(null);

  let abort: AbortController | null = null;
  // The idempotency key of the current Generate attempt, bound to its prompt
  // (see `attempt-key.ts`). Kept across a failed submit, a failed wait and the
  // re-Preview they force, so a retry cannot pay for a second workflow.
  // Dropped when the workflow finishes, on Reset and when the prompt is edited.
  let attempt: Attempt | null = null;
  onDestroy(() => abort?.abort());

  async function estimate() {
    const ticket = sequencer.begin(prompt);
    phase = 'estimating';
    error = null;
    quote = null;
    try {
      const res = await estimateCost({ prompt: ticket.prompt });
      if (!sequencer.isCurrent(ticket)) return;
      // `null` when the estimate came back without a cost: shown as
      // "Estimate unavailable" and Generate stays disabled.
      quote = { prompt: ticket.prompt, cost: costOrNull(res.cost) };
      phase = 'previewed';
    } catch (err) {
      if (!sequencer.isCurrent(ticket)) return;
      error = err instanceof Error ? err.message : 'unknown';
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
        const { snapshot: snap, done } = await getWorkflow(id, SERVER_WAIT_MS, controller.signal);
        snapshot = snap;
        if (done) {
          // Finished (succeeded or not): the next Generate is a new attempt.
          attempt = null;
          phase = 'done';
          return;
        }
      }
      throw new Error('polling timeout');
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      // The workflow was accepted, so it may still be running and charging.
      // Drop the quote, as a failed submit does (see `submit`).
      quote = null;
      error = err instanceof Error ? err.message : 'unknown';
      phase = 'error';
    }
  }

  async function submit() {
    phase = 'submitting';
    error = null;
    snapshot = null;
    const next = attemptFor(attempt, prompt);
    attempt = next;
    try {
      const { workflowId: id } = await submitGeneration({ prompt, idempotencyKey: next.key });
      workflowId = id;
      phase = 'polling';
      longPollUntilDone(id);
    } catch (err) {
      // 🔴 A failed submit may still have started a workflow: a timeout or a
      // 5xx can arrive after the orchestrator accepted it. So drop the quote.
      // Generate stays locked until a new Preview prices the prompt again, and
      // one more click cannot pay for a second workflow. Preview stays usable.
      // Keep this attempt's key even if Reset cleared it while the request was
      // in flight: the workflow may exist, and the retry must reuse the key.
      // (The key is bound to its prompt, so an edited prompt still gets a new one.)
      attempt ??= next;
      quote = null;
      error = err instanceof Error ? err.message : 'unknown';
      phase = 'error';
    }
  }

  // An edited prompt is a new input, so the next Generate is a new attempt.
  function dropAttempt() {
    attempt = null;
  }

  function reset() {
    abort?.abort();
    sequencer.invalidate();
    attempt = null;
    phase = 'idle';
    error = null;
    quote = null;
    workflowId = null;
    snapshot = null;
  }

  const imageUrls = $derived(extractImageUrls(snapshot));

  const busy = $derived(phase === 'estimating' || phase === 'submitting' || phase === 'polling');
  const currentQuote = $derived(quoteFor(quote, prompt));
  const currentCost = $derived(currentQuote?.cost ?? null);
</script>

<section class="flex flex-col gap-4">
  <label class="flex flex-col gap-1 text-sm">
    <span class="font-medium">Prompt</span>
    <textarea
      class="min-h-[5rem] rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      bind:value={prompt}
      oninput={dropAttempt}
      disabled={busy}
    ></textarea>
    <span class="text-xs text-zinc-500">
      Model: <code class="font-mono">{DEFAULT_MODEL_AIR}</code> (edit
      <code class="mx-1 font-mono">server/civitai.ts</code> to change)
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
      disabled={!canGenerate({ busy, prompt, quote })}
      class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
    >
      {phase === 'submitting'
        ? 'Submitting…'
        : phase === 'polling'
          ? 'Generating…'
          : `Generate${currentCost != null ? ` (≈ ${currentCost} Buzz)` : ''}`}
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

  {#if currentQuote && currentCost == null && phase === 'previewed'}
    <p role="status" class="text-sm text-amber-700 dark:text-amber-400">
      Estimate unavailable: the Buzz cost for this prompt could not be
      determined, so Generate is disabled.
    </p>
  {/if}

  {#if !currentQuote && !busy && prompt.trim() !== ''}
    <p class="text-xs text-zinc-500">
      Preview the Buzz cost of this prompt to enable Generate.
    </p>
  {/if}

  {#if currentCost != null && phase === 'previewed'}
    <p class="text-sm text-zinc-600 dark:text-zinc-400">
      This will cost <strong>{currentCost}</strong> Buzz.
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
