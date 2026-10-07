import { getTransport } from '@civitai/blocks-react';

import manifest from '../block.manifest.json' with { type: 'json' };

/**
 * DEV-HARNESS ONLY. A stand-in for the four money REST routes this block calls,
 * so `npm run dev:harness` can exercise them with no network and no Buzz.
 *
 * WHY THIS FILE EXISTS. `useGoodPurchase`, `useEntitlements`, `useTip` and
 * `useTipAllowance` do not go through the postMessage bridge: they `fetch`
 * `<host origin>/api/v1/blocks/...` directly with the block token. The SDK's
 * mock host answers the bridge only, and in `dev:harness` the host origin is
 * this dev server, whose `/api` proxy would forward the call to the real API
 * with a mock token (a 401). So without this, nothing on this page could be
 * clicked through locally.
 *
 * WHAT IT IS NOT. It is not the platform, it is not shipped (installed only from
 * `installDevTransport()` when `VITE_LIVE_MODE` is not `true`; a production
 * build never runs it), and it is not exhaustive. It answers with the server's
 * status codes, bodies and `reason`s for the cases below — each one cites the
 * civitai source it copies — so the block's branches see production shapes.
 * NOT modelled: rate limits (429), the per-viewer daily purchase ceiling, the
 * limiter / idempotency-store outages (503), `charge_unknown`, blue-vs-yellow
 * Buzz pools (goods spend blue then yellow, tips spend yellow only — one
 * balance here), and a pinned install's older catalog.
 *
 * The scope gate IS modelled, because it is what this example teaches: a call
 * is refused `403 insufficient_scope` unless the scope is DECLARED in
 * `block.manifest.json` AND on the token. `goods:read:self` is consent-exempt
 * (the real mint signs it without a prompt); `goods:purchase:self` and
 * `social:tip:self` reach the token only through a consent grant. Remove one
 * from the manifest and its feature is refused here, as in production.
 *
 * URL knobs (on top of the mock host's own `?viewer=anon`, `?theme=light`, …):
 *   ?wallet=N         starting Buzz (default 50: enough for the badge, not the pack)
 *   ?owner=self       the viewer owns this app → purchases refuse `self_purchase`
 *   ?repriced=<id>    the server price of good <id> is 10 higher than the
 *                     manifest's → that purchase refuses `price_changed`
 *   ?recipient=self   the configured tip recipient is the viewer → self-tip refusal
 *   ?tipRecipient=none  no tip recipient configured (the tip jar hides)
 */

/** Ids the fixture uses. Arbitrary, distinct. */
const VIEWER_ID = 1001;
const OTHER_OWNER_ID = 9000;
const OTHER_RECIPIENT_ID = 4242;

// civitai src/pages/api/v1/blocks/tip.ts:79 (BLOCK_TIP_MAX_PER_TIP, block-tip-rate-limit.ts:89)
const TIP_MAX_PER_TIP = 5_000;
// civitai src/server/utils/block-tip-rate-limit.ts:94
const TIP_CAP_PER_DAY = 25_000;
// civitai src/shared/constants/block-goods.constants.ts:79
const GOOD_MAX_PRICE_BUZZ = 50_000;
// civitai src/shared/constants/block-goods.constants.ts:214
const GOOD_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
// The host's idempotency-key charset (BLOCK_IDEMPOTENCY_KEY_REGEX).
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
/**
 * Of this block's scopes, the one the real mint signs WITHOUT consent
 * (civitai src/server/services/blocks/scope-grant.service.ts, CONSENT_EXEMPT_SCOPES).
 */
const CONSENT_EXEMPT = new Set(['goods:read:self']);

/** The mock host's top-up adds 1000 Buzz (blocks-react `mockHost.ts`, OPEN_BUZZ_PURCHASE). */
const MOCK_TOP_UP_BUZZ = 1000;

interface Good {
  id: string;
  title: string;
  priceBuzz: number;
  kind?: string;
  payload?: Record<string, unknown>;
}

