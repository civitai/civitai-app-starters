import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { Harness } from './Harness.js';
import './index.css';

// `pnpm dev:harness` sets VITE_DEV_HARNESS=true to mount the local simulator
// that posts a fake BLOCK_INIT. Never set it in a production build.
const useHarness = import.meta.env.VITE_DEV_HARNESS === 'true';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

createRoot(container).render(
  <StrictMode>{useHarness ? <Harness><App /></Harness> : <App />}</StrictMode>,
);
