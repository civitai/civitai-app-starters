/**
 * #380 — every hook exported from `@civitai/blocks-react` ships a named,
 * exported return type, and the set of hooks is an ASSERTED LEDGER.
 *
 * Before this, whether a hook's return type had a name was a coin flip. Measured
 * on `bcc24bf`: 37 files under `src/hooks/use*.ts`, 17 with an exported
 * `Use<Hook>`, 20 without. (The issue's 36/17/19 predates #413's
 * `useRequestSequencer`. A looser instrument — `grep -l 'export type Use'` —
 * reports 19/18 instead, because it counts `UseImageUploadOptions` and
 * `UseDirectLoadOptions`, which are OPTIONS types, not return types. The 17 is
 * the number that answers the issue's question.)
 *
 * ## The rule, and why it is "exported from the entry" rather than "is a file"
 *
 * `useRequestSequencer` is a `src/hooks/use*.ts` file and is NOT a hook anyone
 * can call: #413 introduced it as the shared request-sequencing helper the
 * consumer-facing hooks build on, and `src/index.ts` deliberately does not
 * export it. Giving it a published `UseRequestSequencer` would put an
 * implementation detail on the API surface to satisfy a guard — the guard
 * bending the code rather than describing it. So the rule is "every hook
 * EXPORTED FROM THE PACKAGE ENTRY", and this file enumerates the file set and
 * the internal set separately so the classification is a recorded decision
 * rather than an accident of which files happen to be re-exported.
 *
 * ## Why three ledgers and not one "every hook has a type" loop
 *
 * A one-directional check ("for each hook, a type exists") is satisfied by
 * deleting the hook — and by deleting BOTH sides of a relationship, which is how
 * #412's M5 mutant survived a relational check and how #359 shipped a phantom
 * `./css/tabs` subpath. Every assertion below is a SET EQUALITY against a
 * written-down list, so it fails when the set grows as well as when it shrinks.
 * Adding a hook is a deliberate two-file act: write it, and record it here.
 *
 * ## What this guard cannot see
 *
 * It reads TEXT. It can prove the annotation says `UseX` and that `UseX` is
 * exported; it cannot prove `UseX` describes what the hook returns — a
 * `UseBuzzBalance` nobody uses would satisfy it. That half is
 * `src/hooks/returnTypeLedger.ts`, whose `Exact<ReturnType<typeof useX>, UseX>`
 * assertions fail `tsc`. Neither check subsumes the other: the structural one is
 * blind to an inline literal that happens to match (measured — see that file),
 * and this one is blind to a name that matches nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const SRC = join(REPO_ROOT, 'packages', 'civitai-blocks-react', 'src');
const HOOKS = join(SRC, 'hooks');

/**
 * Every `src/hooks/use*.ts` file, by hook name. Sorted, and asserted for SET
 * EQUALITY — a new hook file fails this guard until it is classified below as
 * either public or internal.
 */
const HOOK_FILES = [
  'useAppStorage',
  'useAppWorkflows',
  'useBlockAnalytics',
  'useBlockBreakpoint',
  'useBlockContext',
  'useBlockResize',
  'useBlockSettings',
  'useBlockTheme',
  'useBlockToken',
  'useBuzzAccounts',
  'useBuzzBalance',
  'useBuzzPurchase',
  'useBuzzTransactions',
  'useBuzzWorkflow',
  'useCheckpointPicker',
  'useCivitaiNavigate',
  'useCollectionFollow',
  'useConsentUnavailable',
  'useCreatePostFromApp',
  'useDailyCompensation',
  'useDirectLoad',
  'useDomainMaturity',
  'useGatedImages',
  'useGenerationResources',
  'useHostOrigin',
  'useImageUpload',
  'usePublishGenerationOutputs',
  'useRequestConsent',
  'useRequestSequencer',
  'useRequestSignIn',
  'useResourcePicker',
  'useSaveImage',
  'useSharedStorage',
  'useTip',
  'useTipAllowance',
  'useViewer',
  'useWildcardPack',
];

