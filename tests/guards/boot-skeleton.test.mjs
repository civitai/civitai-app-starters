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
 * a directory moves. These are FLOORS, not the inventory: every manifest under
 * starters/ (civitai-block-starter plus every example) is found by the walk,
 * and every one of them declares bootSkeleton today — derive the live numbers
 * with `find starters -name block.manifest.json -not -path '*node_modules*'`.
 * Raise these when the real numbers rise; never lower them to make a run green.
 */
const MIN_MANIFESTS = 12;
const MIN_DECLARING = 12;

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

/**
 * "This app opted into bootSkeleton" — answered by the platform gate itself,
 * not restated here, so this guard can never select a different set than the
 * gate arms on. (Strictly `true`: a string "true" does not arm it.)
 */
function declaresBootSkeleton(manifest) {
  return checkBootSkeleton({ manifest, html: '' }).applicable;
}

/**
 * The ONE list of apps that declare bootSkeleton, from ONE walk. The coupling
 * sweep and THEMED_APPS both read this variable, so they cannot select
 * different sets.
 */
const ALL_BLOCK_APPS = collectBlockApps();
const DECLARING_APPS = ALL_BLOCK_APPS.filter((a) => declaresBootSkeleton(a.manifest));

test('declaresBootSkeleton arms on exactly `true`, like the platform gate', () => {
  assert.equal(declaresBootSkeleton({ bootSkeleton: true }), true);
  for (const manifest of [null, {}, { bootSkeleton: false }, { bootSkeleton: 'true' }, { bootSkeleton: 1 }]) {
    assert.equal(declaresBootSkeleton(manifest), false, JSON.stringify(manifest));
  }
});

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

// The React theme-sync instrument, against fixtures. The case that matters most
// is an ungated effect beside a render-time gate: a file-wide phrase match
// passed it. Every branch of reactThemeSyncErrors has a fixture that only it
// can turn red.
const reactApp = (
  effectBody,
  { renderGate = true, extra = '', deps = '[ready, theme]', before = '' } = {},
) => `
export function App() {
  const { ready, theme } = useBlock();
  useEffect(() => {
    if (!ready) return;
    console.log('unrelated effect');
  }, [ready]);${before}
  useEffect(() => {${effectBody}
  }, ${deps});${extra}
  ${renderGate ? "if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;" : ''}
  return <div data-theme={theme}>{'}'}</div>;
}`;
const GATED = `
    if (!ready) return;
    document.documentElement.dataset.theme = theme;`;
const UNGATED = `
    document.documentElement.dataset.theme = theme;`;
const onlyError = (src, re) => {
  const errors = reactThemeSyncErrors(src);
  assert.equal(errors.length, 1, `expected one error, got ${JSON.stringify(errors)}`);
  assert.match(errors[0], re);
  return errors[0];
};

test('react theme sync: PASSES the gate inside the effect that writes <html>', () => {
  assert.deepEqual(reactThemeSyncErrors(reactApp(GATED)), []);
  assert.deepEqual(reactThemeSyncErrors(reactApp(GATED, { renderGate: false })), []);
  assert.deepEqual(
    reactThemeSyncErrors(
      reactApp(`
    if (!ready) return;
    document.documentElement.setAttribute('data-theme', theme);`),
    ),
    [],
  );
});

test('react theme sync: comments and strings do not derail the parse', () => {
  // A trailing comment with an apostrophe once opened a fake string, and the
  // check reported correctly gated code as "not gated".
  for (const body of [
    `
    if (!ready) return; // don't clobber a dark host's seed
    document.documentElement.dataset.theme = theme;`,
    `
    /* the host's theme, once it's known */
    if (!ready) return;
    document.documentElement.dataset.theme = theme;`,
    `
    if (!ready) return;
    const docs = 'https://example.invalid//theme'; // a // inside a string survives
    const open = '{{';
    document.documentElement.dataset.theme = theme;`,
  ]) {
    assert.deepEqual(reactThemeSyncErrors(reactApp(body)), [], body);
  }
  // A COMMENT that names the write in another effect is not a second writer.
  assert.deepEqual(
    reactThemeSyncErrors(
      reactApp(GATED, {
        before: `
  useEffect(() => {
    // mirrors document.documentElement.dataset.theme = theme, below
    if (!ready) return;
  }, [ready]);`,
      }),
    ),
    [],
  );
});

