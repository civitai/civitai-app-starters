/**
 * Guards the `Refuse to clobber an open re-vendor PR` step in
 * `revendor-canonical-schema.yml` — that it gates every step which can write the
 * automation branch, and that the branch name it queries is the SAME ONE
 * `create-pull-request` writes.
 *
 * WHY THIS EXISTS — two measured defects in the commit that added that step, not
 * hypotheticals:
 *
 *   1. THE GUARD WAS INERT AS FIRST WRITTEN. Four of the job's eight steps had no
 *      `if:`, so the re-vendor ran, the changeset was written and the PR was
 *      force-pushed exactly as before while the guard reported itself working.
 *      A step with no `if:` defaults to `if: success()` — the same mechanism
 *      `release-assert-step-condition.test.mjs` exists for, which was written
 *      after that default broke a real release.
 *   2. THE BRANCH NAME HAD TWO SPELLINGS — a step-level `env:` for the guard's
 *      `gh pr list --head`, and a separate literal in `create-pull-request`'s
 *      `branch:`. The sibling `sync-orchestrator-catalogs.yml` single-sources it
 *      at workflow level and says why in as many words: "Two spellings of it
 *      would make the guard silently inert." The adoption took the step and left
 *      that behind.
 *
 * 🔴 THIS WORKFLOW HAS NO `pull_request` TRIGGER, so it never runs on a PR that
 * changes it. A structural assertion here is the ONLY coverage it can have — the
 * same argument `workflow-action-pins.test.mjs` makes about the same file.
 *
 * 🔴 NODE BUILT-INS ONLY, NO YAML LIBRARY, AND THAT IS NOT A STYLE CHOICE.
 * `pnpm test:guards` runs in the required `Starter` job BEFORE `pnpm install`
 * (`.github/workflows/ci.yml`), so a third-party import here fails to resolve and
 * the whole file reports `fail 1` / `pass 0` — caught exactly that way while
 * writing this. The line-and-indent walk below mirrors
 * `release-assert-step-condition.test.mjs`'s `stepBodyLines` for the same reason.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF = join(REPO_ROOT, '.github', 'workflows', 'revendor-canonical-schema.yml');

const GUARD_STEP = 'Refuse to clobber an open re-vendor PR';
const GUARD_CLAUSE = "steps.guard.outputs.open == ''";

/**
 * The only steps allowed to run while a re-vendor PR is open: `checkout` writes
 * nothing outside the runner, and the guard itself must run to produce the output
 * everything else reads. The list is EXACT, not a minimum — anything else
 * appearing ungated is the defect this file was written for.
 */
const UNGATED_BY_DESIGN = ['actions/checkout', GUARD_STEP];

/** Each `- name:`/`- uses:` step in the job, with its own body lines. */
function steps(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s{4}steps:\s*$/.test(l));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const m = l.match(/^(\s*)-\s*(name|uses|id):\s*(.*)$/);
    if (m) {
      const indent = m[1].length;
      const body = [l.replace(/^(\s*)-\s*/, '$1  ')];
      for (let j = i + 1; j < lines.length; j++) {
        const b = lines[j];
        if (!b.trim() || /^\s*#/.test(b)) continue;
        if (b.match(/^\s*/)[0].length <= indent) break;
        body.push(b);
      }
      out.push({ label: field(body, 'name') ?? field(body, 'uses') ?? '(anonymous)', body });
      continue;
    }
    if (/^\s{0,4}\S/.test(l)) break; // left the job
  }
  return out;
}

/**
 * The value of a top-level key inside a step body, with BALANCED surrounding
 * quotes removed.
 *
 * 🔴 The balance check is load-bearing, not tidiness. An earlier version stripped
 * a leading OR trailing quote independently, which ate the final `'` of
 * `if: steps.guard.outputs.open == ''` — so every gated step read as ungated and
 * this file reported 4 false failures against a workflow that was correct. The
 * instrument was broken, not the thing under test; the fix nearly went into the
 * workflow instead.
 */
function field(body, key) {
  const re = new RegExp(`^\\s*${key}:\\s*(.*)$`);
  for (const l of body) {
    const m = l.match(re);
    if (!m) continue;
    const v = m[1].trim();
    const q = v[0];
    return (q === "'" || q === '"') && v.length > 1 && v.at(-1) === q ? v.slice(1, -1) : v;
  }
  return null;
}

