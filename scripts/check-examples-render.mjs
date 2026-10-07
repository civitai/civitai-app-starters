#!/usr/bin/env node
/**
 * check-examples-render.mjs
 * -------------------------
 * Boots every `starters/examples/*` app under its own `dev:harness` and drives it
 * in headless Chromium. Per example, per scenario:
 *
 *   - the block renders past "Loading…" (a `[data-theme]` root exists inside
 *     `#root` and the page no longer says "Loading…");
 *   - no console error and no uncaught page error;
 *   - the PAINTED background of the block root matches the host theme — sampled
 *     from screenshot pixels, not read from `getComputedStyle`, because the
 *     regression this exists for is a block whose own backgrounds are all
 *     `transparent`, so the colour the viewer sees is the browser CANVAS, which
 *     no computed style reports.
 *
 * THE REGRESSION
 * ==============
 * The examples shipped `color-scheme: light dark` with a transparent page, so
 * on a viewer whose OS is light the canvas was WHITE — under a dark civitai.com,
 * whose BLOCK_INIT said `theme: 'dark'`. That is scenario `dark-on-light-os`.
 *
 * SCENARIOS
 *   dark-on-light-os   host dark, OS light   -> must paint dark   (the regression)
 *   dark-on-dark-os    host dark, OS dark    -> must paint dark
 *   light-on-dark-os   host light, OS dark   -> must paint light  (needs `?theme=light`,
 *                                               which only the SDK Harness reads;
 *                                               skip with --dark-only on an older tree)
 *
 * CONTROLS. The sampler has to report BOTH polarities per example — dark in two
 * scenarios, light in the third — so one that reads a constant, or nothing,
 * fails one of them. Measured at 9de10b5 (before the examples went dark-first):
 * `dark-on-light-os` FAILED for all six, sampling [255,255,255], while
 * `dark-on-dark-os` passed — red at base on exactly the regression.
 *
 * The host theme reaches the block twice, exactly as in production: the
 * `#civitai-block=v1&theme=…` fragment (pre-paint) and BLOCK_INIT (`?theme=` is
 * the mock host's knob for that).
 *
 * USAGE
 *   node scripts/check-examples-render.mjs [--out <dir>] [--only <example>] [--dark-only]
 *   EXAMPLES_DIR=/other/checkout/starters/examples …   # run against another tree
 *
 * Needs Playwright's Chromium: `pnpm --filter @civitai/blocks-react exec
 * playwright install chromium` (the Nix dev shell provides it already).
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const EXAMPLES_DIR = process.env.EXAMPLES_DIR || join(REPO_ROOT, 'starters', 'examples');
// Playwright is a devDependency of the browser-tested package, not of the root.
const { chromium } = createRequire(join(REPO_ROOT, 'packages/civitai-blocks-react/package.json'))('playwright');

/** Six examples exist. A drop means one left the scan; lower this in the same commit. */
const MIN_EXAMPLES = 6;

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const OUT_DIR = argValue('--out') || join(tmpdir(), 'examples-render');
const ONLY = argValue('--only');
const DARK_ONLY = args.includes('--dark-only');

const SCENARIOS = [
  { name: 'dark-on-light-os', host: 'dark', os: 'light' },
  { name: 'dark-on-dark-os', host: 'dark', os: 'dark' },
  ...(DARK_ONLY ? [] : [{ name: 'light-on-dark-os', host: 'light', os: 'dark' }]),
];

function examples() {
  const names = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(EXAMPLES_DIR, d.name, 'package.json')))
    .map((d) => d.name)
    .sort();
  if (!ONLY && names.length < MIN_EXAMPLES) {
    throw new Error(`found ${names.length} examples under ${EXAMPLES_DIR}, expected >= ${MIN_EXAMPLES}`);
  }
  return ONLY ? names.filter((n) => n === ONLY) : names;
}

function harnessPort(dir) {
  const script = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts?.['dev:harness'] ?? '';
  const port = /--port\s+(\d+)/.exec(script)?.[1];
  if (!port) throw new Error(`${dir}: dev:harness pins no --port`);
  return Number(port);
}

