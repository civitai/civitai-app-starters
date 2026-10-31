import { useEffect, useRef } from 'react';

import {
  useBlockContext,
  useBlockResize,
  useEntitlements,
  useRequestSignIn,
} from '@civitai/blocks-react';
import { Alert, Badge, Button, Card, Group, Stack } from '@civitai/blocks-react/ui';
import { isSignedIn } from '@civitai/app-sdk/blocks';

import manifest from '../block.manifest.json' with { type: 'json' };
import { BuyButton } from './BuyButton.js';
import { TipJar } from './TipJar.js';

/**
 * monetize — how an App Block EARNS, on every rail a third-party app can use
 * today. The README cites the civitai source behind each claim here.
 *
 *  1. DIGITAL GOODS (live). `goods` in block.manifest.json is the catalog; the
 *     platform sells it for Buzz and pays the app owner floor(70%) of each sale
 *     immediately. `useGoodPurchase` buys (scope `goods:purchase:self`,
 *     consent-gated), `useEntitlements` reads what the viewer owns from THIS
 *     app (`goods:read:self`, consent-exempt) — and gates the premium feature.
 *  2. TIPS (live). `useTip` / `TipButton` move the viewer's Buzz to a PERSON
 *     (`social:tip:self`). The app earns nothing from a tip.
 *  3. The per-generation AUTHOR FEE and the Buzz-top-up REV SHARE are platform
 *     rails with no API for an app to call: see the "How this app earns" card.
 *
 * The catalog shown is the manifest bundled with this build. The SERVER prices
 * every purchase from the latest APPROVED manifest, which is why each purchase
 * sends the price it showed (`expectedPriceBuzz`).
 */

interface Good {
  id: string;
  title: string;
  description?: string;
  priceBuzz: number;
}
const GOODS = manifest.goods as Good[];

/** The app owner's share of a sale: civitai `computeBlockGoodSplit`, floor(price × 0.7). */
const ownerShare = (priceBuzz: number) => Math.floor(priceBuzz * 0.7);

const FREE_STYLES = ['Watercolor', 'Ink sketch'];
const PACK_STYLES = ['Cel shaded', 'Film noir', 'Risograph', 'Low poly', 'Ukiyo-e', 'Neon glow'];

