/**
 * Guards the `bootSkeleton` manifest/markup COUPLING across every starter that
 * ships a `block.manifest.json`.
 *
 * THE HAZARD, stated once: `"bootSkeleton": true` makes the App Blocks full-page
 * run host stand down its own loading UI — no branded veil, iframe at
 * `opacity: 1` from mount, no reveal transition — on the promise that the app
 * paints its own boot state instantly. Declared over an EMPTY mount container
 * that promise is broken in the worst possible way: the viewer gets a blank
 * iframe for the entire load, *because* the covering veil was removed at the
 * app's own request. `bootSkeleton: true` + empty `#root` is strictly worse than
 * never opting in.
 *
 * The two halves are in different files (`block.manifest.json` and
 * `index.html`), and NEITHER half looks wrong on its own — deleting the skeleton
 * markup while tidying an entry document reads as removing dead scaffolding.
 * That is the failure this file exists to make impossible.
 *
 * It runs the platform's own `bootSkeleton-not-empty` rule
 * (`scripts/lib/boot-skeleton-gate.mjs`) over every manifest in the repo, so a
 * FUTURE starter cannot declare the key without the markup either — the guard is
 * not pinned to the one starter that has it today.
 *
 * WHERE THIS RUNS: `pnpm test:guards`, in ci.yml's `Starter` matrix job. That
 * job is `pull_request`-triggered and runs `test:guards` BEFORE `pnpm install`,
 * so this file may use node stdlib only. It executes once per matrix leg (5x) —
 * same as its sibling guards, deliberately, so renaming a matrix entry can never
 * silently stop running it.
 *
 * READ AS A REGRESSION TEST. At `origin/main` (dd7c5ba, pre-change) the
 * repo-sweep test fails on the literal substring `is empty in the built` and the
 * theme tests fail on `dark light`. Re-derive rather than trust this:
 *   git worktree add --detach /tmp/vbs origin/main
 *   cp scripts/lib/boot-skeleton-gate.mjs /tmp/vbs/scripts/lib/
 *   cp tests/guards/boot-skeleton.test.mjs /tmp/vbs/tests/guards/
 *   (cd /tmp/vbs && node --test tests/guards/boot-skeleton.test.mjs)
 * — but note the manifest/theme tests need THIS change's manifest to be
 * meaningful at all; the load-bearing red is the coupling sweep.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

import { checkBootSkeleton, parseHtml, readThemeShape } from '../../scripts/lib/boot-skeleton-gate.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STARTERS = join(REPO_ROOT, 'starters');
const BLOCK_STARTER = join(STARTERS, 'civitai-block-starter');

/**
 * COVERAGE FLOOR. A sweep that finds zero files is indistinguishable from a
 * passing one, and a `find`-shaped guard silently narrows to nothing the moment
 * a directory moves. Measured at this commit: 7 manifests
 * (civitai-block-starter + 6 under starters/examples), 1 of which declares
 * bootSkeleton. Raise these when the real numbers rise; never lower them to make
 * a run green.
 */
const MIN_MANIFESTS = 7;
const MIN_DECLARING = 1;

/** Every `block.manifest.json` under `starters/`, with its sibling entry document. */
function collectBlockApps() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      const manifestPath = join(full, 'block.manifest.json');
      let manifest = null;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch {
        walk(full);
        continue;
      }
      const htmlPath = join(full, 'index.html');
      let html = null;
      try {
        html = readFileSync(htmlPath, 'utf8');
      } catch {
        html = null;
      }
      out.push({
        dir: relative(REPO_ROOT, full),
        manifestPath: relative(REPO_ROOT, manifestPath),
        htmlPath: relative(REPO_ROOT, htmlPath),
        manifest,
        html,
      });
    }
  };
  walk(STARTERS);
  return out;
}

// ---------------------------------------------------------------------------
// 1. The rule itself, against fixtures. These are the four cases the platform
//    gate distinguishes; the whole guard is worthless if the function cannot
//    tell them apart, so they are asserted before it is pointed at real files.
// ---------------------------------------------------------------------------

