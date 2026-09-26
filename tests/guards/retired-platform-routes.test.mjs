/**
 * Guards against a PUBLISHED package telling a reader to go to a civitai
 * route that no longer exists.
 *
 * Rule: no shipped source file or README in a published `@civitai/*` package
 * may name a retired `/apps/*` route. Those routes 301 elsewhere, so the
 * instruction is not merely stale — it sends the reader somewhere that cannot
 * do what the sentence promises.
 *
 * WHY THIS EXISTS
 * ===============
 * `/apps/installed` was documented as THE settings write path in three places
 * in `@civitai/blocks-react` — `src/hooks/useBlockSettings.ts`,
 * `src/ui/SettingsForm.tsx` and `README.md`. The route has 301'd to
 * `/apps/activity` since the W5 rename, and settings are not written there at
 * all: civitai's own app settings panel writes them through
 * `trpc.blocks.upsertSubscription` (`src/components/Apps/AppSettingsModal.tsx`),
 * built from the same manifest `settings` declaration but with its OWN widgets.
 * civitai never imports `SettingsForm` — the only occurrence of that name in
 * its tree is a comment.
 *
 * 🔴 THE TWO `src/` SITES ARE DOCBLOCKS, SO THEY REACH IDE HOVER FOR EVERY
 * CONSUMER via the emitted `.d.ts`. That is strictly worse than a docs page: a
 * reader never navigates to it, it arrives unbidden at the call site. A
 * sibling arc had already corrected the same claim in the unpublished example
 * docs (#470) while these three shipped copies kept asserting it.
 *
 * 🔴 THIS GUARD DELIBERATELY DOES **NOT** STRIP COMMENTS, which is the inverse
 * of `tests/guards/lib/strip-comments.mjs`'s guards. Those ask "does the CODE
 * call a gate", so prose mentioning it is noise. Here the comment IS the
 * shipped artifact — the defect lives in the docblock and nowhere else — so
 * stripping comments would make this guard structurally blind to the entire
 * class it exists to catch.
 *
 * 🔴 KNOWN LIMITS:
 *   - `RETIRED_ROUTES` is a hand-maintained mirror of civitai's
 *     `next.config.mjs` redirect block, so a route retired AFTER this list was
 *     written is invisible here. The list is a floor, not a discovery
 *     mechanism.
 *     ⚠ It is hand-maintained by CHOICE, not by constraint — an earlier draft
 *     of this comment claimed "this repo cannot read that file" and that was
 *     FALSE. `ci.yml`'s `design-system-drift-guard` job already sparse-checks
 *     out `civitai/civitai` to `.civitai-src` in cone mode, which always
 *     includes repository-root files, so `next.config.mjs` — carrying all four
 *     entries — is on disk in that job today with no config change. Deriving
 *     the list there would turn this floor into real discovery; it is not done
 *     here only because this guard runs in a job that has no such checkout.
 *   - It is a text scan. A retired route named inside a RETRACTION ("this used
 *     to say /apps/installed, which was false") would fail this guard even
 *     though it is correct prose. That is deliberate: there are zero such
 *     occurrences today, over-reporting is the safe direction, and a future
 *     author who needs one should add it here with its reason rather than have
 *     the guard quietly stop meaning what it says.
 *   - CHANGELOG.md is excluded. A changelog legitimately quotes the route
 *     names as they were; rewriting history to satisfy a guard would be a lie.
 *     Same carve-out, same reason, as `doc-cdn-urls.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/**
 * Retired `/apps/*` routes, mirrored from civitai's `next.config.mjs`
 * `redirects()` block. Each is a real 301 with the destination noted, so a
 * failure message can say where the reader actually lands.
 */
const RETIRED_ROUTES = {
  '/apps/installed': '/apps/activity',
  '/apps/mine': '/apps/build',
  '/apps/get-started': '/apps/build',
  '/apps/my-submissions': '/apps/build',
};

