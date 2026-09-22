/**
 * The relationship between the ROOT barrel and the published subpaths, stated
 * as a ledger and asserted (#377).
 *
 * WHY THIS EXISTS. `src/index.ts` is five lines, so nothing in the repo could
 * say what it was FOR. Measured at `f913811`: the root exposed 68 symbols, 65
 * of them also reachable from a subpath and 3 — `OAuthTokens`,
 * `OAuthTokenResponse`, `OAuthClientConfig` — reachable from the root ONLY,
 * because `index.ts` re-exported `src/types.ts` directly and no subpath did.
 * Nothing decided that; it fell out of which file happened to be re-exported
 * where. `./oauth` now re-exports `types.ts`, so the root is exactly the union
 * of its four aggregated subpaths and this test can pin it.
 *
 * WHAT IT ASSERTS:
 *
 *  1. `package.json#exports` and `ENTRY_POINTS` name the same keys. Fails when
 *     the set GROWS *or* SHRINKS — a new subpath cannot ship without a stated
 *     reason to exist, and a deleted one cannot leave a stale reason behind.
 *  2. Every entry carries a non-empty `reason`.
 *  3. The root's symbol set EQUALS the union of the `inRoot: true` entries,
 *     in both directions. This is the invariant #377 asked for: no symbol is
 *     reachable from exactly one of {root, subpath} by accident.
 *  4. Every `inRoot: false` entry's overlap with the root is exactly its
 *     declared `sharedWithRoot` — an explicit ledger of the known name
 *     collisions, each with its own reason, rather than a blanket "no overlap"
 *     that would go red on a deliberate one.
 *  5. `exports[key].types` / `.import` are the mechanical `dist` twin of the
 *     `src` file this test read, so measuring `src` is a claim about what
 *     ships. (It has to measure `src`: a test that needs `dist` is a test that
 *     silently passes on a stale build.)
 *
 * WHAT IT DOES NOT ASSERT. That a subpath has CONSUMERS. It cannot: this
 * package is published, and `git grep` sees none of the apps that install it.
 * `./oauth` has zero import sites in this repo and `./cookies` has exactly one
 * (`starters/next-app/scripts/probe-expired-session.mjs`) — that is an argument
 * for documenting them, not for deleting them. Removing a published export
 * costs a major under semver, and pre-1.0 a minor breaks too.
 *
 * WATCHED TO FAIL: at `f913811` assertion (3) reported
 * `root has 3 symbols no aggregated subpath exports: OAuthClientConfig,
 * OAuthTokenResponse, OAuthTokens`. The positive controls at the bottom keep
 * that ability observable.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');

interface EntryPoint {
  /** Path under `src/`, without extension. `exports` must point at its `dist` twin. */
  src: string;
  /** Is this subpath's surface re-exported from the root barrel? */
  inRoot: boolean;
  /** Names the root shares with this subpath despite `inRoot: false`. */
  sharedWithRoot?: Record<string, string>;
  /** Why this key is published at all — and, when `inRoot: false`, why it is not on the root. */
  reason: string;
}

/**
 * 🔴 ONE ENTRY PER `exports` KEY, EACH WITH A REASON. The JSON-schema key is
 * excluded below because it publishes a file, not a module surface.
 */
