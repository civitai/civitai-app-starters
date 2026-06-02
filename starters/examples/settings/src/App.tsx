import { useRef, useState } from 'react';

import { useBlockContext, useBlockResize, useBlockSettings } from '@civitai/blocks-react';
import { SettingsForm } from '@civitai/blocks-react/ui';
import type { ManifestSettings } from '@civitai/app-sdk/blocks';

import manifest from '../block.manifest.json' with { type: 'json' };

/**
 * settings — manifest-driven settings, two scopes.
 *
 * App Blocks declare their settings as a record in `block.manifest.json`
 * (`settings: { field_name: { scope, type, widget, label, … } }`). The
 * platform validates user input against that declaration AND renders the
 * settings UI from it with the headless `SettingsForm` from
 * `@civitai/blocks-react/ui`.
 *
 * Two scopes:
 *  - `publisher` — set by the model owner / installer (e.g. a watermark, a
 *    default step count). The block READS these from `BLOCK_INIT.settings
 *    .publisherSettings`. A viewer can't change them.
 *  - `viewer`   — each signed-in user controls their own value (e.g. a
 *    sampler preference). Read from `BLOCK_INIT.settings.userSettings`.
 *
 * IMPORTANT — where settings get WRITTEN: from inside the iframe, a block can
 * only READ the settings the host delivered at init. There is no "set
 * settings" postMessage. Persisting publisher/viewer settings happens on the
 * platform's `/apps/installed` page (and the model-edit banner), which renders
 * this same `SettingsForm` and wires `onSubmit` to the platform tRPC. This
 * example renders the viewer form inline so you can see the component, but its
 * `onSubmit` only echoes the values locally — it does NOT persist (it can't,
 * from the iframe). Use the form here to prototype the field layout; the real
 * persistence path is the platform page.
 */
const manifestSettings = manifest.settings as ManifestSettings;
const declaredScopes = manifest.scopes;

export function App() {
  const { ready, settings, theme } = useBlockContext();
  const liveSettings = useBlockSettings(); // shorthand for useBlockContext().settings
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  const [previewValues, setPreviewValues] = useState<Record<string, unknown> | null>(null);

  if (!ready) {
    return (
      <div ref={rootRef} data-theme={theme} className="hw-root">
        Loading…
      </div>
    );
  }

  return (
    <div ref={rootRef} data-theme={theme} className="hw-root">
      <strong>Settings demo</strong>

      <div className="hw-card">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Publisher settings (read-only here)</div>
        <pre style={preStyle}>{JSON.stringify(liveSettings.publisherSettings, null, 2)}</pre>
        <div style={{ opacity: 0.7, fontSize: 12 }}>
          Set by the model owner. The block reads them; it cannot change them.
        </div>
      </div>

      <div className="hw-card">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Your settings (viewer scope)</div>
        <SettingsForm
          manifestSettings={manifestSettings}
          declaredScopes={declaredScopes}
          forScope="viewer"
          initialValues={settings.userSettings}
          submitLabel="Preview values"
          onSubmit={async (values) => {
            // From the iframe this is preview-only — it cannot persist.
            // On the platform `/apps/installed` page the same component's
            // onSubmit calls the platform tRPC to write userSettings.
            setPreviewValues(values);
          }}
        />
        {previewValues ? (
          <pre style={preStyle}>{JSON.stringify(previewValues, null, 2)}</pre>
        ) : null}
      </div>
    </div>
  );
}

const preStyle = {
  margin: '4px 0',
  padding: 8,
  borderRadius: 6,
  background: 'rgba(127,127,127,0.12)',
  fontSize: 12,
  overflow: 'auto',
} as const;
