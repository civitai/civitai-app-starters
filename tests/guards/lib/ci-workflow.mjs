/**
 * A line-and-indent reader for `.github/workflows/ci.yml`, and the structural
 * checks `ci-lanes-ledger.test.mjs` runs over it.
 *
 * 🔴 NODE BUILT-INS ONLY, NO YAML LIBRARY. `pnpm test:guards` runs in the
 * required `Starter` job BEFORE `pnpm install`, so a third-party import does not
 * resolve there (same constraint, and same walk shape, as
 * `revendor-guard-gating.test.mjs`).
 *
 * KNOWN LIMITS. It is a line walk, not a YAML parse. It reads what ci.yml uses
 * today: two-space indentation, job ids at indent 2, job keys at indent 4,
 * `needs:` as a scalar, a flow list or a block list, and a single-line `if:`.
 * A folded (`>-`) `if:` is joined into one line. Anything else is reported as a
 * problem rather than guessed at, which is the safe direction.
 *
 * `problems(text, ledger)` returns STRINGS, not assertions, so the test file can
 * feed it deliberately broken workflow text and check that each breakage is
 * reported under its own message. A checker that is only ever shown the good
 * file has not been shown to be able to fail.
 */

/** Balanced surrounding quotes removed; anything else returned trimmed. */
function unquote(v) {
  const t = v.trim();
  const q = t[0];
  return (q === "'" || q === '"') && t.length > 1 && t.at(-1) === q ? t.slice(1, -1) : t;
}

const indentOf = (line) => line.match(/^ */)[0].length;
const isNoise = (line) => !line.trim() || /^\s*#/.test(line);

/** The lines of the top-level block `key:` (exclusive of the key line). */
function topLevelBlock(lines, key) {
  const start = lines.findIndex((l) => new RegExp(`^${key}:\\s*$`).test(l));
  if (start === -1) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (!isNoise(lines[i]) && indentOf(lines[i]) === 0) break;
    out.push(lines[i]);
  }
  return out;
}

/**
 * The value of `key:` among `lines` at exactly `indent`. Returns
 * `{ scalar, list, children }` or null when the key is absent.
 *   scalar    the same-line value (unquoted), '' when the value is a block
 *   list      a flow (`[a, b]`) or block (`- a`) list, else null
 *   children  the raw nested lines
 */
function readKey(lines, key, indent) {
  const re = new RegExp(`^ {${indent}}${key}:(.*)$`);
  const idx = lines.findIndex((l) => re.test(l));
  if (idx === -1) return null;
  const same = lines[idx].match(re)[1].trim();
  const children = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (isNoise(lines[i])) continue;
    if (indentOf(lines[i]) <= indent) break;
    children.push(lines[i]);
  }
  let list = null;
  let scalar = unquote(same);
  if (/^\[.*\]$/.test(same)) {
    list = same.slice(1, -1).split(',').map((s) => unquote(s)).filter(Boolean);
  } else if (same === '' && children.length && children.every((c) => /^\s*-\s+/.test(c))) {
    list = children.map((c) => unquote(c.replace(/^\s*-\s+/, '')));
  } else if (/^[>|][+-]?$/.test(same)) {
    scalar = children.map((c) => c.trim()).join(' ');
  }
  return { scalar, list, children };
}

/**
 * Every job in the workflow: `{ id, name, needs, if, body, steps }`.
 * `needs` is always an array; `if` is the job-level condition or null.
 */
export function parseJobs(text) {
  const lines = text.split(/\r?\n/);
  const block = topLevelBlock(lines, 'jobs');
  if (!block) return [];
  const jobs = [];
  for (let i = 0; i < block.length; i++) {
    const m = block[i].match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
    if (!m) continue;
    const body = [];
    for (let j = i + 1; j < block.length; j++) {
      if (!isNoise(block[j]) && indentOf(block[j]) <= 2) break;
      body.push(block[j]);
    }
    const needs = readKey(body, 'needs', 4);
    const cond = readKey(body, 'if', 4);
    const name = readKey(body, 'name', 4);
    const outputs = readKey(body, 'outputs', 4);
    jobs.push({
      id: m[1],
      name: name ? name.scalar : null,
      needs: needs ? (needs.list ?? (needs.scalar ? [needs.scalar] : [])) : [],
      if: cond ? cond.scalar : null,
      outputs: outputs
        ? Object.fromEntries(
            outputs.children
              .filter((l) => !isNoise(l))
              .map((l) => l.match(/^\s*([A-Za-z0-9_-]+):\s*(.*)$/))
              .filter(Boolean)
              .map((mm) => [mm[1], unquote(mm[2])]),
          )
        : {},
      body,
    });
  }
  return jobs;
}

