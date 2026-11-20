/**
 * Every framework MAJOR a starter's docs state must equal the major its own
 * package.json resolves to. A RELATIONSHIP guard: it reads both sides and
 * hardcodes neither, so it fails when a manifest is bumped and the prose is
 * not, in either direction.
 *
 * WHY THIS EXISTS
 * ===============
 * #803 and #806. `starters/next-app` depended on `next ^16.2.11` and
 * `tailwindcss ^4.3.0` while its README badge, intro, package description,
 * AGENTS.md and the root README/AGENTS layout rows all said "Next.js 15", and
 * its AGENTS.md stack said "Tailwind 3.4". The same "Tailwind 3.4" sat in the
 * sveltekit-app, react-pwa and svelte-pwa agent guides (each on
 * `tailwindcss ^4.3.0`), and react-pwa / svelte-pwa said "Vite 7" on
 * `vite ^8.0.14`. Nothing went red because no check read the prose against the
 * manifest; a dependency bump is a one-line diff nobody greps the docs for.
 *
 * WHAT IT READS
 * =============
 *  - Per starter (each `starters/<name>/` with a package.json): every
 *    top-level `*.md` except CHANGELOG.md, plus the manifest's `description`.
 *  - The root README.md and AGENTS.md. A line there is attributed to the FIRST
 *    starter directory name it mentions (`next-app`, `react-pwa`, …). A line
 *    that states a version but names no starter is itself a finding, so a new
 *    root sentence cannot dodge the check by being unattributable.
 *
 * A "version statement" is a framework name followed by a number — prose
 * ("Next.js 16", "Tailwind 4"), shorthand ("Next 16's") and shields.io badge
 * paths ("badge/Vite-8-646cff") alike. The FRAMEWORKS table maps each name to
 * the manifest key whose major it must equal. A statement for a framework the
 * starter's manifest does not depend on is also a finding.
 *
 * 🔴 KNOWN LIMITS
 *  - MAJOR only. "Tailwind 4.1" against `^4.3.0` passes; a minor in prose is a
 *    claim this does not check (the fix for #806 states majors only).
 *  - Only the names in FRAMEWORKS. A new framework mentioned with a version
 *    (say "Hono 4") is invisible until it is added to the table.
 *  - Reads the source tree, not a published scaffold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STARTERS = join(REPO_ROOT, 'starters');

/**
 * name → manifest key. Each pattern's capture group is the stated major: the
 * leading digit run, so "Tailwind 3.4" captures 3.
 */
export const FRAMEWORKS = [
  { name: 'Next.js', pkg: 'next', re: /\bNext(?:\.js)?[ -]v?(\d+)/g },
  { name: 'Tailwind', pkg: 'tailwindcss', re: /\bTailwind(?: ?CSS)?[ -]v?(\d+)/g },
  { name: 'Vite', pkg: 'vite', re: /\bVite[ -]v?(\d+)/g },
  { name: 'React', pkg: 'react', re: /\bReact[ -]v?(\d+)/g },
  { name: 'Svelte', pkg: 'svelte', re: /\bSvelte(?!Kit)[ -]v?(\d+)/g },
  { name: 'SvelteKit', pkg: '@sveltejs/kit', re: /\bSvelteKit[ -]v?(\d+)/g },
];

/** The major a semver range's lower bound names: `^16.2.11` → 16. */
export function manifestMajor(manifest, pkg) {
  const range =
    manifest.dependencies?.[pkg] ??
    manifest.devDependencies?.[pkg] ??
    manifest.peerDependencies?.[pkg];
  if (range === undefined) return undefined;
  const m = /(\d+)/.exec(range);
  return m ? Number(m[1]) : undefined;
}

/** A literal string as a RegExp source: every metacharacter escaped. */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

/** Every version statement in `text`, with 1-based line numbers. */
export function versionStatements(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const fw of FRAMEWORKS) {
      for (const m of line.matchAll(fw.re)) {
        out.push({ line: i + 1, lineText: line, fw, stated: Number(m[1]), match: m[0] });
      }
    }
  });
  return out;
}

/**
 * The whole check as a pure function, so the controls below can feed it
 * fixtures that MUST produce findings.
 *
 * @param {{ starters: Record<string, { manifest: object, docs: Record<string, string> }>,
 *           root: Record<string, string> }} tree
 */
