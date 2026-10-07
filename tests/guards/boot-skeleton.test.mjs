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
 * READ AS A REGRESSION TEST. At `origin/main` (a560b3d, immediately before
 * this change) the repo-sweep test fails on the literal substring
 * `is empty in the built` and the theme tests fail because `index.html` still
 * carries an OS-preference media query, no fragment fast-path script, and an
 * `index.css` that transparents the page. Re-derive rather than trust this:
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
 * (civitai-block-starter + 6 under starters/examples), all 7 of which declare
 * bootSkeleton (the examples since they adopted the block starter's boot). Raise these when the real numbers rise; never lower them to make
 * a run green.
 */
const MIN_MANIFESTS = 7;
const MIN_DECLARING = 7;

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
// 3. The block starter and every example: the key, the markup, and the dark bet.
// ---------------------------------------------------------------------------

/**
 * The block starter AND the six examples: each one is copied by someone, so each
 * gets the same dark-first checks. A new themed app joins by being listed here.
 *
 * `sync` names WHERE the app keeps <html data-theme> in step with the host, because
 * that is the one check whose subject is framework code rather than the shared
 * index.html / index.css / manifest trio:
 *   - 'react' — an effect in src/App.tsx gated on `ready` (the six examples);
 *   - 'sdk'   — `syncTheme` in src/block.ts, run after `initialize()` resolves and
 *               re-run from `app.onChange` (civitai-block-starter, which has no
 *               framework since it was converted to web components).
 * Both encode the same three rules: write <html>'s data-theme, re-run on a host
 * theme change, never before BLOCK_INIT.
 */
const THEMED_APPS = [
  { label: 'civitai-block-starter', dir: BLOCK_STARTER, sync: 'sdk' },
  ...['hello-world', 'settings', 'buzz-workflow', 'kv-storage', 'scopes-api', 'buzz-purchase'].map((name) => ({
    label: `examples/${name}`,
    dir: join(STARTERS, 'examples', name),
    sync: 'react',
  })),
];

for (const { label, dir, sync } of THEMED_APPS) {
  test(`${label}: manifest declares bootSkeleton: true (parsed, not grepped)`, () => {
    const manifest = JSON.parse(readFileSync(join(dir, 'block.manifest.json'), 'utf8'));
    assert.equal(manifest.bootSkeleton, true);
  });

  test(`${label}: the skeleton markup lives INSIDE #root`, () => {
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
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

  test(`${label}: the boot theme defaults to DARK, structurally`, () => {
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const shape = readThemeShape(html);

    assert.equal(
      shape.colorSchemeMeta,
      'dark light',
      '<meta name="color-scheme"> must list dark FIRST — it decides the UA canvas colour ' +
        'before any CSS is parsed, and "light dark" bets the wrong way',
    );

    // 🔴 The OS/browser preference must NEVER decide this app's theme. Civitai
    // apps default dark; light engages only when the viewer chose light on
    // civitai.com and the HOST says so (fragment fast path → BLOCK_INIT →
    // THEME_CHANGE). Any OS-preference media query in the inline style — dark
    // OR light — hands the decision to a surface that knows nothing about the
    // viewer's site choice, and is the exact defect this guard exists to keep
    // dead: OS-light + site-dark painted dark components on a light page.
    assert.deepEqual(
      shape.darkMediaBlocks,
      [],
      'there must be NO OS-preference media query carrying dark values. Dark is the BASE. ' +
        'Supplying the dark values from inside such a query hands no-preference / query-less ' +
        'UAs the light theme, which is the exact inversion this guard exists to prevent.',
    );
    assert.deepEqual(
      shape.lightMediaBlocks,
      [],
      'there must be NO OS-preference media query carrying light values either. Light is ' +
        'engaged ONLY by the host fragment (`html[data-theme="light"]`), never by the ' +
        'browser preference — an OS-light viewer whose site theme is dark must still get ' +
        'the dark page.',
    );

    // The base rules must actually carry the dark page value.
    const htmlBg = /html\s*\{[^}]*background:\s*([^;}]+)/i.exec(shape.baseCss);
    assert.ok(htmlBg, 'the base rules must set `html { background: … }` — this is the strong ' +
      'guarantee, independent of `color-scheme` support');
    const baseBg = htmlBg[1].trim().toLowerCase();
    assert.ok(
      isDarkHex(baseBg),
      `base html background ${baseBg} is not a dark colour; dark is supposed to be the base`,
    );

    // …and the light override must exist, behind the fragment-gated attribute,
    // and be genuinely lighter.
    const lightRule = /html\[data-theme='light'\]\s*\{([^}]*)\}/i.exec(shape.baseCss);
    assert.ok(
      lightRule,
      'light must be applied ONLY behind `html[data-theme="light"]` — the attribute the ' +
        'inline fragment script and the App effect set. Without this rule a host that says ' +
        '"light" has no way to repaint the page.',
    );
    const lightBg = /background:\s*([^;}]+)/i.exec(lightRule[1]);
    assert.ok(lightBg, 'the light override must set an html background');
    assert.notEqual(
      baseBg,
      lightBg[1].trim().toLowerCase(),
      'base and light html backgrounds are identical — one of them is not doing anything',
    );
    assert.ok(
      !isDarkHex(lightBg[1].trim().toLowerCase()),
      `the html[data-theme="light"] override (${lightBg[1].trim()}) is a dark colour`,
    );

    // The boot skeleton flips with the same attribute — a light page with dark
    // skeleton cards is the mismatch all over again.
    assert.match(
      shape.baseCss,
      /html\[data-theme='light'\][^{}]*\[data-boot-skeleton\]/i,
      'the skeleton shapes must have a light variant keyed on the same attribute, or a ' +
        'host-declared light page shows dark skeleton cards',
    );
  });

  test(`${label}: the theme fast path is the HOST fragment, not the OS`, () => {
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const shape = readThemeShape(html);

    // Exactly one classic inline script must read the fragment pre-paint. The
    // module entry script has type="module" and no text; the fast path has
    // neither.
    const inlineBodies = shape.inlineScripts.filter((s) => s.text.trim() !== '');
    const fastPath = inlineBodies.find((s) => s.text.includes('civitai-block'));
    assert.ok(
      fastPath,
      'an inline classic script must read the #civitai-block=v1 fragment before first paint ' +
        '— without it the host theme arrives only with BLOCK_INIT, after first paint, and ' +
        'a site-light viewer gets a dark flash on every load',
    );
    assert.ok(
      fastPath.type === null,
      'the fast-path script must be a CLASSIC inline script — Vite bundles `type="module"` ' +
        'inline scripts into the entry chunk, which does not run before first paint',
    );
    assert.match(
      fastPath.text,
      /'light'/,
      'the fast path must engage light only for the exact fragment value theme=light; any ' +
        'other value (or no fragment) keeps the dark default',
    );
    assert.match(
      fastPath.text,
      /dataset\.theme|setAttribute/,
      'the fast path must set the data-theme attribute the boot CSS keys on',
    );

    // The whole document must never consult the OS preference — not in CSS,
    // not in JS, not even in a comment (a comment normalising the old mechanism
    // is how the media query came back last time).
    assert.doesNotMatch(
      html,
      /prefers-color-scheme/,
      'index.html must not mention prefers-color-scheme anywhere — the OS preference is not ' +
        'an input to this app\'s theme. If a comment needs the history, point at the guard ' +
        'instead of restating the mechanism.',
    );
    assert.doesNotMatch(
      html,
      /matchMedia/,
      'index.html must not call matchMedia — JS reads the theme from the host fragment, ' +
        'never from the OS',
    );
  });

  test(`${label}: index.css does not override the boot page background`, () => {
    // Load-bearing cascade fact, measured: Vite emits index.css as a <link>
    // AFTER the inline <style> in the built document. Both select `html` at
    // specificity (0,0,1), so a background declared here wins the cascade and
    // silently hands the page back to the OS canvas colour the moment the
    // stylesheet lands — the boot paint survives only until then. The page
    // background belongs to index.html (+ the App effect); this file must not
    // paint it.
    const css = readFileSync(join(dir, 'src', 'index.css'), 'utf8');
    // 🔴 Strip comments FIRST — the rule's own explanatory comment names
    // `background:`, and a check run over uncommented source reads that prose
    // as a declaration (the same comment-as-code failure readThemeShape's
    // dark-media regex once had).
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const htmlOrBodyBg = /(^|[,\s])(?:html|body)[^{]*\{[^}]*background\s*:/i.exec(cssCode);
    assert.ok(
      !htmlOrBodyBg,
      `index.css sets a background on html/body (${htmlOrBodyBg?.[0]}), which overrides the ` +
        'boot <style> by cascade order — see the comment in this file\'s html/body rule',
    );
  });

  test(`${label}: index.css color-scheme stays dark-first too`, () => {
    // Load-bearing, and easy to miss: a CSS `color-scheme` declaration OVERRIDES
    // the meta tag, and Vite emits index.css as a render-blocking <link> in the
    // BUILT document. `light dark` here silently re-inverts the meta's bet.
    const css = readFileSync(join(dir, 'src', 'index.css'), 'utf8');
    const m = /color-scheme:\s*([^;]+);/i.exec(css);
    assert.ok(m, 'index.css must declare color-scheme');
    assert.equal(m[1].trim(), 'dark light');
  });

  if (sync === 'react') {
    test(`${label}: App.tsx keeps the page in step with the host theme`, () => {
      // THEME_CHANGE arrives only as a transport push — no reload, no new
      // fragment (the host deliberately does not rewrite the iframe src on a
      // toggle). Without this sync a mounted block flips its components but
      // leaves the page behind them in the old theme.
      const src = readFileSync(join(dir, 'src', 'App.tsx'), 'utf8');
      assert.match(
        src,
        /document\.documentElement/,
        'the page background lives on <html>; the host theme must reach it',
      );
      assert.match(
        src,
        /dataset\.theme\s*=|setAttribute\(['"]data-theme/,
        'the sync must set the same data-theme attribute the boot CSS keys on',
      );
      assert.match(
        src,
        /if \(!ready\)\s*return/,
        'the sync must be gated on ready — before BLOCK_INIT `theme` is the transport ' +
          "'light' sentinel, which would clobber the fragment seed of a dark host",
      );
    });
  }

  if (sync === 'sdk') {
    test(`${label}: src/block.ts keeps the page in step with the host theme`, () => {
      // THEME_CHANGE arrives only as a bridge push — no reload, no new fragment.
      // Without this sync a mounted block flips nothing: the page AND the
      // <civitai-*> elements (which read the --civitai-* tokens [data-theme]
      // selects) stay in the old theme. The same three rules as the React check:
      //   writes <html> data-theme   -> syncTheme writes documentElement.dataset.theme from app.theme
      //   re-runs on a theme change  -> update() calls syncTheme and is subscribed with app.onChange
      //   never before BLOCK_INIT    -> the first sync runs only AFTER `await waitForHost(...)`
      // (before BLOCK_INIT the bridge snapshot's `theme` is the 'light' sentinel,
      // which would clobber the fragment seed of a dark host).
      const src = readFileSync(join(dir, 'src', 'block.ts'), 'utf8')
        // Comments out first, so prose that NAMES these calls cannot satisfy them.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      const syncFn = /function\s+syncTheme\s*\(\s*app\b[^)]*\)[^{]*\{([^}]*)\}/.exec(src);
      assert.ok(syncFn, 'src/block.ts must define syncTheme(app)');
      assert.match(
        syncFn[1],
        /document\.documentElement\.dataset\.theme\s*=\s*app\.theme\b/,
        'syncTheme must write <html> data-theme from app.theme — the attribute the boot CSS and the tokens key on',
      );

      const mount = /export\s+async\s+function\s+mountBlock\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src);
      assert.ok(mount, 'src/block.ts must export async function mountBlock');
      const body = mount[1];
      const awaitAt = body.search(/await\s+waitForHost\s*\(/);
      const syncAt = body.search(/syncTheme\s*\(\s*app\s*\)/);
      assert.ok(awaitAt >= 0, 'mountBlock must await waitForHost() (the BLOCK_INIT gate)');
      assert.ok(syncAt >= 0, 'mountBlock must call syncTheme(app)');
      assert.ok(
        awaitAt < syncAt,
        'the theme sync must run only AFTER BLOCK_INIT (await waitForHost) — before it, the ' +
          "snapshot theme is the 'light' sentinel and would clobber a dark host's fragment seed",
      );
      const update = /const\s+update\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\n  \};/.exec(body);
      assert.ok(update && /syncTheme\s*\(\s*app\s*\)/.test(update[1]), 'update() must call syncTheme(app)');
      assert.match(
        body,
        /app\.onChange\s*\(\s*update\s*\)/,
        'update must be subscribed with app.onChange, or a live THEME_CHANGE never reaches <html>',
      );
      const callsOutsideDef = (src.replace(syncFn[0], '').match(/syncTheme\s*\(/g) ?? []).length;
      assert.equal(
        callsOutsideDef,
        1,
        'syncTheme must be called from exactly one place (update), so no pre-init call can exist',
      );
    });
  }
}

/** Relative luminance of a #rgb/#rrggbb below the midpoint. */
function isDarkHex(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  assert.ok(m, `expected a hex colour, got ${value}`);
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}
