import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { Harness } from './dev/Harness.js';
import { LiveHarness } from './dev/LiveHarness.js';
import './index.css';

// VITE_DEV_HARNESS=true wraps the block in a local simulator that posts a
// fake BLOCK_INIT — useful for `pnpm dev:harness`, never for production
// builds. Strip on `pnpm build` by NOT setting it in `.env.production`.
const useHarness = import.meta.env.VITE_DEV_HARNESS === 'true';

// VITE_LIVE_MODE=true swaps the MOCK harness for the LIVE one — it forwards the
// postMessage protocol to the REAL Civitai backend with a pasted dev token
// (`pnpm dev:live`). ⚠️ REAL Buzz is spent. Requires VITE_LIVE_BLOCK_TOKEN.
// Never set in a production build (these are dev-only harnesses).
const useLive = useHarness && import.meta.env.VITE_LIVE_MODE === 'true';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

function Root() {
  if (useLive) {
    return (
      <LiveHarness>
        <App />
      </LiveHarness>
    );
  }
  if (useHarness) {
    return (
      <Harness>
        <App />
      </Harness>
    );
  }
  return <App />;
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
