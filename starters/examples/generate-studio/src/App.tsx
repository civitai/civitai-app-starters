import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useAppWorkflows,
  useBlockContext,
  useBlockResize,
  useBuzzBalance,
  useRequestConsent,
  useRequestSignIn,
} from '@civitai/blocks-react';
import { Alert, Button, Stack } from '@civitai/blocks-react/ui';
import { BLOCK_SCOPES, isPageSlotContext, isSignedIn } from '@civitai/app-sdk/blocks';

import { History } from './components/History.js';
import { ModelSection } from './components/ModelSection.js';
import { PromptSection } from './components/PromptSection.js';
import { RunList } from './components/RunList.js';
import { SourceImageSection } from './components/SourceImageSection.js';
import { SpendBar } from './components/SpendBar.js';
import { findBlocker } from './studio/blocker.js';
import { buildBody, INITIAL_SETUP, type Setup } from './studio/setup.js';
import { useQuote } from './studio/useQuote.js';
import { useRuns } from './studio/useRuns.js';

/** The consent-gated scopes this app declares. The host grants the whole missing set in one dialog. */
const SPEND = BLOCK_SCOPES.AI_WRITE_BUDGETED;
const BALANCE = BLOCK_SCOPES.BUZZ_READ_SELF;

/**
 * generate-studio — a PAGE app for real image generation. Start at the README's
 * guided tour; this file only wires the pieces together:
 *
 *   ModelSection        checkpoint + LoRAs (host pickers, setup codes)
 *   SourceImageSection  txt2img / img2img (host upload)
 *   PromptSection       prompt + parameters, bounded like the server
 *   SpendBar            price → budget → wallet → Generate (+ top-up)
 *   RunList             this session's runs: watch + cancel
 *   History             the app's own queue: cancel, publish, gated outputs
 */
export function App() {
  const { ready, context, theme, token, viewer } = useBlockContext();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  // Keep <html> in step with the host theme (see hello-world for the why).
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  const [setup, setSetup] = useState<Setup>(INITIAL_SETUP);
  const update = useCallback((patch: Partial<Setup>) => setSetup((s) => ({ ...s, ...patch })), []);

  // What the CURRENT token carries. Consent re-mints it, and these flip.
  const canSpend = token.scopes.includes(SPEND);
  const canReadBalance = token.scopes.includes(BALANCE);

  const wallet = useBuzzBalance();
  const history = useAppWorkflows({ limit: 20 });
  const { refetch: refetchWallet } = wallet;
  const { refetch: refetchHistory } = history;

  // Both reads are refused until their scope is granted, and both fetch on
  // mount — so re-read once the token gains the scope.
  useEffect(() => {
    if (canReadBalance) refetchWallet();
  }, [canReadBalance, refetchWallet]);
  useEffect(() => {
    if (canSpend) refetchHistory();
  }, [canSpend, refetchHistory]);

  const body = useMemo(() => buildBody(setup), [setup]);
  // 🔴 Priced only once the token can spend: in production `estimate()` needs
  // the same scope as `submit()`, so pricing before consent just fails.
  const quote = useQuote(body, ready && canSpend);

  const onSettled = useCallback(() => {
    refetchWallet();
    refetchHistory();
  }, [refetchWallet, refetchHistory]);
  const { runs, start, cancelRun, dismiss } = useRuns(onSettled);

  const { requestConsent } = useRequestConsent();
  const { requestSignIn } = useRequestSignIn();

  const generate = useCallback(() => {
    if (!body || quote.price === null) return;
    // With the budget known, never send a submit that cannot land.
    if (findBlocker(quote.price, token.buzzBudget, wallet.balance)) return;
    void start(body);
  }, [body, quote.price, token.buzzBudget, wallet.balance, start]);

  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;

  // NARROW, don't cast: this is a page app, and only `app.page` makes sense.
  if (!isPageSlotContext(context)) {
    return (
      <div ref={rootRef} data-theme={theme} style={{ padding: 16 }}>
        <Alert color="warning">generate-studio runs as a full page app, not inside a slot.</Alert>
      </div>
    );
  }

  return (
    <div ref={rootRef} data-theme={theme} className="studio">
      <Stack gap={12} className="studio-controls">
        <strong style={{ fontSize: 18 }}>Generate Studio</strong>
        {!isSignedIn(viewer) ? (
          // Anonymous viewers get no consent-gated scope at all.
          <Alert color="info" title="Sign in to generate">
            <Button size="sm" onClick={() => requestSignIn()}>
              Sign in
            </Button>
          </Alert>
        ) : !canSpend ? (
          // One dialog grants every declared scope still missing.
          <Alert color="info" title="Allow this app to generate">
            <Stack gap={8}>
              <span>It spends your Buzz, within a per-generation limit, and reads your balance.</span>
              <div>
                <Button size="sm" onClick={() => requestConsent({ scopes: [SPEND, BALANCE] })}>
                  Allow
                </Button>
              </div>
            </Stack>
          </Alert>
        ) : null}
        <ModelSection setup={setup} update={update} />
        <SourceImageSection setup={setup} update={update} />
        <PromptSection setup={setup} update={update} />
        <SpendBar
          quote={quote}
          budget={token.buzzBudget}
          wallet={wallet}
          canGenerate={canSpend && body !== null}
          onGenerate={generate}
        />
      </Stack>
      <Stack gap={24} className="studio-results">
        <RunList runs={runs} onCancel={cancelRun} onDismiss={dismiss} />
        {canSpend ? <History history={history} /> : null}
      </Stack>
    </div>
  );
}
