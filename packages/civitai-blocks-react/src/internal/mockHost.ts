/**
 * `createMockHost` — a framework-agnostic, test-and-dev-only fake of the
 * civitai.com embedding host.
 *
 * The real host (civitai/civitai `IframeHost.tsx` / `PageBlockHost.tsx`) mounts
 * a block in a cross-origin iframe and answers its `postMessage` protocol:
 * mints a token, runs the lazy-consent round-trip, brokers the orchestrator
 * money path (estimate → submit → poll), opens the native Buzz-purchase and
 * resource-picker modals. Locally — in a `vitest` test OR a starter's dev
 * harness — there is no host, so this plays one.
 *
 * It is the portable core that the React `<Harness>` (a.k.a. `<MockHostProvider>`
 * in `../testing`) wraps. Every block app used to hand-roll ~250 lines of this;
 * now they configure it with {@link MockHostOptions} instead.
 *
 * Mechanism (mirrors the gen-matrix reference Harness):
 *  1. Patches `window.parent.postMessage` via `Object.defineProperty(window,
 *     'parent', …)` so the block's OUTBOUND messages are intercepted.
 *  2. Replies as `MessageEvent`s fired from `window.location.origin` — the SDK
 *     `IframeTransport` DROPS any inbound message whose `origin` ≠ the allowed
 *     parent origin, so a block using this in dev MUST allow
 *     `window.location.origin` (the React `<Harness>` is documented for that).
 *  3. Dispatches a configurable `BLOCK_INIT`, then answers the full protocol.
 *
 * NOT a real RS256 JWT, NO real Buzz, NO orchestrator — only the bridge
 * round-trips are exercised. Never import this from production code.
 */

import type {
  BlockContext,
  BlockInitPayload,
  BlockResourceInfo,
  BlockResourcePickerType,
  Theme,
  ViewerInfo,
  WrappedToken,
} from '@civitai/app-sdk/blocks';

const DEV_TOKEN = 'dev.mockhost.mock.jwt.NOT.A.REAL.RS256';
const BUDGETED_SCOPE = 'ai:write:budgeted';

/**
 * How submits resolve. `'none'` = everything succeeds; `'all'` /
 * `'insufficient'` = every submit returns an insufficient-Buzz `failed`
 * snapshot (exercises the per-cell Top-Up CTA); `'some'` = ~1 in 3 submits
 * fail (a mixed grid).
 */
export type MockHostFailMode = 'none' | 'some' | 'all' | 'insufficient';

/**
 * A canned resource the mock host "returns" from `OPEN_RESOURCE_PICKER`.
 * Mirrors the host's narrow `BlockResourceInfo` projection (versionId/modelId/
 * names/baseModel/modelType). Returning `undefined`/`null` simulates a
 * user-dismissed picker (→ `RESOURCE_PICKER_RESULT` with no `selected`).
 */
export type CannedPick = BlockResourceInfo;

/**
 * Drives `createMockHost`. Every field is optional with a sensible default so
 * `createMockHost()` works out of the box. Each block configures SCENARIOS
 * here instead of forking the host code.
 */
