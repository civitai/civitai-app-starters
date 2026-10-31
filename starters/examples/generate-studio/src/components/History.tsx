import { useState } from 'react';

import { SfwGate, useAppWorkflows, usePublishGenerationOutputs, type AppWorkflow } from '@civitai/blocks-react';
import { Alert, Badge, Button, Card, Group, Stack } from '@civitai/blocks-react/ui';
import { BrowsingLevel } from '@civitai/app-sdk/blocks';

import { OutputImage } from './OutputImage.js';
import { Published } from './Published.js';

/**
 * The app's OWN queue: `useAppWorkflows()` reads the generations THIS app made
 * for this viewer (newest first, across reloads), and `cancel()` stops one.
 * The host forces the per-app filter, and drops every internal field — no
 * prompts, params or resources come back, only status, images and cost.
 * Needs `ai:write:budgeted`, the same scope as submitting.
 *
 * Publish: `usePublishGenerationOutputs().publish({ workflowId, imageIndexes })`
 * turns outputs of one of these workflows into public, fully-scanned `Image`
 * rows after the host shows the viewer a confirm. It names INDEXES into this
 * list's `images` — never URLs — so a block can only publish its own outputs.
 */
export function History({ history }: { history: ReturnType<typeof useAppWorkflows> }) {
  const { workflows, loading, error, refetch, cancel } = history;
  const { publish } = usePublishGenerationOutputs();
  const [blurMature, setBlurMature] = useState(true);
  const [published, setPublished] = useState<Record<string, number[]>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const doPublish = async (w: AppWorkflow) => {
    setBusy(w.workflowId);
    setNote(null);
    try {
      const imageIds = await publish({ workflowId: w.workflowId, imageIndexes: w.images.map((_, i) => i) });
      setPublished((p) => ({ ...p, [w.workflowId]: imageIds }));
    } catch (err) {
      // Free-text host error (a dismissed confirm, a rate limit, a scan failure):
      // logged, not rendered.
      console.warn('[generate-studio] publish:', err);
      setNote('Not published.');
    } finally {
      setBusy(null);
    }
  };

  const doCancel = async (w: AppWorkflow) => {
    setBusy(w.workflowId);
    try {
      await cancel(w.workflowId); // splices the canceled row in place
    } catch (err) {
      console.warn('[generate-studio] cancel:', err);
      setNote('Could not cancel that run — it may already have finished.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap={12}>
      <Group justify="space-between" align="center" wrap>
        <strong>History</strong>
        <Group gap={8} align="center" wrap>
          {/* Only offered where mature images CAN be shown — the domain AND the
              viewer's own setting allow R. Elsewhere they are hidden outright. */}
          <SfwGate level={BrowsingLevel.R}>
            <Button size="sm" variant="subtle" onClick={() => setBlurMature((b) => !b)}>
              {blurMature ? 'Unblur mature' : 'Blur mature'}
            </Button>
          </SfwGate>
          <Button size="sm" variant="light" onClick={refetch} loading={loading}>
            Refresh
          </Button>
        </Group>
      </Group>
      {error ? <Alert color="warning">History is unavailable right now.</Alert> : null}
      {note ? (
        <Alert color="info" withCloseButton onClose={() => setNote(null)}>
          {note}
        </Alert>
      ) : null}
      {!loading && !error && workflows.length === 0 ? (
        <small style={dimmed}>Nothing yet — your generations from this app appear here.</small>
      ) : null}
      {workflows.map((w) => (
        <Card key={w.workflowId} data-testid="history-item">
          <Stack gap={8}>
            <Group justify="space-between" align="center" wrap>
              <Group gap={8} align="center">
                <Badge variant="light">{w.status}</Badge>
                <small style={dimmed}>
                  {new Date(w.createdAt).toLocaleString()}
                  {w.cost !== null ? ` · ${w.cost} Buzz` : ''}
                </small>
              </Group>
              <Group gap={8}>
                {w.status === 'pending' || w.status === 'processing' ? (
                  <Button size="sm" variant="subtle" onClick={() => doCancel(w)} disabled={busy === w.workflowId}>
                    Cancel
                  </Button>
                ) : null}
                {w.status === 'succeeded' && w.images.length && !published[w.workflowId] ? (
                  <Button size="sm" variant="light" onClick={() => doPublish(w)} loading={busy === w.workflowId}>
                    Publish
                  </Button>
                ) : null}
              </Group>
            </Group>
            {w.images.length ? (
              <div className="output-grid">
                {w.images.map((img, i) => (
                  <OutputImage
                    key={img.url}
                    url={img.url}
                    nsfwLevel={img.nsfwLevel}
                    blurMature={blurMature}
                    filename={`generate-studio-${w.workflowId}-${i + 1}.png`}
                  />
                ))}
              </div>
            ) : null}
            {published[w.workflowId] ? (
              <Stack gap={4}>
                <small style={dimmed}>Published — read back through the gated, per-viewer read:</small>
                <Published imageIds={published[w.workflowId]!} blurMature={blurMature} />
              </Stack>
            ) : null}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

const dimmed = { color: 'var(--civitai-color-text-dimmed)' } as const;