/** Start `dev:harness` in its own process group, so teardown reaches vite too. */
function startServer(dir) {
  const child = spawn('pnpm', ['run', 'dev:harness'], {
    cwd: dir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => (log += b));
  child.stderr.on('data', (b) => (log += b));
  return {
    pid: child.pid,
    log: () => log,
    stop: () => {
      try {
        process.kill(-child.pid, 'SIGTERM'); // the group WE created, by its PID
      } catch {
        /* already gone */
      }
    },
  };
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not answer within ${timeoutMs}ms`);
}

/** RGB of one screenshot pixel, decoded by the browser itself (no PNG dependency). */
async function pixel(page, x, y) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, png.toString('base64'));
}

async function runScenario(browser, name, port, scenario) {
  const context = await browser.newContext({
    colorScheme: scenario.os,
    viewport: { width: 520, height: 820 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const query = scenario.host === 'light' ? '?theme=light' : '';
  await page.goto(`http://localhost:${port}/${query}#civitai-block=v1&theme=${scenario.host}`);
  const result = { example: name, scenario: scenario.name, errors, failures: [] };
  try {
    await page.waitForFunction(
      () =>
        !!document.querySelector('#root [data-theme]') && !document.body.innerText.includes('Loading…'),
      undefined,
      { timeout: 15_000 },
    );
  } catch {
    result.failures.push('never rendered past "Loading…" (no [data-theme] block root inside #root)');
  }
  // Let the injected stylesheet and any first effects settle before sampling.
  await page.waitForTimeout(300);

  const box = await page.locator('#root [data-theme]').first().boundingBox();
  if (box) {
    const samples = [
      await pixel(page, box.x + 3, box.y + 3),
      await pixel(page, box.x + box.width - 4, box.y + 3),
    ];
    result.samples = samples;
    const isDark = samples.every(([r, g, b]) => Math.max(r, g, b) < 96);
    const isLight = samples.every(([r, g, b]) => Math.min(r, g, b) > 200);
    if (scenario.host === 'dark' && !isDark) {
      result.failures.push(`host is dark but the block root paints ${JSON.stringify(samples)}`);
    }
    if (scenario.host === 'light' && !isLight) {
      result.failures.push(`host is light but the block root paints ${JSON.stringify(samples)}`);
    }
  } else {
    result.failures.push('no block root to sample');
  }
  if (errors.length) result.failures.push(...errors);

  mkdirSync(OUT_DIR, { recursive: true });
  result.screenshot = join(OUT_DIR, `${name}--${scenario.name}.png`);
  await page.screenshot({ path: result.screenshot, fullPage: true });
  await context.close();
  return result;
}

async function main() {
  const names = examples();
  if (names.length === 0) throw new Error(`no example matched --only ${ONLY}`);
  // A host whose Chromium build differs from the one this Playwright pins (a Nix
  // dev shell, say) points at its own binary; CI installs the pinned one.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const results = [];
  try {
    for (const name of names) {
      const dir = join(EXAMPLES_DIR, name);
      const port = harnessPort(dir);
      // An older example tree reads its allowlist from `.env` (gotcha #53);
      // supply it for the run and remove only what this script created.
      const envPath = join(dir, '.env');
      const createdEnv = !existsSync(envPath) && existsSync(join(dir, '.env.example'));
      if (createdEnv) copyFileSync(join(dir, '.env.example'), envPath);
      const server = startServer(dir);
      try {
        await waitForHttp(`http://localhost:${port}/`);
        for (const scenario of SCENARIOS) results.push(await runScenario(browser, name, port, scenario));
      } catch (err) {
        results.push({ example: name, scenario: 'boot', failures: [String(err)], log: server.log() });
      } finally {
        server.stop();
        if (createdEnv) rmSync(envPath, { force: true });
      }
    }
  } finally {
    await browser.close();
  }

  let failed = 0;
  for (const r of results) {
    const ok = r.failures.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.example.padEnd(14)} ${r.scenario.padEnd(17)} ${JSON.stringify(r.samples ?? '')}`);
    for (const f of r.failures) console.log(`        - ${f}`);
    if (r.log && !ok) console.log(r.log);
  }
  const expected = names.length * SCENARIOS.length;
  console.log(`\n${results.length - failed}/${results.length} scenario runs passed (expected ${expected}); screenshots in ${OUT_DIR}`);
  if (failed > 0 || results.length !== expected) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
