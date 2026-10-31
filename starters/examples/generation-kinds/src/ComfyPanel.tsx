import { useCallback, useEffect, useRef, useState } from 'react';

import { useBuzzWorkflow, useWildcardPack, WildcardPackError, WorkflowSubmitError } from '@civitai/blocks-react';
import { Alert, Badge, Button, Card, Group, Select, Stack, Textarea, TextInput } from '@civitai/blocks-react/ui';
import type { BlockWorkflowSnapshot, WorkflowBodyCustomComfyRecipe } from '@civitai/app-sdk/blocks';

import {
  estimateFailureMessage,
  logServerReason,
  pollFailureMessage,
  pollUntilTerminal,
  submitFailureMessage,
  submitRejectionOutcome,
  TERMINAL_STATUSES,
} from './workflow.js';

/**
 * `kind: 'customComfy'`, RECIPE arm — "Comfy on Civitai" by registered recipe id.
 *
 * The block names a server-registered, code-reviewed ComfyUI recipe and sends a
 * small `params` object; the server owns the graph, its resources and its Buzz
 * ceiling. `starter-comfy-txt2img` is the recipe the CLI's page-money template
 * uses: `params` is `.strict()` `{ prompt (≤1500 chars), seed?, accountType? }`
 * — any other key is a rejection, not a drop.
 *
 * MONEY IS POST-PAID. `estimate` returns the recipe's fixed DISPLAY estimate,
 * not a quote; submit reserves the recipe's ceiling against the token budget
 * (`page.buzzBudgetPerGen` must be ≥ it, or every submit is refused), and the
 * charge settles to the measured runtime on the terminal snapshot.
 *
 * Not shown: the INLINE arm (`mode: 'inline'`, the block ships its own graph).
 * It is accepted from third-party page apps today, on the same gates — see the
 * README for why this example sticks to the reviewed recipe.
 */
const RECIPE = 'starter-comfy-txt2img';
const PROMPT_MAX = 1500;

/** Annotate the ARM, not the union: excess-property checks then catch an inline-arm key here. */
function buildBody(prompt: string): WorkflowBodyCustomComfyRecipe {
  return { kind: 'customComfy', recipe: RECIPE, params: { prompt: prompt.trim().slice(0, PROMPT_MAX) } };
}

type Run =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'polling'; workflowId: string; snapshot: BlockWorkflowSnapshot | null; note?: string }
  | { phase: 'done'; snapshot: BlockWorkflowSnapshot; note?: string }
  | { phase: 'error'; message: string };