export interface MockHostOptions {
  /**
   * The signed-in viewer, or `null` for anonymous (→ sign-in CTA). Defaults to
   * a `dev-viewer`. Pass `null` to exercise the anon path.
   */
  viewer?: ViewerInfo | null;
  /**
   * Start WITH the consent-gated `ai:write:budgeted` scope already granted. The
   * real mint WITHHOLDS it until the viewer consents, so this defaults to
   * `false` — the first token carries NO budgeted scope, and `REQUEST_CONSENT`
   * grants it + pushes a `TOKEN_REFRESH` (the lazy-consent round-trip).
   */
  consentGranted?: boolean;
  /** How submits resolve. Default `'none'` (all succeed). */
  failMode?: MockHostFailMode;
  /**
   * Canned picks keyed by requested resource type, returned from
   * `OPEN_RESOURCE_PICKER`. A `null`/absent entry simulates a dismissed picker
   * for that type. Defaults to a curated Checkpoint + LoRA pick.
   */
  cannedPicks?: Partial<Record<BlockResourcePickerType, CannedPick | null>>;
  /** Number of `POLL_WORKFLOW` round-trips before a workflow succeeds. Default 2. */
  pollsUntilDone?: number;
  /** The `cost.total` reported on estimate + succeeded snapshots. Default 8. */
  cost?: number;
  /** The Buzz budget reported on a granted token. Default 200. */
  buzzBudget?: number;
  /** Host theme delivered in `BLOCK_INIT` + context. Default `'dark'`. */
  theme?: Theme;
  /**
   * The `BLOCK_INIT` context. Defaults to a PAGE context
   * (`{ slotId: 'app.page' }`). Pass a `ModelSlotContext` for a model-slot
   * block. `theme` is merged in from {@link MockHostOptions.theme}.
   */
  context?: BlockContext;
  /**
   * Forward-compat hook for a future content-domain / maturity field on
   * `BLOCK_INIT`. Stored verbatim and surfaced on the init payload's context
   * under `domain` / `maturity` so a block can read it once the platform ships
   * the field — inert until then.
   */
  domain?: string;
  /** @see {@link MockHostOptions.domain} */
  maturity?: string;
  /** Identity fields delivered in `BLOCK_INIT`. Sensible dev defaults. */
  blockInstanceId?: string;
  blockId?: string;
  appId?: string;
  /**
   * Called with every intercepted OUTBOUND message (`{ type, payload }`) — the
   * React `<Harness>` uses this to render its on-screen message log. RESIZE
   * messages are included; filter them out in the callback if undesired.
   */
  onOutbound?: (msg: { type: string; payload?: unknown }) => void;
  /**
   * Override `window`. Defaults to `globalThis.window`. Tests pass happy-dom's
   * window; the dev harness uses the default.
   */
  window?: Window & typeof globalThis;
}

/** Handle returned by {@link createMockHost}. Call `install()` to patch the
 * host in; it returns the `uninstall()` that restores `window.parent` and
 * removes timers. Idempotent — calling `install()` twice returns the same
 * teardown; `uninstall()` is safe to call more than once. */
export interface MockHost {
  install: () => () => void;
}

const DEFAULT_CHECKPOINT_PICK: CannedPick = {
  versionId: 691639,
  modelId: 618692,
  modelName: 'FLUX.1 [dev]',
  versionName: 'fp8',
  baseModel: 'Flux.1 D',
  modelType: 'Checkpoint',
};

const DEFAULT_LORA_PICK: CannedPick = {
  versionId: 666002,
  modelId: 555002,
  modelName: 'Sinfully Stylish',
  versionName: 'v2.0',
  baseModel: 'SDXL 1.0',
  modelType: 'LORA',
};

const DEFAULT_VIEWER: ViewerInfo = { id: 2, username: 'dev-viewer', status: 'active' };

/**
 * Reads the URL query toggles the gen-matrix dev harness uses, so a starter's
 * dev harness keeps working with `?viewer/?consent/?fail/?theme/?pick/?pickCkpt`.
 * Returns a partial overlay applied ON TOP of explicit {@link MockHostOptions}
 * (URL wins — it's the interactive dev knob). No-op outside a browser.
 */
export function readMockHostUrlOptions(
  win: (Window & typeof globalThis) | undefined = (globalThis as { window?: Window & typeof globalThis })
    .window,
): Partial<MockHostOptions> {
  if (!win?.location?.search) return {};
  const params = new URLSearchParams(win.location.search);
  const out: Partial<MockHostOptions> = {};

  if (params.get('viewer') === 'anon') out.viewer = null;
  if (params.get('consent') === 'granted') out.consentGranted = true;

  const fail = params.get('fail');
  if (fail === 'insufficient' || fail === 'some' || fail === 'all' || fail === 'none') {
    out.failMode = fail;
  }
  if (params.get('theme') === 'light') out.theme = 'light';
  else if (params.get('theme') === 'dark') out.theme = 'dark';

  // ?pick (LoRA) / ?pickCkpt (Checkpoint): 'cancel' → dismissed; 'pony' → an
  // incompatible Pony LoRA; any other value → the default curated pick.
  const pick = params.get('pick');
  const pickCkpt = params.get('pickCkpt');
  if (pick || pickCkpt) {
    const cannedPicks: Partial<Record<BlockResourcePickerType, CannedPick | null>> = {};
    if (pick === 'cancel') cannedPicks.LORA = null;
    else if (pick === 'pony')
      cannedPicks.LORA = {
        versionId: 555001,
        modelId: 444001,
        modelName: 'Incompatible Pony LoRA',
        versionName: 'v1.0',
        baseModel: 'Pony',
        modelType: 'LORA',
      };
    else if (pick) cannedPicks.LORA = DEFAULT_LORA_PICK;
    if (pickCkpt === 'cancel') cannedPicks.Checkpoint = null;
    else if (pickCkpt) cannedPicks.Checkpoint = DEFAULT_CHECKPOINT_PICK;
    out.cannedPicks = cannedPicks;
  }

  return out;
}