test('react theme sync: a `//` inside a string does not start a comment', () => {
  // If the stripper read `//api` as a comment it would drop the `{` that
  // follows on the same line, the effect would close at the options' `}`, and
  // the write after it would land outside every effect.
  assert.deepEqual(
    reactThemeSyncErrors(
      reactApp(`
    if (!ready) return;
    void fetch('https://x/api', {
      method: 'POST',
    });
    document.documentElement.dataset.theme = theme;`),
    ),
    [],
  );
});

test('react theme sync: an apostrophe in JSX text does not swallow the next lines', () => {
  // JSX text is not a string literal, but a scanner sees its apostrophe as one.
  // Ending quoted strings at a newline (as JS does) keeps the comment below
  // a comment; otherwise its mention of the write counts as a stray write.
  const src = `
export function App() {
  const { ready, theme } = useBlock();
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);
  if (!ready) return <div>Loading…</div>;
  return (
    <div data-theme={theme}>
      <p>Don't panic</p>
      {/* the effect above sets document.documentElement.dataset.theme = theme */}
      <p>{'ok'}</p>
    </div>
  );
}`;
  assert.deepEqual(reactThemeSyncErrors(src), []);
});

test('react theme sync: a regex literal is skipped, or reported as unparseable', () => {
  // `/:\/\//` contains `//`; read as a comment it would eat the `{` after it
  // and report "no useEffect writes…" for a correctly gated effect.
  assert.deepEqual(
    reactThemeSyncErrors(
      reactApp(`
    if (!ready) return;
    const url = String(location.href);
    if (/:\\/\\//.test(url)) {
      console.log('absolute');
    }
    document.documentElement.dataset.theme = theme;`),
    ),
    [],
  );
  const msg = onlyError(
    reactApp(`
    if (!ready) return;
    const r = /never closed
    document.documentElement.dataset.theme = theme;`),
    /^could not parse App\.tsx: unterminated regex literal/,
  );
  assert.doesNotMatch(msg, /gated|does not open|no `useEffect/);
});

test('react theme sync: FAILS an ungated effect even with a render-time gate present', () => {
  const src = reactApp(UNGATED);
  assert.match(src, /if \(!ready\) return <div/, 'fixture must carry the render-time gate');
  assert.match(src, /if \(!ready\) return;/, 'fixture must carry a gate in ANOTHER effect');
  onlyError(src, /does not open with `if \(!ready\) return;`/);
});

test('react theme sync: the per-app assertion is this instrument, not a phrase match', () => {
  // A file-wide `if (!ready) return` match passes this fixture; the per-app
  // test's only call, assertReactThemeSync, must reject it.
  const src = reactApp(UNGATED);
  assert.match(src, /if \(!ready\)\s*return/, 'the old phrase match would pass this fixture');
  assert.throws(() => assertReactThemeSync(src), /does not open with `if \(!ready\) return;`/);
  assert.doesNotThrow(() => assertReactThemeSync(reactApp(GATED)));
});

test('react theme sync: the gate must OPEN the effect, not follow the write', () => {
  onlyError(
    reactApp(`
    document.documentElement.dataset.theme = theme;
    if (!ready) return;`),
    /does not open with/,
  );
});

test('react theme sync: a COMMENT naming the gate inside the effect is not a gate', () => {
  onlyError(
    reactApp(`
    // if (!ready) return;
    document.documentElement.dataset.theme = theme;`),
    /does not open with/,
  );
});

test('react theme sync: FAILS when no effect writes <html> data-theme', () => {
  onlyError(
    reactApp(`
    if (!ready) return;
    document.body.dataset.theme = theme;`),
    /no `useEffect/,
  );
});

