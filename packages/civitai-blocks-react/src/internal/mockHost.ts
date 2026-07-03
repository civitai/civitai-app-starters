/**
 * `createMockHost` — a framework-agnostic, test-and-dev-only fake of the
 * civitai.com embedding host.
 *
 * The real host (civitai/civitai `IframeHost.tsx` / `PageBlockHost.tsx`) mounts
 * a block in a cross-origin iframe and answers its `postMessage` protocol:
 * mints a token, runs the lazy-consent round-trip, brokers the orchestrator
 * money path (estimate → submit → poll), opens the native Buzz-purchase and
 * resource-picker modals, and serves the App-Blocks KV datastore. Locally — in
 * a `vitest` test OR a starter's dev harness — there is no host, so this plays
 * one.
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
 * SCENARIOS (Layer 1 of the local-dev DX): the {@link MockHostOptions.generation},
 * {@link MockHostOptions.buzz}, and {@link MockHostOptions.storage} groups let a
 * dev simulate REAL costs, slow gens, FAILURES, an insufficient-Buzz balance,
 * and a working KV store with a quota — entirely synthetically, so the full
 * money / error / storage UX is exercisable locally without spending a single
 * Buzz or touching the network. The returned {@link MockHost} exposes
 * `setScenario()` + a `buzz` handle so a harness UI can flip scenarios
 * mid-session.
 *
 * PURE + SYNTHETIC: NOT a real RS256 JWT, NO real Buzz, NO orchestrator, and
 * — asserted by the test suite — NO network (`fetch`/`XMLHttpRequest` are never
 * called). Only the postMessage bridge round-trips are exercised. Never import
 * this from production code.
 */

import {
  BrowsingLevel,
  SFW_LEVELS,
  type BlockContext,
  type BlockInitPayload,
  type BlockResourceInfo,
  type BlockResourcePickerType,
  type ColorDomain,
  type Theme,
  type ViewerInfo,
  type WorkflowBody,
  type WrappedToken,
} from '@civitai/app-sdk/blocks';

/** The full all-levels ceiling a `red` domain projects (mirrors the server). */
const ALL_LEVELS =
  BrowsingLevel.PG |
  BrowsingLevel.PG13 |
  BrowsingLevel.R |
  BrowsingLevel.X |
  BrowsingLevel.XXX;

const DEV_TOKEN = 'dev.mockhost.mock.jwt.NOT.A.REAL.RS256';
const BUDGETED_SCOPE = 'ai:write:budgeted';

/** v0 host storage ceilings (mirror civitai/civitai's APP_STORAGE limits). */
const DEFAULT_STORAGE_QUOTA_BYTES = 50 * 1024 * 1024; // 50 MB per app
const DEFAULT_STORAGE_VALUE_CAP_BYTES = 64 * 1024; // 64 KB per value
const DEFAULT_STORAGE_LIMIT_ROWS = 1_000_000;

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
 * A per-generation cost: a fixed number, or a function of the submitted
 * {@link WorkflowBody} (so a dev can vary cost by model / step count).
 */
export type CostSpec = number | ((req: WorkflowBody) => number);

/**
 * A result image url: a fixed string, or a function of the submitted body
 * (so a dev can echo the prompt into a placeholder).
 */
export type ImageSpec = string | ((req: WorkflowBody) => string);

/**
 * GENERATION scenario controls — simulate real costs, slow gens, and failures
 * on the orchestrator money path WITHOUT a real orchestrator. All optional.
 */
export interface MockGenerationScenario {
  /**
   * Cost reported on `ESTIMATE_RESULT` + the succeeded snapshot. A number, or
   * a `(body) => number`. Overrides the legacy top-level `cost`. Default `8`.
   */
  costPerGen?: CostSpec;
  /**
   * Synthetic latency before the SUBMITTED→succeeded transition lands, in ms.
   * A single number, or a `[min, max]` range (uniform random). Applied to the
   * poll that flips a workflow to `succeeded`. Default `0` (immediate).
   */
  latencyMs?: number | [number, number];
  /**
   * Probability (0..1) that any given submit fails with a generic generation
   * error. Independent of {@link failRate}'s sibling controls. Default `0`.
   */
  failRate?: number;
  /**
   * Force the next N submits to fail (counts down). Deterministic companion to
   * {@link failRate} — handy for "first try fails, retry succeeds" UX tests.
   */
  failNext?: number;
  /** A single result image url (or `(body) => url`). */
  image?: ImageSpec;
  /**
   * Multiple result image urls (or `(body) => url[]`). Takes precedence over
   * {@link image} when both are set.
   */
  images?: string[] | ((req: WorkflowBody) => string[]);
}

