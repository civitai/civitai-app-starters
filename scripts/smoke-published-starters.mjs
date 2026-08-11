#!/usr/bin/env node
/**
 * smoke-published-starters.mjs
 * ----------------------------
 * PUBLISHED-version smoke test for the user-scaffolded starters.
 *
 * WHY THIS EXISTS (a demonstrated blind spot, not a hypothetical):
 *   The root `pnpm.overrides` maps the first-party `@civitai/*` packages to
 *   `workspace:*`. So every existing CI job — including the required
 *   `Starter (<name>)` matrix — builds the starters against the LOCAL workspace
 *   copies, never against the published versions their own package.json files
 *   actually admit (`^0.31.0`, `^0.3.0`, `^0.2.0`, …).
 *
 *   That was proven with a controlled pair: adding a local-only export to a
 *   workspace package and importing it from `starters/next-app` was RED without
 *   the override and GREEN with it. A starter can therefore build perfectly in
 *   this repo while being broken against the versions it ships to users — and
 *   the starters are copied out VERBATIM (`npx tiged civitai/civitai-app-starters/
 *   starters/<name> my-app`, documented in README.md / AGENTS.md / CLAUDE.md and
 *   every starter README), so that break is a broken scaffold for every developer
 *   who runs that command.
 *
 * WHAT IT DOES — one pass per starter:
 *   1. COPY the starter out the way a real user does: the git-TRACKED files only,
 *      into a temp dir OUTSIDE the repo. That is byte-for-byte what `npx tiged`
 *      extracts (tiged ships a tarball of the tracked tree at a ref), and being
 *      outside the repo means no `pnpm-workspace.yaml`, no root `package.json`,
 *      and therefore NO `pnpm.overrides` are discoverable by walking up.
 *   2. INSTALL with plain `npm install` against the public registry — npm, not
 *      pnpm, precisely because npm has no workspace-linking behaviour to inherit.
 *   3. ASSERT every `@civitai/*` dependency resolved to a REAL published tarball
 *      (a plain directory in node_modules with a version, never a symlink back
 *      into this repo). This is the positive control on the whole premise: if a
 *      workspace copy leaked in, the run says so instead of passing vacuously.
 *   4. RUN the starter's own `typecheck` and `build` scripts (with
 *      SKIP_ENV_VALIDATION=1, same as CI — there are no real secrets here).
 *
 * SCOPE:
 *   - COVERED: the depth-1 starters under `starters/` — the ones the docs tell
 *     users to `tiged`. Each is asserted to carry no `workspace:` pin; one that
 *     did would be reported as SKIP (loud), never quietly mis-tested.
 *   - NOT COVERED: `starters/examples/*`. Those pin `@civitai/*` via
 *     `workspace:^` BY DESIGN and `starters/examples/README.md` explicitly tells
 *     readers to swap to published versions when copying one out — they are
 *     in-repo illustrations, not user-scaffolded templates. There is no
 *     published-version contract to smoke.
 *
 * WHAT IT CATCHES: a starter using an API that exists only in the workspace
 *   source and not in the published version its pin admits (new export, changed
 *   signature, moved subpath export, a dependency never actually published).
 * WHAT IT DOES NOT CATCH: runtime behaviour (nothing is executed beyond the
 *   build), anything requiring real credentials, browser/e2e behaviour, and
 *   published-version breakage in `starters/examples/*` (out of scope, above).
 *
 * EXIT CODES:
 *   0  every discovered starter installed + typechecked + built against npm,
 *      OR the registry was unreachable (loud SKIP — see below).
 *   1  at least one starter failed, or nothing was discovered to test.
 *
 * REGISTRY UNREACHABLE => graceful exit 0 with a loud SKIP, mirroring the
 *   existing `check-starter-pins.mjs` policy: this job depends on a third party
 *   nobody in this repo controls, and a red that means "npm was down" trains
 *   everyone to ignore it. The skip is printed and lands in the job summary, so
 *   it is visible rather than silent.
 *
 * USAGE
 *   node scripts/smoke-published-starters.mjs                 # all starters
 *   node scripts/smoke-published-starters.mjs next-app        # a subset
 *   KEEP_WORKDIR=1 node scripts/smoke-published-starters.mjs  # keep temp dirs
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  appendFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(join(HERE, '..'));
const STARTERS_DIR = join(REPO_ROOT, 'starters');
const SCOPE = '@civitai/';
const REGISTRY = process.env.NPM_REGISTRY || 'https://registry.npmjs.org';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));

/* ---------------------------------------------------------------- helpers */

