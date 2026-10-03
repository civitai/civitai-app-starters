/**
 * Tests for scripts/revendor-canonical-schema.sh — specifically that a
 * re-vendor EMITS A CHANGESET, which is what makes the mirrored bytes reach a
 * consumer.
 *
 * THE REGRESSION THESE EXIST FOR, MEASURED 2026-10-03. The vendored schema is
 * published: it ships in the tarball (`files: [… "schemas" …]`), is a public
 * export (`./schemas/app-block/v1.json`), and `defineBlock` reads it at runtime
 * (`src/manifest/defineBlock.ts`, CANONICAL_SCHEMA_PATH). The re-vendor script
 * mirrored the bytes and wrote no changeset, and nothing else in the chain adds
 * one — so merging a re-vendor PR could never publish, and the published mirror
 * was structurally guaranteed to lag forever.
 *
 * It is not a cosmetic lag. `goods.items` sets `additionalProperties: false`, so
 * a stale published copy REJECTS a field the server has started to require
 * rather than merely failing to check it: when `goods[].justification` went live
 * and #529 re-vendored it with no changeset, `@civitai/app-sdk@0.56.0` rejected
 * a manifest the platform REQUIRES for `kind: "app_unlock"`.
 *
 * Driven the same way as the other script guards: the real script is COPIED
 * into a synthetic tree and run there (it derives its repo root from its own
 * location), so the file under test is byte-for-byte the file CI runs. The
 * canonical URL is served by a local stand-in, so the suite is offline and
 * deterministic.
 *
 * 🔴 WHICH CASE IS WHICH, because it decides what these tests are worth:
 * 'writes a changeset' is the REGRESSION test — it fails on pre-change code.
 * The three 'writes NO changeset' cases are INVARIANT GUARDS: they were green
 * before this change too (nothing wrote a changeset at all), so they are not
 * regression coverage. They are here to pin the fail-safe direction, and they
 * are only non-vacuous BECAUSE the regression case proves this harness can
 * observe a changeset when one is written.
 *
 * 🔴 AND TWO OF THOSE THREE ARE STRUCTURALLY UNREACHABLE AS THE SCRIPT STANDS —
 * say so rather than letting them read as live coverage. The 404 and transient
 * branches `exit` before the `cp`, so no ordering of the current code can write
 * a changeset there: their changeset assertion cannot fail today. They are kept
 * deliberately, as ORDERING PINS — they are what goes red if someone moves the
 * changeset write ABOVE those exits — and their exit-code and mirror-untouched
 * assertions ARE live coverage of the script's documented contract. The NO-OP
 * case is the only one of the three that reaches the drift decision, so it is
 * the only one whose changeset assertion is reachable; it is also the one that
 * matters most, because the cron runs four times a day and finds no drift on
 * nearly all of them.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const REAL_SCRIPT = join(REPO_ROOT, 'scripts', 'revendor-canonical-schema.sh');

const SCHEMA_REL = join('packages', 'civitai-app-sdk', 'schemas', 'app-block', 'v1.json');

/**
 * The script writes a DATED filename (`revendor-canonical-schema-<YYYY-MM-DD>.md`,
 * matching `sync-orchestrator-catalogs.mjs`), so the test must not pin one name.
 * Reading the DIRECTORY also makes the no-changeset cases assert something real:
 * "no file whose name starts with this prefix", rather than "one exact path is
 * absent", which a renamed output would satisfy vacuously.
 */
const CHANGESET_PREFIX = 'revendor-canonical-schema';
function changesets(root) {
  const dir = join(root, '.changeset');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(CHANGESET_PREFIX) && f.endsWith('.md'));
}

/** A minimal but REAL-SHAPED schema: `goods.items` with additionalProperties:false
 *  is the property that turns a stale mirror into a rejection, so the fixture
 *  carries it rather than a toy object. */
const baseSchema = () => ({
  $id: 'https://civitai.com/schemas/app-block/v1.json',
  type: 'object',
  properties: {
    name: { type: 'string' },
    goods: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'priceBuzz'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          priceBuzz: { type: 'integer' },
        },
      },
    },
  },
});

/** The canonical having GROWN a nested field — the exact shape of the incident. */
const grownSchema = () => {
  const s = baseSchema();
  s.properties.goods.items.properties.justification = { type: 'string', maxLength: 500 };
  return s;
};

const serialize = (o) => `${JSON.stringify(o, null, 2)}\n`;

