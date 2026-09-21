/**
 * Guards the App Storage rejection STRINGS: every error a mock host can put on
 * an `APP_STORAGE_*_RESULT` must be one the real host can produce.
 *
 * WHY THIS EXISTS
 * ===============
 * The host's router throws a `TRPCError` carrying BOTH a
 * `code: 'PAYLOAD_TOO_LARGE'` and a per-site `message`; the bridge
 * (`IframeHost.tsx:282`) forwards **`err.message`** and never the code. So
 * `PAYLOAD_TOO_LARGE` is a string no block can ever receive — and
 * `createMockHost`, the `kv-storage` harness, the contract doc on
 * `APP_STORAGE_SET_RESULT` and the example's only error branch all said it was
 * THE string, for three releases. A block that branched on it took the
 * actionable arm under `dev:mock` and the generic arm in production, and
 * nothing in any build, test or type-check could see the difference.
 * civitai/civitai-app-starters#343.
 *
 * WHAT IT PINS
 * ============
 * 🔴 **THE POSITIVE CLAIM, NOT THE ABSENCE OF ONE WORD.** "the file contains no
 * literal `PAYLOAD_TOO_LARGE`" is a guard spelled rather than structural: it
 * passes for any OTHER invented string, which is the same bug with different
 * letters. What is asserted instead is membership — every rejection a scanned
 * mock emits resolves to a constant exported by
 * `packages/civitai-app-sdk/src/blocks/appStorageErrors.ts`, whose values are
 * the measured host messages.
 *
 * Two halves, and both are needed:
 *   A. a STRING LITERAL in an `error:` position is refused outright — that is
 *      the hand-typed case, in its own words;
 *   B. what remains must NAME an exported constant, so a locally-invented
 *      identifier fails too.
 *
 * The module's own values are checked by EXECUTING it (see `loadErrorsModule`),
 * not by re-reading its literals: the per-value message is a template derived
 * from `APP_STORAGE_MAX_VALUE_BYTES`, so a text scan would have to re-implement
 * the derivation it is supposed to be checking.
 *
 * 🔴 KNOWN LIMITS — read before trusting a green.
 *   - Scoped to `APP_STORAGE_*_RESULT`. The SHARED datastore (`SHARED_*`) is a
 *     different protocol served by different host procedures, and its strings
 *     have NOT been measured; `SHARED_UNAVAILABLE` and friends are deliberately
 *     out of scope, not vouched for.
 *   - `internal/liveHost.ts` is deliberately NOT in `MOCKS`, and that is not an
 *     omission: it is not a mock. Its `APP_STORAGE_SET_RESULT` error arm
 *     forwards `r.error` — the string the real server sent — so there is no
 *     spelling of its own to check, and the membership rule below would fail it
 *     for doing exactly the right thing.
 *   - Local `const` resolution is ONE level deep. A rejection built through two
 *     locals is not followed — it fails the membership check rather than
 *     passing, which is the safe direction, but the message will point at the
 *     wrong thing.
 *   - It cannot tell whether the SDK's strings still match the host. Nothing
 *     offline can. Re-run the commands in `appStorageErrors.ts` when the host
 *     changes; `tests/guards/app-storage-mock-divergences.test.mjs` is the
 *     ledger of known mock/host differences.
 *   - It says nothing about the mock's BEHAVIOUR — which gate answers which
 *     string. That is
 *     `packages/civitai-blocks-react/test/mockHostScenarios.test.tsx`, which
 *     drives `createMockHost` past each ceiling and asserts the three distinct
 *     messages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ERRORS_MODULE = 'packages/civitai-app-sdk/src/blocks/appStorageErrors.ts';

/**
 * Every mock host in this repository that answers the `APP_STORAGE_*`
 * protocol, with the number of REJECTION sites each carries.
 *
 * The count is an asserted ledger, not a floor. A site that silently
 * disappears takes its check with it and reads as a pass; a site that appears
 * unnoticed is exactly how the third `PAYLOAD_TOO_LARGE` got added after the
 * first two were reviewed. Change these numbers deliberately, in the same
 * commit as the code.
 */