function run(cmd, args, cwd, extraEnv = {}) {
  const started = Date.now();
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  return {
    ok: res.status === 0,
    status: res.status,
    signal: res.signal,
    out,
    seconds: Math.round((Date.now() - started) / 1000),
    spawnError: res.error ? res.error.message : null,
  };
}

/** Last `n` non-empty lines of a tool log — enough to name the real error. */
function tail(text, n = 30) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.slice(-n).join('\n');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Is the public registry actually reachable? Probes a package this repo
 * publishes. Returns { ok } | { unreachable, reason }.
 * A definitive 404 is NOT treated as unreachable (that is a real signal), but
 * transport errors / 5xx / 429 are.
 */
async function probeRegistry() {
  const url = `${REGISTRY}/@civitai%2fapp-sdk/latest`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) return { ok: true };
    if (res.status === 404 || res.status === 410) {
      return { unreachable: false, ok: false, reason: `HTTP ${res.status} for @civitai/app-sdk` };
    }
    return { unreachable: true, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { unreachable: true, reason: err?.message || String(err) };
  }
}

/**
 * Copy the git-TRACKED files of `starters/<name>` into `dest`.
 * Tracked-only is the point: it is exactly what `npx tiged` delivers, so a file
 * that was never committed does not reach a user and must not reach this test.
 * Returns the number of files copied.
 */
function copyTracked(starterRelDir, dest) {
  const res = run('git', ['ls-files', '-z', '--', starterRelDir], REPO_ROOT);
  if (!res.ok) {
    throw new Error(`git ls-files failed for ${starterRelDir}: ${tail(res.out, 5)}`);
  }
  const files = res.out.split('\0').filter(Boolean);
  let copied = 0;
  for (const f of files) {
    const src = join(REPO_ROOT, f);
    // Skip a tracked-but-deleted path (a working tree mid-edit).
    if (!existsSync(src)) continue;
    if (!lstatSync(src).isFile()) continue;
    const rel = relative(starterRelDir, f);
    const target = join(dest, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(src, target);
    copied++;
  }
  return copied;
}

/**
 * After install, prove every @civitai/* dep came from the REGISTRY and not from
 * a workspace link. A symlink (or a missing package) means the run would have
 * been testing the wrong thing — the whole premise of this job.
 */
function verifyPublishedResolution(workdir, pkgNames) {
  const resolved = [];
  const problems = [];
  for (const name of pkgNames) {
    const dir = join(workdir, 'node_modules', ...name.split('/'));
    if (!existsSync(dir)) {
      problems.push(`${name}: not installed into node_modules`);
      continue;
    }
    if (lstatSync(dir).isSymbolicLink()) {
      problems.push(`${name}: node_modules entry is a SYMLINK (a workspace copy leaked in)`);
      continue;
    }
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) {
      problems.push(`${name}: installed but has no package.json`);
      continue;
    }
    let version;
    try {
      version = readJson(manifest).version;
    } catch (err) {
      problems.push(`${name}: unreadable package.json (${err.message})`);
      continue;
    }
    resolved.push(`${name}@${version}`);
  }
  return { resolved, problems };
}

/* ------------------------------------------------------------- discovery */