/**
 * BUZZ scenario controls — simulate a balance so the insufficient-Buzz / top-up
 * UX is exercisable. The mock host treats `balance` as a spendable wallet:
 * each succeeding generation DEBITS its cost; a submit whose cost would exceed
 * the remaining balance resolves to an insufficient-Buzz `failed` snapshot
 * (exercising the Top-Up CTA), and `OPEN_BUZZ_PURCHASE` REFILLS the balance.
 */
export interface MockBuzzScenario {
  /**
   * Simulated spendable balance. When set, generations debit against it and a
   * gen that would exceed it returns an insufficient-Buzz outcome. When
   * `undefined`, balance is NOT simulated (back-compat: only the legacy
   * `failMode` drives insufficiency).
   */
  balance?: number;
  /**
   * Force every submit down the insufficient-Buzz path regardless of balance.
   * Equivalent to the legacy `failMode: 'insufficient'`; provided here so the
   * insufficient UX is reachable from the `buzz` group alone.
   */
  insufficient?: boolean;
}

/**
 * STORAGE scenario controls — drive the in-memory KV backend that answers the
 * `APP_STORAGE_*` protocol, so the W4 KV apps (e.g. Prompt Library) can test
 * load / quota / error states against `createMockHost` directly instead of
 * hand-injecting a fake store.
 */
export interface MockStorageScenario {
  /**
   * Initial KV contents (key → JSON value) the store is seeded with. `get`
   * returns these immediately; they count against the simulated quota.
   */
  seed?: Record<string, unknown>;
  /**
   * Simulated per-app quota in bytes. A `set` that would cross it resolves
   * `{ ok: false, error: 'PAYLOAD_TOO_LARGE' }` (the host doesn't leak which
   * cap tripped). Default 50 MB.
   */
  quotaBytes?: number;
  /**
   * Per-value byte cap. A `set` whose serialized value exceeds it resolves
   * `{ ok: false, error: 'PAYLOAD_TOO_LARGE' }`. Default 64 KB.
   */
  valueCapBytes?: number;
  /** Simulated row ceiling reported by `getQuota`. Default 1,000,000. */
  limitRows?: number;
  /**
   * Force the next N storage MUTATIONS (`set`/`delete`) to fail with a generic
   * `STORAGE_UNAVAILABLE` error (counts down) — exercises the error UX.
   */
  failNext?: number;
}