interface Entitlement {
  goodId: string;
  kind: string;
  payload: Record<string, unknown>;
  grantedAt: string;
}

type Reply = { status: number; body: unknown };

const json = (status: number, body: unknown): Reply => ({ status, body });

export interface DevMoneyApi {
  /** Credit a completed mock top-up to the fixture wallet. */
  creditTopUp(): void;
  /** The `publisherSettings` an installer would have saved. */
  publisherSettings: Record<string, unknown>;
}

export function installDevMoneyApi(): DevMoneyApi {
  const params = new URLSearchParams(window.location.search);
  let wallet = Number(params.get('wallet') ?? 50);
  if (!Number.isFinite(wallet) || wallet < 0) wallet = 50;
  const ownerId = params.get('owner') === 'self' ? VIEWER_ID : OTHER_OWNER_ID;
  const repriced = params.get('repriced');
  const recipientKnob = params.get('tipRecipient') ?? params.get('recipient');
  const publisherSettings: Record<string, unknown> =
    recipientKnob === 'none'
      ? {}
      : { tip_recipient_user_id: recipientKnob === 'self' ? VIEWER_ID : OTHER_RECIPIENT_ID };

  const declared = new Set<string>(manifest.scopes);
  const goods = (manifest as { goods?: Good[] }).goods ?? [];
  const entitlements = new Map<string, Entitlement>();
  let tipSpentToday = 0;
  let purchaseSerial = 0;
  /** idempotencyKey -> the fingerprint it is pinned to and its terminal reply. */
  const goodKeys = new Map<string, { fingerprint: string; reply: Reply }>();
  const tipKeys = new Map<string, { fingerprint: string; reply: Reply }>();

  /**
   * Every token the mock host has minted, by its raw value — an older token is
   * still valid until it expires, exactly as a real JWT is, so a request that
   * raced a TOKEN_REFRESH is not refused for it.
   */
  const minted = new Map<string, string[]>();
  const record = () => {
    const { token } = getTransport().getSnapshot();
    if (token.raw) minted.set(token.raw, token.scopes);
  };
  record();
  getTransport().subscribe(record);

  /** What the token in this request carries, as the server would read it off the JWT. */
  const tokenScopes = (bearer: string): string[] | null => {
    const carried = minted.get(bearer);
    if (!carried) return null;
    // The real mint signs only APPROVED (declared) scopes: exempt ones always,
    // gated ones once granted. The mock host's consent grant does not consult
    // the manifest, so the intersection with `declared` is applied here.
    return [...declared].filter((s) => CONSENT_EXEMPT.has(s) || carried.includes(s));
  };
  const signedIn = () => getTransport().getSnapshot().viewer != null;

  /**
   * `withBlockScope` (civitai src/server/middleware/block-scope.middleware.ts):
   * 401 with no valid token, 403 `insufficient_scope` (:1864) when the token
   * lacks the route's scope, then 403 `context_binding` (:1884) for an
   * anonymous subject on a `:self` scope.
   */
  const gate = (bearer: string, scope: string): Reply | null => {
    const scopes = tokenScopes(bearer);
    if (!scopes) return json(401, { error: 'invalid block token' }); // :1415
    if (!scopes.includes(scope)) {
      return json(403, { error: `missing required scope: ${scope}`, code: 'insufficient_scope' });
    }
    if (!signedIn()) {
      // enforceContextBinding, block-scope.middleware.ts:1103
      return json(403, { error: `${scope} requires authenticated subject`, code: 'context_binding' });
    }
    return null;
  };

  // GET /api/v1/blocks/entitlements — civitai src/pages/api/v1/blocks/entitlements.ts
  const entitlementsRoute = (bearer: string): Reply =>
    gate(bearer, 'goods:read:self') ?? json(200, { entitlements: [...entitlements.values()].reverse() });

  // POST /api/v1/blocks/goods/purchase — civitai src/pages/api/v1/blocks/goods/purchase.ts
  // and purchaseBlockGood in src/server/services/blocks/block-goods.service.ts
  const purchaseRoute = (bearer: string, body: Record<string, unknown>): Reply => {
    const refused = gate(bearer, 'goods:purchase:self');
    if (refused) return refused;
    const { goodId, expectedPriceBuzz, idempotencyKey } = body;
    if (
      typeof goodId !== 'string' ||
      !GOOD_ID_RE.test(goodId) ||
      (expectedPriceBuzz !== undefined &&
        (!Number.isInteger(expectedPriceBuzz) ||
          (expectedPriceBuzz as number) <= 0 ||
          (expectedPriceBuzz as number) > GOOD_MAX_PRICE_BUZZ)) ||
      (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)))
    ) {
      return json(400, { error: 'Invalid request body' }); // purchase.ts:125
    }
    const good = goods.find((g) => g.id === goodId);
    if (!good) return json(404, { ok: false, error: 'This item is not available' }); // purchase.ts:138
    const priceBuzz = good.priceBuzz + (repriced === good.id ? 10 : 0);

    const fingerprint = JSON.stringify([goodId, priceBuzz, expectedPriceBuzz ?? null]);
    if (typeof idempotencyKey === 'string') {
      const prior = goodKeys.get(idempotencyKey);
      if (prior && prior.fingerprint !== fingerprint) {
        return json(422, { error: 'This idempotency key was already used for a different purchase' }); // :267
      }
      if (prior) return prior.reply; // :272 — a terminal result is replayed verbatim
    }

    const attempt = (): Reply & { retryable: boolean } => {
      if (expectedPriceBuzz !== undefined && expectedPriceBuzz !== priceBuzz) {
        // block-goods.service.ts:589
        return {
          ...json(409, {
            ok: false,
            error: `The price changed to ${priceBuzz} Buzz. Check the new price and try again.`,
            reason: 'price_changed',
          }),
          retryable: false,
        };
      }
      if (ownerId === VIEWER_ID) {
        // block-goods.service.ts:603
        return {
          ...json(400, { ok: false, error: 'You cannot buy your own app’s items', reason: 'self_purchase' }),
          retryable: false,
        };
      }
      if (entitlements.has(good.id)) {
        // block-goods.service.ts:622
        return {
          ...json(409, { ok: false, error: 'You already own this item', reason: 'already_owned' }),
          retryable: false,
        };
      }
      if (wallet < priceBuzz) {
        // block-goods.service.ts:822 — retryable: a top-up can change the verdict
        return {
          ...json(400, {
            ok: false,
            error: 'You do not have enough Buzz to buy this item',
            reason: 'insufficient_funds',
          }),
          retryable: true,
        };
      }
      wallet -= priceBuzz;
      purchaseSerial += 1;
      const entitlement: Entitlement = {
        goodId: good.id,
        kind: good.kind ?? 'good',
        payload: good.payload ?? {},
        grantedAt: new Date().toISOString(),
      };
      entitlements.set(good.id, entitlement);
      // purchase.ts:240
      return {
        ...json(200, {
          ok: true,
          purchase: { id: `dev-purchase-${purchaseSerial}`, goodId: good.id, priceBuzz },
          entitlement,
        }),
        retryable: false,
      };
    };
    const outcome = attempt();
    // purchase.ts:223 — a retryable verdict is NOT cached under the key.
    if (typeof idempotencyKey === 'string' && !outcome.retryable) {
      goodKeys.set(idempotencyKey, { fingerprint, reply: { status: outcome.status, body: outcome.body } });
    }
    return { status: outcome.status, body: outcome.body };
  };

  // GET /api/v1/blocks/tip-allowance — civitai src/pages/api/v1/blocks/tip-allowance.ts
  const allowanceRoute = (bearer: string): Reply =>
    gate(bearer, 'social:tip:self') ??
    json(200, {
      cap: TIP_CAP_PER_DAY,
      spent: tipSpentToday,
      remaining: Math.max(0, TIP_CAP_PER_DAY - tipSpentToday),
    });

  // POST /api/v1/blocks/tip — civitai src/pages/api/v1/blocks/tip.ts
  const tipRoute = (bearer: string, body: Record<string, unknown>): Reply => {
    const refused = gate(bearer, 'social:tip:self');
    if (refused) return refused;
    const { toUserId, amount, entityType, entityId, idempotencyKey } = body;
    if (
      !Number.isInteger(toUserId) ||
      (toUserId as number) <= 0 ||
      !Number.isInteger(amount) ||
      (amount as number) <= 0 ||
      (amount as number) > TIP_MAX_PER_TIP ||
      (entityType !== undefined && !['Image', 'Collection', 'User'].includes(entityType as string)) ||
      (entityId !== undefined && (!Number.isInteger(entityId) || (entityId as number) <= 0)) ||
      (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)))
    ) {
      return json(400, { error: 'Invalid request body' }); // tip.ts:127
    }
    if (Boolean(entityType) !== Boolean(entityId)) {
      return json(400, { error: 'entityType and entityId must be provided together' }); // tip.ts:134
    }
    if (toUserId === VIEWER_ID) return json(400, { error: 'You cannot tip yourself' }); // tip.ts:141

    const fingerprint = JSON.stringify([toUserId, amount, entityType ?? null, entityId ?? null]);
    if (typeof idempotencyKey === 'string') {
      const prior = tipKeys.get(idempotencyKey);
      if (prior && prior.fingerprint !== fingerprint) {
        return json(422, { error: 'This idempotency key was already used for a different tip' }); // tip.ts:341
      }
      if (prior) return prior.reply; // tip.ts:349
    }

    let reply: Reply;
    if (tipSpentToday + (amount as number) > TIP_CAP_PER_DAY) {
      reply = json(400, { error: `Daily tip limit reached (${TIP_CAP_PER_DAY} Buzz). Try again tomorrow.` }); // tip.ts:196
    } else if (wallet < (amount as number)) {
      // buzz.controller.ts → throwInsufficientFundsError (errorHandling.ts:309)
      reply = json(400, { ok: false, error: "Hey buddy, seems like you don't have enough funds to perform this action." });
    } else {
      wallet -= amount as number;
      tipSpentToday += amount as number;
      reply = json(200, {
        ok: true,
        tip: { toUserId, amount, entityType: entityType ?? null, entityId: entityId ?? null },
      }); // tip.ts:280
    }
    if (typeof idempotencyKey === 'string') tipKeys.set(idempotencyKey, { fingerprint, reply });
    return reply;
  };

  const route = (method: string, path: string, bearer: string, body: Record<string, unknown>): Reply | null => {
    if (method === 'GET' && path === '/api/v1/blocks/entitlements') return entitlementsRoute(bearer);
    if (method === 'POST' && path === '/api/v1/blocks/goods/purchase') return purchaseRoute(bearer, body);
    if (method === 'GET' && path === '/api/v1/blocks/tip-allowance') return allowanceRoute(bearer);
    if (method === 'POST' && path === '/api/v1/blocks/tip') return tipRoute(bearer, body);
    return null;
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/v1/blocks/')) {
      return realFetch(input, init);
    }
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    let body: Record<string, unknown> = {};
    try {
      body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    } catch {
      /* an unparseable body falls through to the route's 400 */
    }
    // A short delay so the block's loading states are visible, and so an
    // unmount mid-request exercises the hooks' abort path.
    await new Promise((r) => setTimeout(r, 250));
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const reply = route(method, url.pathname, bearer, body);
    if (!reply) return realFetch(input, init);
    console.info(`[dev money api] ${method} ${url.pathname} -> ${reply.status}`, reply.body);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    creditTopUp: () => {
      wallet += MOCK_TOP_UP_BUZZ;
    },
    publisherSettings,
  };
}