/**
 * Reader-facing docs at the repo root. These do NOT ship to npm, so they are
 * not "published" in the sense the packages are — but they are the repo's
 * front door, and a retired route in them misdirects a reader exactly as hard.
 *
 * 🔴 THEY ARE IN SCOPE BECAUSE THE ROUTE LIST SAYS THEY MUST BE. An earlier
 * draft scanned published packages only, while `RETIRED_ROUTES` named four
 * routes — so the guard reported PASS over three live `/apps/my-submissions`
 * instructions in these very files, for a route on its own list. A guard that
 * lists four and enforces one reads as coverage while providing none, which is
 * worse than not listing them.
 */
const REPO_DOCS = ['README.md', 'docs'];

/**
 * Coverage floors. An unasserted count is indistinguishable from a scanner
 * wired to nothing: without these, a bad glob, a renamed `packages/` dir or a
 * discovery step that silently returned [] all read as a clean PASS.
 *
 * Six packages publish today (app-sdk, blocks-react, components,
 * components-react, sdk, theme). Raising these is fine; lowering one means a
 * package stopped publishing, which is a decision worth making on purpose.
 */
const MIN_PUBLISHED_PACKAGES = 6;
const MIN_SCANNED_FILES = 50;
const MIN_REPO_DOCS = 2;
/**
 * 🔴 EVERY DISCOVERY PATH NEEDS ITS OWN FLOOR — this one was missing, and the
 * gap was demonstrated rather than theorised: with the shipped-doc lookup
 * typo'd, restoring the pre-fix bytes into `blocks-react/README.md` — one of
 * the three sites this guard exists to protect — still reported CLEAN, because
 * `MIN_SCANNED_FILES` is dominated ~36:1 by `src/**` and cannot notice nine
 * docs vanishing. A floor that another path can satisfy is not a floor.
 *
 * 9 today: a README in each of the six published packages, plus
 * `components`' `MARKUP.md` and `demo/index.html`, plus `sdk`'s `BREAKING.md`.
 */
const MIN_SHIPPED_DOCS = 9;

/** `true` when the package.json is published to npm (i.e. not `private`). */
function isPublished(pkgJsonPath) {
  return !JSON.parse(readFileSync(pkgJsonPath, 'utf8')).private;
}

/**
 * DISCOVER the published packages rather than hardcoding them, so a new
 * package is covered the day it lands instead of the day someone remembers.
 */
function publishedPackageDirs() {
  return readdirSync(PACKAGES_DIR)
    .map((name) => join(PACKAGES_DIR, name))
    .filter((dir) => statSync(dir).isDirectory())
    .filter((dir) => {
      try {
        return isPublished(join(dir, 'package.json'));
      } catch {
        return false; // no package.json → not a package
      }
    });
}

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.md', '.html']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', '__tests__', 'coverage']);

/** Collect scannable files under `abs`, which may be a file or a directory. */
function collect(abs, out) {
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return; // a `files` entry that does not exist on disk
  }
  if (stat.isFile()) {
    const dot = abs.lastIndexOf('.');
    const ext = dot === -1 ? '' : abs.slice(dot);
    if (!SCANNED_EXTENSIONS.has(ext)) return;
    if (abs.endsWith('CHANGELOG.md')) return; // history quotes old names on purpose
    out.push(abs);
    return;
  }
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    // 🔴 Name-checked WITHOUT `isDirectory()`, because that is false for a
    // symlink-to-directory — so a `node_modules` symlink would walk straight
    // past the skip list and `statSync` would follow it. Unreachable in this
    // tree today (zero symlinks under packages/), and a name test costs
    // nothing; a followed symlink loop would recurse unbounded.
    if (SKIP_DIRS.has(entry.name)) continue;
    // Only symlinked DIRECTORIES are skipped — they are the recursion hazard.
    // Skipping symlinked FILES too lost real coverage: `components/demo/` is in
    // that package's `files` array, so a symlinked doc there genuinely ships.
    if (entry.isSymbolicLink() && entry.isDirectory()) continue;
    collect(join(abs, entry.name), out);
  }
}