/**
 * Drives `createMockHost`. Every field is optional with a sensible default so
 * `createMockHost()` works out of the box. Each block configures SCENARIOS
 * here instead of forking the host code.
 *
 * Backward-compatible: the legacy top-level `cost`/`failMode`/`buzzBudget`/
 * `pollsUntilDone` knobs still work. When BOTH a legacy knob and its scenario
 * equivalent are set, the SCENARIO wins (it's the newer, richer control).
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
  /**
   * The `cost.total` reported on estimate + succeeded snapshots. Default 8.
   * @deprecated Prefer {@link MockGenerationScenario.costPerGen} on `generation`.
   */
  cost?: number;
  /** The Buzz budget reported on a granted token. Default 200. */
  buzzBudget?: number;
  /**
   * GENERATION scenario: cost / latency / failure / result-image controls. See
   * {@link MockGenerationScenario}.
   */
  generation?: MockGenerationScenario;
  /**
   * BUZZ scenario: simulated balance + force-insufficient. See
   * {@link MockBuzzScenario}.
   */
  buzz?: MockBuzzScenario;
  /**
   * STORAGE scenario: in-memory KV backend (seed / quota / failNext). See
   * {@link MockStorageScenario}. When omitted, the store starts EMPTY with the
   * v0 defaults — `APP_STORAGE_*` is answered either way (the mock host always
   * serves storage now).
   */
  storage?: MockStorageScenario;
  /** Host theme delivered in `BLOCK_INIT` + context. Default `'dark'`. */
  theme?: Theme;
  /**
   * The `BLOCK_INIT` context. Defaults to a PAGE context
   * (`{ slotId: 'app.page' }`). Pass a `ModelSlotContext` for a model-slot
   * block. `theme` is merged in from {@link MockHostOptions.theme}.
   */
  context?: BlockContext;
  /**
   * The color-domain the host projects into `BLOCK_INIT` (civitai #2670),
   * surfaced on the top-level `domain` field. When set WITHOUT an explicit
   * {@link MockHostOptions.maxBrowsingLevel}, the mock host derives a matching
   * ceiling: `green`/`blue` → SFW (`SFW_LEVELS`), `red` → all levels — so
   * `useDomainMaturity()`/`<SfwGate>` are exercisable. Omit for a host that
   * predates #2670 (neither field is emitted → the hook fail-closes to SFW).
   */
  domain?: ColorDomain;
  /**
   * The authoritative browsing-level ceiling BITMASK emitted on `BLOCK_INIT`
   * (`maxBrowsingLevel`). Overrides whatever {@link MockHostOptions.domain} /
   * {@link MockHostOptions.maturity} would derive. Use `BrowsingLevel` bits
   * from `@civitai/app-sdk/blocks` to compose one.
   */
  maxBrowsingLevel?: number;
  /**
   * Convenience for the common case: `'sfw'` → an SFW ceiling (`SFW_LEVELS`),
   * `'mature'` → an all-levels ceiling. Lower precedence than an explicit
   * {@link MockHostOptions.maxBrowsingLevel}, higher than the
   * {@link MockHostOptions.domain}-derived default.
   */
  maturity?: 'sfw' | 'mature';
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

/**
 * The mutable slice of {@link MockHostOptions} a harness UI can flip mid-session
 * via {@link MockHost.setScenario}. (Identity/init-only fields like `viewer`,
 * `context`, `theme`, and `appId` are fixed at install time — change them by
 * re-installing.)
 */
export type MockHostScenarioPatch = Pick<
  MockHostOptions,
  'failMode' | 'cost' | 'pollsUntilDone' | 'cannedPicks' | 'generation' | 'buzz' | 'storage'
>;

/** Runtime Buzz-balance handle exposed on {@link MockHost.buzz}. */
export interface MockBuzzHandle {
  /** Current simulated balance, or `undefined` when balance isn't simulated. */
  getBalance: () => number | undefined;
  /** Set (or start simulating) the balance. Pass `undefined` to stop simulating. */
  setBalance: (n: number | undefined) => void;
}

/** Handle returned by {@link createMockHost}.
 *
 * Call `install()` to patch the host in; it returns the `uninstall()` that
 * restores `window.parent` and removes timers (so the historical
 * `const uninstall = createMockHost(opts).install()` keeps working unchanged).
 *
 * After install, a harness UI can drive scenarios live:
 *  - `setScenario(patch)` — merge new generation/buzz/storage/failMode controls.
 *  - `buzz.setBalance(n)` / `buzz.getBalance()` — flip the simulated wallet.
 *
 * `install()` is idempotent — calling it twice returns the same teardown;
 * `uninstall()` is safe to call more than once. */
export interface MockHost {
  install: () => () => void;
  /** Merge a partial scenario into the live mock host (no re-install). */
  setScenario: (patch: MockHostScenarioPatch) => void;
  /** Runtime Buzz-balance control for a harness UI. */
  buzz: MockBuzzHandle;
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

const INSUFFICIENT_BUZZ_ERROR = 'Insufficient Buzz to run this generation.';
const GENERIC_GEN_ERROR = 'Generation failed (simulated).';

/** Byte size of a JSON value as the mock store would persist it. */
function jsonByteSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  } catch {
    return 0;
  }
}