const MOCKS = [
  { file: 'packages/civitai-blocks-react/src/internal/mockHost.ts', rejections: 5 },
  { file: 'starters/examples/kv-storage/src/Harness.tsx', rejections: 1 },
];

// ---------------------------------------------------------------------------
// Loading the real module.
//
// `pnpm test:guards` runs in the required `Starter` job BEFORE `pnpm install`
// (.github/workflows/ci.yml), so there is no `node_modules` and no bundler.
// Node strips the types itself; the only thing missing is TypeScript's
// `./x.js` -> `./x.ts` specifier rewrite, which this resolve hook supplies in
// a dozen lines and zero dependencies.
// ---------------------------------------------------------------------------

/**
 * Import the errors module and hand back its namespace.
 *
 * 🔴 Throws — never skips — when the runtime is too old for `registerHooks`
 * (Node >= 22.15). A skipped guard is a silent pass, which is the failure mode
 * this whole file is about. CI pins Node 24.
 */
async function loadErrorsModule() {
  assert.equal(
    typeof registerHooks,
    'function',
    `this guard executes ${ERRORS_MODULE} through node:module's registerHooks, which needs\n` +
      `Node >= 22.15 (CI pins 24, see .github/workflows/ci.yml NODE_VERSION). Upgrade Node —\n` +
      `this must not be skipped: the whole point is that a text scan cannot check a derived\n` +
      `string.`,
  );
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && specifier.endsWith('.js')) {
        try {
          const resolved = nextResolve(specifier, context);
          if (existsSync(fileURLToPath(resolved.url))) return resolved;
        } catch {
          // fall through to the .ts rewrite below
        }
        return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
      }
      return nextResolve(specifier, context);
    },
  });
  return import(pathToFileURL(join(REPO_ROOT, ERRORS_MODULE)).href);
}

const errors = await loadErrorsModule();

/** `{ name -> value }` for every `APP_STORAGE_ERROR_*` string the module exports. */
const EXPORTED_MESSAGES = Object.fromEntries(
  Object.entries(errors).filter(
    ([name, value]) => /^APP_STORAGE_ERROR_/.test(name) && typeof value === 'string',
  ),
);

// ---------------------------------------------------------------------------
// Extracting what a mock emits. Pure functions, exported for the controls.
// ---------------------------------------------------------------------------

/**
 * Every `APP_STORAGE_*_RESULT` dispatch in `source` whose payload carries an
 * `error`, as `{ line, messageType, expr }` — `expr` being the raw source of
 * the `error:` value.
 *
 * The payload body is read by BALANCING BRACES from the opening `{`, not by a
 * `[^}]*` class: a nested object in a payload would truncate the latter and
 * silently drop the `error` after it.
 */
export function rejectionSitesOf(source) {
  const sites = [];
  // `[^{}]*?` between the type and the payload so a match can never leap over
  // an intervening object literal into a later dispatch. Comments sit there.
  const opener = /type:\s*'(APP_STORAGE_[A-Z_]+_RESULT)',[^{}]*?payload:\s*\{/g;
  let m;
  while ((m = opener.exec(source))) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') depth -= 1;
      i += 1;
    }
    const body = source.slice(start, i - 1);
    const err = /(?:^|[\s,{])error:\s*([^,}\n]+)/.exec(body);
    if (!err) continue;
    sites.push({
      line: source.slice(0, m.index).split('\n').length,
      messageType: m[1],
      expr: err[1].trim(),
    });
  }
  return sites;
}

/**
 * Expand a bare local identifier to `name = <its initializer>` so a rejection
 * routed through one local `const` is judged on what that const holds. Any
 * other expression is returned unchanged.
 *
 * ONE level, deliberately: deeper indirection fails the membership check
 * instead of being followed, which errs toward red.
 */
