import { useState } from 'react';

import { useDomainMaturity, useSaveImage } from '@civitai/blocks-react';
import { Badge, Button, Group } from '@civitai/blocks-react/ui';
import { BrowsingLevel } from '@civitai/app-sdk/blocks';

interface Props {
  url: string;
  /**
   * The browsing-level bit the host reported (`AppWorkflowImage.nsfwLevel`,
   * `BlockGatedImage.nsfwLevel`), or `null` for an image nothing has rated yet —
   * a fresh output, or the viewer's own just-published image.
   */
  nsfwLevel: number | null;
  /** Blur allowed-but-mature images until clicked. The viewer's choice (see `History`). */
  blurMature: boolean;
  filename: string;
  /** Whether to offer Save. `useSaveImage` only accepts Civitai image/orchestration URLs. */
  canSave?: boolean;
}

/**
 * One output, shown only as far as THIS viewer may see it here.
 *
 * `useDomainMaturity().isLevelAllowed(level)` tests the level against the
 * domain's ceiling INTERSECTED with the viewer's own browsing setting, and
 * fails closed to SFW before `BLOCK_INIT` lands. Three cases:
 *
 * - rated, not allowed → a placeholder. The pixels are never rendered.
 * - rated, allowed     → shown (mature levels blurred until clicked, if asked).
 * - NOT rated yet      → shown with a "not rated yet" badge, and never given a
 *   rating it does not have (a missing level is not "G"). These are only ever
 *   the viewer's OWN outputs, and that is the host's own posture too: its gated
 *   read hands a viewer their own unrated image, flagged `ratingPending`.
 */
export function OutputImage({ url, nsfwLevel, blurMature, filename, canSave = true }: Props) {
  const { isLevelAllowed } = useDomainMaturity();
  const { saveImage } = useSaveImage();
  const [revealed, setRevealed] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const rated = nsfwLevel !== null;
  if (rated && !isLevelAllowed(nsfwLevel)) {
    return (
      <div style={{ ...frame, ...placeholder }} data-testid="output-hidden">
        Hidden at your browsing level
      </div>
    );
  }
  const mature = rated && nsfwLevel > BrowsingLevel.PG13;
  const blurred = !revealed && mature && blurMature;

  const save = async () => {
    setSaveNote(null);
    try {
      // The HOST downloads it: a sandboxed iframe has no `allow-downloads`, so
      // `<a download>` is inert here. The host refuses any non-Civitai URL.
      await saveImage({ url, filename });
    } catch (err) {
      console.warn('[generate-studio] save:', err);
      setSaveNote('Could not save this image.');
    }
  };

  return (
    <figure style={{ margin: 0 }} data-testid={blurred ? 'output-blurred' : 'output-visible'}>
      <div style={{ ...frame, position: 'relative' }}>
        <img
          src={url}
          alt="Generated output"
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: blurred ? 'blur(24px)' : undefined }}
        />
        {blurred ? (
          <div style={{ ...placeholder, position: 'absolute', inset: 0, background: 'transparent' }}>
            <Button size="sm" variant="filled" onClick={() => setRevealed(true)}>
              Show mature image
            </Button>
          </div>
        ) : null}
      </div>
      <Group justify="space-between" align="center" style={{ marginTop: 6 }}>
        {rated ? <span /> : <Badge size="sm" variant="outline">not rated yet</Badge>}
        {canSave ? (
          <Button size="sm" variant="subtle" onClick={save}>
            Save
          </Button>
        ) : null}
      </Group>
      {saveNote ? <small role="status">{saveNote}</small> : null}
    </figure>
  );
}

const frame = {
  aspectRatio: '1 / 1',
  borderRadius: 8,
  overflow: 'hidden',
  background: 'var(--civitai-color-media-placeholder)',
} as const;

const placeholder = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: 12,
  color: 'var(--civitai-color-text-dimmed)',
} as const;