/**
 * Reads the URL query toggles the gen-matrix dev harness uses, so a starter's
 * dev harness keeps working with `?viewer/?consent/?fail/?theme/?pick/?pickCkpt`.
 * Layer-1 additions: `?balance/?latency/?costPerGen/?failNext/?failRate/?seed`
 * map onto the new scenario groups so a dev can flip insufficient-buzz /
 * failures / latency without editing code.
 *
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

  // ?domain=green|blue|red projects a color-domain (and its derived ceiling);
  // ?maturity=sfw|mature sets the ceiling directly.
  const domain = params.get('domain');
  if (domain === 'green' || domain === 'blue' || domain === 'red') out.domain = domain;
  const maturity = params.get('maturity');
  if (maturity === 'sfw' || maturity === 'mature') out.maturity = maturity;

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

  // --- Layer-1 scenario toggles ---
  const generation: MockGenerationScenario = {};
  const buzz: MockBuzzScenario = {};

  const balance = params.get('balance');
  if (balance !== null && balance.trim() !== '' && Number.isFinite(Number(balance))) {
    buzz.balance = Number(balance);
  }
  if (params.get('insufficient') === '1' || params.get('insufficient') === 'true') {
    buzz.insufficient = true;
  }

  const latency = params.get('latency');
  if (latency !== null && latency.trim() !== '') {
    // ?latency=2000 or ?latency=500-2000
    const range = latency.split('-').map((s) => Number(s.trim()));
    const lo = range[0] ?? NaN;
    const hi = range[1] ?? NaN;
    if (range.length === 2 && Number.isFinite(lo) && Number.isFinite(hi)) {
      generation.latencyMs = [lo, hi];
    } else if (Number.isFinite(lo)) {
      generation.latencyMs = lo;
    }
  }

  const costPerGen = params.get('costPerGen') ?? params.get('cost');
  if (costPerGen !== null && Number.isFinite(Number(costPerGen))) {
    generation.costPerGen = Number(costPerGen);
  }

  const failNext = params.get('failNext');
  if (failNext !== null && Number.isInteger(Number(failNext))) {
    generation.failNext = Number(failNext);
  }
  const failRate = params.get('failRate');
  if (failRate !== null && Number.isFinite(Number(failRate))) {
    generation.failRate = Number(failRate);
  }

  if (Object.keys(generation).length > 0) out.generation = generation;
  if (Object.keys(buzz).length > 0) out.buzz = buzz;

  const seed = params.get('seed');
  if (seed) {
    try {
      const parsed = JSON.parse(seed) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') out.storage = { seed: parsed };
    } catch {
      /* ignore malformed ?seed= */
    }
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
 * const host = createMockHost({ generation: { failNext: 1, latencyMs: 1500 }, buzz: { balance: 5 } });
 * const uninstall = host.install();
 * // … drive the block / assertions …
 * host.buzz.setBalance(0);       // flip to insufficient mid-session
 * host.setScenario({ generation: { failRate: 1 } });
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
  const buzzBudget = options.buzzBudget ?? 200;
  const theme: Theme = options.theme ?? 'dark';
  const blockInstanceId = options.blockInstanceId ?? 'page_mock';
  const blockId = options.blockId ?? 'mock-block';
  const appId = options.appId ?? 'app_dev';

  // ---- LIVE, mutable scenario state (so setScenario / buzz.setBalance work) ----
  // Legacy + scenario knobs are merged into one mutable record; `setScenario`
  // rewrites these in place without re-installing.
  let failMode: MockHostFailMode = options.failMode ?? 'none';
  let pollsUntilDone = options.pollsUntilDone ?? 2;
  let gen: MockGenerationScenario = { ...(options.generation ?? {}) };
  let buzz: MockBuzzScenario = { ...(options.buzz ?? {}) };
  // Legacy `cost` feeds costPerGen unless the scenario set its own.
  let legacyCost = options.cost ?? 8;
  let cannedPicks: Partial<Record<BlockResourcePickerType, CannedPick | null>> =
    options.cannedPicks ?? { Checkpoint: DEFAULT_CHECKPOINT_PICK, LORA: DEFAULT_LORA_PICK };

  // ---- Storage scenario (in-memory KV backend) ----
  const storageScenario: MockStorageScenario = { ...(options.storage ?? {}) };
  const store = new Map<string, { value: unknown; updatedAt: string }>();
  const seedNow = new Date().toISOString();
  for (const [k, v] of Object.entries(storageScenario.seed ?? {})) {
    store.set(k, { value: v, updatedAt: seedNow });
  }
  let storageFailNext = storageScenario.failNext ?? 0;
  const quotaBytes = storageScenario.quotaBytes ?? DEFAULT_STORAGE_QUOTA_BYTES;
  const valueCapBytes = storageScenario.valueCapBytes ?? DEFAULT_STORAGE_VALUE_CAP_BYTES;
  const limitRows = storageScenario.limitRows ?? DEFAULT_STORAGE_LIMIT_ROWS;

  const usedBytes = () => {
    let total = 0;
    for (const [k, row] of store) total += jsonByteSize(row.value) + k.length;
    return total;
  };

  // Resolve a per-gen cost from the scenario (or legacy `cost`).
  const costFor = (body: WorkflowBody): number => {
    const spec: CostSpec | undefined = gen.costPerGen ?? legacyCost;
    return typeof spec === 'function' ? spec(body) : (spec ?? legacyCost);
  };

  const latencyFor = (): number => {
    const l = gen.latencyMs;
    if (l === undefined) return 0;
    if (Array.isArray(l)) {
      const [min, max] = l;
      return Math.round(min + Math.random() * Math.max(0, max - min));
    }
    return l;
  };

  const imagesFor = (workflowId: string, body: WorkflowBody): string[] => {
    if (gen.images) return typeof gen.images === 'function' ? gen.images(body) : gen.images;
    if (gen.image) return [typeof gen.image === 'function' ? gen.image(body) : gen.image];
    // Default synthetic result: prominently labeled MOCK so a first-run dev in
    // `dev:harness` can't mistake the scaffold's placeholder for a real (or
    // broken) generation. "MOCK" is the dominant line; the short workflow id
    // keeps per-gen uniqueness. (`%0A` is a newline in placehold.co's text.)
    return [
      `https://placehold.co/512x512/1971c2/ffffff/png?text=MOCK%0A${encodeURIComponent(
        workflowId.slice(-4),
      )}`,
    ];
  };

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
    // body + cost remembered per workflow so the succeeded snapshot can echo them.
    const workflows = new Map<string, { polls: number; cost: number; body: WorkflowBody }>();
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const dispatchToBlock = (data: unknown) => {
      win.dispatchEvent(new MessageEvent('message', { data, origin: parentOrigin }));
    };
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
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

    const succeededSnapshot = (workflowId: string) => {
      const wf = workflows.get(workflowId);
      const cost = wf?.cost ?? legacyCost;
      const body = wf?.body ?? ({} as WorkflowBody);
      return {
        workflowId,
        status: 'succeeded' as const,
        cost: { total: cost },
        imageUrls: imagesFor(workflowId, body),
      };
    };

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
            body?: WorkflowBody;
            key?: string;
            value?: unknown;
            prefix?: string;
            limit?: number;
            cursor?: string;
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
            after(0, () => {
              dispatchToBlock({ type: 'TOKEN_REFRESH', payload: { token: nextToken() } });
            });
            return;
          }

          case 'REQUEST_SIGN_IN':
            // The real host opens its login UI; nothing to reply.
            return;

          case 'ESTIMATE_WORKFLOW': {
            const body = typed.payload?.body ?? ({} as WorkflowBody);
            dispatchToBlock({
              type: 'ESTIMATE_RESULT',
              payload: {
                requestId,
                snapshot: {
                  workflowId: 'wf_estimate',
                  status: 'pending',
                  cost: { total: costFor(body) },
                },
              },
            });
            return;
          }

          case 'SUBMIT_WORKFLOW': {
            submitCount += 1;
            const body = typed.payload?.body ?? ({} as WorkflowBody);
            const cost = costFor(body);

            // Insufficient-Buzz path: legacy failMode, the buzz scenario's
            // force flag, OR a simulated balance that can't cover this gen.
            const balanceSimulated = typeof buzz.balance === 'number';
            const insufficient =
              failMode === 'all' ||
              failMode === 'insufficient' ||
              buzz.insufficient === true ||
              (balanceSimulated && (buzz.balance as number) < cost);

            // Generic generation failure: failNext countdown, failRate dice, or
            // the legacy 'some' (~1 in 3) mode.
            let genericFail = false;
            if (!insufficient) {
              if ((gen.failNext ?? 0) > 0) {
                gen.failNext = (gen.failNext as number) - 1;
                genericFail = true;
              } else if (typeof gen.failRate === 'number' && Math.random() < gen.failRate) {
                genericFail = true;
              } else if (failMode === 'some' && submitCount % 3 === 0) {
                genericFail = true;
              }
            }

            if (insufficient) {
              dispatchToBlock({
                type: 'WORKFLOW_SUBMITTED',
                payload: {
                  requestId,
                  snapshot: {
                    workflowId: `wf_fail_${submitCount}`,
                    status: 'failed',
                    error: INSUFFICIENT_BUZZ_ERROR,
                  },
                },
              });
              return;
            }
            if (genericFail) {
              dispatchToBlock({
                type: 'WORKFLOW_SUBMITTED',
                payload: {
                  requestId,
                  snapshot: {
                    workflowId: `wf_fail_${submitCount}`,
                    status: 'failed',
                    error: GENERIC_GEN_ERROR,
                  },
                },
              });
              return;
            }

            // Success path: debit the simulated balance + remember body/cost.
            if (balanceSimulated) buzz.balance = (buzz.balance as number) - cost;
            const workflowId = `wf_${submitCount}_${Date.now()}`;
            workflows.set(workflowId, { polls: 0, cost, body });
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
            if (polls >= pollsUntilDone) {
              // Apply synthetic latency on the terminal (succeeded) poll only.
              const delay = latencyFor();
              if (delay > 0) {
                after(delay, () =>
                  dispatchToBlock({
                    type: 'WORKFLOW_STATUS',
                    payload: { requestId, snapshot: succeededSnapshot(workflowId) },
                  }),
                );
              } else {
                dispatchToBlock({
                  type: 'WORKFLOW_STATUS',
                  payload: { requestId, snapshot: succeededSnapshot(workflowId) },
                });
              }
            } else {
              dispatchToBlock({
                type: 'WORKFLOW_STATUS',
                payload: { requestId, snapshot: { workflowId, status: 'processing' as const } },
              });
            }
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

          case 'OPEN_BUZZ_PURCHASE': {
            // Refill the simulated balance so the post-top-up retry succeeds.
            const newBalance = typeof buzz.balance === 'number' ? buzz.balance + 1000 : 1000;
            if (typeof buzz.balance === 'number') buzz.balance = newBalance;
            buzz.insufficient = false;
            dispatchToBlock({
              type: 'BUZZ_PURCHASE_RESULT',
              payload: { requestId, purchased: true, newBalance },
            });
            return;
          }

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

          // ---- Civitai Apps KV datastore (W4) — in-memory backend ----
          case 'APP_STORAGE_GET': {
            const key = typed.payload?.key ?? '';
            const row = store.get(key);
            dispatchToBlock({
              type: 'APP_STORAGE_GET_RESULT',
              payload: { requestId, value: row ? row.value : null },
            });
            return;
          }

          case 'APP_STORAGE_SET': {
            const key = typed.payload?.key ?? '';
            const value = typed.payload?.value;
            if (storageFailNext > 0) {
              storageFailNext -= 1;
              dispatchToBlock({
                type: 'APP_STORAGE_SET_RESULT',
                payload: { requestId, ok: false, error: 'STORAGE_UNAVAILABLE' },
              });
              return;
            }
            const sizeBytes = jsonByteSize(value);
            if (sizeBytes > valueCapBytes) {
              dispatchToBlock({
                type: 'APP_STORAGE_SET_RESULT',
                payload: { requestId, ok: false, error: 'PAYLOAD_TOO_LARGE' },
              });
              return;
            }
            // Quota check: projected usage after this upsert.
            const existing = store.get(key);
            const existingBytes = existing ? jsonByteSize(existing.value) + key.length : 0;
            const projected = usedBytes() - existingBytes + sizeBytes + key.length;
            if (projected > quotaBytes) {
              dispatchToBlock({
                type: 'APP_STORAGE_SET_RESULT',
                payload: { requestId, ok: false, error: 'PAYLOAD_TOO_LARGE' },
              });
              return;
            }
            store.set(key, { value, updatedAt: new Date().toISOString() });
            dispatchToBlock({
              type: 'APP_STORAGE_SET_RESULT',
              payload: { requestId, ok: true, sizeBytes },
            });
            return;
          }

          case 'APP_STORAGE_DELETE': {
            const key = typed.payload?.key ?? '';
            if (storageFailNext > 0) {
              storageFailNext -= 1;
              dispatchToBlock({
                type: 'APP_STORAGE_DELETE_RESULT',
                payload: { requestId, ok: false, deleted: false, error: 'STORAGE_UNAVAILABLE' },
              });
              return;
            }
            const had = store.delete(key);
            dispatchToBlock({
              type: 'APP_STORAGE_DELETE_RESULT',
              payload: { requestId, ok: true, deleted: had },
            });
            return;
          }

          case 'APP_STORAGE_LIST': {
            const prefix = typed.payload?.prefix ?? '';
            const limit = typed.payload?.limit ?? 100;
            const cursor = typed.payload?.cursor;
            // Cursor = base64 of the last returned key (matches the hook's
            // documented `nextCursor` contract).
            const afterKey = cursor ? safeAtob(cursor) : undefined;
            const allKeys = [...store.entries()]
              .filter(([k]) => k.startsWith(prefix))
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
            const startIdx = afterKey
              ? allKeys.findIndex(([k]) => k > afterKey)
              : 0;
            const slice = (startIdx < 0 ? [] : allKeys.slice(startIdx)).slice(0, limit);
            const keys = slice.map(([key, row]) => ({ key, updatedAt: row.updatedAt }));
            const last = slice[slice.length - 1]?.[0];
            const hasMore =
              last !== undefined &&
              allKeys.findIndex(([k]) => k === last) < allKeys.length - 1;
            dispatchToBlock({
              type: 'APP_STORAGE_LIST_RESULT',
              payload: {
                requestId,
                keys,
                ...(hasMore && last ? { nextCursor: safeBtoa(last) } : {}),
              },
            });
            return;
          }

          case 'APP_STORAGE_QUOTA': {
            dispatchToBlock({
              type: 'APP_STORAGE_QUOTA_RESULT',
              payload: {
                requestId,
                usedBytes: usedBytes(),
                rowCount: store.size,
                limitBytes: quotaBytes,
                limitRows,
              },
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

    // Merge theme into the init context.
    const baseContext: BlockContext = options.context ?? { slotId: 'app.page' };
    const context: BlockContext = { ...baseContext, theme };

    // Color-domain maturity (civitai #2670). Resolve the ceiling by precedence:
    // explicit maxBrowsingLevel > maturity convenience > domain-derived. Only
    // EMIT a field when the corresponding option was set, so the default mock
    // host stays a #2670-predating host (the hook fail-closes to SFW).
    const resolvedCeiling: number | undefined =
      options.maxBrowsingLevel !== undefined
        ? options.maxBrowsingLevel
        : options.maturity === 'sfw'
          ? SFW_LEVELS
          : options.maturity === 'mature'
            ? ALL_LEVELS
            : options.domain !== undefined
              ? options.domain === 'red'
                ? ALL_LEVELS
                : SFW_LEVELS
              : undefined;

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
      ...(options.domain !== undefined ? { domain: options.domain } : {}),
      ...(resolvedCeiling !== undefined ? { maxBrowsingLevel: resolvedCeiling } : {}),
    };

    after(0, () => dispatchToBlock({ type: 'BLOCK_INIT', payload: initPayload }));

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

  function setScenario(patch: MockHostScenarioPatch): void {
    if (patch.failMode !== undefined) failMode = patch.failMode;
    if (patch.pollsUntilDone !== undefined) pollsUntilDone = patch.pollsUntilDone;
    if (patch.cost !== undefined) legacyCost = patch.cost;
    if (patch.cannedPicks !== undefined) cannedPicks = patch.cannedPicks;
    if (patch.generation !== undefined) gen = { ...gen, ...patch.generation };
    if (patch.buzz !== undefined) buzz = { ...buzz, ...patch.buzz };
    if (patch.storage !== undefined) {
      // Only the live-tunable storage knob (`failNext`) is applied mid-session;
      // seed/quota are install-time (re-install to change the backing store).
      if (patch.storage.failNext !== undefined) storageFailNext = patch.storage.failNext;
    }
  }

  const buzzHandle: MockBuzzHandle = {
    getBalance: () => buzz.balance,
    setBalance: (n) => {
      buzz.balance = n;
    },
  };

  return { install, setScenario, buzz: buzzHandle };
}

/** btoa/atob that work in both browser + node (happy-dom + vitest). */
function safeBtoa(s: string): string {
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(s, 'utf-8').toString('base64');
}
function safeAtob(s: string): string {
  if (typeof atob === 'function') return atob(s);
  return Buffer.from(s, 'base64').toString('utf-8');
}