/**
 * The docs a package actually SHIPS, derived from its npm `files` array.
 *
 * 🔴 DERIVED, NOT HARDCODED — an earlier draft listed `['README.md',
 * 'MARKUP.md']` and therefore missed two files that reach every consumer:
 * `@civitai/sdk`'s `BREAKING.md` and `@civitai/components`' `demo/index.html`
 * (both in their `files` arrays, and `.html` was not even a scanned
 * extension). A retired-route instruction in either shipped to npm with this
 * guard green.
 *
 * ⚠ An earlier draft justified this by saying `doc-cdn-urls.test.mjs` uses the
 * same criterion. It does NOT — that guard's corpus is a hardcoded four-path
 * array, and its own KNOWN LIMITS say it "cannot see a pinned URL added to a
 * file NOT in SHIPPED_DOCS". The honest argument is the one that stands on its
 * own: `files` plus npm's implicit set tracks what is PUBLISHED, where a
 * hand-list tracks what someone remembered.
 *
 * `dist` is excluded: it is generated from `src/**`, which is scanned at its
 * source, and it does not exist in a cold checkout — including it would make
 * the corpus depend on whether a build has run.
 */
function shippedDocs(pkgDir) {
  const { files = [] } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const out = [];
  // 🔴 npm ALWAYS publishes README.md regardless of `files`, so `files`
  // UNDER-states the publish set. Deriving from it alone lost a case the
  // hardcoded list it replaced used to catch: a package listing only
  // `["dist"]` still ships its README to every consumer, and `shippedDocs`
  // returned [] for it. Union the derived set with npm's implicit one.
  // npm's rule is case- and extension-insensitive ("README & LICENSE can have
  // any case and extension"), so match rather than hardcode `README.md`.
  for (const name of readdirSync(pkgDir)) {
    if (/^readme(\.|$)/i.test(name)) collect(join(pkgDir, name), out);
  }
  for (const entry of files) {
    if (entry.startsWith('!')) continue; // a negation, not a payload
    // Normalise before the prefix test: `./dist` and `/dist` are legal `files`
    // spellings that a raw `startsWith('dist/')` waves through, which would
    // pull a whole built tree into the corpus and make the result depend on
    // whether a build has run.
    const normalised = entry.replace(/^\.?\/+/, '');
    if (normalised === 'dist' || normalised.startsWith('dist/')) continue;
    collect(join(pkgDir, normalised), out);
  }
  return [...new Set(out)];
}

/** The `src/**` half of a package's corpus. */
function srcFiles(pkgDir) {
  const out = [];
  collect(join(pkgDir, 'src'), out);
  return out;
}

/**
 * Matches a retired route only when it is the WHOLE path segment, so
 * `/apps/installed` does not also flag a hypothetical `/apps/installed-apps`.
 */