test('react theme sync: FAILS two effects that both write <html>', () => {
  onlyError(
    reactApp(GATED, {
      extra: `
  useEffect(() => {${GATED}
  }, [ready, theme]);`,
    }),
    /2 effects write <html> data-theme; expected exactly one/,
  );
});

test('react theme sync: FAILS an ungated write under another hook or in render', () => {
  onlyError(
    reactApp(GATED, {
      extra: `
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);`,
    }),
    /1 write\(s\) to <html> data-theme outside the gated useEffect/,
  );
  onlyError(
    reactApp(GATED, {
      extra: `
  document.documentElement.setAttribute('data-theme', theme);`,
    }),
    /1 write\(s\) to <html> data-theme outside the gated useEffect/,
  );
});

test('react theme sync: the effect must re-run on theme (and ready)', () => {
  onlyError(reactApp(GATED, { deps: '[ready]' }), /deps must list ready and theme \(found \[ready\]\)/);
  onlyError(reactApp(GATED, { deps: '[theme]' }), /deps must list ready and theme/);
});

test('react theme sync: an unparseable source says so, never "not gated"', () => {
  const unbalanced = `
export function App() {
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
    if (x) {
  }, [ready, theme]);
`;
  const msg = onlyError(unbalanced, /^could not parse the useEffect/);
  assert.doesNotMatch(msg, /gated|does not open/);
  onlyError(`${reactApp(GATED)}\n/* never closed`, /^could not parse App\.tsx/);
});

// ---------------------------------------------------------------------------
// 2. The repo sweep. THIS is the guard; everything above proves it can go red.
// ---------------------------------------------------------------------------

