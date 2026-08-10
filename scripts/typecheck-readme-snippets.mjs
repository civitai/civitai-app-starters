#!/usr/bin/env node
/**
 * typecheck-readme-snippets.mjs
 * -----------------------------
 * Extracts ```ts / ```tsx fenced code blocks from the published packages'
 * READMEs (and the root docs guide) and runs `tsc --noEmit` against each one,
 * with the SDK packages' built `.d.ts` resolved via tsconfig `paths`. This
 * keeps the README examples from rotting: if a documented import disappears or
 * a call signature changes, this fails in CI.
 *
 * WHAT IT CHECKS
 *   - Imports from `@civitai/app-sdk` (+ subpaths) and `@civitai/blocks-react`
 *     (+ `/ui`) RESOLVE against the built declarations.
 *   - The documented exports EXIST and are CALLED with type-compatible args.
 *
 * WHAT IT TOLERATES (so partial doc snippets still pass)
 *   - Free identifiers a snippet references but doesn't declare (e.g. `modelId`,
 *     `prompt`, `manifest`). These surface as `TS2304: Cannot find name 'X'`;
 *     the runner injects `declare const X: any;` + `type X = any;` for each and
 *     re-checks. A genuine API error (wrong args, missing export, bad shape) is
 *     a different code and still fails.
 *
 * 🔴 THE `type X = any` SHIM USED TO SWALLOW A WHOLE CLASS OF DOC BUG, AND THIS
 * IS THE HOLE IT LEFT. The auto-import map was built from VALUE exports only
 * (`SymbolFlags.Value`), so a TYPE-only export — every `interface` / `type` in
 * the SDK, e.g. `ConsentUnavailablePayload` — could never resolve to a real
 * import and always fell through to `type X = any`. A snippet writing
 * `payload as SomeType` therefore PASSED whether or not `SomeType` was imported,
 * and passed EVEN IF NO SUCH TYPE EXISTED: substituting a deliberately bogus
 * `ConsentUnavailablePayloadDOESNOTEXIST` produced a clean `43 passed / 0
 * failed`. A reader would reasonably cite this gate as proof the snippet
 * compiles; it proved only that the runner had shimmed the name away.
 *
 * A TYPE export map is now built alongside the value map, and a missing name
 * that resolves in it gets a REAL `import type { X } from '<module>'` instead of
 * a shim — so a type that does not exist, or one the doc forgot to import from a
 * subpath it never mentions, now FAILS. Only a name in NEITHER map falls back to
 * `any` (genuine free identifiers like `modelId`, and types local to the doc's
 * own narrative). Regression-tested by `scripts/test-readme-snippet-gate.mjs`,
 * which is the negative control: it asserts a bogus type name FAILS.
 *   - Top-level `await` and hooks-called-as-statements: each snippet body is
 *     wrapped in an `async` function.
 *   - Unused locals/params (relaxed compiler flags).
 *
 * OPT-OUT
 *   Put `// @ts-skip-readme` (optionally `// @ts-skip-readme: <reason>`) as the
 *   FIRST non-empty line of a fenced block to skip it — for intentionally
 *   incomplete or illustrative snippets that can't be made to typecheck without
 *   distorting the doc. The reason is printed in the run summary.
 *
 * NON-CHECKABLE FENCES
 *   Only ```ts and ```tsx blocks are checked. ```bash / ```json / ```jsonc /
 *   plain ``` are skipped automatically.
 *
 * USAGE
 *   node scripts/typecheck-readme-snippets.mjs
 *   Requires the SDK packages to be BUILT first (their dist/*.d.ts must exist):
 *     pnpm --filter @civitai/app-sdk build
 *     pnpm --filter @civitai/blocks-react build
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const SDK_DIST = join(repoRoot, 'packages/civitai-app-sdk/dist');
const BLOCKS_DIST = join(repoRoot, 'packages/civitai-blocks-react/dist');

// The published subpaths an agent imports from, mapped to the built declaration
// entry. Used to (a) resolve free identifiers to a REAL import instead of an
// `any` shim — so import-omitting reference fragments validate against the true
// types — and (b) typecheck the imports themselves.
const SDK_PKG = join(repoRoot, 'packages/civitai-app-sdk');
const ENTRYPOINTS = [
  { module: '@civitai/app-sdk', dts: join(SDK_DIST, 'index.d.ts') },
  { module: '@civitai/app-sdk/oauth', dts: join(SDK_DIST, 'oauth/index.d.ts') },
  { module: '@civitai/app-sdk/scopes', dts: join(SDK_DIST, 'scopes/index.d.ts') },
  { module: '@civitai/app-sdk/cookies', dts: join(SDK_DIST, 'cookies/index.d.ts') },
  { module: '@civitai/app-sdk/orchestrator', dts: join(SDK_DIST, 'orchestrator/index.d.ts') },
  { module: '@civitai/app-sdk/blocks', dts: join(SDK_DIST, 'blocks/index.d.ts') },
  { module: '@civitai/blocks-react', dts: join(BLOCKS_DIST, 'index.d.ts') },
  { module: '@civitai/blocks-react/ui', dts: join(BLOCKS_DIST, 'ui/index.d.ts') },
];

/**
 * Build TWO `identifier -> import-module` maps across the published
 * entrypoints, using the TypeScript compiler API (resolves nested
 * `export * from` re-exports that a regex can't):
 *
 *   `values` — exports usable in VALUE position (functions, consts, classes,
 *              enums). Injected as `import { X } from '…'`.
 *   `types`  — exports usable ONLY in TYPE position (`interface`, `type`).
 *              Injected as `import type { X } from '…'`.
 *
 * When a snippet references a known SDK export it didn't import, we inject the
 * real import — so even a one-line per-hook fragment is checked against the
 * genuine type, not `any`. The `types` map is what makes a missing/nonexistent
 * TYPE name a failure instead of a silent `type X = any` shim (see the header).
 *
 * A symbol carrying BOTH flags (a class, an enum) lands in `values` only —
 * a plain value import covers both positions.
 *
 * First-wins on collisions (entry order above), so a bare `@civitai/app-sdk`
 * import is preferred over a subpath.
 */
