import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BlockGate } from '@civitai/blocks-react/ui';

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
  // Production: wrap the app in <BlockGate> so a DIRECT (unembedded) top-level
  // load of the block's <slug>.civit.ai URL degrades to a branded "Open on
  // Civitai" landing instead of hanging on the loading spinner forever. When
  // embedded in the Civitai host (or under the dev harness above, which posts a
  // fake BLOCK_INIT), the gate is a transparent pass-through.
  return (
    <BlockGate>
      <App />
    </BlockGate>
  );
}

// No boot-skeleton cleanup code here, on purpose. `createRoot(container)` CLEARS
// the container's existing children before its first commit, so the
// `[data-boot-skeleton]` markup in index.html removes itself.
//
// 🔴 That is REACT-SPECIFIC — do not carry the omission to another framework.
// Measured on this repo's own dependencies: React 19.2.6 + happy-dom leaves a
// prefilled #root holding only the app's output (guarded by
// `packages/civitai-blocks-react/test/bootSkeletonRemoval.test.tsx`), while
// Svelte 5.55.10's `mount(App, { target })` APPENDS next to the existing
// children — `_mount` does `target.appendChild(create_text())` and never clears
// — so a Svelte block needs an explicit
// `document.querySelector('[data-boot-skeleton]')?.remove()` after mount.
// Assume APPEND for anything not measured.
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