function routeMatcher(route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}(?![a-z0-9-])`, 'g');
}

/** Markdown under the repo-root doc surfaces, recursively. */
function repoDocFiles() {
  const out = [];
  const walk = (abs) => {
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      return; // a listed doc surface that does not exist is caught by the floor
    }
    if (stat.isFile()) {
      if (abs.endsWith('.md') && !abs.endsWith('CHANGELOG.md')) out.push(abs);
      return;
    }
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      // Same ordering as `collect`: name FIRST, because `isDirectory()` is
      // false for a symlink-to-directory. An earlier round fixed this in
      // `collect` and left the identical predicate here.
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory() && entry.isSymbolicLink()) continue;
      walk(join(abs, entry.name));
    }
  };
  for (const rel of REPO_DOCS) walk(join(REPO_ROOT, rel));
  return out;
}

const PACKAGE_DIRS = publishedPackageDirs();
const PACKAGE_SRC_FILES = PACKAGE_DIRS.flatMap(srcFiles);
const SHIPPED_DOC_FILES = PACKAGE_DIRS.flatMap(shippedDocs);
const REPO_DOC_FILES = repoDocFiles();

/**
 * 🔴 BUILT FROM THE SAME ARRAYS THE FLOORS MEASURE — that is the whole point of
 * this line, and an earlier draft got it wrong in a way that voided the floor
 * it had just added. `SHIPPED_DOC_FILES` was computed by a SECOND, independent
 * call and never spread in here; the scan reached the shipped docs by a
 * different route. Deleting that route left the floor still reading 9 while two
 * retired routes shipped with the guard green. A floor that measures a
 * parallel computation is not a floor on the scan.
 */
const SCANNED = [...new Set([...PACKAGE_SRC_FILES, ...SHIPPED_DOC_FILES, ...REPO_DOC_FILES])];

const HITS = [];
/** Every file the HITS loop actually READ — see the binding assertion below. */
const READ = new Set();
for (const file of SCANNED) {
  READ.add(file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [route, destination] of Object.entries(RETIRED_ROUTES)) {
      if (routeMatcher(route).test(line)) {
        HITS.push({
          file: relative(REPO_ROOT, file),
          line: i + 1,
          route,
          destination,
          text: line.trim(),
        });
      }
    }
  });
}

test('the matcher detects a retired route, and only as a whole segment (negative control)', () => {
  // Guards the INSTRUMENT. If this stops firing, every "no retired routes
  // found" result below is a claim about a broken regex, not about the repo.
  const bad = ` * iframe — settings are *written* on the platform \`/apps/installed\` page,`;
  assert.equal(
    [...bad.matchAll(routeMatcher('/apps/installed'))].length,
    1,
    'the pattern must match the exact sentence this guard was written for',
  );

  // The real pre-fix text from each of the three sites, so the control is built
  // from bytes that actually shipped rather than from a textbook fixture.
  const shipped = [
    'settings are *written* on the platform `/apps/installed` page',
    ' *   1. Platform-side `/apps/installed` settings modal (publisher slice).',
    'are *written* on the platform `/apps/installed` page, not via a bridge message.',
  ];
  for (const s of shipped) {
    assert.equal([...s.matchAll(routeMatcher('/apps/installed'))].length, 1, `must match: ${s}`);
  }

  // A live route that merely shares a prefix must NOT be flagged.
  assert.equal(
    [...'/apps/installed-apps'.matchAll(routeMatcher('/apps/installed'))].length,
    0,
    'a longer path segment must not be flagged',
  );
  assert.equal(
    [...'see /apps/activity for the list'.matchAll(routeMatcher('/apps/installed'))].length,
    0,
    'the live replacement route must never be flagged',
  );
});