/**
 * Hook-shaped files that are NOT on the package entry, and why.
 *
 * `useRequestSequencer` (#413) is the shared in-flight-request sequencer the
 * public hooks call; it has no standalone meaning to a block author and
 * publishing a return type for it would publish the helper.
 */
const INTERNAL_HOOKS = ['useRequestSequencer'];

/**
 * Hooks whose return annotation is NOT `Use<Hook>` because the hook is
 * OVERLOADED, mapped to the annotation each signature carries in declaration
 * order. Every name here must still be exported from the entry — the escape is
 * from the one-name convention, never from the naming requirement.
 */
const OVERLOADED_HOOKS = {
  useImageUpload: [
    'UseImageUploadGenerationSource',
    'UseImageUploadAsyncScan',
    'UseImageUpload',
    // The implementation signature. Not a call shape any consumer can reach,
    // and deliberately NOT on the entry — see the assertion below.
    'UseImageUploadImplementation',
  ],
};

/** Names declared on an overload signature but kept off the published entry. */
const UNPUBLISHED_OVERLOAD_TYPES = ['UseImageUploadImplementation'];

const ENTRY_HOOKS = HOOK_FILES.filter((h) => !INTERNAL_HOOKS.includes(h));
const typeNameFor = (hook) => `Use${hook[3].toUpperCase()}${hook.slice(4)}`;

const entrySource = readFileSync(join(SRC, 'index.ts'), 'utf8');

/** Names in `export { … } from` clauses (values, plus inline `type` members). */
function entryValueExports(source) {
  const out = new Set();
  for (const m of source.matchAll(/export\s*\{([^}]*)\}\s*from\s*'[^']+'/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) out.add(name);
    }
  }
  return out;
}

/** Names in `export type { … } from` clauses. */
function entryTypeExports(source) {
  const out = new Set();
  for (const m of source.matchAll(/export\s+type\s*\{([^}]*)\}\s*from\s*'[^']+'/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) out.add(name);
    }
  }
  return out;
}

/**
 * Return annotations of every `export function <hook>` signature in `source`,
 * in declaration order. Scans the parameter list by balancing parentheses
 * rather than by regex, because several of these hooks declare multi-line
 * parameters with `(` inside comments and defaults.
 */
