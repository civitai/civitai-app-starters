/**
 * #378 — no module under a directory named `internal/` (or `private/`) may be
 * reached from `@civitai/blocks-react`'s MAIN entry.
 *
 * Before this guard, `src/index.ts` published 14 symbols out of `src/internal/`
 * — `IframeTransport`, `sendTypedRequest`, `getTransport`, `RequestTimeoutError`
 * and friends, six of which README § "Lower-level transport" names as
 * deliberately public. The directory name therefore told a contributor the exact
 * opposite of the truth: that the package's lower-level surface was private and
 * free to move. #378 is a NAMING defect, not an over-export — nothing was
 * removed, nine modules moved to `src/transport/`.
 *
 * ## What "reached from" means here, and why it is not one hop
 *
 * The issue's own check clause reads "the main entry's import specifiers contain
 * no `internal/` segment". Taken literally that is a ONE-HOP check, and a
 * one-hop check is walkable: a two-line `src/transport/barrel.ts` doing
 * `export * from '../internal/iframeTransport.js'` satisfies it while putting
 * exactly the same symbols on exactly the same entry. So the walk below follows
 * RE-EXPORT edges (`export … from`) transitively.
 *
 * It does NOT follow plain `import` edges past the entry. That is deliberate and
 * is the line between the two directories: a public module may *use* a private
 * helper (`hooks/useCollectionFollow.ts` imports `internal/replyError.js`, and
 * should) — what it may not do is put that module's path on the published
 * surface. A re-export is the only edge that does that, and it is also the only
 * edge a launderer can hide behind.
 *
 * ## Scope: the `.` entry, deliberately not `./testing` or `./live`
 *
 * The exports map has four entries. `./live` re-exports `createLiveHost` from
 * `internal/liveHost.ts` and is left that way ON PURPOSE — which is what makes
 * it this guard's positive control below, built from the real tree rather than a
 * toy fixture. Widening the rule to all four subpaths would force the ~1.9k-line
 * live host and its picker/catalog/consent dependencies out of `internal/` too,
 * for no gain: nobody is misled about `createLiveHost`'s status, because README
 * § "The `/live` subexport" documents it as published API. #378's closing
 * condition names "the package's public entry", singular, and that is `.`.
 *
 * ## Second property: `src/transport/` owes `src/internal/` nothing
 *
 * `transport/` is self-contained (it imports from `@civitai/*`, `react` and
 * itself, never from `../internal/`). That is what makes the split a real
 * boundary rather than a rename: the public half cannot quietly grow a
 * dependency on the private half and drag it onto the surface later.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const PKG = join(REPO_ROOT, 'packages', 'civitai-blocks-react');
const SRC = join(PKG, 'src');

/** Directory names that assert "not public". */
const PRIVATE_DIR_NAMES = ['internal', 'private'];

/** Every `from '<specifier>'` in the file, import and re-export alike. */
function allSpecifiers(source) {
  return [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** Only `export … from '<specifier>'` — the edges that publish a module. */
function reExportSpecifiers(source) {
  return [...source.matchAll(/\bexport\s[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/**
 * Resolve a relative `./x.js` specifier to the `.ts`/`.tsx` file on disk.
 * Returns `null` for a bare (external) specifier — those are another package's
 * problem, not this entry's layout.
 */
function resolveLocal(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier).replace(/\.js$/, '');
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`unresolvable specifier ${specifier} from ${relative(REPO_ROOT, fromFile)}`);
}

/**
 * Walk from `entry`, following every specifier out of the entry itself and
 * re-export edges thereafter. Returns every local file reached, entry included.
 */
function reachableFromEntry(entry) {
  const seen = new Set([entry]);
  const queue = [[entry, true]];
  while (queue.length > 0) {
    const [file, isEntry] = queue.shift();
    const source = readFileSync(file, 'utf8');
    const specs = isEntry ? allSpecifiers(source) : reExportSpecifiers(source);
    for (const spec of specs) {
      const target = resolveLocal(file, spec);
      if (target === null || seen.has(target)) continue;
      seen.add(target);
      queue.push([target, false]);
    }
  }
  return [...seen];
}

/** Files under `src/` whose path crosses a directory asserting privacy. */
function privateDirHits(files) {
  return files
    .map((f) => relative(SRC, f))
    .filter((rel) => rel.split(sep).slice(0, -1).some((seg) => PRIVATE_DIR_NAMES.includes(seg)))
    .sort();
}

function walkTs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test('#378 — the main entry reaches no module under internal/ or private/', () => {
  const reached = reachableFromEntry(join(SRC, 'index.ts'));

  // Positive control on the WALKER, not on the verdict: a zero below is only
  // meaningful if the walk actually went somewhere. `src/index.ts` alone would
  // trivially satisfy the assertion.
  assert.ok(
    reached.length > 30,
    `the walk reached only ${reached.length} file(s) — it is not seeing the entry's graph, ` +
      'so the empty violation list below vouches for nothing',
  );

  assert.deepEqual(
    privateDirHits(reached),
    [],
    'module(s) reached from src/index.ts live under a directory that asserts they are private',
  );
});

test('POSITIVE CONTROL — the same walk DOES flag ./live, which really does re-export from internal/', () => {
  // Realistic data, not a fixture: `src/live.ts` is the repo's own second entry
  // and re-exports `createLiveHost` straight out of `src/internal/liveHost.ts`.
  // If this reports nothing, the checker above cannot see the thing it claims
  // to be checking for, and its zero is a wiring bug rather than a clean tree.
  const hits = privateDirHits(reachableFromEntry(join(SRC, 'live.ts')));
  assert.deepEqual(hits, [join('internal', 'liveHost.ts')]);
});

test('POSITIVE CONTROL — a laundering barrel under transport/ does NOT walk past the guard', () => {
  // The one-hop version of this check (the issue's literal "the main entry's
  // import specifiers contain no internal/ segment") passes on this shape. The
  // transitive walk must not.
  //
  // `src/testing.tsx` is the stand-in: it sits at the same depth as `index.ts`
  // and imports `internal/mockHost.js` — but only as a plain `import`, never a
  // re-export, so a walker that followed re-exports ONLY would see nothing. The
  // assertion is therefore on the ENTRY arm (which follows every specifier),
  // proving the entry's own imports are covered too and not just its exports.
  const hits = privateDirHits(reachableFromEntry(join(SRC, 'testing.tsx')));
  assert.ok(
    hits.includes(join('internal', 'mockHost.ts')),
    `expected the walker to reach internal/mockHost.ts from testing.tsx, got ${JSON.stringify(hits)}`,
  );
});

test('#378 — src/transport/ imports nothing from a private directory', () => {
  const files = walkTs(join(SRC, 'transport'));
  assert.ok(files.length >= 9, `expected the transport modules, found ${files.length}`);

  const offenders = [];
  for (const file of files) {
    for (const spec of allSpecifiers(readFileSync(file, 'utf8'))) {
      const target = resolveLocal(file, spec);
      if (target === null) continue;
      if (privateDirHits([target]).length > 0) {
        offenders.push(`${relative(SRC, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(
    offenders.sort(),
    [],
    'src/transport/ (public) took a dependency on src/internal/ (private)',
  );
});
