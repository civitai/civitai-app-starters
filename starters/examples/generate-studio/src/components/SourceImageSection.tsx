import { useState } from 'react';

import { useImageUpload } from '@civitai/blocks-react';
import { Button, Card, Group, SegmentedControl, Stack } from '@civitai/blocks-react/ui';

import type { Setup } from '../studio/setup.js';

interface Props {
  setup: Setup;
  update: (patch: Partial<Setup>) => void;
}

/**
 * txt2img vs img2img. img2img is the same body plus a `sourceImage`.
 *
 * `useImageUpload({ purpose: 'generationSource' })` opens the HOST's upload
 * chrome and resolves with `{ url, width, height }` — a Civitai-hosted, PRIVATE,
 * unscanned input (the orchestrator scans it at generation time). The server
 * accepts only Civitai-hosted https URLs as a source, so this is how to get one.
 *
 * 🔴 PAGE APPS ONLY: the server refuses a source image on a model-slot token.
 * The checkpoint's ecosystem picks plain `img2img` or an edit graph — there is
 * no body field for it — and an ecosystem with neither is refused.
 */
export function SourceImageSection({ setup, update }: Props) {
  const { open } = useImageUpload({ purpose: 'generationSource' });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const upload = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const source = await open(); // null = dismissed
      if (source) update({ sourceImage: { url: source.url, width: source.width, height: source.height } });
    } catch (err) {
      console.warn('[generate-studio] image upload:', err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Stack gap={12}>
        <SegmentedControl
          fullWidth
          value={setup.mode}
          onChange={(v) => update({ mode: v === 'img2img' ? 'img2img' : 'txt2img' })}
          data={[
            { value: 'txt2img', label: 'Text to image' },
            { value: 'img2img', label: 'Image to image' },
          ]}
        />
        {setup.mode === 'img2img' ? (
          <Stack gap={8}>
            {setup.sourceImage ? (
              <img
                src={setup.sourceImage.url}
                alt="Source"
                style={{ width: '100%', maxHeight: 240, objectFit: 'contain', borderRadius: 6 }}
              />
            ) : (
              <small style={{ color: 'var(--civitai-color-text-dimmed)' }}>
                Upload the image to start from. Generate stays off until there is one.
              </small>
            )}
            <Group gap={8}>
              <Button variant="light" size="sm" onClick={upload} loading={busy}>
                {setup.sourceImage ? 'Replace image' : 'Upload image'}
              </Button>
              {setup.sourceImage ? (
                <Button variant="subtle" size="sm" onClick={() => update({ sourceImage: null })}>
                  Clear
                </Button>
              ) : null}
            </Group>
            {failed ? <small role="status">The upload did not finish. Please try again.</small> : null}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}