export function expandLocal(source, expr) {
  if (!/^[A-Za-z_$][\w$]*$/.test(expr)) return expr;
  const decl = new RegExp(`\\bconst\\s+${expr}\\s*=\\s*([\\s\\S]*?);`).exec(source);
  return decl ? `${expr} = ${decl[1]}` : expr;
}

/**
 * Judge one rejection expression against the exported set.
 *
 * Returns `{ ok: true, names }` or `{ ok: false, why }`. Pure, so the controls
 * below can feed it the shapes that must fail without touching a real file.
 */
export function judgeRejection(expr, exported) {
  const literal = /'([^']*)'|"([^"]*)"|`([^`]*)`/.exec(expr);
  if (literal) {
    return {
      ok: false,
      why:
        `a hand-typed string literal (${literal[0]}) is the rejection. The host does not send\n` +
        `        strings this repository invents — it sends its own TRPCError MESSAGE, and the six it\n` +
        `        can send are exported from ${ERRORS_MODULE}.\n` +
        `        Import one (see APP_STORAGE_HOST_ERROR_MESSAGES) instead of typing it here.`,
    };
  }
  const names = (expr.match(/\b[A-Za-z_$][\w$]*\b/g) ?? []).filter((n) =>
    Object.hasOwn(exported, n),
  );
  if (names.length === 0) {
    return {
      ok: false,
      why:
        `nothing in this expression names a constant exported by ${ERRORS_MODULE}.\n` +
        `        Every storage rejection a mock emits has to be drawn from that module, so the mock\n` +
        `        and any block matcher share ONE spelling of each host message.`,
    };
  }
  const notMessages = names.filter((n) => !errors.isAppStorageHostErrorMessage(exported[n]));
  if (notMessages.length > 0) {
    return {
      ok: false,
      why:
        `${notMessages.join(', ')} is exported but its value is not a message the host can\n` +
        `        produce (isAppStorageHostErrorMessage said no).`,
    };
  }
  return { ok: true, names };
}

// ---------------------------------------------------------------------------
// Controls. A verdict from an instrument nobody validated is a claim about the
// instrument.
// ---------------------------------------------------------------------------

test('CONTROL — the errors module really loaded, and carries the measured set', () => {
  // A zero from the sweeps below is worthless if this object is empty.
  assert.ok(
    Object.keys(EXPORTED_MESSAGES).length >= 6,
    `only ${Object.keys(EXPORTED_MESSAGES).length} APP_STORAGE_ERROR_* strings loaded from\n` +
      `${ERRORS_MODULE} — the import resolved to something, but not to the module this guard\n` +
      `is about.`,
  );
  // The per-value message is DERIVED, so prove the derivation is live rather
  // than a literal that happens to read correctly: feed the builder a cap the
  // constant cannot equal and watch the output move.
  const moved = errors.appStorageValueTooLargeMessage(128 * 1024);
  assert.notEqual(
    moved,
    errors.APP_STORAGE_ERROR_VALUE_TOO_LARGE,
    `appStorageValueTooLargeMessage() ignores its argument — the per-value message is a\n` +
      `hardcoded string wearing a function. It must be built from the cap, or it silently\n` +
      `stops matching the host the day the cap moves.`,
  );
  assert.ok(errors.isAppStorageHostErrorMessage(moved), 'a moved cap must still classify');
  assert.equal(
    errors.APP_STORAGE_ERROR_VALUE_TOO_LARGE,
    errors.appStorageValueTooLargeMessage(),
    'the exported constant must BE the builder applied to the SDK cap',
  );
});

test('CONTROL — no host message is a substring of another', () => {
  // `classifyAppStorageError` matches by CONTAINMENT and returns on the first
  // hit, so an overlap would silently mis-route one reason to another.
  const all = Object.values(EXPORTED_MESSAGES);
  for (const a of all) {
    for (const b of all) {
      if (a === b) continue;
      assert.ok(
        !a.includes(b),
        `"${b}" is a substring of "${a}" — containment matching can no longer tell them apart.`,
      );
    }
  }
});

