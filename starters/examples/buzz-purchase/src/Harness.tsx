import { useEffect, useState, type ReactNode } from 'react';

import { getTransport } from '@civitai/blocks-react';
import { Harness as MockHost } from '@civitai/blocks-react/testing';
// 🔴 `/live` is the REAL backend: a submit there spends your own Buzz. It has its
// own subpath (never `/testing`) so the import line itself says so.
import { createLiveHost } from '@civitai/blocks-react/live';
import type { ModelSlotContext } from '@civitai/app-sdk/blocks';

import manifest from '../block.manifest.json' with { type: 'json' };

/**
 * Dev-only host for `npm run dev:harness` (mock) and `npm run dev:live` (real
 * backend). Never mounted in a production build — see src/main.tsx.
 *
 * Both hosts post their replies from this page's own origin, and the SDK
 * transport drops messages from any origin it was not told to trust. So the
 * transport is created HERE, before any hook runs, with this origin allowed
 * (gotcha #53) — no `.env` value has to match a port.
 */
export function installDevTransport() {
  getTransport({ allowedParentOrigins: [window.location.origin] });
}

/**
 * What the host sends a block in the `model.sidebar_top` slot. Placeholder ids:
 * for `dev:live`, put a real model's ids here.
 */
const MODEL_SLOT: ModelSlotContext = {
  slotId: 'model.sidebar_top',
  modelId: 12345,
  modelVersionId: 67890,
  modelName: 'Dev Mock Model',
  modelType: 'Checkpoint',
  modelNsfwLevel: 1,
};

export function Harness({ children }: { children: ReactNode }) {
  if (import.meta.env.VITE_LIVE_MODE === 'true') return <LiveHost>{children}</LiveHost>;
  // The SDK's mock host: no network, no Buzz. `declaredScopes` is the
  // manifest's own list, so a scope the manifest forgot fails here exactly as
  // the real host refuses it. URL knobs: `?theme=light`, `?viewer=anon`, …
  return (
    <MockHost
      declaredScopes={manifest.scopes}
      blockId={manifest.blockId}
      context={MODEL_SLOT}
      // A 120-Buzz generation against a 50-Buzz wallet: the first Generate is
      // refused and offers a top-up; the mock purchase refills the wallet and the
      // retry lands. `?consent=granted&costPerGen=600` prices it over the
      // mock's 200-Buzz per-generation budget instead — no top-up offered.
      generation={{ costPerGen: 120 }}
      buzz={{ balance: 50 }}
      buzzBalance={{ blue: 50, green: 0, yellow: 0 }}
    >
      {children}
    </MockHost>
  );
}

/** `createLiveHost` forwards the bridge to the real API through the vite proxy. */
function LiveHost({ children }: { children: ReactNode }) {
  const token = import.meta.env.VITE_LIVE_BLOCK_TOKEN as string | undefined;
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    if (!token) return;
    // `backendBaseUrl: ''` = same origin; vite.config.ts proxies `/api`.
    const host = createLiveHost({
      blockToken: token,
      backendBaseUrl: '',
      context: MODEL_SLOT,
      fetchImpl: (input, init) => fetch(input, init), // bound: a detached `fetch` throws
    });
    const uninstall = host.install();
    setInstalled(true);
    return uninstall;
  }, [token]);
  if (!token) return <p>dev:live needs VITE_LIVE_BLOCK_TOKEN in .env.development.local (see .env.example).</p>;
  return installed ? children : null;
}
