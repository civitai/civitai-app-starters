'use client';

import { useState } from 'react';
import { Button, Card, TextInput } from '@civitai/components-react';

/**
 * Small showcase of the Civitai design system using the ergonomic React
 * bindings (`@civitai/components-react`) — a Card, a TextInput and a Button,
 * all themed by the `--civitai-*` tokens from `@civitai/theme`. The same
 * components are available as framework-agnostic `data-civitai-ui` markup for
 * non-React apps (see the Svelte starters).
 */
export function DesignSystemDemo() {
  const [prompt, setPrompt] = useState('a corgi astronaut');

  return (
    <Card withBorder padding="lg" data-testid="ds-card">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Civitai design system</h2>
          <p className="text-sm" style={{ color: 'var(--civitai-color-text-dimmed)' }}>
            Rendered with <code className="font-mono">@civitai/components-react</code>, themed by{' '}
            <code className="font-mono">--civitai-*</code> tokens.
          </p>
        </div>
        <TextInput
          label="Prompt"
          description="A themed text input from the design system."
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
        />
        <Button variant="filled" data-testid="ds-button">
          Generate
        </Button>
      </div>
    </Card>
  );
}