const DECLARING = { bootSkeleton: true };

const PASSING_HTML = `<!doctype html>
<html><head>
  <meta name="color-scheme" content="dark light" />
  <style>html{background:#1a1b1e}[data-boot-skeleton]{padding:16px}</style>
</head><body>
  <div id="root">
    <div data-boot-skeleton aria-hidden="true"><span></span></div>
  </div>
  <script type="module" src="/src/main.tsx"></script>
</body></html>`;

test('gate: PASSES a declaring manifest whose #root holds the skeleton', () => {
  const r = checkBootSkeleton({ manifest: DECLARING, html: PASSING_HTML });
  assert.equal(r.applicable, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.containerCount, 1);
  assert.equal(r.skeletonCount, 1);
});

test('gate: FAILS (a) key declared + empty #root', () => {
  const html = PASSING_HTML.replace(
    /<div id="root">[\s\S]*?<\/div>\s*<\/div>/,
    '<div id="root"></div>',
  );
  assert.match(html, /<div id="root"><\/div>/, 'fixture must really have an empty #root');
  const r = checkBootSkeleton({ manifest: DECLARING, html });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /#root is empty in the built/);
});

test('gate: FAILS (b) [data-boot-skeleton] OUTSIDE #root', () => {
  const html = `<!doctype html><html><body>
    <div data-boot-skeleton aria-hidden="true"><span></span></div>
    <div id="root">text</div>
  </body></html>`;
  const r = checkBootSkeleton({ manifest: DECLARING, html });
  assert.equal(r.ok, false);
  // #root is non-empty, so rule 3 passes — this is rule 4 firing alone.
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /outside the mount container/);
});

test('gate: FAILS (c) #root holding only whitespace, a comment and a <script>', () => {
  const html = `<!doctype html><html><body>
    <div id="root">
      <!-- mounted by src/main.tsx -->
      <script>console.log("not paint");</script>
    </div>
  </body></html>`;
  const r = checkBootSkeleton({ manifest: DECLARING, html });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /#root is empty in the built/);
});

test('gate: #app and [data-app-root] are containers too, and BOTH are checked', () => {
  const html = `<!doctype html><html><body>
    <div id="app"><span data-boot-skeleton></span></div>
    <div data-app-root></div>
  </body></html>`;
  const r = checkBootSkeleton({ manifest: DECLARING, html });
  assert.equal(r.containerCount, 2);
  assert.equal(r.ok, false, 'the empty [data-app-root] must fail even though #app passes');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /\[data-app-root\] is empty in the built/);
});

test('gate: rule 2 — no identifiable container is a PASS, not a guess', () => {
  const r = checkBootSkeleton({
    manifest: DECLARING,
    html: '<!doctype html><html><body><main>hi</main></body></html>',
  });
  assert.equal(r.applicable, true);
  assert.equal(r.ok, true);
  assert.equal(r.containerCount, 0);
});

test('gate: does not apply when the manifest omits bootSkeleton', () => {
  const empty = '<!doctype html><html><body><div id="root"></div></body></html>';
  for (const manifest of [{}, { bootSkeleton: false }, { bootSkeleton: 'true' }]) {
    const r = checkBootSkeleton({ manifest, html: empty });
    assert.equal(r.applicable, false, `${JSON.stringify(manifest)} must not arm the gate`);
    assert.equal(r.ok, true);
  }
});