/** Builds <tmp>/scripts/<script> + <tmp>/packages/.../v1.json; REPO_ROOT resolves to <tmp>. */
function createFixture(vendoredBody) {
  const root = mkdtempSync(join(tmpdir(), 'revendor-guard-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(REAL_SCRIPT, join(root, 'scripts', 'revendor-canonical-schema.sh'));
  mkdirSync(dirname(join(root, SCHEMA_REL)), { recursive: true });
  writeFileSync(join(root, SCHEMA_REL), vendoredBody);
  return root;
}

const destroyFixture = (root) => rmSync(root, { recursive: true, force: true });

async function runScript(root, canonicalUrl) {
  try {
    const { stdout, stderr } = await execFileAsync(
      'bash',
      [join(root, 'scripts', 'revendor-canonical-schema.sh')],
      { env: { ...process.env, CANONICAL_URL: canonicalUrl }, cwd: tmpdir() },
    );
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (e) {
    return { code: e.code ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Serves whatever the current case sets, so one server covers every case. */
let server;
let origin;
let respond = { status: 200, body: '' };

before(async () => {
  server = createServer((_req, res) => {
    res.writeHead(respond.status, { 'content-type': 'application/json' });
    res.end(respond.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}/v1.json`;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

const msg = (want, r) => `expected exit ${want}, got ${r.code}\n--- script output ---\n${r.out}`;

describe('revendor-canonical-schema.sh — a re-vendor must PUBLISH, not just mirror', () => {
  test('REGRESSION: a real re-vendor writes a patch changeset for @civitai/app-sdk alone', async () => {
    const root = createFixture(serialize(baseSchema()));
    try {
      respond = { status: 200, body: serialize(grownSchema()) };
      const r = await runScript(root, origin);
      assert.equal(r.code, 0, msg(0, r));

      // Control that the script did the thing it is NAMED for. Without this, a
      // changeset assertion could pass over a script that never re-vendored.
      assert.equal(
        readFileSync(join(root, SCHEMA_REL), 'utf8'),
        serialize(grownSchema()),
        'the vendored schema was not actually re-vendored',
      );

      const found = changesets(root);
      assert.equal(
        found.length,
        1,
        `expected exactly 1 ${CHANGESET_PREFIX}* changeset, got ${found.length} (${found.join(', ')}) — the re-vendor cannot reach a published consumer\n--- script output ---\n${r.out}`,
      );
      // Dated, not fixed: a fixed name `cat >`-truncates a hand-authored
      // changeset for this same mechanism. Pin the SHAPE so the fixed name
      // cannot come back.
      assert.match(
        found[0],
        /^revendor-canonical-schema-\d{4}-\d{2}-\d{2}\.md$/,
        `changeset filename is not dated — a fixed name truncates whatever is already at that path: ${found[0]}`,
      );
      const cs = readFileSync(join(root, '.changeset', found[0]), 'utf8');

      // Assert the STATE a release depends on — the package it bumps and the
      // bump level — not merely that some file appeared. `patch`: pre-1.0 a
      // caret pins the MINOR, so a minor would withhold the corrected schema
      // from every caret-pinned consumer, which is the failure this mechanism
      // exists to end. The script's own comment carries the full reasoning and
      // the two rationales that were retracted before it.
      assert.match(
        cs,
        /^---\n(?:[^\n]*\n)*?'@civitai\/app-sdk': patch\n(?:[^\n]*\n)*?---\n/,
        `changeset does not declare a patch bump for @civitai/app-sdk:\n${cs}`,
      );
      // 🔴 ALLOWLIST, NOT A DENYLIST. This was a hand-listed alternation of five
      // package names and the workspace has SEVEN publishable packages, so a
      // changeset bumping the unlisted one passed. A denylist of names has to be
      // revisited every time a package is added — and nothing would tell you.
      // Inverted: the ONLY line allowed in the front matter is app-sdk's, so a
      // package added tomorrow is covered without touching this test.
      const bumped = (cs.match(/^'[^']+':\s*\w+$/gm) ?? []).sort();
      assert.deepEqual(
        bumped,
        ["'@civitai/app-sdk': patch"],
        `changeset must bump @civitai/app-sdk and nothing else (it ships the schema); got:\n${bumped.join('\n') || '(none parsed)'}`,
      );
    } finally {
      destroyFixture(root);
    }
  });

  test('INVARIANT GUARD: a no-op re-vendor writes NO changeset', async () => {
    // Green before this change too. Pins the fail-safe direction, and this is
    // the guard that earns its place: the cron is `37 */6 * * *` — FOUR runs a
    // day — and finds no drift on nearly all of them, so a changeset written on
    // a no-op would publish an empty release roughly four times a day.
    // ⚠ This comment said "weekly … every single week" until round 2. The
    // retraction of that figure swept the script header and the PR body and
    // MISSED this copy, inside the file the same PR authored — the reason a
    // retraction has to be a tree-wide sweep, not an edit where you were looking.
    const identical = serialize(baseSchema());
    const root = createFixture(identical);
    try {
      respond = { status: 200, body: identical };
      const r = await runScript(root, origin);
      assert.equal(r.code, 0, msg(0, r));
      assert.deepEqual(changesets(root), [], 'a no-op re-vendor wrote a changeset');
    } finally {
      destroyFixture(root);
    }
  });

  test('INVARIANT GUARD: a transient failure writes NO changeset and leaves the mirror alone', async () => {
    const before = serialize(baseSchema());
    const root = createFixture(before);
    try {
      respond = { status: 503, body: 'upstream unavailable' };
      const r = await runScript(root, origin);
      assert.equal(r.code, 0, msg(0, r)); // transient => skip quietly
      assert.deepEqual(changesets(root), [], 'a transient failure wrote a changeset');
      assert.equal(readFileSync(join(root, SCHEMA_REL), 'utf8'), before, 'the mirror was modified on a transient failure');
    } finally {
      destroyFixture(root);
    }
  });

  test('INVARIANT GUARD: a 404 fails loudly and writes NO changeset', async () => {
    const root = createFixture(serialize(baseSchema()));
    try {
      respond = { status: 404, body: 'not found' };
      const r = await runScript(root, origin);
      assert.equal(r.code, 1, msg(1, r)); // the canonical URL moved => hard fail
      assert.deepEqual(changesets(root), [], 'a 404 wrote a changeset');
    } finally {
      destroyFixture(root);
    }
  });
});