export function App() {
  const { ready, theme, viewer, settings } = useBlockContext();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);
  const { requestSignIn } = useRequestSignIn();
  // ONE entitlements read for the view. Consent-exempt, so it runs on load;
  // skipped (no request) for an anonymous viewer, who is `unauthenticated`.
  const ent = useEntitlements();

  // Keep <html> in step with the host theme (see hello-world for the why).
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;

  const signedIn = isSignedIn(viewer);
  const recipient = settings.publisherSettings.tip_recipient_user_id;
  const recipientUserId =
    typeof recipient === 'number' && Number.isInteger(recipient) && recipient > 0 ? recipient : null;

  /**
   * 🔴 THE GATE ORDER IS THE POINT. `owns()` is `false` while entitlements are
   * loading AND when the read FAILED, so gating on it alone would show "locked"
   * to a viewer who paid. Anonymous first, then loading, then error — and only
   * then the answer.
   */
  const packState: 'anon' | 'loading' | 'error' | 'owned' | 'locked' = ent.unauthenticated
    ? 'anon'
    : ent.loading && ent.entitlements === null
      ? 'loading'
      : ent.error
        ? 'error'
        : ent.owns('style-pack')
          ? 'owned'
          : 'locked';

  return (
    <div ref={rootRef} data-theme={theme} style={{ padding: 16 }}>
      <Stack gap={12}>
        <Group gap={8} align="center">
          <strong style={{ fontSize: 18 }}>Monetize</strong>
          {ent.owns('supporter') ? (
            <Badge color="success" data-testid="supporter-badge">
              Supporter
            </Badge>
          ) : null}
        </Group>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
            gap: 12,
            alignItems: 'start',
          }}
        >
          {/* ── Rail 1: digital goods ─────────────────────────────────── */}
          <Card data-testid="shop">
            <Stack gap={10}>
              <strong>Shop</strong>
              {!signedIn ? (
                <Group gap={8} align="center">
                  <span>Sign in to buy.</span>
                  <Button size="sm" variant="light" onClick={() => requestSignIn()} data-testid="sign-in">
                    Sign in
                  </Button>
                </Group>
              ) : null}
              {ent.error && !ent.unauthenticated ? (
                <Alert color="warning" title="Couldn't check your purchases">
                  <Group gap={8} align="center">
                    <span>Nothing you bought is lost.</span>
                    <Button size="sm" variant="subtle" onClick={ent.refetch}>
                      Retry
                    </Button>
                  </Group>
                </Alert>
              ) : null}
              {GOODS.map((good) => (
                <div key={good.id} data-testid={`good-${good.id}`}>
                  <Group gap={8} align="center" justify="space-between">
                    <div>
                      <div>
                        <strong>{good.title}</strong> · {good.priceBuzz} Buzz
                      </div>
                      {good.description ? (
                        <div style={{ fontSize: 13, color: 'var(--civitai-color-text-dimmed)' }}>
                          {good.description}
                        </div>
                      ) : null}
                    </div>
                    {ent.owns(good.id) ? (
                      <Badge color="success" data-testid={`owned-${good.id}`}>
                        Owned
                      </Badge>
                    ) : signedIn && !ent.error && ent.entitlements !== null ? (
                      <BuyButton
                        goodId={good.id}
                        title={good.title}
                        priceBuzz={good.priceBuzz}
                        // The purchase reply carries the entitlement, but the
                        // read is the source of truth for every other screen —
                        // re-read rather than patch local state. No new token
                        // is needed: entitlements are looked up by viewer + app.
                        onPurchased={() => ent.refetch()}
                      />
                    ) : null}
                  </Group>
                </div>
              ))}
            </Stack>
          </Card>

          {/* ── The premium feature, gated on an entitlement ──────────── */}
          <Card data-testid="styles" data-pack={packState}>
            <Stack gap={10}>
              <strong>Prompt styles</strong>
              <Group gap={6}>
                {FREE_STYLES.map((s) => (
                  <Badge key={s} variant="light">
                    {s}
                  </Badge>
                ))}
                {packState === 'owned'
                  ? PACK_STYLES.map((s) => (
                      <Badge key={s} variant="light" color="success">
                        {s}
                      </Badge>
                    ))
                  : null}
              </Group>
              <div style={{ fontSize: 13 }} data-testid="styles-status">
                {packState === 'owned'
                  ? 'Style pack unlocked.'
                  : packState === 'locked'
                    ? `${PACK_STYLES.length} more styles with the Style pack.`
                    : packState === 'anon'
                      ? 'Sign in to unlock more styles.'
                      : packState === 'loading'
                        ? 'Checking your purchases…'
                        : "Couldn't check your purchases — your styles are not locked, just unknown."}
              </div>
            </Stack>
          </Card>

          {/* ── Rail: tips (to a person) ───────────────────────────────── */}
          <Card data-testid="tips">
            <Stack gap={10}>
              <strong>Tip the creator</strong>
              {recipientUserId === null ? (
                <span data-testid="tips-unconfigured">The model owner has not set a tip recipient.</span>
              ) : !signedIn ? (
                <span>Sign in to send a tip.</span>
              ) : (
                <TipJar recipientUserId={recipientUserId} />
              )}
            </Stack>
          </Card>

          {/* ── What each rail pays ───────────────────────────────────── */}
          <Card data-testid="rails">
            <Stack gap={8}>
              <strong>How this app earns</strong>
              <div>
                <Badge color="success">Live</Badge> <strong>Goods</strong> — the app owner is paid floor(70%) of each
                sale, immediately:{' '}
                {GOODS.map((g) => `${g.title} ${g.priceBuzz} → ${ownerShare(g.priceBuzz)}`).join(', ')} Buzz.
              </div>
              <div>
                <Badge color="info">Not the app</Badge> <strong>Tips</strong> — go to the person tipped, in full; the
                app earns nothing from them.
              </div>
              <div>
                <Badge color="success">Live</Badge> <strong>Author fee</strong> — automatic on generations an app
                runs: max(1, 5% of base) Buzz each, paid daily. This block runs none, so it earns none here.
              </div>
              <div>
                <Badge color="warning">Not paid out</Badge> <strong>Buzz bought in the block</strong> — a top-up
                (e.g. from a purchase above) is recorded against the app, but no payout exists today.
              </div>
            </Stack>
          </Card>
        </div>
      </Stack>
    </div>
  );
}
