import { useEffect, useRef, useState } from 'react';

import { useBlockContext, useBlockResize } from '@civitai/blocks-react';
import { Card, SettingsForm, Stack } from '@civitai/blocks-react/ui';
import type { ManifestSettings } from '@civitai/app-sdk/blocks';

import manifest from '../block.manifest.json' with { type: 'json' };

/**
 * settings — manifest-driven settings, two scopes.
 *
 * A Civitai App declares its settings as a record in `block.manifest.json`
 * (`settings: { field_name: { scope, type, widget, label, … } }`). The platform
 * validates input against that declaration AND renders its settings UI from it.
 * This example renders the same declaration with the headless `SettingsForm`.
 *
 *  - `publisher` — set by the model owner / installer. Read from
 *    `BLOCK_INIT.settings.publisherSettings`; a viewer can't change them.
 *  - `viewer` — each signed-in user's own value. Read from
 *    `BLOCK_INIT.settings.userSettings`.
 *
 * 🔴 THE HOST SENDS WHAT WAS STORED, NOT THE DECLARATION. Defaults are written
 * when an install's settings are saved, so a field your manifest gained in a
 * later version — or a page app, which is sent `{}` — arrives with nothing.
 * Fall back to the manifest default yourself: `withDefaults` below.
 * (`SettingsForm` does the same for the fields it shows.)
 *
 * WHERE SETTINGS GET WRITTEN: not from here. There is no "set settings" message;
 * Civitai's own settings panel writes them, with its own widgets. (The one
 * exception is the viewer's checkpoint, via `useCheckpointPicker`.) So this
 * form's `onSubmit` only previews the values.
 */
const manifestSettings = manifest.settings as ManifestSettings;

/** Stored values for one scope, with the manifest default for anything unset. */
function withDefaults(scope: 'publisher' | 'viewer', stored: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(manifestSettings)
      .filter(([, field]) => field.scope === scope)
      .map(([key, field]) => [key, key in stored ? stored[key] : field.default]),
  );
}

export function App() {
  const { ready, settings, theme } = useBlockContext();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);
  const [previewValues, setPreviewValues] = useState<Record<string, unknown> | null>(null);

  // Keep <html> in step with the host theme (see hello-world for the why).
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;

  return (
    <div ref={rootRef} data-theme={theme} style={{ padding: 16 }}>
      <Stack gap={8}>
        <strong>Settings demo</strong>

        <Card>
          <Stack gap={4}>
            <strong>Publisher settings (read-only here)</strong>
            <pre style={preStyle}>{JSON.stringify(withDefaults('publisher', settings.publisherSettings), null, 2)}</pre>
            <small style={dimmed}>Set by the model owner, defaults filled in by the block.</small>
          </Stack>
        </Card>

        <Card>
          <Stack gap={4}>
            <strong>Your settings (viewer scope)</strong>
            <SettingsForm
              manifestSettings={manifestSettings}
              declaredScopes={manifest.scopes}
              forScope="viewer"
              initialValues={settings.userSettings}
              submitLabel="Preview values"
              onSubmit={async (values) => setPreviewValues(values)}
            />
            {previewValues ? <pre style={preStyle}>{JSON.stringify(previewValues, null, 2)}</pre> : null}
          </Stack>
        </Card>
      </Stack>
    </div>
  );
}

const dimmed = { color: 'var(--civitai-color-text-dimmed)' } as const;

const preStyle = {
  margin: 0,
  padding: 8,
  borderRadius: 'var(--civitai-radius)',
  background: 'var(--civitai-color-body)',
  fontFamily: 'var(--civitai-font-mono)',
  fontSize: 12,
  overflow: 'auto',
} as const;