test('CONTROL — the classifier answers, and can say no', () => {
  assert.equal(errors.classifyAppStorageError(new Error('per-user row limit exceeded')), 'user-row-limit');
  assert.equal(errors.classifyAppStorageError('value exceeds 64KB cap'), 'value-too-large');
  // A host that moved its cap: still the same rejection site.
  assert.equal(errors.classifyAppStorageError('value exceeds 32KB cap'), 'value-too-large');
  // NEGATIVE: the code the mock used to send, and an unrelated string.
  assert.equal(errors.classifyAppStorageError('PAYLOAD_TOO_LARGE'), null);
  assert.equal(errors.classifyAppStorageError('STORAGE_UNAVAILABLE'), null);
  assert.equal(errors.classifyAppStorageError(undefined), null);
});

test('CONTROL — the site extractor finds rejections, and does not invent them', () => {
  // Shaped like the real file: a comment between `type:` and `payload:`, a
  // success dispatch that must NOT be reported, and a nested object in a
  // payload that a `[^}]*` reader would truncate on.
  const fixture = [
    "dispatchToBlock({",
    "  type: 'APP_STORAGE_SET_RESULT',",
    "  // a comment that sits between the type and the payload",
    "  payload: { requestId, ok: false, error: APP_STORAGE_ERROR_USER_ROW_LIMIT },",
    "});",
    "dispatchToBlock({",
    "  type: 'APP_STORAGE_SET_RESULT',",
    "  payload: { requestId, ok: true, sizeBytes },",
    "});",
    "dispatchToBlock({",
    "  type: 'APP_STORAGE_DELETE_RESULT',",
    "  payload: { requestId, meta: { nested: 1 }, ok: false, error: SOME_IDENT },",
    "});",
  ].join('\n');
  assert.deepEqual(
    rejectionSitesOf(fixture).map((s) => [s.messageType, s.expr]),
    [
      ['APP_STORAGE_SET_RESULT', 'APP_STORAGE_ERROR_USER_ROW_LIMIT'],
      ['APP_STORAGE_DELETE_RESULT', 'SOME_IDENT'],
    ],
    'the extractor must see both rejections, skip the success, and read past a nested object',
  );
  assert.deepEqual(rejectionSitesOf('nothing to see here'), []);
  // SHARED_* is another protocol and is deliberately not this guard's business.
  assert.deepEqual(
    rejectionSitesOf("type: 'SHARED_VOTE_RESULT',\npayload: { requestId, ok: false, error: 'NOT_FOUND' },"),
    [],
  );
});

test('CONTROL — the judge accepts a real constant and refuses every way of not using one', () => {
  assert.equal(judgeRejection('APP_STORAGE_ERROR_USER_ROW_LIMIT', EXPORTED_MESSAGES).ok, true);
  assert.equal(
    judgeRejection('cond ? APP_STORAGE_ERROR_VALUE_TOO_LARGE : APP_STORAGE_ERROR_USER_ROW_LIMIT', EXPORTED_MESSAGES)
      .ok,
    true,
    'a conditional over two exported constants is fine — the harness picks by gate',
  );

  // The exact regression, and three other spellings of it.
  for (const bad of [
    "'PAYLOAD_TOO_LARGE'",
    "'STORAGE_UNAVAILABLE'",
    '"anything a reviewer would not notice"',
    '`a template literal`',
  ]) {
    const verdict = judgeRejection(bad, EXPORTED_MESSAGES);
    assert.equal(verdict.ok, false, `${bad} must be refused`);
    assert.match(verdict.why, /hand-typed string literal/);
  }

  // A locally-invented identifier: no literal, still not a host message.
  const invented = judgeRejection('MY_OWN_ERROR', EXPORTED_MESSAGES);
  assert.equal(invented.ok, false);
  assert.match(invented.why, /names a constant exported by/);

  // And the one-level local expansion the harness relies on.
  const src = "const rejection = tooBig ? APP_STORAGE_ERROR_VALUE_TOO_LARGE : null;\nerror: rejection";
  assert.equal(judgeRejection(expandLocal(src, 'rejection'), EXPORTED_MESSAGES).ok, true);
  const badSrc = "const rejection = 'PAYLOAD_TOO_LARGE';";
  assert.equal(judgeRejection(expandLocal(badSrc, 'rejection'), EXPORTED_MESSAGES).ok, false);
});