function returnAnnotations(source, hook) {
  const out = [];
  const needle = `export function ${hook}(`;
  let at = source.indexOf(needle);
  while (at !== -1) {
    let i = at + needle.length - 1; // on the '('
    let depth = 0;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    const rest = source.slice(i + 1);
    const m = /^\s*:\s*([^;{]+?)\s*[;{]/.exec(rest);
    out.push(m === null ? null : m[1].trim());
    at = source.indexOf(needle, i);
  }
  return out;
}

test('#380 LEDGER — src/hooks/use*.ts is exactly the recorded set (fails on GROW and on shrink)', () => {
  const onDisk = readdirSync(HOOKS)
    .filter((f) => /^use[A-Z].*\.tsx?$/.test(f))
    .map((f) => f.replace(/\.tsx?$/, ''))
    .sort();

  // Positive control on the reader before the equality is believed.
  assert.ok(onDisk.length > 20, `read only ${onDisk.length} hook file(s) — the ledger below is vacuous`);

  assert.deepEqual(
    onDisk,
    [...HOOK_FILES].sort(),
    'the hook file set moved. ADD the new hook to HOOK_FILES, then classify it: ' +
      'public (it gets a Use<Hook> return type and an entry export) or INTERNAL_HOOKS ' +
      '(it stays off src/index.ts). Deleting a hook means deleting its ledger entry too.',
  );
});

test('#380 LEDGER — the entry exports exactly ENTRY_HOOKS (fails on GROW and on shrink)', () => {
  const exported = entryValueExports(entrySource);
  const hooksOnEntry = [...exported].filter((n) => /^use[A-Z]/.test(n)).sort();

  assert.ok(hooksOnEntry.length > 20, `found only ${hooksOnEntry.length} hook export(s) on the entry`);

  assert.deepEqual(
    hooksOnEntry,
    [...ENTRY_HOOKS].sort(),
    'the set of hooks exported from src/index.ts no longer matches HOOK_FILES minus INTERNAL_HOOKS',
  );
});

test('#380 — every entry hook declares AND exports its Use<Hook> return type', () => {
  const missing = [];
  for (const hook of ENTRY_HOOKS) {
    const name = typeNameFor(hook);
    const file = join(HOOKS, `${hook}.ts`);
    const source = readFileSync(file, 'utf8');
    if (!new RegExp(`export\\s+(?:type|interface)\\s+${name}\\b`).test(source)) {
      missing.push(`${hook}.ts does not export a type or interface named ${name}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('#380 — every Use<Hook> type is re-exported from the package entry', () => {
  const types = entryTypeExports(entrySource);
  const missing = ENTRY_HOOKS.map(typeNameFor).filter((n) => !types.has(n));
  assert.deepEqual(
    missing,
    [],
    'declared in the hook module but never re-exported — a consumer of the published ' +
      'package still cannot name it, which is the whole of #380',
  );
});

test('#380 — the return ANNOTATION is the named type, not an inline literal', () => {
  // The structural half (src/hooks/returnTypeLedger.ts) is blind here: an inline
  // literal identical to the named type is mutually assignable with it and
  // passes `tsc`. MEASURED, not assumed — see that file's header.
  const wrong = [];
  for (const hook of ENTRY_HOOKS) {
    const source = readFileSync(join(HOOKS, `${hook}.ts`), 'utf8');
    const found = returnAnnotations(source, hook);
    const expected = OVERLOADED_HOOKS[hook] ?? [typeNameFor(hook)];
    assert.ok(found.length > 0, `no 'export function ${hook}(' signature found`);
    if (JSON.stringify(found) !== JSON.stringify(expected)) {
      wrong.push(`${hook}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(found)}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('#380 — an overloaded hook publishes every arm EXCEPT the implementation signature', () => {
  const types = entryTypeExports(entrySource);
  for (const [hook, names] of Object.entries(OVERLOADED_HOOKS)) {
    for (const name of names) {
      if (UNPUBLISHED_OVERLOAD_TYPES.includes(name)) {
        assert.ok(
          !types.has(name),
          `${name} is the implementation signature of ${hook} and must stay off the entry`,
        );
      } else {
        assert.ok(types.has(name), `${hook}'s overload type ${name} is not exported from the entry`);
      }
    }
  }
});

test('#380 — INTERNAL_HOOKS really are absent from the entry', () => {
  // The other direction of the classification: an internal hook that quietly
  // became public would otherwise sit in INTERNAL_HOOKS forever, exempt from
  // every requirement above.
  const exported = entryValueExports(entrySource);
  for (const hook of INTERNAL_HOOKS) {
    assert.ok(
      !exported.has(hook),
      `${hook} is listed as internal but src/index.ts exports it — move it to the public ` +
        'side of the ledger and give it a Use<Hook> return type',
    );
  }
});

test('POSITIVE CONTROL — the annotation reader finds real annotations, including overloads', () => {
  // A reader that silently returned [] would make every check above vacuous.
  const upload = returnAnnotations(readFileSync(join(HOOKS, 'useImageUpload.ts'), 'utf8'), 'useImageUpload');
  assert.equal(upload.length, 4, `expected 4 useImageUpload signatures, read ${upload.length}`);

  const picker = returnAnnotations(
    readFileSync(join(HOOKS, 'useResourcePicker.ts'), 'utf8'),
    'useResourcePicker',
  );
  assert.deepEqual(picker, ['UseResourcePicker']);

  // A hook whose parameter list contains parentheses inside a type — the case a
  // naive `\((.*)\):` regex gets wrong.
  const resize = returnAnnotations(
    readFileSync(join(HOOKS, 'useBlockResize.ts'), 'utf8'),
    'useBlockResize',
  );
  assert.deepEqual(resize, ['UseBlockResize']);
});