/**
 * Create a framework-agnostic mock host. Call the returned `install()` to patch
 * `window.parent` + start answering the block's protocol; it returns an
 * `uninstall()` teardown (restores `window.parent`, clears timers). Safe to use
 * from a node/jsdom/happy-dom test OR a browser dev harness.
 *
 * @example
 * const host = createMockHost({ failMode: 'some', pollsUntilDone: 1 });
 * const uninstall = host.install();
 * // … drive the block / assertions …
 * uninstall();
 */
export function createMockHost(options: MockHostOptions = {}): MockHost {
  const maybeWin =
    options.window ?? (globalThis as { window?: Window & typeof globalThis }).window;
  if (!maybeWin) {
    throw new Error('createMockHost: no window available (call from a DOM environment).');
  }
  // Bind to a non-nullable local so the `install()` closure keeps the narrowing.
  const win: Window & typeof globalThis = maybeWin;

  const viewer = options.viewer === undefined ? DEFAULT_VIEWER : options.viewer;
  const failMode: MockHostFailMode = options.failMode ?? 'none';
  const pollsUntilDone = options.pollsUntilDone ?? 2;
  const cost = options.cost ?? 8;
  const buzzBudget = options.buzzBudget ?? 200;
  const theme: Theme = options.theme ?? 'dark';
  const cannedPicks: Partial<Record<BlockResourcePickerType, CannedPick | null>> =
    options.cannedPicks ?? { Checkpoint: DEFAULT_CHECKPOINT_PICK, LORA: DEFAULT_LORA_PICK };
  const blockInstanceId = options.blockInstanceId ?? 'page_mock';
  const blockId = options.blockId ?? 'mock-block';
  const appId = options.appId ?? 'app_dev';

  let installed = false;
  let teardown: () => void = () => {};

  function install(): () => void {
    if (installed) return teardown;
    installed = true;

    const parentOrigin = win.location.origin;
    const originalParent = win.parent;
    let consentGranted = !!options.consentGranted;
    let tokenSerial = 0;
    let submitCount = 0;
    const workflows = new Map<string, { polls: number }>();
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const dispatchToBlock = (data: unknown) => {
      win.dispatchEvent(new MessageEvent('message', { data, origin: parentOrigin }));
    };

    const nextToken = (): WrappedToken => {
      tokenSerial += 1;
      return {
        raw: `${DEV_TOKEN}.${tokenSerial}`,
        scopes: consentGranted ? [BUDGETED_SCOPE] : [],
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        ...(consentGranted ? { buzzBudget } : {}),
      };
    };

    const succeededSnapshot = (workflowId: string) => ({
      workflowId,
      status: 'succeeded' as const,
      cost: { total: cost },
      imageUrls: [
        `https://placehold.co/512x512/1971c2/ffffff/png?text=${encodeURIComponent(
          workflowId.slice(-4),
        )}`,
      ],
    });

    const parentMock = {
      postMessage: (msg: unknown) => {
        if (
          typeof msg !== 'object' ||
          msg === null ||
          typeof (msg as { type?: unknown }).type !== 'string'
        ) {
          return;
        }
        const typed = msg as {
          type: string;
          payload?: {
            requestId?: string;
            workflowId?: string;
            resourceType?: BlockResourcePickerType;
          };
        };

        options.onOutbound?.({ type: typed.type, payload: typed.payload });

        const requestId = typed.payload?.requestId;

        switch (typed.type) {
          case 'REQUEST_TOKEN':
            dispatchToBlock({
              type: 'TOKEN_REFRESH_RESPONSE',
              payload: { ...(requestId ? { requestId } : {}), token: nextToken() },
            });
            return;

          case 'REQUEST_CONSENT': {
            // Lazy-consent round-trip: grant the scope, then push a
            // host-initiated TOKEN_REFRESH carrying it (the App's auto-resume
            // depends on seeing the new scope on its token).
            consentGranted = true;
            const t = setTimeout(() => {
              dispatchToBlock({ type: 'TOKEN_REFRESH', payload: { token: nextToken() } });
            }, 0);
            timers.add(t);
            return;
          }

          case 'REQUEST_SIGN_IN':
            // The real host opens its login UI; nothing to reply.
            return;

          case 'ESTIMATE_WORKFLOW':
            dispatchToBlock({
              type: 'ESTIMATE_RESULT',
              payload: {
                requestId,
                snapshot: { workflowId: 'wf_estimate', status: 'pending', cost: { total: cost } },
              },
            });
            return;

          case 'SUBMIT_WORKFLOW': {
            submitCount += 1;
            const failThis =
              failMode === 'all' ||
              failMode === 'insufficient' ||
              (failMode === 'some' && submitCount % 3 === 0);
            if (failThis) {
              dispatchToBlock({
                type: 'WORKFLOW_SUBMITTED',
                payload: {
                  requestId,
                  snapshot: {
                    workflowId: `wf_fail_${submitCount}`,
                    status: 'failed',
                    error: 'Insufficient Buzz to run this generation.',
                  },
                },
              });
              return;
            }
            const workflowId = `wf_${submitCount}_${Date.now()}`;
            workflows.set(workflowId, { polls: 0 });
            dispatchToBlock({
              type: 'WORKFLOW_SUBMITTED',
              payload: { requestId, snapshot: { workflowId, status: 'pending' } },
            });
            return;
          }

          case 'POLL_WORKFLOW': {
            const workflowId = typed.payload?.workflowId ?? '';
            const wf = workflows.get(workflowId);
            const polls = (wf?.polls ?? 0) + 1;
            if (wf) wf.polls = polls;
            const snapshot =
              polls >= pollsUntilDone
                ? succeededSnapshot(workflowId)
                : { workflowId, status: 'processing' as const };
            dispatchToBlock({ type: 'WORKFLOW_STATUS', payload: { requestId, snapshot } });
            return;
          }

          case 'CANCEL_WORKFLOW': {
            const workflowId = typed.payload?.workflowId ?? '';
            workflows.delete(workflowId);
            dispatchToBlock({
              type: 'WORKFLOW_CANCELED',
              payload: { requestId, snapshot: { workflowId, status: 'canceled' } },
            });
            return;
          }

          case 'OPEN_BUZZ_PURCHASE':
            dispatchToBlock({
              type: 'BUZZ_PURCHASE_RESULT',
              payload: { requestId, purchased: true, newBalance: 1000 },
            });
            return;

          case 'OPEN_CHECKPOINT_PICKER': {
            const selected = cannedPicks.Checkpoint;
            dispatchToBlock({
              type: 'CHECKPOINT_PICKER_RESULT',
              payload: {
                requestId,
                ...(selected
                  ? {
                      selected: {
                        versionId: selected.versionId,
                        modelId: selected.modelId,
                        modelName: selected.modelName,
                        versionName: selected.versionName,
                        baseModel: selected.baseModel,
                      },
                    }
                  : {}),
              },
            });
            return;
          }

          case 'OPEN_RESOURCE_PICKER': {
            const rtype = typed.payload?.resourceType;
            const selected = rtype ? cannedPicks[rtype] : undefined;
            dispatchToBlock({
              type: 'RESOURCE_PICKER_RESULT',
              payload: { requestId, ...(selected ? { selected } : {}) },
            });
            return;
          }

          default:
            return;
        }
      },
    };

    Object.defineProperty(win, 'parent', {
      value: parentMock,
      configurable: true,
      writable: true,
    });

    // Merge theme + forward-compat domain/maturity into the init context.
    const baseContext: BlockContext = options.context ?? { slotId: 'app.page' };
    const context: BlockContext = {
      ...baseContext,
      theme,
      ...(options.domain !== undefined ? { domain: options.domain } : {}),
      ...(options.maturity !== undefined ? { maturity: options.maturity } : {}),
    };

    const initPayload: BlockInitPayload = {
      blockInstanceId,
      blockId,
      appId,
      token: nextToken(),
      context,
      settings: { publisherSettings: {}, userSettings: {} },
      viewer,
      theme,
      renderMode: 'iframe',
    };

    const initTimer = setTimeout(() => dispatchToBlock({ type: 'BLOCK_INIT', payload: initPayload }), 0);
    timers.add(initTimer);

    let torn = false;
    teardown = () => {
      if (torn) return;
      torn = true;
      installed = false;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      Object.defineProperty(win, 'parent', {
        value: originalParent,
        configurable: true,
        writable: true,
      });
    };
    return teardown;
  }

  return { install };
}