test('gate: ADVISORY warns when nothing styles the boot content inline', () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="/assets/index.css" />
  </head><body>
    <div id="root"><div data-boot-skeleton aria-hidden="true"><span></span></div></div>
  </body></html>`;
  const r = checkBootSkeleton({ manifest: DECLARING, html });
  assert.equal(r.ok, true, 'advisory must not block');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /styled only by an external stylesheet/);
});

test('parser: attributes, raw-text elements and comments are handled', () => {
  const root = parseHtml(
    `<div id="root" data-x><style>#root{content:"<div id=fake>"}</style>` +
      `<!-- <div id=alsofake> --><span data-boot-skeleton></span></div>`,
  );
  const div = root.children.find((c) => c.type === 'element');
  assert.equal(div.attrs.id, 'root');
  assert.equal(div.attrs['data-x'], '');
  // The `<div id=fake>` inside the <style> body and the one inside the comment
  // must NOT have become elements.
  const tags = [];
  const walk = (n) => {
    for (const c of n.children ?? []) {
      if (c.type === 'element') {
        tags.push(c.tag);
        walk(c);
      }
    }
  };
  walk(root);
  assert.deepEqual(tags, ['div', 'style', 'span']);
});

test('readThemeShape: DETECTS a real prefers-color-scheme: dark block', () => {
  // Negative control for the dark-default assertion below. Without this, a
  // `darkMediaBlocks === []` result is indistinguishable from a regex wired to
  // nothing.
  const shape = readThemeShape(
    `<html><head><meta name="color-scheme" content="light dark">` +
      `<style>html{background:#fff}@media (prefers-color-scheme: dark){html{background:#000}}</style>` +
      `</head><body></body></html>`,
  );
  assert.equal(shape.colorSchemeMeta, 'light dark');
  assert.equal(shape.darkMediaBlocks.length, 1);
  assert.match(shape.darkMediaBlocks[0], /#000/);
  assert.match(shape.baseCss, /background:#fff/);
  assert.doesNotMatch(shape.baseCss, /#000/, 'the media block must not leak into baseCss');
});

test('readThemeShape: a MENTION of the dark query in a CSS comment is not a block', () => {
  // The instrument bug this test pins actually happened: the `[^{]*` in the
  // media regex ran past a commented-out mention and swallowed the next real
  // rule, reporting the base `html { background }` as a dark media block.
  const shape = readThemeShape(
    `<html><head><style>/* deliberately NO @media (prefers-color-scheme: dark) block */` +
      `html{background:#111}@media (prefers-color-scheme: light){html{background:#fff}}</style>` +
      `</head><body></body></html>`,
  );
  assert.deepEqual(shape.darkMediaBlocks, []);
  assert.equal(shape.lightMediaBlocks.length, 1);
  assert.match(shape.baseCss, /background:#111/);
});

// ---------------------------------------------------------------------------
// 2. The repo sweep. THIS is the guard; everything above proves it can go red.
// ---------------------------------------------------------------------------

test('every starter that ships a block.manifest.json satisfies the coupling', () => {
  const apps = collectBlockApps();

  assert.ok(
    apps.length >= MIN_MANIFESTS,
    `expected at least ${MIN_MANIFESTS} block.manifest.json files under starters/, found ` +
      `${apps.length} (${apps.map((a) => a.dir).join(', ')}). A sweep that finds nothing is ` +
      `indistinguishable from a passing one — if manifests genuinely moved, fix the walk.`,
  );

  const declaring = apps.filter((a) => a.manifest?.bootSkeleton === true);
  assert.ok(
    declaring.length >= MIN_DECLARING,
    `expected at least ${MIN_DECLARING} manifest(s) declaring bootSkeleton: true, found ` +
      `${declaring.length}. POSITIVE CONTROL: with none declaring it, this whole sweep passes ` +
      `vacuously and proves nothing.`,
  );

  const failures = [];
  for (const app of declaring) {
    assert.ok(app.html !== null, `${app.dir} declares bootSkeleton but has no ${app.htmlPath}`);
    const r = checkBootSkeleton({ manifest: app.manifest, html: app.html, label: app.htmlPath });
    failures.push(...r.errors);
    // The advisory is not fatal, but a first-party starter has no excuse.
    failures.push(...r.warnings.map((w) => `ADVISORY ${w}`));
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

// ---------------------------------------------------------------------------
// 3. The block starter specifically: the key, the markup, and the dark bet.
// ---------------------------------------------------------------------------

test('civitai-block-starter: manifest declares bootSkeleton: true (parsed, not grepped)', () => {
  const manifest = JSON.parse(readFileSync(join(BLOCK_STARTER, 'block.manifest.json'), 'utf8'));
  assert.equal(manifest.bootSkeleton, true);
});

test('civitai-block-starter: the skeleton markup lives INSIDE #root', () => {
  const html = readFileSync(join(BLOCK_STARTER, 'index.html'), 'utf8');
  const root = parseHtml(html);
  const find = (node, pred) => {
    for (const c of node.children ?? []) {
      if (c.type !== 'element') continue;
      if (pred(c)) return c;
      const hit = find(c, pred);
      if (hit) return hit;
    }
    return null;
  };
  const container = find(root, (el) => el.attrs.id === 'root');
  assert.ok(container, '#root must exist in index.html');
  const skeleton = find(container, (el) => 'data-boot-skeleton' in el.attrs);
  assert.ok(skeleton, '[data-boot-skeleton] must be a DESCENDANT of #root');
  assert.equal(
    skeleton.attrs['aria-hidden'],
    'true',
    'the skeleton is decorative; the host already publishes aria-busy on the iframe',
  );
});

test('civitai-block-starter: the boot theme defaults to DARK, structurally', () => {
  const html = readFileSync(join(BLOCK_STARTER, 'index.html'), 'utf8');
  const shape = readThemeShape(html);

  assert.equal(
    shape.colorSchemeMeta,
    'dark light',
    '<meta name="color-scheme"> must list dark FIRST — it decides the UA canvas colour ' +
      'before any CSS is parsed, and "light dark" bets the wrong way',
  );

  assert.deepEqual(
    shape.darkMediaBlocks,
    [],
    'there must be NO @media (prefers-color-scheme: dark) block. Dark is the BASE. Supplying ' +
      'the dark values from inside a dark media query hands no-preference / query-less UAs ' +
      'the light theme, which is the exact inversion this guard exists to prevent.',
  );

  assert.ok(
    shape.lightMediaBlocks.length >= 1,
    'light must be applied only inside @media (prefers-color-scheme: light)',
  );

  // The base rules must actually carry the dark values.
  const htmlBg = /html\s*\{[^}]*background:\s*([^;}]+)/i.exec(shape.baseCss);
  assert.ok(htmlBg, 'the base rules must set `html { background: … }` — this is the strong ' +
    'guarantee, independent of `color-scheme` support');
  const baseBg = htmlBg[1].trim().toLowerCase();
  const lightBg = /html\s*\{[^}]*background:\s*([^;}]+)/i.exec(shape.lightMediaBlocks.join('\n'));
  assert.ok(lightBg, 'the light media block must override html background');
  assert.notEqual(
    baseBg,
    lightBg[1].trim().toLowerCase(),
    'base and light html backgrounds are identical — one of them is not doing anything',
  );
  assert.ok(
    isDarkHex(baseBg),
    `base html background ${baseBg} is not a dark colour; dark is supposed to be the base`,
  );
  assert.ok(
    !isDarkHex(lightBg[1].trim().toLowerCase()),
    `the prefers-color-scheme: light override (${lightBg[1].trim()}) is a dark colour`,
  );
});

test('civitai-block-starter: index.css color-scheme stays dark-first too', () => {
  // Load-bearing, and easy to miss: a CSS `color-scheme` declaration OVERRIDES
  // the meta tag, and Vite emits index.css as a render-blocking <link> in the
  // BUILT document. `light dark` here silently re-inverts the meta's bet.
  const css = readFileSync(join(BLOCK_STARTER, 'src', 'index.css'), 'utf8');
  const m = /color-scheme:\s*([^;]+);/i.exec(css);
  assert.ok(m, 'index.css must declare color-scheme');
  assert.equal(m[1].trim(), 'dark light');
});

/** Relative luminance of a #rgb/#rrggbb below the midpoint. */
function isDarkHex(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  assert.ok(m, `expected a hex colour, got ${value}`);
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}