const ENTRY_POINTS: Record<string, EntryPoint> = {
  '.': {
    src: 'index',
    inRoot: true,
    reason:
      'The aggregate of the four browser-and-server-safe OAuth-app subpaths, and nothing else. ' +
      'What an app that does the Authorization-Code flow imports.',
  },
  './oauth': {
    src: 'oauth/index',
    inRoot: true,
    reason:
      'The OAuth flow (PKCE, authorize URL, token exchange/refresh/revoke, fetchMe) plus the ' +
      'token/config types those functions return, so a consumer of this subpath alone can name ' +
      'its own return types. Zero import sites in THIS repo; the package is published.',
  },
  './scopes': {
    src: 'scopes/index',
    inRoot: true,
    reason:
      'Scope bitmask helpers. Imported directly by starters that need the named flags without ' +
      'pulling the OAuth functions.',
  },
  './cookies': {
    src: 'cookies/index',
    inRoot: true,
    reason:
      'AES-256-GCM sealed-cookie sessions. One import site in this repo — ' +
      'starters/next-app/scripts/probe-expired-session.mjs imports it by specifier at runtime.',
  },
  './orchestrator': {
    src: 'orchestrator/index',
    inRoot: true,
    reason:
      'Workflow submit/estimate/poll, body builders and the WORKFLOW_STEP_TYPES catalog. The ' +
      'most-imported subpath in the repo after ./blocks.',
  },
  './orchestrator/steps': {
    src: 'orchestrator/steps',
    inRoot: false,
    reason:
      'NOT on the root: type-only, and its declarations name @civitai/client, an OPTIONAL peer. ' +
      'Folding it into the root would make that peer effectively mandatory for every consumer.',
  },
  './blocks': {
    src: 'blocks/index',
    inRoot: false,
    sharedWithRoot: {
      BuzzAccountType:
        'A SECOND, NARROWER declaration of the same name — the pools a block can see, versus the ' +
        'full Civitai set on ./oauth. Deliberate; see the note in src/blocks/types.ts. Renaming ' +
        'either is a breaking change.',
    },
    reason:
      'NOT on the root: importing it runs ./safe-storage for its side effect, and it is 119 ' +
      'symbols of Civitai-Apps contract that an OAuth app never touches. Disjoint audiences.',
  },
  './safe-storage': {
    src: 'safe-storage/index',
    inRoot: false,
    reason:
      'NOT on the root: its purpose IS the module side effect (`import ' +
      '"@civitai/app-sdk/safe-storage"`), and a side effect on the root barrel is not something ' +
      'a consumer can opt out of.',
  },
  './manifest': {
    src: 'manifest/index',
    inRoot: false,
    reason: 'NOT on the root: NODE ONLY — needs node:fs and the optional peer ajv.',
  },
  './vite': {
    src: 'vite/index',
    inRoot: false,
    reason: 'NOT on the root: NODE ONLY — optional peers ajv (runtime) and vite (types).',
  },
};

/** `exports` keys that publish a FILE rather than a module surface. */
const FILE_EXPORT_KEYS = ['./schemas/app-block/v1.json'];

/**
 * 🔴 THE ROOT'S PUBLISHED SURFACE, ENUMERATED — grows OR shrinks, this fails.
 *
 * The relationship assertions above are a claim about SHAPE, not about
 * CONTENT, and shape alone is walkable: deleting `export type * from
 * '../types.js'` from `src/oauth/index.ts` takes the same three symbols off
 * BOTH sides at once, so the root stays an exact union of its subpaths while
 * the package silently loses three published types. Measured — that mutation
 * survived every other assertion in this file.
 *
 * So the root is enumerated. `@civitai/app-sdk` is PUBLISHED and pre-1.0,
 * where a minor can break a consumer: adding a name here is a `minor` and
 * should be a deliberate line in the diff; removing one is a BREAKING change
 * and must never be an accident. Only the root is enumerated — it is the
 * specifier nearly every consumer imports, and the `inRoot` union above
 * propagates the guarantee to the four subpaths that compose it.
 */