function buildExportMap() {
  const map = new Map();
  const typeMap = new Map();
  let ts;
  try {
    const req = createRequire(join(SDK_PKG, 'package.json'));
    ts = req('typescript');
  } catch {
    // No local typescript — fall back to no auto-import (snippets still get the
    // `any`-shim path, so the runner degrades gracefully rather than crashing).
    return { values: map, types: typeMap };
  }
  const opts = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
    allowJs: true,
    noEmit: true,
  };
  for (const { module, dts } of ENTRYPOINTS) {
    if (!existsSync(dts)) continue;
    const prog = ts.createProgram([dts], opts);
    const checker = prog.getTypeChecker();
    const sf = prog.getSourceFile(dts);
    const sym = sf && checker.getSymbolAtLocation(sf);
    if (!sym) continue;
    for (const exp of checker.getExportsOfModule(sym)) {
      // A re-export (`export { x } from './y.js'`) is an ALIAS symbol — resolve
      // it to its target before checking for value-ness, else everything looks
      // like a non-value.
      let resolved = exp;
      if ((exp.flags & ts.SymbolFlags.Alias) !== 0) {
        try {
          resolved = checker.getAliasedSymbol(exp);
        } catch {
          resolved = exp;
        }
      }
      const name = exp.getName();
      if ((resolved.flags & ts.SymbolFlags.Value) !== 0) {
        // Usable in value position — a plain `import { X }` covers both
        // positions, so a class/enum never needs a `import type` entry too.
        if (!map.has(name)) map.set(name, module);
        continue;
      }
      // TYPE-ONLY export (`interface` / `type`). Importing it as a VALUE would
      // error, so it gets its own map and an `import type { X }` injection.
      // `SymbolFlags.Type` alone is too narrow here: a type alias resolves with
      // `TypeAlias`, an interface with `Interface`, so test the composite.
      const TYPEISH =
        ts.SymbolFlags.Type | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface;
      if ((resolved.flags & TYPEISH) === 0) continue;
      if (!typeMap.has(name)) typeMap.set(name, module);
    }
  }
  return { values: map, types: typeMap };
}

// Snippet temp dirs live INSIDE the blocks-react package so Node-style module
// resolution climbs into its node_modules — which already has `react`,
// `react-dom`, `@types/react`, `@types/node`, and the symlinked
// `@civitai/app-sdk` (+ its `/schemas/*` subpath via the exports map). The only
// import that can't resolve that way is the blocks-react SELF import (a package
// has no self-symlink), so we map just that via tsconfig `paths`.
const BLOCKS_PKG = join(repoRoot, 'packages/civitai-blocks-react');
const TMP_PARENT = join(BLOCKS_PKG, '.readme-snippets-tmp');