test('the scan actually read the published packages (positive control)', () => {
  // A reassuring zero is indistinguishable from a probe wired to nothing.
  assert.ok(
    PACKAGE_DIRS.length >= MIN_PUBLISHED_PACKAGES,
    `expected >= ${MIN_PUBLISHED_PACKAGES} published packages, discovered ${PACKAGE_DIRS.length}` +
      ' — did `packages/` move, or did discovery silently return nothing?',
  );
  assert.ok(
    SCANNED.length >= MIN_SCANNED_FILES,
    `expected >= ${MIN_SCANNED_FILES} scanned files, got ${SCANNED.length}`,
  );
  // The repo-root docs are a SEPARATE discovery path from the packages, so the
  // package floor above cannot detect it silently returning nothing.
  assert.ok(
    REPO_DOC_FILES.length >= MIN_REPO_DOCS,
    `expected >= ${MIN_REPO_DOCS} repo-root doc files, got ${REPO_DOC_FILES.length}` +
      ` — did README.md or docs/ move?`,
  );
  // And the shipped docs are a THIRD path, dominated ~36:1 by src/** in the
  // total — so MIN_SCANNED_FILES cannot see them all disappear.
  assert.ok(
    SHIPPED_DOC_FILES.length >= MIN_SHIPPED_DOCS,
    `expected >= ${MIN_SHIPPED_DOCS} shipped package docs, got ${SHIPPED_DOC_FILES.length}` +
      ` — did a package's "files" array change, or did the lookup break?`,
  );

  // 🔴 A COUNT IS NOT A CONNECTION. The three assertions above measure the
  // discovery arrays; none of them says those arrays are what gets SCANNED.
  // Measured: with the shipped docs computed but left out of `SCANNED`, every
  // count above still passed — 9 ≥ 9 — while a retired route planted in
  // BREAKING.md went unreported. So pin the RELATIONSHIP, not the components:
  // everything discovered must actually be in the scanned set.
  const scannedSet = new Set(SCANNED);
  const missed = [...PACKAGE_SRC_FILES, ...SHIPPED_DOC_FILES, ...REPO_DOC_FILES].filter(
    (f) => !scannedSet.has(f),
  );
  assert.deepEqual(
    missed.map((f) => relative(REPO_ROOT, f)),
    [],
    'these files were DISCOVERED but are not in SCANNED — the floors above are' +
      ' measuring a computation the scan does not use',
  );

  // 🔴 AND THE SECOND HOP: being in `SCANNED` is not being READ. The assertion
  // above pins discovery→SCANNED; the HITS loop is an independent statement, so
  // pointing it at a different array would relocate the very defect this
  // assertion exists to close, one step downstream.
  const unread = SCANNED.filter((f) => !READ.has(f));
  assert.deepEqual(
    unread.map((f) => relative(REPO_ROOT, f)),
    [],
    'these files are in SCANNED but the scan never read them',
  );
  // Name WHICH non-README file was lost. The count floor above already catches
  // a regression to the old hardcoded ['README.md','MARKUP.md'] list -- measured,
  // it fails at 7 < 9 -- so these two do not exist because the count is blind.
  // They exist so the failure says which surface went missing instead of only
  // that the total moved. (An earlier comment here claimed the count floor would
  // pass such a regression; that was false, and the correction was made in a
  // commit message while this sentence stayed in the tree.)
  assert.ok(
    SHIPPED_DOC_FILES.some((f) => f.endsWith('BREAKING.md')),
    'no BREAKING.md among the shipped docs — the files-array lookup has regressed to README-only',
  );
  assert.ok(
    SHIPPED_DOC_FILES.some((f) => f.endsWith('demo/index.html')),
    'no demo/index.html among the shipped docs — .html is shipped and must be scanned',
  );
  // Prove the files were READ, not merely listed: the entry point of the
  // package this guard was written for must be present and non-empty.
  // 🔴 ALL THREE ORIGINAL SITES, not just one. A count floor cannot see a
  // PARTIAL src loss: measured, adding 'ui' to SKIP_DIRS dropped
  // `src/ui/SettingsForm.tsx` — one of the three sites this guard was written
  // for — and the suite stayed 3/3 green.
  for (const [suffix, marker] of [
    ['packages/civitai-blocks-react/src/hooks/useBlockSettings.ts', 'useBlockContext'],
    ['packages/civitai-blocks-react/src/ui/SettingsForm.tsx', 'ManifestSettings'],
    ['packages/civitai-blocks-react/README.md', 'useBlockSettings'],
  ]) {
    const hit = SCANNED.find((f) => f.endsWith(suffix));
    assert.ok(hit, `${suffix} was not scanned — a site this guard exists for has left the corpus`);
    assert.ok(
      readFileSync(hit, 'utf8').includes(marker),
      `${suffix} read as empty or unexpected content`,
    );
  }
});

test('no published package names a retired /apps/* route', () => {
  assert.deepEqual(
    HITS.map((h) => `${h.file}:${h.line} ${h.route} (301s to ${h.destination})`),
    [],
    [
      'A published package names a civitai route that no longer exists.',
      '',
      'These routes 301, so the instruction does not merely read as stale — it',
      'sends the reader to a page that cannot do what the sentence promises.',
      '',
      'Name the live route, or better, the AFFORDANCE a reader can see — the',
      '"Manage" control, the submit flow. Naming a live route is fine and this',
      'repo does it in several places; only a RETIRED one is the defect here.',
      '',
      'If the sentence is about writing app settings: that happens platform-side,',
      'in the panel reached from the "Manage" control, through',
      '`trpc.blocks.upsertSubscription`. Prefer the affordance to a URL there —',
      'that panel is a modal with three entry points, so no single URL is true.',
      '',
      'A docblock under `src/` reaches IDE hover for every consumer via the',
      'emitted .d.ts, so a wrong one there is worse than a wrong docs page.',
    ].join('\n'),
  );
});
