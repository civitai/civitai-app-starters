import { useEffect, useState, type ReactNode } from 'react';

import { getTransport } from '@civitai/blocks-react';
import { Harness as MockHost } from '@civitai/blocks-react/testing';
// 🔴 `/live` is the REAL backend: a submit there spends your own Buzz. It has its
// own subpath (never `/testing`) so the import line itself says so.
import { createLiveHost } from '@civitai/blocks-react/live';
import type { WorkflowBody } from '@civitai/app-sdk/blocks';

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
 * Whether the manifest declares the money scope. The host only ever grants a
 * scope the manifest declares, so without it the consent request can never
 * succeed. The SDK mock does not read `declaredScopes` for this scope (only for
 * storage; see `MockHostOptions.declaredScopes`), so the harness passes the
 * manifest's answer as `consentGrantable`: drop the scope from
 * block.manifest.json and "Allow generation" is refused here the way it is in
 * production.
 */
const DECLARES_BUDGETED = manifest.scopes.includes('ai:write:budgeted');

/**
 * Mock prices, in Buzz, shaped like production's: the starter recipe's fixed
 * display estimate is 15, and a chat-completion turn is quoted from 1 Buzz up
 * (the host's live quote rises with `maxTokens` and the model). The real
 * numbers always come from the host; these only make the CTA show one.
 */
const mockCost = (body: WorkflowBody): number => (body.kind === 'customComfy' ? 15 : body.kind === 'step' ? 1 : 0);

export function Harness({ children }: { children: ReactNode }) {
  if (import.meta.env.VITE_LIVE_MODE === 'true') return <LiveHost>{children}</LiveHost>;
  // The SDK's mock host: no network, no Buzz. No `context` prop: the mock's
  // default IS a page slot (`app.page`), which is what this app is.
  // URL knobs: `?theme=light`, `?viewer=anon`, `?consent=granted`, …
  return (
    <MockHost
      declaredScopes={manifest.scopes}
      blockId={manifest.blockId}
      consentGrantable={DECLARES_BUDGETED}
      // The page token's per-call budget is minted from `page.buzzBudgetPerGen`.
      buzzBudget={manifest.page.buzzBudgetPerGen}
      generation={{ costPerGen: mockCost }}
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
    // `backendBaseUrl: ''` = same origin; vite.config.ts proxies `/api`. No
    // `context`: the live host's default is a page slot too.
    const host = createLiveHost({
      blockToken: token,
      backendBaseUrl: '',
      fetchImpl: (input, init) => fetch(input, init), // bound: a detached `fetch` throws
    });
    const uninstall = host.install();
    setInstalled(true);
    return uninstall;
  }, [token]);
  if (!token) return <p>dev:live needs VITE_LIVE_BLOCK_TOKEN in .env.development.local (see .env.example).</p>;
  return installed ? children : null;
}
