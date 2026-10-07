import { Alert, Badge, Button, Card, Group, Stack } from '@civitai/blocks-react/ui';

import { LIVE, type Run } from '../studio/useRuns.js';
import { OutputImage } from './OutputImage.js';

interface Props {
  runs: Run[];
  onCancel: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

/**
 * This session's runs, live. Outputs here come straight off the workflow
 * snapshot (`imageUrls`), which carries NO rating — so they render as "not
 * rated yet". The rated copies, and Publish, live in History.
 */
export function RunList({ runs, onCancel, onDismiss }: Props) {
  if (runs.length === 0) return null;
  return (
    <Stack gap={12}>
      <strong>This session</strong>
      {runs.map((run) => (
        <Card key={run.localId} aria-label={`Run ${STATUS_LABEL[run.status]}`} data-testid="run">
          <Stack gap={8}>
            <Group justify="space-between" align="center" wrap>
              <Group gap={8} align="center">
                <Badge variant="light" color={COLOR[run.status]}>
                  {STATUS_LABEL[run.status]}
                </Badge>
                {run.cost !== null ? <small style={dimmed}>{run.cost} Buzz</small> : null}
                {run.autoClaim ? <small style={dimmed}>+{run.autoClaim} daily boost claimed</small> : null}
              </Group>
              {LIVE.has(run.status) ? (
                // Cancel = a real server-side stop. Disabled until there is a
                // workflow id to cancel (a submit still in flight has none).
                <Button size="sm" variant="subtle" onClick={() => onCancel(run.localId)} disabled={!run.workflowId}>
                  Cancel
                </Button>
              ) : (
                <Button size="sm" variant="subtle" onClick={() => onDismiss(run.localId)}>
                  Dismiss
                </Button>
              )}
            </Group>
            {run.images.length ? (
              <div className="output-grid">
                {run.images.map((url, i) => (
                  <OutputImage key={url} url={url} nsfwLevel={null} blurMature filename={`generate-studio-${i + 1}.png`} />
                ))}
              </div>
            ) : null}
            {run.message ? <Alert color={run.status === 'failed' ? 'error' : 'warning'}>{run.message}</Alert> : null}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

const STATUS_LABEL: Record<Run['status'], string> = {
  submitting: 'Submitting…',
  queued: 'Queued',
  running: 'Generating…',
  succeeded: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
  expired: 'Expired',
  refused: 'Not started',
};

const COLOR: Record<Run['status'], 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  submitting: 'info',
  queued: 'info',
  running: 'primary',
  succeeded: 'success',
  failed: 'error',
  canceled: 'warning',
  expired: 'warning',
  refused: 'warning',
};

const dimmed = { color: 'var(--civitai-color-text-dimmed)' } as const;
