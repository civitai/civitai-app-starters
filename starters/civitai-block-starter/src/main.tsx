import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { Harness } from './dev/Harness.js';
import './index.css';

// VITE_DEV_HARNESS=true wraps the block in a local simulator that posts a
// fake BLOCK_INIT — useful for `pnpm dev:harness`, never for production
// builds. Strip on `pnpm build` by NOT setting it in `.env.production`.
const useHarness = import.meta.env.VITE_DEV_HARNESS === 'true';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

createRoot(container).render(
  <StrictMode>{useHarness ? <Harness><App /></Harness> : <App />}</StrictMode>,
);
