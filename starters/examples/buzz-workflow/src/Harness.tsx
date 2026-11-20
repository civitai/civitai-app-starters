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

/**
 * Whether the mock starts with the spend scope (`ai:write:budgeted`) already
 * granted. Default YES, and that is a choice about THIS example, not about the
 * mock: the mock refuses an estimate from a token without the scope, exactly as
 * production does, and this example prices on mount without first asking for
 * consent — so un-granted, its first quote fails and the button shows `…` until
 * the first Generate (whose submit prompts, is granted and retries on its own).
 * `?consent=0` starts WITHOUT the scope, to see that real first-visit state; the
 * mock's own `?consent=granted` can only turn consent ON, which is why this
 * reads the URL itself. (buzz-purchase, generate-studio and generation-kinds ask
 * for consent BEFORE they estimate, which is the pattern to copy.)
 */
function startsWithConsent(): boolean {
  const consent = new URLSearchParams(window.location.search).get('consent');
  return consent !== '0' && consent !== 'ungrantable';
}

export function Harness({ children }: { children: ReactNode }) {
  if (import.meta.env.VITE_LIVE_MODE === 'true') return <LiveHost>{children}</LiveHost>;
  // The SDK's mock host: no network, no Buzz. `declaredScopes` is the
  // manifest's own list, so a scope the manifest forgot fails here exactly as
  // the real host refuses it. URL knobs: `?theme=light`, `?viewer=anon`,
  // `?consent=0`, …
  return (
    <MockHost
      declaredScopes={manifest.scopes}
      blockId={manifest.blockId}
      context={MODEL_SLOT}
      consentGranted={startsWithConsent()}
      // The orchestrator prices a cache hit at 0, and the SEED decides
      // cache-hit-ness (gotcha #59): a fixed seed is free here, a fresh one costs.
      generation={{ costPerGen: (req) => (req.kind === 'textToImage' && req.params?.seed !== undefined ? 0 : 120) }}
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
      // Each `track()` is checked against `analytics.events`; the console warns
      // once per event or property production would drop.
      manifest,
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
