import { useState } from 'react';
import { CivitaiButton, CivitaiCard, CivitaiTextInput } from '@civitai/components-react';

/**
 * Small showcase of the Civitai design system using the React bindings for the
 * `<civitai-*>` custom elements (`@civitai/components-react`) — a Card, a
 * TextInput and a Button, all themed by the `--civitai-*` tokens from
 * `@civitai/theme`. The elements are self-styling and inject those tokens
 * themselves on first mount, so there is no CSS import or setup step.
 *
 * Handlers receive the DOM event, not an extracted value, and the field
 * elements re-dispatch the native `change` — which commits on blur/Enter
 * rather than on every keystroke, exactly as a native input does.
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
