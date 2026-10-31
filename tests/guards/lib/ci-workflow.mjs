/**
 * A line-and-indent reader for `.github/workflows/ci.yml`, and the structural
 * checks `ci-lanes-ledger.test.mjs` runs over it.
 *
 * 🔴 NODE BUILT-INS ONLY, NO YAML LIBRARY. `pnpm test:guards` runs in the
 * required `starters` job BEFORE `pnpm install`, so a third-party import does not
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
export const RECORD_JOB = 'record-tree';
/** Jobs that are not hosts because they ARE the lane machinery. */
const STRUCTURAL = [LANES_JOB, RECORD_JOB];
/** A one-lane condition: the job-level condition of a one-lane host, and the step condition of a lane step. */
export const laneCondition = (id) => `\${{ !cancelled() && needs.${LANES_JOB}.outputs.${id} != 'false' }}`;
const clause = (id) => `needs.${LANES_JOB}.outputs.${id} != 'false'`;
/** The job-level condition of a host: its one lane's, or every lane's clause OR-ed under the status function. */
export const hostCondition = (lanes) =>
  lanes.length === 1 ? laneCondition(lanes[0]) : `\${{ !cancelled() && (${lanes.map(clause).join(' || ')}) }}`;
/** The job-level condition of a step-gated host: the status function and nothing else. */
export const STEP_GATED_JOB_CONDITION = '${{ !cancelled() }}';
/** The conditions an ungated (no-lane) step may carry. */
const UNGATED_CONDITIONS = [null, STEP_GATED_JOB_CONDITION];

/**
 * The lane a step condition gates on, or null. A gated step is
 * `${{ !cancelled() && <clause> }}` or `${{ !cancelled() && <clause> && <more> }}`:
 * the status function and then ONE lane's clause as top-level conjuncts. More
 * conjuncts may only narrow it, so an `||` anywhere after the clause is
 * refused (`a && b || c` runs on `c` alone).
 */
export function gatedLane(cond) {
  if (typeof cond !== 'string') return null;
  const m = cond.match(/^\$\{\{ !cancelled\(\) && needs\.lanes\.outputs\.([\w-]+) != 'false'( && (.*))? \}\}$/);
  if (!m) return null;
  if (m[3] !== undefined && /\|\|/.test(m[3])) return null;
  return m[1];
}

/** Kept for callers that ask about one lane: is `cond` gated on exactly `id`? */
export const stepIsGated = (cond, id) => gatedLane(cond) === id;

/**
 * The `&&`-conjuncts of a `${{ … }}` condition, trimmed, or null when the
 * condition is not a pure conjunction (an `||` or a parenthesis makes the
 * set reading wrong, so it is refused rather than approximated).
 */
export function conjuncts(cond) {
  const m = typeof cond === 'string' ? cond.match(/^\$\{\{([\s\S]*)\}\}$/) : null;
  // Zero-argument status calls (`!cancelled()`, `success()`) are atoms; any
  // other parenthesis, or an `||`, is structure this set reading cannot see.
  if (!m || /\|\||[()]/.test(m[1].replace(/!?\b\w+\(\)/g, ''))) return null;
  return m[1].split('&&').map((c) => c.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/**
 * The exact conjunct set `record-tree` must carry for a ledger and its hosts.
 * A host of core lanes must have SUCCEEDED and each of its lanes must have
 * been ON (a host succeeds with lanes switched off); a host of advisory lanes
 * may be skipped, but not failed or cancelled.
 */
export function recordConjuncts(ledger, hosts) {
  const out = [
    '!cancelled()',
    "github.event_name == 'pull_request'",
    `needs.${LANES_JOB}.result == 'success'`,
    `needs.${LANES_JOB}.outputs.lane == 'full'`,
  ];
  const hosted = new Set(Object.values(hosts).flat());
  for (const [host, lanes] of Object.entries(hosts)) {
    const core = lanes.filter((l) => ledger[l] === 'core');
    if (core.length) {
      out.push(`needs.${host}.result == 'success'`, ...core.map((l) => `needs.${LANES_JOB}.outputs.${l} == 'true'`));
    } else {
      out.push(`needs.${host}.result != 'failure'`, `needs.${host}.result != 'cancelled'`);
    }
  }
  // A core lane no host carries still has to be ON for a record.
  for (const l of Object.keys(ledger).filter((l) => ledger[l] === 'core' && !hosted.has(l))) {
    out.push(`needs.${LANES_JOB}.outputs.${l} == 'true'`);
  }
  return out;
}

/**
 * Evaluates a pure-conjunction condition of the shapes `recordConjuncts`
 * produces against a context. Throws on any other shape, so a test cannot pass
 * by evaluating something it does not understand.
 */
export function evaluateConjunction(cond, ctx) {
  const parts = conjuncts(cond);
  if (!parts) throw new Error(`not a pure conjunction: ${cond}`);
  return parts.every((c) => {
    if (c === '!cancelled()') return !ctx.cancelled;
    let m = c.match(/^github\.event_name == '([^']*)'$/);
    if (m) return ctx.event === m[1];
    m = c.match(/^needs\.([\w-]+)\.result (==|!=) '([^']*)'$/);
    if (m) return ((ctx.results[m[1]] ?? '') === m[3]) === (m[2] === '==');
    m = c.match(/^needs\.([\w-]+)\.outputs\.([\w-]+) == '([^']*)'$/);
    if (m) return (ctx.outputs[m[1]]?.[m[2]] ?? '') === m[3];
    throw new Error(`unknown conjunct shape: ${c}`);
  });
}