const isUngatedByDesign = (s) => UNGATED_BY_DESIGN.some((u) => s.label.startsWith(u));
const gated = (s) => (field(s.body, 'if') ?? '').includes(GUARD_CLAUSE);

describe('revendor-canonical-schema.yml — the open-PR guard actually gates the job', () => {
  const text = readFileSync(WF, 'utf8');
  const all = steps(text);

  test('POSITIVE CONTROL: the parse finds the job steps at all', () => {
    // Without this, every assertion below passes vacuously over an empty list —
    // the reassuring-zero failure mode. If the job is legitimately restructured,
    // fix the walk; do not delete this file.
    assert.ok(all.length >= 6, `parsed ${all.length} steps, expected >=6 — the walk is broken, not the workflow`);
    assert.ok(
      all.some((s) => s.label === GUARD_STEP),
      `no step named "${GUARD_STEP}" — every \`${GUARD_CLAUSE}\` condition is then always false`,
    );
  });

  test('the guard writes the `open` output the conditions read, and queries for a PR', () => {
    const g = all.find((s) => s.label === GUARD_STEP);
    assert.equal(field(g.body, 'id'), 'guard', 'the guard step lost `id: guard`; the conditions reference it by that id');
    const run = g.body.join('\n');
    assert.match(run, /open=.*>>\s*"?\$GITHUB_OUTPUT/, 'the guard does not write an `open` output');
    assert.match(run, /gh pr list/, 'the guard does not query for an open PR');
  });

  test('EVERY step that can write the automation branch is gated on the guard', () => {
    const ungated = all.filter((s) => !isUngatedByDesign(s)).filter((s) => !gated(s)).map((s) => s.label);
    assert.deepEqual(
      ungated,
      [],
      'these steps run even while a re-vendor PR is open, so the guard is inert for them — ' +
        `add \`if: ${GUARD_CLAUSE}\` (AND it into any existing condition):\n  ${ungated.join('\n  ')}`,
    );
  });

  test('exactly the by-design steps are ungated — a NEW ungated step fails here', () => {
    const ungated = all.filter((s) => !gated(s)).map((s) => s.label);
    assert.deepEqual(
      ungated.sort(),
      [...UNGATED_BY_DESIGN].sort().map((u) => ungated.find((l) => l.startsWith(u)) ?? u).sort(),
      `expected exactly ${UNGATED_BY_DESIGN.length} ungated steps (checkout + the guard), got ${ungated.length}: ${ungated.join(', ')}`,
    );
  });

  test('the branch name is SINGLE-SOURCED — the guard queries what create-pull-request writes', () => {
    // 🔴 The whole point. Two spellings make the guard query a branch nobody
    // opens a PR on: `open` is then always empty, every step runs, and the next
    // cron force-pushes a reviewer's commit away with the job green throughout.
    const cpr = all.find((s) => (field(s.body, 'uses') ?? '').startsWith('peter-evans/create-pull-request'));
    assert.ok(cpr, 'no create-pull-request step found');
    const written = field(cpr.body, 'branch') ?? '';
    const m = written.match(/^\$\{\{\s*env\.([A-Z_]+)\s*\}\}$/);
    assert.ok(
      m,
      "create-pull-request's `branch:` must reference a workflow-level env var, not a literal, so the guard " +
        `cannot drift from it. Got: ${written || '(unset)'}`,
    );
    const varName = m[1];
    assert.match(
      text,
      new RegExp(`^env:(?:\\n(?!\\S).*)*?^\\s+${varName}:`, 'm'),
      `\`branch:\` references env.${varName}, which is not defined in the workflow-level \`env:\` block`,
    );
    const g = all.find((s) => s.label === GUARD_STEP);
    assert.match(
      g.body.join('\n'),
      new RegExp(`\\$${varName}\\b|\\$\\{${varName}\\}`),
      `the guard does not read $${varName}; a second spelling of the branch name makes it inert`,
    );
    assert.equal(
      field(g.body, varName),
      null,
      `the guard re-declares ${varName} at step level — that is the second spelling this test exists to prevent. ` +
        'Delete it and let the workflow-level env reach the step.',
    );
  });
});
