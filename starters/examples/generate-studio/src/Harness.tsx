import { useEffect, useState, type ReactNode } from 'react';

import { getTransport } from '@civitai/blocks-react';
import { Harness as MockHost, type MockHostOptions } from '@civitai/blocks-react/testing';
// 🔴 `/live` is the REAL backend: a submit there spends your own Buzz. It has its
// own subpath (never `/testing`) so the import line itself says so.
import { createLiveHost } from '@civitai/blocks-react/live';
import { BLOCK_SCOPES, type WorkflowBody } from '@civitai/app-sdk/blocks';

import manifest from '../block.manifest.json' with { type: 'json' };
import {
  APP_WORKFLOWS,
  CHECKPOINT_PICK,
  GATED_IMAGES,
  LORA_PICK,
  mockImage,
  PUBLISHED_IDS,
  SOURCE_UPLOAD,
} from './dev/fixtures.js';

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
 * The per-generation budget the real token mint derives from THIS manifest:
 * `page.buzzBudgetPerGen`, 10 when absent, clamped to 1000.
 */
const BUDGET = Math.min(manifest.page.buzzBudgetPerGen ?? 10, 1000);

export function Harness({ children }: { children: ReactNode }) {
  if (import.meta.env.VITE_LIVE_MODE === 'true') return <LiveHost>{children}</LiveHost>;

  // Two knobs of this example's own, on top of the SDK's (`?theme=light`,
  // `?viewer=anon`, `?consent=granted`, `?domain=red`, `?balance=N`, …):
  //   ?price=N    what every generation costs (default 40 per image)
  //   ?balance=N  ALSO sets the wallet `useBuzzBalance` reads (the SDK knob
  //               only drives the submit's insufficient-Buzz path)
  const q = new URLSearchParams(window.location.search);
  const price = Number(q.get('price'));
  const balance = Number(q.get('balance') ?? 5000);

  return (
    // The SDK's mock host: no network, no Buzz.
    <MockHost
      declaredScopes={manifest.scopes}
      blockId={manifest.blockId}
      // No `context`: the mock's default IS a complete `app.page` context.
      buzzBudget={BUDGET}
      buzzBalance={{ blue: balance, green: 0, yellow: 0 }}
      cannedPicks={{ Checkpoint: CHECKPOINT_PICK, LORA: LORA_PICK }}
      cannedGenerationSourceUpload={SOURCE_UPLOAD}
      appWorkflows={{ workflows: APP_WORKFLOWS }}
      publishImageIds={PUBLISHED_IDS}
      gatedImages={GATED_IMAGES}
      pollsUntilDone={3}
      generation={{
        latencyMs: 1500,
        costPerGen: (body) => (Number.isFinite(price) && price > 0 ? price : 40 * quantityOf(body)),
        images: (body) =>
          Array.from({ length: quantityOf(body) }, (_, i) =>
            mockImage(`${'sourceImage' in body && body.sourceImage ? 'img2img' : 'txt2img'} ${i + 1}`, 30 + i * 70),
          ),
      }}
      {...refusalsForUndeclaredScopes(manifest.scopes)}
    >
      {children}
    </MockHost>
  );
}

function quantityOf(body: WorkflowBody): number {
  return body.kind === 'textToImage' ? (body.params.quantity ?? 1) : 1;
}

/**
 * Make the mock refuse what PRODUCTION refuses when the manifest forgets a scope.
 *
 * 🔴 THE SDK MOCK ONLY ENFORCES `declaredScopes` FOR STORAGE. For every other
 * message it answers whatever the manifest says, so deleting `buzz:read:self`
 * or `ai:write:budgeted` from block.manifest.json would still "work" here and
 * then fail every call in production — where the token only ever carries
 * declared scopes and each procedure throws `block lacks <scope> scope`.
 * This maps each missing scope onto the mock knob that produces that refusal.
 */
function refusalsForUndeclaredScopes(scopes: readonly string[]): Partial<MockHostOptions> {
  const declared = new Set(scopes);
  const out: Partial<MockHostOptions> = {};
  if (!declared.has(BLOCK_SCOPES.BUZZ_READ_SELF)) {
    out.buzzBalanceError = `block lacks ${BLOCK_SCOPES.BUZZ_READ_SELF} scope`;
  }
  if (!declared.has(BLOCK_SCOPES.AI_WRITE_BUDGETED)) {
    const lacks = `block lacks ${BLOCK_SCOPES.AI_WRITE_BUDGETED} scope`;
    out.consentGrantable = false; // nothing can grant an undeclared scope
    out.appWorkflowsError = lacks; // the queue read/cancel need the spend scope
    out.publishError = lacks; // so does publishing
    out.generation = { failEstimate: 'failed', failEstimateMessage: lacks, failSubmitException: true, failSubmitExceptionMessage: lacks };
  }
  return out;
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
      // No `context`: the live host's default is a complete `app.page` context
      // (dev-token mints page tokens only).
      fetchImpl: (input, init) => fetch(input, init), // bound: a detached `fetch` throws
    });
    const uninstall = host.install();
    setInstalled(true);
    return uninstall;
  }, [token]);
  if (!token) return <p>dev:live needs VITE_LIVE_BLOCK_TOKEN in .env.development.local (see .env.example).</p>;
  return installed ? children : null;
}
