/**
 * Guards the copy-paste CDN `<link>` URLs in the docs that SHIP INSIDE the
 * published packages.
 *
 * Rule: a `cdn.jsdelivr.net/npm/@civitai/<pkg>/...` URL in one of those files
 * must carry NO version. Unversioned tracks the `latest` dist-tag, so the
 * stylesheet a reader loads always matches the contract the same file
 * documents.
 *
 * WHY THIS EXISTS
 * ===============
 * The pinned form has rotted TWICE, and both times it was silent in the same
 * way: jsDelivr serves every published version forever, so a stale pin returns
 * **HTTP 200 with an old stylesheet**. Nothing 404s, nothing logs, and every
 * attribute or token documented since the pin was written renders as an
 * unstyled bare element.
 *
 *   - `0.3.1` (77ce989) fixed pins left at `@0.1.1` — by then `MARKUP.md`
 *     documented 19 components against CSS carrying rules for 10.
 *   - The same pins were stale again by `0.4.0`. Measured on the CDN
 *     (`@0.9.9` 404 in both cases as the negative control):
 *       · `@civitai/theme@0.2.0/styles.css`      200, 5,560 B, **0** `--civitai-bp-*`
 *         tokens — while `packages/civitai-theme/README.md` documents
 *         `var(--civitai-bp-md)` eleven lines above the link that pinned it.
 *       · `@civitai/components@0.3.0/styles.css` 200, 28,042 B, **0**
 *         `data-nowrap` rules — while `MARKUP.md` documents `data-nowrap="true"`
 *         as the opt-out for the wrapping `group` shipped in `components@0.4.0`.
 *     Both are a single shipped file contradicting itself.
 *
 * A bump is not a fix, it is the same defect rescheduled: these packages
 * version INDEPENDENTLY, publish on separate changesets, and `MARKUP.md` is
 * static prose (`files` → npm → mirrored verbatim into
 * developer.civitai.com), so no build step can rewrite it. Removing the version
 * is what makes the rot structurally impossible.
 *
 * 🔴 SCOPE — deliberately the four SHIPPED doc files only. `CHANGELOG.md`s
 * legitimately quote pinned URLs as history (`@0.1.1`, `@0.9.9`, and a
 * `theme@0.3.0` that was a hard 404 when written), and rewriting history to
 * satisfy a guard would be a lie. A reader never copy-pastes from a changelog.
 *
 * 🔴 KNOWN LIMITS:
 *   - It is a text scan, not an HTML/Markdown parse: a jsDelivr URL inside a
 *     prose sentence counts the same as one inside a `<link>`. That direction is
 *     safe (it over-reports, and fails loudly with file:line).
 *   - OFFLINE by design. It asserts the URL SHAPE, never that the URL resolves.
 *     Reachability belongs to a network check; making this one fetch would make
 *     a required check fail on a CDN outage.
 *   - It cannot see a pinned URL added to a file NOT in `SHIPPED_DOCS`. The
 *     coverage floor below is what catches that list going stale.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every file that ships to npm inside a published package AND hands the reader
 * a copy-paste CDN URL. All four are in their package's `files` array, so the
 * corrected copy only reaches consumers — and the generated developer docs — on
 * a publish.
 */
const SHIPPED_DOCS = [
  'packages/civitai-components/MARKUP.md',
  'packages/civitai-components/README.md',
  'packages/civitai-components/demo/index.html',
  'packages/civitai-theme/README.md',
];

/**
 * Matches a jsDelivr URL for a first-party package, capturing the `@<version>`
 * segment when present. `[^/@\s"'<>]+` for the version so it stops at the path
 * separator and at any quote/angle bracket that ends an attribute.
 */