// ---------------------------------------------------------------------------
// The guard.
// ---------------------------------------------------------------------------

test('every storage rejection a mock emits is drawn from the exported set (#343)', () => {
  for (const { file, rejections } of MOCKS) {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8');
    const sites = rejectionSitesOf(source);

    assert.equal(
      sites.length,
      rejections,
      `${file}: found ${sites.length} APP_STORAGE_* rejection sites, the ledger says ${rejections}.\n` +
        `FEWER means a check vanished with the site it guarded, which reads as a pass. MORE means\n` +
        `a rejection arrived without anyone updating this file — which is how the third\n` +
        `PAYLOAD_TOO_LARGE was added after the first two had been reviewed. Update MOCKS.`,
    );

    for (const site of sites) {
      const verdict = judgeRejection(expandLocal(source, site.expr), EXPORTED_MESSAGES);
      assert.ok(
        verdict.ok,
        `${file}:${site.line} (${site.messageType}) emits \`error: ${site.expr}\` —\n` +
          `        ${verdict.why}\n\n` +
          `        The host sends the TRPCError's MESSAGE, never its code. The six it can send are\n` +
          `        exported from ${ERRORS_MODULE}, measured against civitai/civitai. A string this\n` +
          `        repository invents makes \`dev:mock\` exercise a branch production never takes —\n` +
          `        civitai/civitai-app-starters#343.`,
      );
    }
  }
});

test('the example a reader copies branches on the CLASSIFIER, not on host prose (#343)', () => {
  // The sharpest consequence of #343 lived here: `kv-storage`'s only error arm
  // tested `/payload_too_large/i`, so the actionable copy was unreachable in
  // production while passing every local run. The fix is not "a wider regex" —
  // it is that the example does not spell a host string at all.
  const rel = 'starters/examples/kv-storage/src/App.tsx';
  const src = readFileSync(join(REPO_ROOT, rel), 'utf8');

  const fnAt = src.indexOf('function storageFailureMessage');
  assert.ok(fnAt >= 0, `${rel} no longer defines storageFailureMessage()`);
  const fn = src.slice(fnAt);

  assert.ok(
    /classifyAppStorageError\(/.test(fn),
    `${rel}'s storageFailureMessage() no longer calls classifyAppStorageError(). Whatever it\n` +
      `matches on instead is a second spelling of the host's messages, and a second spelling is\n` +
      `what drifts.`,
  );
  assert.ok(
    /from '@civitai\/app-sdk\/blocks'/.test(src.slice(0, fnAt)) &&
      /classifyAppStorageError/.test(src.slice(0, fnAt)),
    `${rel} must import classifyAppStorageError from @civitai/app-sdk/blocks`,
  );

  // No host message may be SPELLED in the function — that is the drift this
  // closes. Checked against the real strings, so it cannot be walked by
  // rewording the guard's idea of them.
  for (const [name, message] of Object.entries(EXPORTED_MESSAGES)) {
    assert.ok(
      !fn.includes(message),
      `${rel}'s storageFailureMessage() spells the host message "${message}" (${name}).\n` +
        `Branch on classifyAppStorageError()'s reason instead: the string is the host's and can\n` +
        `move; the reason is this SDK's and cannot.`,
    );
  }

  // And the generic arm survives. `classifyAppStorageError` answers null for a
  // message this SDK version does not know, which is a REAL outcome — the host
  // can reword or add a site in any deploy.
  assert.ok(
    /\bdefault:/.test(fn),
    `${rel}'s storageFailureMessage() has no \`default:\` arm. An unrecognised host message\n` +
      `must still produce copy, not fall off the end returning undefined.`,
  );
});