export function ComfyPanel({ canSpend, signedIn }: { canSpend: boolean; signedIn: boolean }) {
  const { estimate, submit, poll, cancel } = useBuzzWorkflow();
  const [prompt, setPrompt] = useState('a lighthouse on a cliff at dusk, volumetric light');
  const [quote, setQuote] = useState<number | null>(null);
  const [quoteNote, setQuoteNote] = useState<string | null>(null);
  const [run, setRun] = useState<Run>({ phase: 'idle' });
  const stopPoll = useRef<(() => void) | null>(null);
  useEffect(() => () => stopPoll.current?.(), []);

  // ESTIMATE: re-quote when the prompt settles. The SAME builder feeds submit,
  // so what was priced is what runs.
  useEffect(() => {
    if (!canSpend || !prompt.trim()) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      estimate(buildBody(prompt))
        .then((snap) => {
          if (cancelled) return;
          setQuote(snap.cost?.total ?? null);
          setQuoteNote(null);
        })
        .catch((err: unknown) => {
          logServerReason('comfy estimate', null, err);
          if (cancelled) return;
          setQuote(null);
          setQuoteNote(estimateFailureMessage(err));
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [canSpend, prompt, estimate]);

  const follow = useCallback(
    (workflowId: string, note?: string) => {
      stopPoll.current?.();
      setRun({ phase: 'polling', workflowId, snapshot: null, ...(note ? { note } : {}) });
      stopPoll.current = pollUntilTerminal(poll, workflowId, (snap) => {
        if (snap.status === 'failed') logServerReason('comfy poll', snap);
        setRun(
          TERMINAL_STATUSES.has(snap.status)
            ? { phase: 'done', snapshot: snap, note: snap.status === 'failed' ? (note ?? pollFailureMessage()) : note }
            : { phase: 'polling', workflowId, snapshot: snap, ...(note ? { note } : {}) },
        );
      });
    },
    [poll],
  );

  // CONFIRM + SUBMIT: the click on the quoted button is the confirmation.
  const onRun = useCallback(async () => {
    setRun({ phase: 'submitting' });
    try {
      const snap = await submit(buildBody(prompt));
      if (snap.status === 'failed') {
        // A RESOLVED failure: a cap refusal before anything ran (the placeholder id,
        // nothing charged) or a real run that came back failed and may have spent —
        // `submitFailureMessage` says which. Either way there is nothing to poll.
        logServerReason('comfy submit', snap);
        setRun({ phase: 'error', message: submitFailureMessage(snap) });
        return;
      }
      follow(snap.workflowId);
    } catch (err) {
      logServerReason('comfy submit', err instanceof WorkflowSubmitError ? err.snapshot : null, err);
      const outcome = submitRejectionOutcome(err);
      if (outcome.pollWorkflowId) follow(outcome.pollWorkflowId, outcome.viewerMessage);
      else setRun({ phase: 'error', message: outcome.viewerMessage });
    }
  }, [prompt, submit, follow]);

  const onCancel = useCallback(() => {
    if (run.phase !== 'polling') return;
    stopPoll.current?.();
    // A real server-side cancel; best-effort if it already finished.
    cancel(run.workflowId)
      .then((snap) => setRun({ phase: 'done', snapshot: snap }))
      .catch(() => setRun({ phase: 'idle' }));
  }, [run, cancel]);

  const busy = run.phase === 'submitting' || run.phase === 'polling';
  const shown = run.phase === 'done' ? run.snapshot : run.phase === 'polling' ? run.snapshot : null;

  return (
    <Card data-testid="comfy-panel">
      <Stack gap={12}>
        <Group justify="space-between" gap={8}>
          <strong>Comfy recipe</strong>
          <Badge variant="outline">customComfy · {RECIPE}</Badge>
        </Group>
        <Textarea
          label="Prompt"
          minRows={3}
          maxLength={PROMPT_MAX}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <WildcardPicker enabled={signedIn} onPick={(option) => setPrompt((p) => `${p.trim()}, ${option}`)} />
        <Group gap={8}>
          <Button onClick={onRun} disabled={!canSpend || busy || quote == null} loading={run.phase === 'submitting'}>
            {quote == null ? 'Run' : `Run · est. ${quote} Buzz`}
          </Button>
          {run.phase === 'polling' ? (
            <Button variant="subtle" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </Group>
        <small style={dimmed}>
          {quoteNote ??
            'An estimate, not a price: you are charged the measured runtime, bounded by the recipe’s registered ceiling.'}
        </small>

        {run.phase === 'polling' ? <span role="status">Generating…</span> : null}
        {run.phase === 'error' ? <Alert color="error">{run.message}</Alert> : null}
        {run.phase !== 'error' && run.phase !== 'idle' && 'note' in run && run.note ? (
          <Alert color="warning">{run.note}</Alert>
        ) : null}
        {shown?.status === 'succeeded' ? (
          <Stack gap={8}>
            {(shown.imageUrls ?? []).map((url) => (
              <img key={url} src={url} alt="Comfy recipe result" style={imageStyle} />
            ))}
            {typeof shown.cost?.total === 'number' ? (
              <small style={dimmed} data-testid="comfy-charged">
                Charged {shown.cost.total} Buzz
              </small>
            ) : null}
          </Stack>
        ) : null}
        {shown && (shown.status === 'canceled' || shown.status === 'expired') ? (
          <Alert color="warning">{shown.status === 'canceled' ? 'Canceled.' : 'Timed out before it finished.'}</Alert>
        ) : null}
      </Stack>
    </Card>
  );
}

/**
 * `useWildcardPack(modelVersionId)` — the host resolves, downloads and parses a
 * wildcard pack in the viewer's own session and hands back its lists. Not a
 * `WorkflowBody` kind: it feeds a prompt. No manifest scope, but a signed-in
 * viewer, and page-host only. A non-positive id is a no-op, which is how this
 * stays idle until the viewer asks.
 */
function WildcardPicker({ enabled, onPick }: { enabled: boolean; onPick: (option: string) => void }) {
  const [draftId, setDraftId] = useState('');
  const [versionId, setVersionId] = useState(0);
  const { pack, loading, error, refetch } = useWildcardPack(versionId);
  const [list, setList] = useState('');
  const names = pack ? Object.keys(pack.lists) : [];
  const current = list && pack?.lists[list] ? list : (names[0] ?? '');
  const options = current && pack ? (pack.lists[current] ?? []) : [];

  return (
    <Stack gap={8} data-testid="wildcard">
      <Group gap={8} align="flex-end">
        <TextInput
          label="Wildcard pack (model version id)"
          inputMode="numeric"
          value={draftId}
          onChange={(e) => setDraftId(e.target.value.replace(/\D/g, ''))}
          style={{ flex: '1 1 180px' }}
        />
        <Button variant="light" disabled={!enabled || !draftId} onClick={() => setVersionId(Number(draftId))}>
          Load pack
        </Button>
      </Group>
      {versionId > 0 && loading ? <small style={dimmed}>Loading pack…</small> : null}
      {error ? (
        <Alert color="warning">
          {wildcardErrorMessage(error)}{' '}
          {error instanceof WildcardPackError && error.code === 'busy' ? (
            <Button size="sm" variant="subtle" onClick={() => void refetch()}>
              Retry
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {pack && names.length > 0 ? (
        <Group gap={8} align="flex-end">
          <Select
            label={`${pack.modelName} · list`}
            value={current}
            onChange={setList}
            options={names.map((n) => ({ value: n, label: `${n} (${pack.lists[n]?.length ?? 0})` }))}
            style={{ flex: '1 1 180px' }}
          />
          <Button
            variant="light"
            disabled={options.length === 0}
            onClick={() => onPick(options[Math.floor(Math.random() * options.length)] ?? '')}
          >
            Add random option
          </Button>
        </Group>
      ) : null}
    </Stack>
  );
}

/** Branch on the DISCRIMINATED code — the host never sends free text on this channel. */
function wildcardErrorMessage(err: Error): string {
  if (!(err instanceof WildcardPackError)) return 'Could not reach Civitai to load that pack.';
  switch (err.code) {
    case 'not-found':
      return 'No wildcard pack you can download has that version id.';
    case 'forbidden':
      return 'That pack is above your content settings.';
    case 'too-large':
      return 'That pack is too large to import.';
    case 'busy':
      return 'Busy loading another pack.';
    default:
      return 'That pack could not be read.';
  }
}

const dimmed = { color: 'var(--civitai-color-text-dimmed)' } as const;
const imageStyle = { width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 6 } as const;