/**
 * The steps of a parsed job: `{ label, if, body }`. `label` is the step's
 * `uses:` action (without its ref) or its single-line `run:` command, which is
 * what the ungated allowlist names; `name` is kept for messages.
 */
export function parseSteps(job) {
  const start = job.body.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (start === -1) return [];
  const steps = [];
  for (let i = start + 1; i < job.body.length; i++) {
    const l = job.body[i];
    if (isNoise(l)) continue;
    if (indentOf(l) <= 4) break;
    const m = l.match(/^ {6}- (.*)$/);
    if (!m) continue;
    const body = [`        ${m[1]}`];
    for (let j = i + 1; j < job.body.length; j++) {
      if (isNoise(job.body[j])) continue;
      if (indentOf(job.body[j]) <= 6) break;
      body.push(job.body[j]);
    }
    const uses = readKey(body, 'uses', 8);
    const run = readKey(body, 'run', 8);
    const name = readKey(body, 'name', 8);
    const cond = readKey(body, 'if', 8);
    steps.push({
      label: uses ? uses.scalar.replace(/@.*$/, '') : run ? run.scalar : '(no uses/run)',
      name: name ? name.scalar : null,
      if: cond ? cond.scalar : null,
      body,
    });
  }
  return steps;
}

/** The `on:` block's lines, for trigger-level checks. */
export function triggerBlock(text) {
  return topLevelBlock(text.split(/\r?\n/), 'on') ?? [];
}

export const LANES_JOB = 'lanes';
/** Jobs that are not in the ledger because they ARE the lane machinery. */
const STRUCTURAL = [LANES_JOB];
export const laneCondition = (id) => `\${{ !cancelled() && needs.${LANES_JOB}.outputs.${id} != 'false' }}`;
/** The job-level condition of a step-gated job: the status function and nothing else. */
export const STEP_GATED_JOB_CONDITION = '${{ !cancelled() }}';
const stepClause = (id) => `needs.${LANES_JOB}.outputs.${id} != 'false'`;
/** A gated step is `${{ <clause> }}` or `${{ <clause> && <anything> }}`: the clause is a top-level conjunct. */
export const stepIsGated = (cond, id) =>
  typeof cond === 'string' &&
  (cond === `\${{ ${stepClause(id)} }}` || (cond.startsWith(`\${{ ${stepClause(id)} && `) && cond.endsWith(' }}')));

/**
 * Everything wrong with `text` as measured against `ledger` (job id -> kind).
 * Empty means the workflow and the ledger agree. Each message starts with a
 * stable tag in square brackets, which is what the negative controls match on.
 */
