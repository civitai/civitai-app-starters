import { useState } from 'react';

import { useCheckpointPicker, useGenerationResources, useResourcePicker } from '@civitai/blocks-react';
import { Alert, Button, Card, Group, ResourceCard, Slider, Stack, TextInput } from '@civitai/blocks-react/ui';
import type { BlockCheckpointInfo, BlockResourceInfo } from '@civitai/app-sdk/blocks';

import {
  defaultStrength,
  keepCompatibleLoras,
  LORA_STRENGTH_MAX,
  LORA_STRENGTH_MIN,
  MAX_LORAS,
  type LoraChoice,
  type Setup,
} from '../studio/setup.js';
import { encodeSetupCode, parseSetupCode, resolveSetupCode } from '../studio/setupCode.js';

interface Props {
  setup: Setup;
  update: (patch: Partial<Setup>) => void;
}

/**
 * Checkpoint + LoRAs, chosen in the HOST's own picker. The block never sees a
 * catalog — only what the viewer picked — and every pick is a HINT the server
 * re-validates and re-prices at estimate/submit.
 *
 * - `useCheckpointPicker().open()` — the checkpoint. NO `baseModelGroup`: that
 *   option is a FILTER, and passing the current family would trap the viewer in
 *   it. (Its `persist()` is not used: on a page app the host always refuses it —
 *   there is no model binding to persist an override against.)
 * - `useResourcePicker().open({ resourceType: 'LORA', baseModelGroup })` — LoRAs,
 *   filtered to the checkpoint's family, DERIVED from the checkpoint (never a
 *   hard-coded ecosystem). Page apps only.
 * - `useGenerationResources().fetch(ids)` — rehydrates a pasted setup code.
 */
export function ModelSection({ setup, update }: Props) {
  const { open: openCheckpoint } = useCheckpointPicker();
  const { open: openResource } = useResourcePicker();
  const { fetch: fetchResources } = useGenerationResources();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const changeCheckpoint = async () => {
    setBusy(true);
    try {
      const { selected } = await openCheckpoint({ currentVersionId: setup.checkpoint.versionId });
      if (!selected) return; // dismissed
      applyCheckpoint(selected, setup.loras);
    } catch (err) {
      console.warn('[generate-studio] checkpoint picker:', err);
      setNotice('The model picker could not be opened. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const applyCheckpoint = (checkpoint: BlockCheckpointInfo, loras: LoraChoice[]) => {
    // A new checkpoint can change the ECOSYSTEM, which strands the old family's
    // LoRAs. Drop them visibly rather than let the next estimate fail unexplained.
    const { kept, dropped } = keepCompatibleLoras(loras, checkpoint.baseModel);
    update({ checkpoint, loras: kept });
    setNotice(
      dropped.length ? `Removed ${dropped.length} LoRA(s) made for a different model family.` : null,
    );
  };

  const addLora = async () => {
    if (setup.loras.length >= MAX_LORAS) return;
    setBusy(true);
    const requestedFamily = setup.checkpoint.baseModel;
    try {
      const picked = await openResource({ resourceType: 'LORA', baseModelGroup: requestedFamily });
      if (!picked) return; // dismissed
      if (setup.loras.some((l) => l.resource.versionId === picked.versionId)) return;
      update({
        loras: [...setup.loras, { resource: picked, strength: defaultStrength(picked), requestedFamily }],
      });
    } catch (err) {
      console.warn('[generate-studio] LoRA picker:', err);
      setNotice('The LoRA picker could not be opened. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const loadCode = async () => {
    const parsed = parseSetupCode(code);
    if (!parsed) {
      setNotice("That isn't a setup code. It looks like `128078 + 666002@0.8`.");
      return;
    }
    setBusy(true);
    try {
      const rows = await fetchResources([parsed.checkpointVersionId, ...parsed.loras.map((l) => l.versionId)]);
      const resolved = resolveSetupCode(parsed, rows);
      if (!resolved.checkpoint) {
        setNotice("That code's checkpoint isn't available to you.");
        return;
      }
      const family = resolved.checkpoint.baseModel;
      update({
        checkpoint: resolved.checkpoint,
        loras: resolved.loras.map((l) => ({ ...l, requestedFamily: family })),
      });
      setNotice(resolved.missing ? `Loaded. ${resolved.missing} resource(s) in the code aren't available to you.` : 'Setup loaded.');
      setCode('');
    } catch (err) {
      console.warn('[generate-studio] generation-resources:', err);
      setNotice("Couldn't load that setup right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Stack gap={12}>
        <strong>Model</strong>
        <ResourceCard
          variant="row"
          resource={checkpointAsResource(setup.checkpoint)}
          actions={
            <Button variant="light" size="sm" onClick={changeCheckpoint} disabled={busy}>
              Change
            </Button>
          }
        />

        <Group justify="space-between" align="center">
          <span>
            LoRAs <small style={dimmed}>({setup.loras.length}/{MAX_LORAS})</small>
          </span>
          <Button variant="light" size="sm" onClick={addLora} disabled={busy || setup.loras.length >= MAX_LORAS}>
            Add LoRA
          </Button>
        </Group>
        {setup.loras.map((l) => (
          <Stack key={l.resource.versionId} gap={4}>
            <ResourceCard
              variant="row"
              resource={l.resource}
              actions={
                <Button variant="subtle" size="sm" onClick={() => update({ loras: setup.loras.filter((x) => x !== l) })}>
                  Remove
                </Button>
              }
            />
            {/* The range is the resource's own recommended clamp, inside the server's [-1, 2]. */}
            <Slider
              label={`Weight · ${l.resource.modelName}`}
              showValue
              min={Math.max(l.resource.minStrength ?? LORA_STRENGTH_MIN, LORA_STRENGTH_MIN)}
              max={Math.min(l.resource.maxStrength ?? LORA_STRENGTH_MAX, LORA_STRENGTH_MAX)}
              step={0.05}
              value={l.strength}
              onChange={(strength) =>
                update({
                  loras: setup.loras.map((x) => (x.resource.versionId === l.resource.versionId ? { ...x, strength: Math.round(strength * 100) / 100 } : x)),
                })
              }
            />
          </Stack>
        ))}
        {setup.loras.some((l) => l.resource.trainedWords?.length) ? (
          <small style={dimmed}>
            Trigger words:{' '}
            {setup.loras.flatMap((l) => l.resource.trainedWords ?? []).join(', ')}
          </small>
        ) : null}

        <Stack gap={4}>
          <small style={dimmed}>
            Setup code: <code data-testid="setup-code">{encodeSetupCode(setup.checkpoint.versionId, setup.loras)}</code>
          </small>
          <Group gap={8} align="flex-end" wrap>
            <TextInput
              label="Load a setup code"
              placeholder="128078 + 666002@0.8"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            <Button variant="outline" size="sm" onClick={loadCode} disabled={busy || !code.trim()}>
              Load
            </Button>
          </Group>
        </Stack>

        {notice ? (
          <Alert color="info" withCloseButton onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        ) : null}
      </Stack>
    </Card>
  );
}

/** `ResourceCard` renders a `BlockResourceInfo`; the checkpoint picker returns the narrower `BlockCheckpointInfo`. */
function checkpointAsResource(c: BlockCheckpointInfo): BlockResourceInfo {
  return { ...c, modelType: 'Checkpoint' };
}

const dimmed = { color: 'var(--civitai-color-text-dimmed)' } as const;
