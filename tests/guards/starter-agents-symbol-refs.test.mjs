/**
 * Guards the AGENT-FACING doc of `starters/civitai-block-starter` against the
 * two ways it has actually gone wrong: naming symbols that do not exist, and
 * quoting a hook COUNT that the package then outgrows.
 *
 * 🔴 THE STARTER IS NO LONGER REACT. It was converted in place to web
 * components on `@civitai/sdk` (no `@civitai/blocks-react`), so the symbols its
 * guide names are now `app.*` / `app.host.*` members of the SDK client, not
 * hooks. Check 2 was PORTED to that surface rather than deleted: it reads the
 * `AppClient`, `BlockAppClient` and `Host` interfaces out of the SDK source.
 * The original hook check is kept beside it, so a `useXxx` the guide names
 * (say, while pointing React users elsewhere) must still really exist.
 *
 * WHY THIS EXISTS
 * ===============
 * `starters/civitai-block-starter/AGENTS.md` is the file a scaffolding agent
 * reads to learn what the starter can do. On 2026-09-29 it said
 *
 *     `@civitai/blocks-react` for the eight hooks + the singleton `IframeTransport`
 *
 * while the version the starter's own package.json pinned exported **37**,
 * including `useGoodPurchase` / `useEntitlements` — the entire digital-goods
 * path. The pins admitted goods; nothing in the starter pointed at it, so for
 * an agent the capability did not exist. `tsc` sees nothing here: a doc claim
 * is not a code path, and neither is a count.
 *
 * WHAT IT PINS
 * ============
 *   1. NO HOOK COUNT. The doc may not quote "<N> hooks". A count is a claim
 *      about a set that grows every release; there is no way to keep one true,
 *      so the only durable rule is "enumerate, don't count". Pins the CLASS,
 *      not the stale number.
 *
 *   2. FORWARD — every `app.<member>` / `app.host.<member>` the doc names is
 *      really declared on `@civitai/sdk`'s `AppClient` / `BlockAppClient` /
 *      `Host`, and every `useXxx` it names is really exported by
 *      `@civitai/blocks-react`. A dead pointer in an agent guide is worse than
 *      no pointer: the agent writes a call that cannot resolve.
 *
 *   3. FORWARD — every scope-shaped token the doc names is really a value in
 *      `BLOCK_SCOPES`. `defineBlock` gates on MEMBERSHIP in that object, so a
 *      plausible-but-unknown scope is refused at build time.
 *
 *   4. DERIVED SET — every `goods:*` scope in `BLOCK_SCOPES` is named by the
 *      doc. Derived from the CODE, not from a typed list here, so it fails when
 *      the goods scope set GROWS (a new scope nobody documented) *and* when the
 *      doc loses the goods section (the regression this guard was written for).
 *
 * 🔴 KNOWN LIMITS, stated so nobody reads more into this than it carries:
 *   - It checks that every symbol the prose names EXISTS. It cannot check that
 *     the prose is TRUE — a bullet could describe `useGoodPurchase` completely
 *     wrongly and still pass.
 *   - Check 4 is scope-driven only. There is no mechanical link from a scope to
 *     the hook that uses it, so a future goods HOOK can ship undocumented
 *     without failing this. Widening it needs a real link, not a typed list.
 *   - It reads the WORKSPACE sources, not the published tarball the starter's
 *     caret pin resolves to. `scripts/smoke-published-starters.mjs` owns that
 *     direction; this one runs offline, with no install, in the required
 *     `Starter (<name>)` matrix job.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC_PATH = 'starters/civitai-block-starter/AGENTS.md';
const INDEX_PATH = 'packages/civitai-blocks-react/src/index.ts';
const SDK_APP_PATH = 'packages/civitai-sdk/src/app/index.ts';
const SDK_HOST_PATH = 'packages/civitai-sdk/src/host/index.ts';
const SCOPES_PATH = 'packages/civitai-app-sdk/src/blocks/scopes.ts';

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const doc = read(DOC_PATH);

/** Hook identifiers the doc names, in backticks: `useThing` / `useThing()`. */
function hooksNamedInDoc(text) {
  return new Set(Array.from(text.matchAll(/`(use[A-Z][A-Za-z0-9]*)/g), (m) => m[1]));
}

/** Scope-shaped tokens the doc names, in backticks: 3 or 4 lowercase segments. */
function scopesNamedInDoc(text) {
  return new Set(
    Array.from(text.matchAll(/`([a-z]+:[a-z]+:[a-z]+(?::[a-z]+)?)`/g), (m) => m[1]),
  );
}

/** Hook names re-exported by the blocks-react barrel. */
function exportedHooks(indexSrc) {
  return new Set(Array.from(indexSrc.matchAll(/\buse[A-Z][A-Za-z0-9]*/g), (m) => m[0]));
}

/**
 * Member names of `export interface <name> … { … }` in an SDK source file —
 * the top-level (two-space-indented) property and method names.
 */
function interfaceMembers(src, name) {
  const start = src.search(new RegExp(`^export interface ${name}\\b[^{]*\\{`, 'm'));
  assert.ok(start >= 0, `could not locate \`export interface ${name}\``);
  const end = src.indexOf('\n}', start);
  const body = src.slice(src.indexOf('{', start) + 1, end);
  return new Set(Array.from(body.matchAll(/^  (?:readonly\s+)?([a-zA-Z][A-Za-z0-9]*)\??\s*[(:<]/gm), (m) => m[1]));
}

/** `app.<member>` and `app.host.<member>` references inside backtick spans of the doc. */
function sdkMembersNamedInDoc(text) {
  const app = new Set();
  const host = new Set();
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    for (const m of span[1].matchAll(/\bapp\.(host\.)?([A-Za-z][A-Za-z0-9]*)/g)) {
      if (m[1]) host.add(m[2]);
      else app.add(m[2]);
    }
  }
  return { app, host };
}

function sdkSurface() {
  const appSrc = read(SDK_APP_PATH);
  const app = new Set([
    ...interfaceMembers(appSrc, 'AppClient'),
    ...interfaceMembers(appSrc, 'BlockAppClient'),
  ]);
  const host = interfaceMembers(read(SDK_HOST_PATH), 'Host');
  return { app, host };
}

/** Every value in the `BLOCK_SCOPES` object literal. */
function blockScopeValues(scopesSrc) {
  const body = scopesSrc.slice(
    scopesSrc.indexOf('export const BLOCK_SCOPES'),
    scopesSrc.indexOf('} as const;'),
  );
  assert.ok(body.length > 0, `could not locate the BLOCK_SCOPES literal in ${SCOPES_PATH}`);
  return new Set(Array.from(body.matchAll(/^\s+[A-Z0-9_]+:\s*'([^']+)'/gm), (m) => m[1]));
}

// Positive controls on the parsers themselves. A reassuring "0 violations" is
// indistinguishable from a matcher wired to nothing, so assert each extractor
// finds a non-trivial set before trusting any emptiness below.
//
// The size floors alone are NOT enough and that was measured, not assumed: with
// only `scopes.size >= 10` against a 15-entry object, a mutation that broke ONE
// entry's quoting left the control GREEN — a floor set well below the real size
// cannot see a partial parse break. Each extractor therefore also asserts an
// ANCHOR symbol it must always find, which a total break loses outright.
test('the extractors actually match something (positive control)', () => {
  const hooks = exportedHooks(read(INDEX_PATH));
  const scopes = blockScopeValues(read(SCOPES_PATH));
  assert.ok(hooks.size >= 20, `blocks-react barrel parse found only ${hooks.size} hooks`);
  assert.ok(scopes.size >= 10, `BLOCK_SCOPES parse found only ${scopes.size} scopes`);
  assert.ok(hooks.has('useBlockContext'), 'blocks-react barrel parse lost its anchor hook');
  assert.ok(scopes.has('models:read:self'), 'BLOCK_SCOPES parse lost its anchor scope');
  // The hook extractor no longer has a positive control against the DOC (the
  // guide legitimately names no hooks now) — it keeps one against the barrel
  // above and against a literal here.
  assert.deepEqual([...hooksNamedInDoc('call `useBlockContext()` and `useThing`')], ['useBlockContext', 'useThing']);
  const sdk = sdkSurface();
  for (const anchor of ['site', 'storage', 'orchestration', 'getToken', 'host', 'viewer', 'onChange']) {
    assert.ok(sdk.app.has(anchor), `@civitai/sdk client parse lost its anchor member \`${anchor}\``);
  }
  for (const anchor of ['autoResize', 'openResourcePicker', 'publishGenerationOutputs']) {
    assert.ok(sdk.host.has(anchor), `@civitai/sdk Host parse lost its anchor member \`${anchor}\``);
  }
  const named = sdkMembersNamedInDoc(doc);
  assert.ok(named.app.size >= 5, `${DOC_PATH} names only ${named.app.size} \`app.*\` members — parser or doc broken`);
  assert.ok(named.host.size >= 1, `${DOC_PATH} names no \`app.host.*\` member — parser or doc broken`);
  assert.ok(scopesNamedInDoc(doc).size > 0, `${DOC_PATH} names no scopes — parser or doc broken`);
});

test('every app.* / app.host.* member the doc names exists on the @civitai/sdk client', () => {
  const sdk = sdkSurface();
  const named = sdkMembersNamedInDoc(doc);
  const missing = [
    ...[...named.app].filter((m) => !sdk.app.has(m)).map((m) => `app.${m}`),
    ...[...named.host].filter((m) => !sdk.host.has(m)).map((m) => `app.host.${m}`),
  ].sort();
  assert.deepEqual(
    missing,
    [],
    `${DOC_PATH} names member(s) the @civitai/sdk client does not declare ` +
      `(${SDK_APP_PATH} AppClient/BlockAppClient, ${SDK_HOST_PATH} Host): ${missing.join(', ')}`,
  );
});

test('the doc does not quote a hook COUNT', () => {
  const COUNT_WORD =
    /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty)[- ](?:\w+[- ])?hooks\b/i;
  // A count inside DOUBLE QUOTES is a historical quotation, not a live claim —
  // the rule's own explanation has to be able to quote the stale sentence it is
  // warning about. Exempt it MECHANICALLY (strip quoted spans, then test) rather
  // than by allow-listing the exact wording: an allow-listed phrase stops
  // matching the moment someone rewords the explanation, and the guard then
  // fires on the line that is teaching the rule.
  const offenders = doc
    .split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => COUNT_WORD.test(line.replace(/"[^"]*"/g, ' ')));
  assert.deepEqual(
    offenders,
    [],
    `${DOC_PATH} quotes a hook count. The hook set grows every release — say "the block hooks" and tell the reader to enumerate:\n` +
      offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n'),
  );
});

test('every hook the doc names is exported by @civitai/blocks-react', () => {
  const exported = exportedHooks(read(INDEX_PATH));
  const missing = [...hooksNamedInDoc(doc)].filter((h) => !exported.has(h)).sort();
  assert.deepEqual(
    missing,
    [],
    `${DOC_PATH} names hook(s) that ${INDEX_PATH} does not export: ${missing.join(', ')}`,
  );
});

test('every scope the doc names is a real BLOCK_SCOPES value', () => {
  const known = blockScopeValues(read(SCOPES_PATH));
  const missing = [...scopesNamedInDoc(doc)].filter((s) => !known.has(s)).sort();
  assert.deepEqual(
    missing,
    [],
    `${DOC_PATH} names scope(s) absent from BLOCK_SCOPES in ${SCOPES_PATH}: ${missing.join(', ')}. ` +
      `defineBlock gates on membership, so these are refused at build time.`,
  );
});

test('every goods:* scope in BLOCK_SCOPES is documented in the starter guide', () => {
  const goodsScopes = [...blockScopeValues(read(SCOPES_PATH))].filter((s) =>
    s.startsWith('goods:'),
  );
  assert.ok(goodsScopes.length > 0, 'BLOCK_SCOPES has no goods:* scope — derive-from-code broke');
  const named = scopesNamedInDoc(doc);
  const undocumented = goodsScopes.filter((s) => !named.has(s)).sort();
  assert.deepEqual(
    undocumented,
    [],
    `${DOC_PATH} does not mention goods scope(s): ${undocumented.join(', ')}. ` +
      `The digital-goods path is only reachable to a scaffolding agent if the starter guide names it.`,
  );
});