export function audit(tree) {
  const findings = [];
  const statements = [];
  const names = Object.keys(tree.starters);

  const check = (starter, file, s) => {
    statements.push({ starter, file, ...s });
    const manifest = tree.starters[starter].manifest;
    const want = manifestMajor(manifest, s.fw.pkg);
    if (want === undefined) {
      findings.push(
        `${file}:${s.line} states "${s.match}" but starters/${starter}/package.json has no ${s.fw.pkg}`,
      );
    } else if (want !== s.stated) {
      findings.push(
        `${file}:${s.line} states "${s.match}" but starters/${starter}/package.json resolves ${s.fw.pkg} major ${want}`,
      );
    }
  };

  for (const [starter, { manifest, docs }] of Object.entries(tree.starters)) {
    for (const [file, text] of Object.entries(docs)) {
      for (const s of versionStatements(text)) check(starter, file, s);
    }
  }

  for (const [file, text] of Object.entries(tree.root)) {
    for (const s of versionStatements(text)) {
      let first;
      let at = Infinity;
      for (const n of names) {
        const m = new RegExp(`(?<![\\w-])${escapeRegExp(n)}(?![\\w-])`).exec(s.lineText);
        if (m && m.index < at) {
          at = m.index;
          first = n;
        }
      }
      if (!first) {
        findings.push(`${file}:${s.line} states "${s.match}" but names no starter to check it against`);
        continue;
      }
      check(first, file, s);
    }
  }

  return { findings, statements };
}

function loadTree() {
  const starters = {};
  for (const name of readdirSync(STARTERS).sort()) {
    const dir = join(STARTERS, name);
    const pj = join(dir, 'package.json');
    if (!existsSync(pj)) continue;
    const manifest = JSON.parse(readFileSync(pj, 'utf8'));
    const docs = {};
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.md') || f === 'CHANGELOG.md') continue;
      docs[`starters/${name}/${f}`] = readFileSync(join(dir, f), 'utf8');
    }
    docs[`starters/${name}/package.json (description)`] = manifest.description ?? '';
    starters[name] = { manifest, docs };
  }
  const root = {};
  for (const f of ['README.md', 'AGENTS.md']) root[f] = readFileSync(join(REPO_ROOT, f), 'utf8');
  return { starters, root };
}

const tree = loadTree();
const result = audit(tree);

test('every framework major a starter doc states matches that starter’s package.json', (t) => {
  t.diagnostic(`${result.statements.length} version statements checked`);
  assert.deepEqual(result.findings, []);
});

test('POSITIVE CONTROL — every FRAMEWORKS pattern finds at least one statement in the real tree', () => {
  // A pattern that matches nothing makes the check above vacuous for that
  // framework. Each of these frameworks is stated with a version somewhere in
  // the starters' docs today; a regex typo shows up here as a zero.
  const counts = Object.fromEntries(FRAMEWORKS.map((f) => [f.name, 0]));
  for (const s of result.statements) counts[s.fw.name] += 1;
  for (const [name, n] of Object.entries(counts)) {
    assert.ok(n > 0, `no "${name} <major>" statement found — is the pattern broken? counts: ${JSON.stringify(counts)}`);
  }
  // Root rows are attributed, not skipped: next-app's layout rows in the root
  // README and AGENTS.md must be among the statements.
  const rootNext = result.statements.filter((s) => !s.file.startsWith('starters/') && s.starter === 'next-app');
  assert.ok(rootNext.length >= 2, `expected root README + AGENTS next-app rows, got ${rootNext.length}`);
});

test('POSITIVE CONTROL — a stale major is reported (the #803 / #806 shape)', () => {
  // The fixture's manifest major is derived from the real next-app manifest
  // plus one, so the stated value can never coincidentally equal it.
  const real = manifestMajor(tree.starters['next-app'].manifest, 'next');
  const bumped = real + 1;
  const fixture = {
    starters: {
      'next-app': {
        manifest: { dependencies: { next: `^${bumped}.0.0` }, devDependencies: { tailwindcss: '^9.1.0' } },
        docs: { 'a.md': `Next.js ${real} App Router\n- Tailwind 3.4\n[badge](https://img.shields.io/badge/Next.js-${real}-black.svg)` },
      },
    },
    root: { 'README.md': `- \`starters/next-app\` — Next.js ${real} + Tailwind\n- Vite 8 somewhere\n` },
  };
  const { findings, statements } = audit(fixture);
  assert.equal(statements.length, 4);
  assert.equal(findings.length, 5, findings.join('\n'));
  assert.ok(findings.some((f) => f.includes('names no starter')));
});

test('NEGATIVE CONTROL — docs that state the manifest majors produce nothing', () => {
  const fixture = {
    starters: {
      'svelte-pwa': {
        manifest: { dependencies: { svelte: '^5.1.0' }, devDependencies: { vite: '~8.0.1', tailwindcss: '^4.3.0' } },
        docs: { 'a.md': 'Vite 8 + Svelte 5 (no Kit), Tailwind 4\n[v](https://img.shields.io/badge/Vite-8-646cff.svg)' },
      },
    },
    root: { 'AGENTS.md': '├── svelte-pwa/  # Vite 8 + Svelte 5\n' },
  };
  const { findings, statements } = audit(fixture);
  assert.equal(statements.length, 6);
  assert.deepEqual(findings, []);
});
