import { Button, Card, Group, NumberInput, SegmentedControl, Slider, Stack, Textarea } from '@civitai/blocks-react/ui';

import { CFG_MAX, CFG_MIN, QUANTITY_MAX, SIZES, STEPS_MAX, STEPS_MIN, type Setup, type SizeKey } from '../studio/setup.js';

interface Props {
  setup: Setup;
  update: (patch: Partial<Setup>) => void;
}

/**
 * Prompt and parameters. The control bounds ARE the server's bounds
 * (`blockWorkflowBodySchema`): an over-limit value is refused before any Buzz
 * is spent, so the UI simply cannot produce one.
 */
export function PromptSection({ setup, update }: Props) {
  return (
    <Card>
      <Stack gap={12}>
        <Textarea
          label="Prompt"
          minRows={3}
          value={setup.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
          error={setup.prompt.trim() ? undefined : 'A prompt is required.'}
        />
        <Textarea
          label="Negative prompt"
          minRows={2}
          value={setup.negativePrompt}
          onChange={(e) => update({ negativePrompt: e.target.value })}
        />
        {setup.mode === 'txt2img' ? (
          <Stack gap={4}>
            <SegmentedControl
              fullWidth
              value={setup.size}
              onChange={(v) => update({ size: v as SizeKey })}
              data={(Object.keys(SIZES) as SizeKey[]).map((k) => ({ value: k, label: SIZES[k].label }))}
            />
            <small style={{ color: 'var(--civitai-color-text-dimmed)' }}>
              {SIZES[setup.size].width} × {SIZES[setup.size].height}
            </small>
          </Stack>
        ) : null}
        <Slider label="Steps" showValue min={STEPS_MIN} max={STEPS_MAX} step={1} value={setup.steps} onChange={(steps) => update({ steps })} />
        <Slider label="CFG scale" showValue min={CFG_MIN} max={CFG_MAX} step={0.5} value={setup.cfgScale} onChange={(cfgScale) => update({ cfgScale })} />
        <Slider label="Images" showValue min={1} max={QUANTITY_MAX} step={1} value={setup.quantity} onChange={(quantity) => update({ quantity })} />
        <Group gap={8} align="flex-end" wrap>
          <NumberInput
            label="Seed"
            description="Empty = a new random seed every run."
            min={0}
            value={setup.seed}
            onChange={(seed) => update({ seed: seed === null ? null : Math.max(0, Math.floor(seed)) })}
            style={{ flex: 1, minWidth: 160 }}
          />
          <Button variant="subtle" size="sm" onClick={() => update({ seed: null })} disabled={setup.seed === null}>
            Random
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
