import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BlockGate, injectBlocksStyles } from '@civitai/blocks-react/ui';

import { App } from './App.js';
import { Harness, installDevTransport } from './Harness.js';
import './index.css';

// The /ui pack's stylesheet, including the --civitai-* tokens, BEFORE the first
// render, so nothing paints unstyled.
injectBlocksStyles();

// `dev:harness` / `dev:live` set VITE_DEV_HARNESS=true. Never set it in a build.
const useHarness = import.meta.env.VITE_DEV_HARNESS === 'true';
if (useHarness) installDevTransport();

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

createRoot(container).render(
  <StrictMode>
    {useHarness ? (
      <Harness>
        <App />
      </Harness>
    ) : (
      // A direct, unembedded load of the block's URL gets an "Open on Civitai"
      // card instead of hanging on "Loading…"; embedded, it is a pass-through.
      <BlockGate>
        <App />
      </BlockGate>
    )}
  </StrictMode>,
);
