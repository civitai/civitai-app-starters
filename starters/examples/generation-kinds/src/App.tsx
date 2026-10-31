import { useEffect, useRef } from 'react';

import {
  useBlockContext,
  useBlockResize,
  useBlockToken,
  useConsentUnavailable,
  useRequestConsent,
  useRequestSignIn,
} from '@civitai/blocks-react';
import { Alert, Badge, Button, Card, Group, Stack } from '@civitai/blocks-react/ui';
import { BLOCK_SCOPES, isPageSlotContext, isSignedIn } from '@civitai/app-sdk/blocks';

import { ChatPanel } from './ChatPanel.js';
import { ComfyPanel } from './ComfyPanel.js';

/**
 * generation-kinds — the `WorkflowBody` kinds beyond `textToImage`, as a PAGE app.
 *
 * One panel per kind, each running the same money flow as `buzz-workflow`:
 * estimate (a quote shown on the button) → the click is the confirmation →
 * submit → a caller-owned poll loop → a terminal snapshot.
 *
 *  - `ComfyPanel` — `kind: 'customComfy'`, the RECIPE arm (`starter-comfy-txt2img`),
 *    plus `useWildcardPack` to fill its prompt from a wildcard pack.
 *  - `ChatPanel`  — `kind: 'step'`, `step: 'chat-completion'`, multi-turn.
 *
 * Both kinds are PAGE-ONLY on the host (a model-slot token is refused), which is
 * why this example is a page app (`page` in the manifest, no `targets`).
 *
 * THE GATE, in the host's own order. Nothing here estimates until all three hold,
 * because the host refuses an estimate as well as a submit without them:
 *  1. a signed-in viewer (`isSignedIn`) — else `useRequestSignIn`;
 *  2. `ai:write:budgeted` on the CURRENT token — the host withholds it at mint
 *     until the viewer consents, so ask with `useRequestConsent` and read the
 *     grant off `useBlockToken().scopes` when the refreshed token lands;
 *  3. the host can grant it at all — `useConsentUnavailable` reports a request
 *     that can never succeed here (e.g. the manifest does not declare the scope).
 */
const BUDGETED = BLOCK_SCOPES.AI_WRITE_BUDGETED;

export function App() {
  const { ready, context, viewer, theme } = useBlockContext();
  const token = useBlockToken();
  const { requestSignIn } = useRequestSignIn();
  const { requestConsent } = useRequestConsent();
  const { refusal, reset } = useConsentUnavailable();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  // Keep <html> in step with the host theme (see hello-world for the why).
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;

  const signedIn = isSignedIn(viewer);
  const granted = signedIn && token.scopes.includes(BUDGETED);
  const onPage = isPageSlotContext(context);

  return (
    <div ref={rootRef} data-theme={theme} style={rootStyle}>
      <Stack gap={16}>
        <Group justify="space-between" align="flex-start" gap={8}>
          <Stack gap={4}>
            <h1 style={titleStyle}>Generation kinds</h1>
            <span style={dimmed}>
              The <code>WorkflowBody</code> kinds beyond <code>textToImage</code>: a Comfy recipe and a chat
              step, each estimated, confirmed, submitted and polled.
            </span>
          </Stack>
          <Group gap={6}>
            <Badge variant="light">Apps: invite-only beta</Badge>
            {granted && typeof token.buzzBudget === 'number' ? (
              <Badge variant="outline" data-testid="budget">
                Budget {token.buzzBudget} Buzz / run
              </Badge>
            ) : null}
          </Group>
        </Group>

        {!onPage ? (
          <Alert color="warning">
            Both kinds are page-only: the host refuses them from a model-slot token. Open this app at its page.
          </Alert>
        ) : null}

        {!signedIn ? (
          <Card>
            <Group justify="space-between" gap={8}>
              <span>Sign in to run generations. Every run spends your own Buzz.</span>
              <Button onClick={() => requestSignIn()}>Sign in</Button>
            </Group>
          </Card>
        ) : !granted ? (
          <Card>
            <Stack gap={8}>
              <Group justify="space-between" gap={8}>
                <span>Allow this app to spend Buzz on your behalf, up to its per-run budget.</span>
                <Button
                  onClick={() => {
                    reset();
                    // Pass the scope by name: without it the host cannot tell
                    // "never grantable" from "not confirmed yet", and stays silent.
                    requestConsent({ scopes: [BUDGETED] });
                  }}
                >
                  Allow generation
                </Button>
              </Group>
              {refusal ? (
                <Alert color="error" role="alert">
                  Generation permission isn’t available for this app here, so nothing can run.
                </Alert>
              ) : null}
            </Stack>
          </Card>
        ) : null}

        <div style={gridStyle}>
          <ComfyPanel canSpend={granted && onPage} signedIn={signedIn} />
          <ChatPanel canSpend={granted && onPage} />
        </div>
      </Stack>
    </div>
  );
}

/**
 * Full width at every size: a page app owns the whole frame, so the panels
 * flow into as many columns as fit (one on a phone, two from ~900px) instead of
 * sitting in a fixed-width box.
 */
const rootStyle = { padding: 'clamp(12px, 2vw, 32px)', boxSizing: 'border-box', width: '100%' } as const;
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
  gap: 16,
  alignItems: 'start',
} as const;
const titleStyle = { margin: 0, fontSize: 22, lineHeight: 1.2 } as const;
const dimmed = { color: 'var(--civitai-color-text-dimmed)' } as const;