test('every starter that ships a block.manifest.json satisfies the coupling', () => {
  const apps = ALL_BLOCK_APPS;

  assert.ok(
    apps.length >= MIN_MANIFESTS,
    `expected at least ${MIN_MANIFESTS} block.manifest.json files under starters/, found ` +
      `${apps.length} (${apps.map((a) => a.dir).join(', ')}). A sweep that finds nothing is ` +
      `indistinguishable from a passing one — if manifests genuinely moved, fix the walk.`,
  );

  const declaring = DECLARING_APPS;
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
 * 🔴 THE ONLY VALID `sync` VALUES. The theme-sync check below is chosen BY this
 * tag, so an app without one (or with an ambiguous one) would get NEITHER check
 * and pass silently — which is how a merge once dropped generate-studio's sync
 * check. A missing or unknown value is therefore a FAILURE, both here and as a
 * per-app test inside the loop, never a skip.
 */
const SYNC_KINDS = new Set(['react', 'sdk']);

/**
 * `sync` names WHERE an app keeps <html data-theme> in step with the host, because
 * that is the one check whose subject is framework code rather than the shared
 * index.html / index.css / manifest trio:
 *   - 'react' — an effect in src/App.tsx gated on `ready`; the app's src/App.tsx
 *               imports `@civitai/blocks-react`;
 *   - 'sdk'   — `syncTheme` in src/block.ts, run after `initialize()` resolves and
 *               re-run from `app.onChange`; the app's src/block.ts imports
 *               `@civitai/sdk` (civitai-block-starter, which has no framework
 *               since it was converted to web components).
 * Both encode the same three rules: write <html>'s data-theme, re-run on a host
 * theme change, never before BLOCK_INIT.
 *
 * DERIVED from the app's source, not declared: exactly one of the two signals
 * yields that kind. Neither, or both, yields `null` — which is not in SYNC_KINDS,
 * so the app FAILS (never skips) until its sync is unambiguous.
 */
function deriveSyncKind(appDir) {
  const read = (rel) => {
    try {
      return readFileSync(join(appDir, rel), 'utf8');
    } catch {
      return null;
    }
  };
  return syncKindFrom({ appTsx: read(join('src', 'App.tsx')), blockTs: read(join('src', 'block.ts')) });
}

/** The decision itself, over file CONTENTS (null = file absent), so fixtures can pin it. */
function syncKindFrom({ appTsx, blockTs }) {
  // An import statement at the start of a line — prose in a comment, or a
  // string, that NAMES the package does not count.
  const imports = (src, pkg) =>
    src !== null &&
    new RegExp(`^import\\b[^;]*?from\\s+['"]${pkg.replace('/', '\\/')}['"]`, 'm').test(src);
  const react = imports(appTsx, '@civitai/blocks-react');
  const sdk = imports(blockTs, '@civitai/sdk');
  if (react && !sdk) return 'react';
  if (sdk && !react) return 'sdk';
  return null;
}

test('syncKindFrom: exactly one signal decides; neither or both is null', () => {
  const REACT = "import { useBlock } from '@civitai/blocks-react';\n";
  const SDK = "import { initialize } from '@civitai/sdk';\n";
  assert.equal(syncKindFrom({ appTsx: REACT, blockTs: null }), 'react');
  assert.equal(syncKindFrom({ appTsx: null, blockTs: SDK }), 'sdk');
  assert.equal(syncKindFrom({ appTsx: REACT, blockTs: SDK }), null, 'both signals is ambiguous');
  assert.equal(syncKindFrom({ appTsx: null, blockTs: null }), null, 'no signal is not a kind');
  assert.equal(syncKindFrom({ appTsx: 'export {};\n', blockTs: 'export {};\n' }), null);
});

test('syncKindFrom: a commented-out or quoted import is not a signal', () => {
  for (const appTsx of [
    "// import { useBlock } from '@civitai/blocks-react';\nexport {};\n",
    "const s = \"import { useBlock } from '@civitai/blocks-react'\";\n",
  ]) {
    assert.equal(syncKindFrom({ appTsx, blockTs: null }), null, appTsx);
  }
});

/**
 * Every app under starters/ whose manifest declares `bootSkeleton: true` —
 * found by the same walk as the coupling sweep above, never hand-listed. Each
 * one is copied by someone, so each gets the same dark-first checks; a new
 * themed app joins by existing on disk. (A hand-written list here once left
 * three such examples with no per-app checks at all, and nothing failed.)
 */
const appLabel = (a) => relative(STARTERS, join(REPO_ROOT, a.dir)).split('\\').join('/');

const THEMED_APPS = DECLARING_APPS.map((a) => ({
  label: appLabel(a),
  dir: join(REPO_ROOT, a.dir),
  sync: deriveSyncKind(join(REPO_ROOT, a.dir)),
})).sort((x, y) => x.label.localeCompare(y.label));

test('THEMED_APPS is EXACTLY the set the coupling sweep checks', () => {
  // The relationship, not a count: every app the sweep treats as declaring
  // bootSkeleton gets the per-app checks, and nothing else does. A count floor
  // here would miss a filter that drops the newest apps while the total still
  // clears it — the exact defect this derivation replaced.
  // DECLARING_APPS is the very array the coupling sweep iterates.
  const sweepSet = DECLARING_APPS.map(appLabel).sort();
  assert.deepEqual(
    THEMED_APPS.map((a) => a.label).sort(),
    sweepSet,
    'THEMED_APPS and the coupling sweep disagree about which apps declare bootSkeleton',
  );
});

test('THEMED_APPS is derived from disk and includes the block starter', () => {
  // POSITIVE CONTROL for the derivation: a filter wired to nothing would
  // produce zero per-app tests and a green run. The block starter is the one
  // app whose presence (and `sdk` kind) is a fixed fact of this repo.
  const starter = THEMED_APPS.find((a) => a.dir === BLOCK_STARTER);
  assert.ok(starter, 'civitai-block-starter declares bootSkeleton and must be derived');
  assert.equal(starter.sync, 'sdk');
});

test('every THEMED_APPS entry names how it syncs the theme (react | sdk)', () => {
  const bad = THEMED_APPS.filter((a) => !SYNC_KINDS.has(a.sync)).map(
    (a) => `${a.label}: sync=${JSON.stringify(a.sync)}`,
  );
  assert.deepEqual(
    bad,
    [],
    `THEMED_APPS entries without a valid \`sync\` (one of ${[...SYNC_KINDS].join(', ')}) — ` +
      'their theme-sync check would be skipped. The kind is derived: src/App.tsx importing ' +
      '@civitai/blocks-react => react, src/block.ts importing @civitai/sdk => sdk; exactly ' +
      `one must hold:\n  ${bad.join('\n  ')}`,
  );
});

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

  if (!SYNC_KINDS.has(sync)) {
    test(`${label}: names a theme-sync kind`, () => {
      assert.fail(
        `${label} has sync=${JSON.stringify(sync)}; it must be one of ${[...SYNC_KINDS].join(', ')} ` +
          'so that its theme-sync check runs',
      );
    });
  }

  if (sync === 'react') {
    test(`${label}: App.tsx keeps the page in step with the host theme`, () => {
      // THEME_CHANGE arrives only as a transport push — no reload, no new
      // fragment (the host deliberately does not rewrite the iframe src on a
      // toggle). Without this sync a mounted block flips its components but
      // leaves the page behind them in the old theme.
      assertReactThemeSync(readFileSync(join(dir, 'src', 'App.tsx'), 'utf8'));
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

/**
 * The React theme sync, checked structurally. Returns a list of problems
 * (empty = sound):
 *   - exactly one `useEffect(() => { … })` writes <html>'s data-theme;
 *     a "write" is `document.documentElement.dataset.theme = …` or
 *     `document.documentElement.setAttribute('data-theme', …)`, spelled through
 *     `document.documentElement`. 🔴 An ALIASED write
 *     (`const html = document.documentElement; html.dataset.theme = …`) is NOT
 *     detected — neither as the sync nor as an ungated stray;
 *   - EVERY such (unaliased) write in the file sits inside that effect — a second write
 *     under `useLayoutEffect`, another hook or the render body runs ungated;
 *   - that effect's body OPENS with `if (!ready) return;`;
 *   - its deps list both `ready` and `theme`, or a live THEME_CHANGE (or the
 *     ready flip itself) never re-runs it.
 *
 * Why the gate must sit in THAT body: the effect is what writes <html>; a
 * render-time `if (!ready) return <div>…` elsewhere in the component stops
 * nothing, because the effect runs on the first commit regardless — with
 * `theme` still the transport's 'light' sentinel.
 *
 * A source this cannot parse — an unterminated block comment, or a regex
 * literal (see stripJsComments) — reports "could not parse", never "not gated".
 */
function reactThemeSyncErrors(rawSrc) {
  // Comments out first, so prose that NAMES the gate or the write cannot
  // satisfy either, and an apostrophe in a comment cannot open a fake string.
  const stripped = stripJsComments(rawSrc);
  if (stripped.error) return [`could not parse App.tsx: ${stripped.error}`];
  const src = stripped.code;
  const HTML_THEME_WRITE =
    /document\.documentElement\s*\.\s*(?:dataset\.theme\s*=(?!=)|setAttribute\(\s*['"]data-theme['"])/g;
  const READY_GATE = /^\s*if\s*\(\s*!ready\s*\)\s*return\s*;/;
  const countWrites = (s) => (s.match(HTML_THEME_WRITE) ?? []).length;

  const effects = [];
  const effectOpen = /\buseEffect\s*\(\s*\(\s*\)\s*=>\s*\{/g;
  for (let m; (m = effectOpen.exec(src)); ) {
    const open = m.index + m[0].length - 1;
    const close = matchingBrace(src, open);
    if (close < 0) {
      return [`could not parse the useEffect at offset ${m.index}: no matching closing brace`];
    }
    effects.push({ body: src.slice(open + 1, close), after: src.slice(close + 1) });
  }
  const themeEffects = effects.filter((e) => countWrites(e.body) > 0);
  if (themeEffects.length === 0) {
    return [
      'no `useEffect(() => { … })` writes document.documentElement data-theme — the host ' +
        'theme never reaches <html> after mount',
    ];
  }
  if (themeEffects.length > 1) {
    return [`${themeEffects.length} effects write <html> data-theme; expected exactly one`];
  }
  const [effect] = themeEffects;
  const outside = countWrites(src) - countWrites(effect.body);
  if (outside > 0) {
    return [
      `${outside} write(s) to <html> data-theme outside the gated useEffect (another hook, or ` +
        'the render body) — they run before BLOCK_INIT with the sentinel theme',
    ];
  }
  if (!READY_GATE.test(effect.body)) {
    return [
      'the effect that writes <html> data-theme does not open with `if (!ready) return;` — a ' +
        'render-time ready gate elsewhere does not stop the effect from running',
    ];
  }
  const deps = /^\s*,\s*\[([^\]]*)\]/.exec(effect.after);
  const names = new Set((deps?.[1] ?? '').split(',').map((d) => d.trim()));
  if (!deps || !names.has('ready') || !names.has('theme')) {
    return [
      `the theme effect's deps must list ready and theme (found ${deps ? `[${deps[1].trim()}]` : 'none'}) ` +
        '— without theme a live THEME_CHANGE never reaches <html>',
    ];
  }
  return [];
}

/** The per-app React assertion — the ONLY call site the per-app test uses. */
function assertReactThemeSync(src) {
  const errors = reactThemeSyncErrors(src);
  assert.deepEqual(
    errors,
    [],
    `App.tsx's theme sync is unsound:\n  ${errors.join('\n  ')}\n(before BLOCK_INIT \`theme\` is ` +
      "the transport's 'light' sentinel, which would clobber the fragment seed of a dark host)",
  );
}

/**
 * `{ code }`: `src` with every `//` and block comment removed (newlines kept);
 * or `{ error }` when it cannot be stripped safely. String and template
 * literals are copied verbatim, so a `//` inside a string or URL survives.
 * Quoted strings end at a newline, as in JS, so a stray apostrophe (JSX text)
 * cannot swallow the rest of the file.
 *
 * REGEX LITERALS are recognised only by POSITION: a lone `/` after one of
 * `( , = : [ ! & | ? ; {` or `return`/`typeof` starts one; it is scanned to
 * its closing `/` (escapes and `[…]` classes honoured) and replaced by a
 * neutral `/re/`, so a `//`, quote or brace inside it is not misread here or
 * by matchingBrace. One with no closing `/` on its line is an
 * `{ error }`. A `/` anywhere else (division, `</tag>`, `/>`) is ordinary
 * code — a regex in any OTHER position (e.g. after `=>`) is not recognised.
 */
function stripJsComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return { error: 'unterminated block comment' };
      out += src.slice(i, end + 2).replace(/[^\n]/g, '');
      i = end + 1;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      i--;
    } else if (c === "'" || c === '"' || c === '`') {
      const end = literalEnd(src, i);
      out += src.slice(i, end + 1);
      i = end;
    } else if (c === '/' && n !== '>' && /(?:[(,=:[!&|?;{]|\breturn|\btypeof)\s*$/.test(out)) {
      const end = regexEnd(src, i);
      if (end < 0) return { error: `unterminated regex literal at offset ${i}` };
      out += '/re/';
      i = end;
    } else {
      out += c;
    }
  }
  return { code: out };
}

/** Index of the `/` closing the regex literal opening at `i`; -1 if none on its line. */
function regexEnd(src, i) {
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\n') return -1;
    if (c === '\\') j++;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return j;
  }
  return -1;
}

/** Index of the last char of the string/template literal opening at `i`. */
function literalEnd(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === q) return j;
    else if (src[j] === '\n' && q !== '`') return j - 1;
  }
  return src.length - 1;
}

/** Index of the `}` closing the `{` at `open`, skipping string/template literals; -1 if none. */
function matchingBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = literalEnd(src, i);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
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