const ROOT_SURFACE = [
  'BuildAuthorizeUrlOptions', 'BuildImageGenBodyOptions', 'BuildTextToImageBodyOptions',
  'BuildWorkflowBodyOptions', 'BuildWorkflowBodyStep', 'BuzzAccount', 'BuzzAccountType',
  'CookieAttributes', 'CreateOrchestratorClientOptions', 'DEFAULT_MODEL_AIR',
  'DEFAULT_ORCHESTRATOR_BASE_URL', 'DEFAULT_POLL_WAIT_SECONDS', 'ExchangeCodeOpts',
  'FetchBuzzAccountOpts', 'GenerateInput', 'GetWorkflowOptions', 'IMAGE_GEN_ENGINES',
  'ImageGenEngine', 'ImageGenInput', 'OAuthClientConfig', 'OAuthError', 'OAuthTokenResponse',
  'OAuthTokens', 'OrchestratorClient', 'OrchestratorError', 'OrchestratorWorkflowStatus',
  'Pkce', 'PollWorkflowOptions', 'RefreshTokenOpts', 'RevokeTokenOpts', 'TERMINAL_STATUSES',
  'TerminalStatus', 'TokenScope', 'TokenScopeKey', 'TokenScopePresetKey', 'TokenScopePresets',
  'TokenScopeValue', 'WORKFLOW_STEP_TYPES', 'WorkflowSnapshot', 'WorkflowStepType',
  'bitmaskFromScopes', 'buildAuthorizeUrl', 'buildImageGenBody', 'buildSetCookieHeader',
  'buildTextToImageBody', 'buildWorkflowBody', 'callOrchestrator', 'createOrchestratorClient',
  'estimateWorkflow', 'exchangeCode', 'extractImageUrls', 'fetchBuzzAccount', 'fetchMe',
  'generatePkce', 'generateState', 'getScopeLabel', 'getWorkflow', 'hasScope', 'isTerminal',
  'pollWorkflow', 'readCookie', 'refreshToken', 'revokeToken', 'scopesFromBitmask',
  'sealCookie', 'submitWorkflow', 'tokenScopeLabels', 'unsealCookie',
];

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Exported symbol names per entry point, read off `src/` through the
 * TypeScript API — which follows `export *` chains, where a text scan would
 * not.
 */
function measureSurface(entries: Record<string, EntryPoint>): Map<string, Set<string>> {
  const files = Object.values(entries).map((e) => join(PKG, 'src', `${e.src}.ts`));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    resolveJsonModule: true,
  });
  const checker = program.getTypeChecker();

  const out = new Map<string, Set<string>>();
  for (const [key, entry] of Object.entries(entries)) {
    const file = join(PKG, 'src', `${entry.src}.ts`);
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`entry point source not found: ${file}`);
    const symbol = checker.getSymbolAtLocation(source);
    if (!symbol) throw new Error(`${file} is not a module (no module symbol)`);
    out.set(key, new Set(checker.getExportsOfModule(symbol).map((s) => s.getName())));
  }
  return out;
}

function sorted(set: Iterable<string>): string[] {
  return [...set].sort();
}

interface Finding {
  kind: 'key-set' | 'missing-reason' | 'root-extra' | 'root-missing' | 'overlap' | 'dist-path';
  detail: string;
}

/**
 * The whole check as a pure function, so the positive controls can feed it a
 * surface that MUST produce findings.
 */