function discoverStarters() {
  let entries;
  try {
    entries = readdirSync(STARTERS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error(`ERROR: cannot read ${relative(REPO_ROOT, STARTERS_DIR)}/: ${err.message}`);
    process.exit(1);
  }

  const found = [];
  const skipped = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // `starters/examples/*` live one level deeper and are deliberately out of
    // scope (workspace:^ by design — see the header). Depth-1 only.
    const pkgPath = join(STARTERS_DIR, e.name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    if (requested.length > 0 && !requested.includes(e.name)) continue;

    let pkg;
    try {
      pkg = readJson(pkgPath);
    } catch (err) {
      skipped.push({ name: e.name, reason: `unparseable package.json (${err.message})` });
      continue;
    }

    const civitaiDeps = [];
    let workspacePin = null;
    for (const field of DEP_FIELDS) {
      for (const [dep, range] of Object.entries(pkg[field] || {})) {
        if (!dep.startsWith(SCOPE)) continue;
        if (typeof range === 'string' && range.startsWith('workspace:')) {
          workspacePin = `${dep}: "${range}" [${field}]`;
          continue;
        }
        civitaiDeps.push(dep);
      }
    }

    if (workspacePin) {
      // Loud, never silent: a top-level starter with a workspace pin cannot be
      // smoke-tested against published versions, and that is worth saying.
      skipped.push({
        name: e.name,
        reason: `carries a workspace: pin (${workspacePin}) — no published-version contract to smoke`,
      });
      continue;
    }
    if (civitaiDeps.length === 0) {
      skipped.push({ name: e.name, reason: 'no @civitai/* dependency' });
      continue;
    }

    found.push({ name: e.name, pkg, civitaiDeps });
  }
  return { found, skipped };
}

/* ------------------------------------------------------------------ main */

async function main() {
  const { found, skipped } = discoverStarters();

  for (const s of skipped) {
    console.warn(`SKIP  ${s.name} — ${s.reason}`);
  }

  if (found.length === 0) {
    console.error('');
    console.error('ERROR: no user-scaffolded starter was discovered under starters/.');
    console.error('       Expected at least one depth-1 directory with a package.json and a');
    console.error('       published-version @civitai/* pin. Refusing to report a vacuous pass.');
    process.exit(1);
  }

  console.log(`Discovered ${found.length} user-scaffolded starter(s): ${found.map((s) => s.name).join(', ')}`);
  console.log(`Registry: ${REGISTRY}`);
  console.log('');

  const probe = await probeRegistry();
  if (probe.unreachable) {
    console.warn('');
    console.warn(`SKIP: the public npm registry is unreachable (${probe.reason}).`);
    console.warn('      This job depends on a third party nobody in this repo controls, so an');
    console.warn('      outage is reported as a skip, not a red. Nothing was verified.');
    writeSummary({ found, skipped, results: [], registrySkip: probe.reason });
    return;
  }

  const results = [];
  for (const starter of found) {
    const relDir = `starters/${starter.name}`;
    const workdir = mkdtempSync(join(tmpdir(), `starter-smoke-${starter.name}-`));
    const record = { name: starter.name, workdir, steps: [], ok: false, files: 0, resolved: [] };
    console.log(`─── ${starter.name} ────────────────────────────────────────────`);

    try {
      record.files = copyTracked(relDir, workdir);
      console.log(`copy   ${record.files} tracked file(s) -> ${workdir}`);
      if (record.files === 0) {
        record.steps.push({ step: 'copy', ok: false, log: 'no tracked files copied' });
        throw new Error('no tracked files copied');
      }

      // A copied-out starter must not carry a workspace manifest with it.
      for (const stray of ['pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
        if (existsSync(join(workdir, stray))) {
          record.steps.push({
            step: 'copy',
            ok: false,
            log: `copied starter contains ${stray} — it would re-introduce workspace resolution`,
          });
          throw new Error(`copied starter contains ${stray}`);
        }
      }

      // 1. install — plain npm, public registry, no workspace anywhere above.
      let install = run('npm', ['install', '--no-audit', '--no-fund'], workdir, {
        npm_config_registry: REGISTRY,
      });
      if (!install.ok) {
        // One retry: npm installs are the step most exposed to a transient
        // network blip. A genuinely broken package fails both times.
        console.log(`install failed (exit ${install.status}) — retrying once`);
        install = run('npm', ['install', '--no-audit', '--no-fund'], workdir, {
          npm_config_registry: REGISTRY,
        });
      }
      record.steps.push({ step: 'npm install', ok: install.ok, seconds: install.seconds, log: install.out });
      console.log(`install ${install.ok ? 'OK' : `FAILED (exit ${install.status})`} in ${install.seconds}s`);
      if (!install.ok) throw new Error('npm install failed');

      // 2. positive control: prove we got PUBLISHED packages, not workspace links.
      const { resolved, problems } = verifyPublishedResolution(workdir, starter.civitaiDeps);
      record.resolved = resolved;
      console.log(`resolved ${resolved.join(', ') || '(none)'}`);
      if (problems.length > 0) {
        record.steps.push({ step: 'published-resolution check', ok: false, log: problems.join('\n') });
        console.log(`resolution FAILED:\n${problems.join('\n')}`);
        throw new Error('published-resolution check failed');
      }
      record.steps.push({ step: 'published-resolution check', ok: true, log: resolved.join(', ') });

      // 3. the starter's own scripts.
      for (const script of ['typecheck', 'build']) {
        if (!starter.pkg.scripts?.[script]) {
          console.log(`${script}: not defined — skipping`);
          continue;
        }
        const r = run('npm', ['run', script], workdir, {
          SKIP_ENV_VALIDATION: '1',
          npm_config_registry: REGISTRY,
        });
        record.steps.push({ step: `npm run ${script}`, ok: r.ok, seconds: r.seconds, log: r.out });
        console.log(`${script} ${r.ok ? 'OK' : `FAILED (exit ${r.status})`} in ${r.seconds}s`);
        if (!r.ok) {
          console.log(tail(r.out, 40));
          throw new Error(`npm run ${script} failed`);
        }
      }

      record.ok = true;
    } catch (err) {
      record.error = err.message;
    } finally {
      if (process.env.KEEP_WORKDIR) {
        console.log(`(kept ${workdir})`);
      } else {
        rmSync(workdir, { recursive: true, force: true });
      }
      console.log('');
    }
    results.push(record);
  }

  /* ------------------------------------------------------------- report */

  const passed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log('════ published-starter smoke ════');
  for (const r of results) {
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.files} file(s) copied` +
        `${r.resolved.length ? `, ${r.resolved.join(' ')}` : ''})${r.ok ? '' : ` — ${r.error}`}`,
    );
  }
  console.log(
    `\n${passed.length}/${results.length} starter(s) copied, installed from ${REGISTRY} and built.`,
  );

  if (failed.length > 0) {
    console.error('');
    console.error('ERROR: starter(s) BROKEN against their PUBLISHED @civitai/* versions.');
    console.error('       They build in this monorepo only because pnpm.overrides swaps in the');
    console.error('       workspace copies. A user running `npx tiged` gets the failure below.');
    for (const r of failed) {
      const bad = r.steps.find((s) => !s.ok);
      console.error('');
      console.error(`  ── ${r.name}: ${r.error}`);
      if (bad) console.error(tail(bad.log, 40).replace(/^/gm, '     '));
    }
    console.error('');
  }

  writeSummary({ found, skipped, results });

  if (failed.length > 0) process.exit(1);
}

/** GitHub job summary — the always-visible surface, present or not in CI. */
function writeSummary({ found, skipped, results, registrySkip }) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = ['## Published-starter smoke', ''];
  if (registrySkip) {
    lines.push(
      `⚠️ **SKIPPED** — the public npm registry was unreachable (\`${registrySkip}\`). Nothing was verified.`,
      '',
    );
  } else {
    const passed = results.filter((r) => r.ok).length;
    lines.push(
      `**${passed}/${results.length}** starter(s) copied out (tracked files only, like \`npx tiged\`), ` +
        `installed with plain \`npm install\` from \`${REGISTRY}\`, and built.`,
      '',
      '| Starter | Result | Files copied | Resolved @civitai/* |',
      '| --- | --- | --- | --- |',
    );
    for (const r of results) {
      lines.push(
        `| \`${r.name}\` | ${r.ok ? '✅ pass' : '❌ **fail**'} | ${r.files} | ${r.resolved.join('<br>') || '—'} |`,
      );
    }
    lines.push('');
    for (const r of results.filter((x) => !x.ok)) {
      const bad = r.steps.find((s) => !s.ok);
      lines.push(`<details><summary><b>${r.name}</b> — ${r.error}</summary>`, '', '```');
      lines.push(tail(bad ? bad.log : '', 40));
      lines.push('```', '</details>', '');
    }
  }
  if (skipped.length > 0) {
    lines.push('### Not covered', '');
    for (const s of skipped) lines.push(`- \`${s.name}\` — ${s.reason}`);
    lines.push('');
  }
  lines.push(
    '`starters/examples/*` are out of scope by design: they pin `@civitai/*` via `workspace:^` and ' +
      '`starters/examples/README.md` tells readers to swap to published versions when copying one out.',
    '',
    '_Advisory job. It depends on the public npm registry, so it is **not** a required check._',
  );
  lines.push(`\n<!-- discovered: ${found.length} -->`);
  appendFileSync(file, `${lines.join('\n')}\n`);
}

main().catch((err) => {
  console.error(`smoke-published-starters: unexpected error: ${err?.stack || err}`);
  process.exit(1);
});