/**
 * Everything wrong with `text` as measured against `ledger` (lane -> kind) and
 * `hosts` (job id -> lanes). Empty means the workflow and the ledger agree.
 * Each message starts with a stable tag in square brackets, which is what the
 * negative controls match on.
 */
export function problems(text, ledger, { hosts = {}, stepGated = [], ungatedSteps = {} } = {}) {
  const out = [];
  const jobs = parseJobs(text);
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const ledgerIds = Object.keys(ledger);
  const hostIds = Object.keys(hosts);

  if (jobs.length < 5) {
    out.push(`[parse] only ${jobs.length} jobs parsed from ci.yml; the walk is broken, not the workflow`);
  }
  const lanes = byId.get(LANES_JOB);
  if (!lanes) {
    out.push(`[lanes-missing] ci.yml has no \`${LANES_JOB}\` job; every lane condition then reads an empty output`);
  }

  // Lanes against hosts: every lane in exactly one host, every hosted lane in the ledger.
  for (const id of ledgerIds) {
    const n = hostIds.filter((h) => hosts[h].includes(id)).length;
    if (n === 0) out.push(`[lane-unhosted] lane \`${id}\` is in JOBS but no host in HOSTS runs it, so nothing checks it`);
    if (n > 1) out.push(`[lane-multihosted] lane \`${id}\` is in ${n} hosts; its steps and its record condition are ambiguous`);
  }
  for (const h of hostIds) {
    for (const id of hosts[h].filter((l) => !ledgerIds.includes(l))) {
      out.push(`[host-lane-unknown] host \`${h}\` lists lane \`${id}\`, which is not in JOBS`);
    }
    const kinds = new Set(hosts[h].filter((l) => ledgerIds.includes(l)).map((l) => ledger[l]));
    if (kinds.size > 1) {
      out.push(`[host-mixed] host \`${h}\` mixes core and advisory lanes; a required host would then fail on a live service, or a core lane go path-scoped`);
    }
  }

  // Hosts against ci.yml jobs, in both directions.
  const inWorkflow = jobs.map((j) => j.id).filter((id) => !STRUCTURAL.includes(id));
  for (const id of inWorkflow.filter((id) => !hostIds.includes(id))) {
    out.push(
      `[job-not-in-hosts] ci.yml job \`${id}\` is not in HOSTS (scripts/ci-lanes.mjs). ` +
        'A new job must host lanes there before it can run.',
    );
  }
  for (const id of hostIds.filter((id) => !inWorkflow.includes(id))) {
    out.push(`[host-not-in-workflow] HOSTS lists \`${id}\`, which ci.yml does not have; its lanes then run nowhere`);
  }

  for (const job of jobs) {
    if (STRUCTURAL.includes(job.id) || !hostIds.includes(job.id)) continue;
    const hostLanes = hosts[job.id];
    const want = stepGated.includes(job.id) ? STEP_GATED_JOB_CONDITION : hostCondition(hostLanes);
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
          "The status function and the `!= 'false'` comparisons are what make a failed or skipped `lanes` run the job.",
      );
    }

    // A one-lane host that is not step-gated is gated at job level; its steps are its own business.
    if (!stepGated.includes(job.id) && hostLanes.length === 1) continue;
    const allowed = ungatedSteps[job.id] ?? [];
    const steps = parseSteps(job);
    if (steps.length < allowed.length + hostLanes.length) {
      out.push(`[step-parse] only ${steps.length} steps parsed in host \`${job.id}\`; the walk is broken`);
    }
    const seenLanes = new Set();
    for (const s of steps) {
      const lane = gatedLane(s.if);
      if (lane !== null) {
        if (!hostLanes.includes(lane)) {
          out.push(
            `[step-foreign-lane] step \`${s.name ?? s.label}\` of \`${job.id}\` is gated on lane \`${lane}\`, ` +
              `which \`${job.id}\` does not host; it would run when that lane's own host is skipped`,
          );
        }
        seenLanes.add(lane);
        continue;
      }
      if (allowed.includes(s.label)) {
        if (!UNGATED_CONDITIONS.includes(s.if)) {
          out.push(
            `[always-step-conditional] step \`${s.label}\` of \`${job.id}\` must run whenever the job runs but has \`if: ${s.if}\``,
          );
        }
        continue;
      }
      out.push(
        `[step-ungated] step \`${s.name ?? s.label}\` of \`${job.id}\` does not read a lane output ` +
          `(it has ${s.if === null ? 'no `if:`' : `\`if: ${s.if}\``}), so it runs in lanes that turned it off. ` +
          "Expected `if: ${{ !cancelled() && needs.lanes.outputs.<lane> != 'false' }}`, optionally with more `&&` conjuncts.",
      );
    }
    for (const l of hostLanes.filter((l) => !seenLanes.has(l))) {
      out.push(`[lane-no-steps] host \`${job.id}\` carries lane \`${l}\` but no step is gated on it, so that lane checks nothing`);
    }
    for (const label of allowed.filter((u) => !steps.some((s) => s.label === u && UNGATED_CONDITIONS.includes(s.if)))) {
      out.push(`[always-step-missing] host \`${job.id}\` no longer has the ungated step \`${label}\``);
    }
  }

  if (lanes) {
    if (lanes.if !== null) out.push(`[lanes-conditional] the \`${LANES_JOB}\` job has an \`if:\`; it must run on every event`);
    if (lanes.needs.length) out.push(`[lanes-needs] the \`${LANES_JOB}\` job has \`needs:\`; it must be first`);
    // `name-prefix` is the one output that is not a lane switch: the required hosts' `name:` reads it.
    const wantOutputs = ['lane', ...ledgerIds, 'name-prefix'];
    for (const key of wantOutputs.filter((k) => !(k in lanes.outputs))) {
      out.push(
        `[output-missing] the \`${LANES_JOB}\` job declares no output \`${key}\`; a step reading it gets an empty string and always runs`,
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

  const record = byId.get(RECORD_JOB);
  if (!record) {
    out.push(`[record-missing] ci.yml has no \`${RECORD_JOB}\` job; no tree is ever recorded and main never skips`);
  } else {
    const want = [LANES_JOB, ...hostIds];
    for (const id of want.filter((id) => !record.needs.includes(id))) {
      out.push(
        `[record-needs-missing] \`${RECORD_JOB}\` does not need \`${id}\`, so it can record a tree before \`${id}\` finished, ` +
          'or without it having run at all. Every host goes in its `needs:`.',
      );
    }
    for (const id of record.needs.filter((id) => !want.includes(id))) {
      out.push(`[record-needs-unknown] \`${RECORD_JOB}\` needs \`${id}\`, which is not a host`);
    }
    const have = conjuncts(record.if);
    if (!have) {
      out.push(`[record-condition-shape] \`${RECORD_JOB}\`'s \`if:\` is not a pure \`&&\` conjunction: ${record.if}`);
    } else {
      const expect = recordConjuncts(ledger, hosts);
      for (const c of expect.filter((c) => !have.includes(c))) {
        out.push(`[record-condition-missing] \`${RECORD_JOB}\`'s \`if:\` lacks \`${c}\`; without it a run that did not test the full tree can record it`);
      }
      for (const c of have.filter((c) => !expect.includes(c))) {
        out.push(`[record-condition-unknown] \`${RECORD_JOB}\`'s \`if:\` carries \`${c}\`, which the ledger does not account for`);
      }
    }
    const upload = record.body.findIndex((l) => /uses:\s*actions\/upload-artifact@/.test(l));
    const name = upload === -1 ? null : record.body.slice(upload).find((l) => /^\s+name:/.test(l))?.trim();
    if (name !== 'name: ci-tested-tree-${{ steps.tree.outputs.sha }}-full') {
      out.push(`[record-artifact-name] \`${RECORD_JOB}\` uploads ${name ?? 'nothing'}; the gate looks up \`ci-tested-tree-<tree>-full\``);
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
          'required contexts pending forever; select lanes with the job- and step-level conditions instead.',
      );
    }
  }
  return out;
}