// Docs whose ts/tsx fences we typecheck. Add to this list to cover more docs.
const DOCS = [
  'packages/civitai-app-sdk/README.md',
  'packages/civitai-blocks-react/README.md',
  'docs/build-your-first-app-block.md',
];

const SKIP_MARKER = '@ts-skip-readme';

/** Pull every ```ts / ```tsx fenced block out of a markdown string. */
function extractBlocks(md, file) {
  const lines = md.split('\n');
  const blocks = [];
  let inBlock = false;
  let lang = '';
  let buf = [];
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w+)?/);
    if (!inBlock && fence) {
      inBlock = true;
      lang = (fence[1] ?? '').toLowerCase();
      buf = [];
      startLine = i + 1;
      continue;
    }
    if (inBlock && /^```\s*$/.test(line)) {
      inBlock = false;
      if (lang === 'ts' || lang === 'tsx') {
        blocks.push({ file, lang, startLine, code: buf.join('\n') });
      }
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return blocks;
}

/** First non-empty line — used to detect the opt-out marker. */
function firstNonEmptyLine(code) {
  for (const l of code.split('\n')) {
    if (l.trim().length) return l.trim();
  }
  return '';
}

/** Split a snippet into its leading import/`with`-attribute lines and the rest. */
function splitImports(code) {
  const lines = code.split('\n');
  const imports = [];
  const body = [];
  let stillImports = true;
  let inImport = false;
  for (const line of lines) {
    const t = line.trim();
    if (stillImports && (inImport || /^import[\s{*]/.test(t) || /^import\s+\w/.test(t))) {
      imports.push(line);
      // A multi-line import continues until the line that ends the statement.
      if (/;?\s*$/.test(t) && (t.endsWith(';') || /from\s+['"][^'"]+['"]/.test(t) || /['"];?$/.test(t))) {
        inImport = false;
      } else {
        inImport = true;
      }
      // Once a non-import, non-blank line appears we stop treating lines as imports.
      continue;
    }
    if (stillImports && t === '') {
      // Blank lines between imports are fine; keep them with the body so output
      // is tidy. They don't end the import region.
      body.push(line);
      continue;
    }
    stillImports = false;
    body.push(line);
  }
  return { imports: imports.join('\n'), body: body.join('\n') };
}

/**
 * Assemble a typecheckable module from a snippet: imports hoisted to the top,
 * `declare`d free-variable shims after them, then the body kept at MODULE scope.
 *
 * Module scope (not a wrapper function) is deliberate: top-level await is legal
 * in an ES module, hooks/JSX as expression statements are legal, and the doc's
 * own top-level `function App() {...}` / `interface X {...}` declarations stay
 * valid. We only strip a leading `export ` (illegal-free here, and irrelevant to
 * typechecking) and guarantee the file is a module so top-level await is allowed.
 */
function buildSource({ imports, body }, { autoImports = '', declares = '' } = {}) {
  // `export function App()` → `function App()`, etc. The export modifier is
  // pure noise for a typecheck and the snippet never gets emitted.
  const bodyNoExport = body.replace(/^(\s*)export\s+/gm, '$1');
  const hasModuleSyntax = imports.trim().length > 0 || autoImports.trim().length > 0;
  return [
    imports,
    autoImports,
    declares,
    bodyNoExport,
    // Ensure the file is a module (required for top-level await) even when the
    // snippet has no imports/exports of its own.
    hasModuleSyntax ? '' : 'export {};',
  ]
    .filter(Boolean)
    .join('\n');
}

function makeTsconfig(dir, isTsx) {
  const cfg = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      jsx: isTsx ? 'react-jsx' : undefined,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      noEmit: true,
      // Relaxed so partial snippets aren't punished for unused/implicit-ish bits.
      noUnusedLocals: false,
      noUnusedParameters: false,
      allowImportingTsExtensions: false,
      // The snippet dir is inside packages/civitai-blocks-react, so `react`,
      // `@types/node`, `@types/react`, and `@civitai/app-sdk` resolve from that
      // package's node_modules. Only the SELF import needs an explicit map.
      paths: {
        '@civitai/blocks-react': [BLOCKS_DIST + '/index.d.ts'],
        '@civitai/blocks-react/*': [BLOCKS_DIST + '/*'],
      },
      baseUrl: '.',
    },
    include: ['snippet.ts', 'snippet.tsx'],
  };
  // Drop undefined keys so tsc doesn't choke.
  cfg.compilerOptions = JSON.parse(JSON.stringify(cfg.compilerOptions));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(cfg, null, 2));
}

/** Resolve the workspace's local tsc binary. */
function tscBin() {
  const bin = join(repoRoot, 'packages/civitai-app-sdk/node_modules/.bin/tsc');
  if (existsSync(bin)) return bin;
  const root = join(repoRoot, 'node_modules/.bin/tsc');
  if (existsSync(root)) return root;
  return 'tsc';
}

function runTsc(dir) {
  try {
    execFileSync(tscBin(), ['-p', join(dir, 'tsconfig.json')], {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { ok: true, out: '' };
  } catch (err) {
    return { ok: false, out: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

/**
 * Free-identifier names a snippet uses but doesn't declare. Covers:
 *   TS2304  Cannot find name 'X'
 *   TS2552  Cannot find name 'X'. Did you mean 'Y'?  (emitted instead of 2304
 *           when a similarly-named symbol is in scope)
 *   TS18004 No value exists in scope for the shorthand property 'X'
 * All three mean "the doc references X without defining it" — shim with `any`.
 */
function collectMissingNames(out) {
  const names = new Set();
  for (const re of [
    /error TS2304: Cannot find name '([^']+)'/g,
    /error TS2552: Cannot find name '([^']+)'/g,
    /error TS18004: No value exists in scope for the shorthand property '([^']+)'/g,
  ]) {
    let m;
    while ((m = re.exec(out)) !== null) names.add(m[1]);
  }
  return names;
}

/**
 * Diagnostic codes that are ARTIFACTS of shimming a free identifier to `any`,
 * not real doc bugs — tolerated so an import-omitting reference fragment (e.g.
 * `const v = storage.get<MyShape>(...)` where `storage`/`useX` was shimmed)
 * still passes:
 *   TS2347  Untyped function calls may not accept type arguments
 *           (a shimmed `any` callee + `<T>` type args, e.g. `useRef<...>` or
 *           `storage.get<...>` when the producing hook wasn't imported)
 * A real signature/shape error surfaces under a DIFFERENT code and still fails.
 */
const TOLERATED_CODES = new Set(['TS2347']);

/** Strip tolerated-code diagnostic lines; returns the remaining hard errors. */
function hardErrorLines(out) {
  return out
    .split('\n')
    .filter((line) => {
      const m = line.match(/error (TS\d+):/);
      if (!m) return false;
      return !TOLERATED_CODES.has(m[1]);
    });
}

/**
 * Render `import { a, b } from 'mod';` lines from a name→module map.
 * `kind: 'type'` renders `import type { … }` — required for a type-only export,
 * which cannot legally be imported in value position.
 */
function renderAutoImports(autoByModule, kind = 'value') {
  const lines = [];
  const keyword = kind === 'type' ? 'import type' : 'import';
  for (const [module, names] of autoByModule) {
    lines.push(`${keyword} { ${[...names].join(', ')} } from '${module}';`);
  }
  return lines.join('\n');
}

function checkBlock(block, exportMap) {
  const isTsx = block.lang === 'tsx';
  const { imports, body } = splitImports(block.code);
  const declared = new Set();
  // module -> Set<name> of SDK exports the snippet used but didn't import. We
  // inject the REAL import so the fragment is checked against the true type.
  const autoByModule = new Map();
  // Same, for TYPE-ONLY exports — injected as `import type`.
  const autoTypeByModule = new Map();
  // Names already imported in the snippet's own import block — never re-import
  // (would be a duplicate-identifier error).
  const alreadyImported = new Set(
    [...imports.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]),
  );
  mkdirSync(TMP_PARENT, { recursive: true });
  const dir = mkdtempSync(join(TMP_PARENT, 'snip-'));
  try {
    makeTsconfig(dir, isTsx);
    const fileName = isTsx ? 'snippet.tsx' : 'snippet.ts';
    let lastOut = '';
    // Iteratively resolve free identifiers: a known SDK export gets a REAL
    // injected import (checked against its true type); anything else gets an
    // `any` shim (`declare const`/`type`). A real API error has a code that
    // survives both and fails the snippet.
    for (let pass = 0; pass < 12; pass++) {
      const declares = [...declared]
        .map((n) => `declare const ${n}: any;\ntype ${n} = any;`)
        .join('\n');
      const autoImports = [
        renderAutoImports(autoByModule),
        renderAutoImports(autoTypeByModule, 'type'),
      ]
        .filter(Boolean)
        .join('\n');
      const src = buildSource({ imports, body }, { autoImports, declares });
      writeFileSync(join(dir, fileName), src);
      const { ok, out } = runTsc(dir);
      if (ok) return { ok: true };
      lastOut = out;
      const missing = collectMissingNames(out);
      let added = false;
      for (const n of missing) {
        if (declared.has(n) || alreadyImported.has(n)) continue;
        const mod = exportMap.values.get(n);
        const typeMod = exportMap.types.get(n);
        if (mod) {
          if (!autoByModule.has(mod)) autoByModule.set(mod, new Set());
          const set = autoByModule.get(mod);
          if (!set.has(n)) {
            set.add(n);
            added = true;
          }
        } else if (typeMod) {
          // A TYPE-ONLY export: `import type`, never a `type X = any` shim —
          // the shim is what let a nonexistent type name pass (see header).
          if (!autoTypeByModule.has(typeMod)) autoTypeByModule.set(typeMod, new Set());
          const set = autoTypeByModule.get(typeMod);
          if (!set.has(n)) {
            set.add(n);
            added = true;
          }
        } else {
          declared.add(n);
          added = true;
        }
      }
      if (!added) {
        // No new free vars to shim. If every remaining diagnostic is a tolerated
        // shimming artifact (TS2347), treat the snippet as passing; otherwise
        // the leftover errors are real doc bugs.
        const hard = hardErrorLines(out);
        if (hard.length === 0) return { ok: true };
        return { ok: false, out: hard.join('\n') };
      }
    }
    return { ok: false, out: lastOut };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  if (!existsSync(join(SDK_DIST, 'index.d.ts')) || !existsSync(join(BLOCKS_DIST, 'index.d.ts'))) {
    console.error(
      'ERROR: built declarations missing. Build the SDK packages first:\n' +
        '  pnpm --filter @civitai/app-sdk build\n' +
        '  pnpm --filter @civitai/blocks-react build',
    );
    process.exit(2);
  }

  const exportMap = buildExportMap();
  // 🔴 Print BOTH counts. A zero on either side means that half of the
  // auto-import resolution is wired to nothing and every name it should have
  // covered is silently falling back to an `any` shim — which reads as a clean
  // run. `scripts/test-readme-snippet-gate.mjs` is the negative control.
  console.log(
    `Resolved ${exportMap.values.size} SDK value exports and ${exportMap.types.size} ` +
      `type-only exports for auto-import.\n`,
  );

  let total = 0;
  let checked = 0;
  let skipped = 0;
  const failures = [];

  for (const rel of DOCS) {
    const file = join(repoRoot, rel);
    if (!existsSync(file)) {
      console.log(`- ${rel}: (not found, skipping)`);
      continue;
    }
    const blocks = extractBlocks(readFileSync(file, 'utf8'), rel);
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      total++;
      const first = firstNonEmptyLine(block.code);
      if (first.includes(SKIP_MARKER)) {
        skipped++;
        const reason = first.split(SKIP_MARKER)[1]?.replace(/^[:\s]+/, '') || '(no reason given)';
        console.log(`  SKIP  ${rel}:${block.startLine} [${block.lang}] — ${reason}`);
        continue;
      }
      const res = checkBlock(block, exportMap);
      if (res.ok) {
        checked++;
        console.log(`  PASS  ${rel}:${block.startLine} [${block.lang}]`);
      } else {
        console.log(`  FAIL  ${rel}:${block.startLine} [${block.lang}]`);
        failures.push({ rel, line: block.startLine, lang: block.lang, out: res.out });
      }
    }
  }

  // Clean up the snippet scratch dir.
  rmSync(TMP_PARENT, { recursive: true, force: true });

  console.log(
    `\nREADME snippets: ${total} found · ${checked} passed · ${skipped} skipped · ${failures.length} failed`,
  );

  if (failures.length) {
    console.error('\n--- failures ---');
    for (const f of failures) {
      console.error(`\n${f.rel}:${f.line} [${f.lang}]`);
      console.error(f.out.trim());
    }
    process.exit(1);
  }
}

main();