export function problems(text, ledger, { stepGated = [], ungatedSteps = [] } = {}) {
  const out = [];
  const jobs = parseJobs(text);
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const ledgerIds = Object.keys(ledger);

  if (jobs.length < 10) {
    out.push(`[parse] only ${jobs.length} jobs parsed from ci.yml; the walk is broken, not the workflow`);
  }
  const lanes = byId.get(LANES_JOB);
  if (!lanes) {
    out.push(`[lanes-missing] ci.yml has no \`${LANES_JOB}\` job; every lane condition then reads an empty output`);
  }

  const inWorkflow = jobs.map((j) => j.id).filter((id) => !STRUCTURAL.includes(id));
  for (const id of inWorkflow.filter((id) => !ledgerIds.includes(id))) {
    out.push(
      `[job-not-in-ledger] ci.yml job \`${id}\` is not in JOBS (scripts/ci-lanes.mjs). ` +
        'A new job must be given a lane kind there before it can run; add it, and add its output to the `lanes` job.',
    );
  }
  for (const id of ledgerIds.filter((id) => !inWorkflow.includes(id))) {
    out.push(
      `[ledger-job-not-in-workflow] JOBS lists \`${id}\`, which ci.yml no longer has. ` +
        'A removed or renamed job must leave the ledger in the same change (and a required job must never be renamed).',
    );
  }

  for (const job of jobs) {
    if (STRUCTURAL.includes(job.id)) continue;
    const want = stepGated.includes(job.id) ? STEP_GATED_JOB_CONDITION : laneCondition(job.id);
    if (!job.needs.includes(LANES_JOB)) {
      out.push(
        `[needs-lanes] job \`${job.id}\` does not list \`${LANES_JOB}\` in \`needs:\`, so ` +
          `\`needs.${LANES_JOB}.outputs.*\` is always empty for it and the job can never be skipped`,
      );
    }
    if (job.if === null) {
      out.push(`[no-condition] job \`${job.id}\` has no job-level \`if:\`; expected \`if: ${want}\``);
    } else if (job.if !== want) {
      out.push(
        `[condition-shape] job \`${job.id}\` has \`if: ${job.if}\`; expected exactly \`if: ${want}\`. ` +
          "The status function and the `!= 'false'` comparison are what make a failed or skipped `lanes` run the job.",
      );
    }
  }

  for (const id of stepGated) {
    const job = byId.get(id);
    if (!job) continue;
    const steps = parseSteps(job);
    if (steps.length < ungatedSteps.length + 1) {
      out.push(`[step-parse] only ${steps.length} steps parsed in step-gated job \`${id}\`; the walk is broken`);
    }
    const isAllowed = (s) => ungatedSteps.includes(s.label);
    for (const s of steps) {
      const gated = stepIsGated(s.if, id);
      if (isAllowed(s) && s.if !== null) {
        out.push(
          `[always-step-conditional] step \`${s.label}\` of job \`${id}\` must run in every lane but has \`if: ${s.if}\``,
        );
      } else if (!isAllowed(s) && !gated) {
        out.push(
          `[step-ungated] step \`${s.name ?? s.label}\` of job \`${id}\` does not read the lane output ` +
            `(it has ${s.if === null ? 'no `if:`' : `\`if: ${s.if}\``}), so it runs in lanes that turned the job off. ` +
            `Expected \`if: \${{ ${stepClause(id)} }}\`, or that clause AND-ed in front of the step's own condition.`,
        );
      }
    }
    for (const label of ungatedSteps.filter((u) => !steps.some((s) => s.label === u))) {
      out.push(`[always-step-missing] job \`${id}\` no longer has the every-lane step \`${label}\``);
    }
  }

  if (lanes) {
    if (lanes.if !== null) out.push(`[lanes-conditional] the \`${LANES_JOB}\` job has an \`if:\`; it must run on every event`);
    if (lanes.needs.length) out.push(`[lanes-needs] the \`${LANES_JOB}\` job has \`needs:\`; it must be first`);
    const wantOutputs = ['lane', ...ledgerIds];
    for (const key of wantOutputs.filter((k) => !(k in lanes.outputs))) {
      out.push(
        `[output-missing] the \`${LANES_JOB}\` job declares no output \`${key}\`; a job reading it gets an empty string and always runs`,
      );
    }
    for (const key of Object.keys(lanes.outputs).filter((k) => !wantOutputs.includes(k))) {
      out.push(`[output-unknown] the \`${LANES_JOB}\` job declares output \`${key}\`, which nothing in the ledger accounts for`);
    }
    for (const [key, value] of Object.entries(lanes.outputs)) {
      const want = `\${{ steps.decide.outputs.${key} }}`;
      if (wantOutputs.includes(key) && value !== want) {
        out.push(`[output-crossed] \`${LANES_JOB}\` output \`${key}\` is \`${value}\`; expected \`${want}\``);
      }
    }
    if (!lanes.body.some((l) => /^\s*run:\s*node\s+scripts\/ci-lanes\.mjs\s*$/.test(l))) {
      out.push(`[lanes-script] the \`${LANES_JOB}\` job no longer runs \`node scripts/ci-lanes.mjs\``);
    }
    if (!lanes.body.some((l) => /^\s*-\s*id:\s*decide\s*$/.test(l) || /^\s*id:\s*decide\s*$/.test(l))) {
      out.push(`[lanes-step-id] no step with \`id: decide\` in the \`${LANES_JOB}\` job; every output reads \`steps.decide\``);
    }
  }

  const on = triggerBlock(text);
  for (const l of on) {
    if (/^\s*schedule:/.test(l)) {
      out.push('[schedule-trigger] ci.yml has a `schedule:` trigger; the script has no scheduled lane, so it would run EVERY job on the cron');
    }
  }
  for (const l of on) {
    if (/^\s*(paths|paths-ignore):/.test(l)) {
      out.push(
        `[workflow-paths-filter] ci.yml's \`on:\` block has \`${l.trim()}\`. A workflow that never starts leaves ` +
          'required contexts pending forever; select jobs with the job-level lane condition instead.',
      );
    }
  }
  return out;
}