const JSDELIVR_CIVITAI = /cdn\.jsdelivr\.net\/npm\/(@civitai\/[a-z0-9-]+)(@[^/@\s"'<>]+)?\//g;

/**
 * Coverage floor. 7 unversioned first-party jsDelivr URLs exist across
 * SHIPPED_DOCS today (MARKUP.md 2, components/README.md 2, demo/index.html 2,
 * theme/README.md 1). An unasserted count is indistinguishable from a scanner
 * wired to nothing: without this, deleting the links, renaming a file out of
 * the list, or a regex that silently stopped matching all read as a PASS.
 * Raising it is fine; lowering it means deciding a doc no longer needs to tell
 * readers how to load the CSS.
 */
const MIN_UNVERSIONED_URLS = 7;

function scan(relPath) {
  // readFileSync THROWS on a missing file, on purpose: a doc renamed out from
  // under this list must fail the guard, never silently skip it.
  const text = readFileSync(join(REPO_ROOT, relPath), 'utf8');
  const lines = text.split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(JSDELIVR_CIVITAI)) {
      hits.push({ file: relPath, line: i + 1, pkg: m[1], version: m[2] ?? null, text: line.trim() });
    }
  });
  return hits;
}

const ALL = SHIPPED_DOCS.flatMap(scan);

test('the regex actually detects a pinned URL (negative control)', () => {
  // Guards the INSTRUMENT, not the repo. If this ever stops firing, every
  // "no pinned URLs found" result below is a claim about a broken regex.
  const bad = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/theme@0.2.0/styles.css" />`;
  const found = [...bad.matchAll(JSDELIVR_CIVITAI)];
  assert.equal(found.length, 1, 'the pattern must match a pinned jsDelivr URL');
  assert.equal(found[0][1], '@civitai/theme');
  assert.equal(found[0][2], '@0.2.0', 'the version segment must be captured, or nothing is ever flagged');

  const good = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/theme/styles.css" />`;
  const ok = [...good.matchAll(JSDELIVR_CIVITAI)];
  assert.equal(ok.length, 1, 'the pattern must still match an UNVERSIONED URL');
  assert.equal(ok[0][2], undefined, 'an unversioned URL must capture no version');
});

test('no shipped doc pins a @civitai/* jsDelivr URL to a version', () => {
  const pinned = ALL.filter((h) => h.version !== null);
  assert.deepEqual(
    pinned.map((h) => `${h.file}:${h.line} ${h.pkg}${h.version}`),
    [],
    [
      'A versioned CDN URL ships in a published doc.',
      '',
      'Drop the version — `cdn.jsdelivr.net/npm/@civitai/<pkg>/styles.css` resolves',
      'on every CDN because both packages ship a real root `styles.css` (jsDelivr',
      'ignores package.json `exports`; see the header of each build script).',
      '',
      'A pin does not fail loudly here: jsDelivr keeps serving the old stylesheet',
      'with HTTP 200, so newly documented attributes render unstyled with no error.',
      'This has already shipped twice — see this file’s header.',
    ].join('\n'),
  );
});

test('every shipped doc is reachable and still carries its CDN links', () => {
  // Positive control for the scan itself: prove each listed file was READ and
  // produced hits, so a file emptied or moved cannot pass as "clean".
  for (const f of SHIPPED_DOCS) {
    const hits = ALL.filter((h) => h.file === f);
    assert.ok(hits.length > 0, `${f} yielded no @civitai jsDelivr URL — is the list stale?`);
  }
  assert.ok(
    ALL.length >= MIN_UNVERSIONED_URLS,
    `expected >= ${MIN_UNVERSIONED_URLS} first-party jsDelivr URLs across the shipped docs, found ${ALL.length}`,
  );
});

test('both design-system packages are represented (no half-documented setup)', () => {
  // `@civitai/components` is useless without `@civitai/theme`'s tokens, and the
  // two version independently — the specific mistake the 0.3.1 changelog
  // records is applying one package's version to both links. Asserting both
  // names appear keeps a future edit from dropping one link entirely.
  const pkgs = new Set(ALL.map((h) => h.pkg));
  assert.ok(pkgs.has('@civitai/theme'), 'no @civitai/theme CDN URL found in the shipped docs');
  assert.ok(pkgs.has('@civitai/components'), 'no @civitai/components CDN URL found in the shipped docs');
});