export function auditExportSurface(
  entries: Record<string, EntryPoint>,
  surface: Map<string, Set<string>>,
  exportsMap: Record<string, unknown>,
  fileExportKeys: string[],
): Finding[] {
  const findings: Finding[] = [];

  const declared = sorted(Object.keys(entries));
  const published = sorted(Object.keys(exportsMap).filter((k) => !fileExportKeys.includes(k)));
  if (JSON.stringify(declared) !== JSON.stringify(published)) {
    findings.push({
      kind: 'key-set',
      detail: `package.json#exports keys ${JSON.stringify(published)} != ledger keys ${JSON.stringify(declared)}`,
    });
  }

  for (const [key, entry] of Object.entries(entries)) {
    if (!entry.reason || entry.reason.trim().length < 40) {
      findings.push({ kind: 'missing-reason', detail: `${key} has no stated reason to exist` });
    }
    const target = exportsMap[key] as { types?: string; import?: string } | undefined;
    if (target) {
      const wantTypes = `./dist/${entry.src}.d.ts`;
      const wantImport = `./dist/${entry.src}.js`;
      if (target.types !== wantTypes || target.import !== wantImport) {
        findings.push({
          kind: 'dist-path',
          detail:
            `${key} publishes {types: ${target.types}, import: ${target.import}} but the ledger ` +
            `read src/${entry.src}.ts, whose dist twin is {${wantTypes}, ${wantImport}}`,
        });
      }
    }
  }

  const root = surface.get('.');
  if (!root) return findings;

  const aggregated = new Set<string>();
  for (const [key, entry] of Object.entries(entries)) {
    if (key === '.' || !entry.inRoot) continue;
    for (const name of surface.get(key) ?? []) aggregated.add(name);
  }

  const rootExtra = sorted([...root].filter((n) => !aggregated.has(n)));
  if (rootExtra.length > 0) {
    findings.push({
      kind: 'root-extra',
      detail: `root has ${rootExtra.length} symbols no aggregated subpath exports: ${rootExtra.join(', ')}`,
    });
  }
  const rootMissing = sorted([...aggregated].filter((n) => !root.has(n)));
  if (rootMissing.length > 0) {
    findings.push({
      kind: 'root-missing',
      detail: `${rootMissing.length} aggregated-subpath symbols are absent from the root: ${rootMissing.join(', ')}`,
    });
  }

  for (const [key, entry] of Object.entries(entries)) {
    if (key === '.' || entry.inRoot) continue;
    const overlap = sorted([...(surface.get(key) ?? [])].filter((n) => root.has(n)));
    const declaredOverlap = sorted(Object.keys(entry.sharedWithRoot ?? {}));
    if (JSON.stringify(overlap) !== JSON.stringify(declaredOverlap)) {
      findings.push({
        kind: 'overlap',
        detail:
          `${key} shares ${JSON.stringify(overlap)} with the root; the ledger declares ` +
          `${JSON.stringify(declaredOverlap)}`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// The assertions
// ---------------------------------------------------------------------------

const packageJson = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
};
const surface = measureSurface(ENTRY_POINTS);

describe('root barrel / subpath relationship (#377)', () => {
  it('measures a non-empty surface for every entry point', () => {
    // Positive control on the MEASUREMENT: a TypeScript program that failed to
    // resolve would hand back empty sets and every assertion below would pass
    // vacuously.
    for (const [key, names] of surface) {
      expect(names.size, `${key} measured 0 exported symbols`).toBeGreaterThan(0);
    }
  });

  it('holds the stated relationship', () => {
    const findings = auditExportSurface(
      ENTRY_POINTS,
      surface,
      packageJson.exports,
      FILE_EXPORT_KEYS,
    );
    const counts = [...surface].map(([k, v]) => `${k}=${v.size}`).join(' ');
    expect(findings.map((f) => `${f.kind}: ${f.detail}`), counts).toEqual([]);
  });

  it('keeps the root an exact union, not a superset or a subset', () => {
    // Spelled out separately from the ledger walk so the numbers appear in the
    // failure message rather than only the diff.
    const root = surface.get('.')!;
    const union = new Set<string>();
    for (const [key, entry] of Object.entries(ENTRY_POINTS)) {
      if (key === '.' || !entry.inRoot) continue;
      for (const n of surface.get(key)!) union.add(n);
    }
    expect(sorted(root)).toEqual(sorted(union));
  });

  it('publishes exactly the enumerated root surface — no additions, no removals', () => {
    // A removal here is a BREAKING change for every consumer importing
    // `@civitai/app-sdk`; an addition is a `minor`. Either way it belongs in
    // the diff and in the changeset, not in a green run.
    expect(sorted(surface.get('.')!)).toEqual([...ROOT_SURFACE].sort());
  });

  it('gives every published subpath a reason recorded next to the README that documents it', () => {
    // The ledger's reason is for maintainers; the README row is for consumers.
    // Both must exist, or "documented" is a claim nobody checks.
    const readme = readFileSync(join(PKG, 'README.md'), 'utf8');
    const undocumented = Object.keys(ENTRY_POINTS)
      .filter((k) => k !== '.')
      .filter((k) => !readme.includes(`@civitai/app-sdk${k.slice(1)}`));
    expect(undocumented).toEqual([]);
  });
});

describe('POSITIVE CONTROL — the checker can produce a non-zero count', () => {
  const base: Record<string, EntryPoint> = {
    '.': { src: 'index', inRoot: true, reason: 'x'.repeat(60) },
    './a': { src: 'a/index', inRoot: true, reason: 'x'.repeat(60) },
    './b': { src: 'b/index', inRoot: false, reason: 'x'.repeat(60) },
  };
  const exportsMap = {
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    './a': { types: './dist/a/index.d.ts', import: './dist/a/index.js' },
    './b': { types: './dist/b/index.d.ts', import: './dist/b/index.js' },
  };
  const ok = new Map<string, Set<string>>([
    ['.', new Set(['One', 'Two'])],
    ['./a', new Set(['One', 'Two'])],
    ['./b', new Set(['Three'])],
  ]);

  it('NEGATIVE CONTROL — a consistent surface produces nothing', () => {
    expect(auditExportSurface(base, ok, exportsMap, [])).toEqual([]);
  });

  it('reports the exact #377 shape: a symbol reachable from the root only', () => {
    const drifted = new Map(ok);
    drifted.set('.', new Set(['One', 'Two', 'OAuthTokens']));
    const findings = auditExportSurface(base, drifted, exportsMap, []);
    expect(findings.filter((f) => f.kind === 'root-extra')).toHaveLength(1);
    expect(findings[0].detail).toContain('OAuthTokens');
  });

  it('reports a symbol an aggregated subpath exports but the root does not', () => {
    const drifted = new Map(ok);
    drifted.set('./a', new Set(['One', 'Two', 'Three']));
    const findings = auditExportSurface(base, drifted, exportsMap, []);
    expect(findings.filter((f) => f.kind === 'root-missing')).toHaveLength(1);
  });

  it('reports an undeclared overlap between the root and a non-aggregated subpath', () => {
    const drifted = new Map(ok);
    drifted.set('./b', new Set(['Three', 'One']));
    const findings = auditExportSurface(base, drifted, exportsMap, []);
    expect(findings.filter((f) => f.kind === 'overlap')).toHaveLength(1);
  });

  it('reports a NEW exports key with no stated reason', () => {
    const findings = auditExportSurface(
      base,
      ok,
      { ...exportsMap, './c': { types: './dist/c.d.ts', import: './dist/c.js' } },
      [],
    );
    expect(findings.filter((f) => f.kind === 'key-set')).toHaveLength(1);
  });

  it('reports a REMOVED exports key whose reason is still in the ledger', () => {
    const { './b': _dropped, ...shrunk } = exportsMap;
    const findings = auditExportSurface(base, ok, shrunk, []);
    expect(findings.filter((f) => f.kind === 'key-set')).toHaveLength(1);
  });

  it('reports an entry whose reason is empty', () => {
    const findings = auditExportSurface(
      { ...base, './b': { ...base['./b'], reason: '' } },
      ok,
      exportsMap,
      [],
    );
    expect(findings.filter((f) => f.kind === 'missing-reason')).toHaveLength(1);
  });

  it('reports an exports target that is not the dist twin of the measured src file', () => {
    const findings = auditExportSurface(
      base,
      ok,
      { ...exportsMap, './b': { types: './dist/b.d.ts', import: './dist/b.js' } },
      [],
    );
    expect(findings.filter((f) => f.kind === 'dist-path')).toHaveLength(1);
  });
});
