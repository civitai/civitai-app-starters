'use client';

import { useState } from 'react';
import { CivitaiButton, CivitaiCard, CivitaiTextInput } from '@civitai/components-react';

/**
 * Small showcase of the Civitai design system using the React bindings for the
 * `<civitai-*>` custom elements (`@civitai/components-react`) — a Card, a
 * TextInput and a Button, all themed by the `--civitai-*` tokens from
 * `@civitai/theme`. The same elements work as plain custom-element markup in
 * any framework (see the Svelte starters).
 *
 * 🔴 Client-only by necessity, hence `'use client'`. `@lit/react` assigns props
 * as PROPERTIES from effects, which never run on the server, so these wrappers
 * server-render as bare `<civitai-*>` tags and fill in after hydration. Where
 * the server output itself matters (SEO-critical copy), put that content in
 * ordinary HTML — as the heading and paragraph below are — or write the
 * `<civitai-*>` tag directly in JSX so its attributes survive SSR.
 */
export function DesignSystemDemo() {
  const [prompt, setPrompt] = useState('a corgi astronaut');

  return (
    <CivitaiCard withBorder padding="lg" data-testid="ds-card">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Civitai design system</h2>
          <p className="text-sm" style={{ color: 'var(--civitai-color-text-dimmed)' }}>
            Rendered with <code className="font-mono">@civitai/components-react</code>, themed by{' '}
            <code className="font-mono">--civitai-*</code> tokens.
          </p>
        </div>
        <CivitaiTextInput
          label="Prompt"
          description="A themed text input from the design system."
          value={prompt}
          onChange={(e) => setPrompt((e.currentTarget as HTMLElement & { value: string }).value)}
        />
        <CivitaiButton variant="filled" data-testid="ds-button">
          Generate
        </CivitaiButton>
      </div>
    </CivitaiCard>
  );
}
