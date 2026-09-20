#!/usr/bin/env node
/**
 * Mutation battery for the guards in test/.
 *
 * A guard that has never been watched fail is a claim, not evidence. For each
 * mutant this script breaks ONE mechanism, runs ONE test file, and records
 * which tests went red and with what message — so the report can say the guard
 * died on ITS OWN assertion rather than on a collateral error.
 *
 * Controls built in:
 *   - a POSITIVE CONTROL mutant that must obviously be caught; if it survives,
 *     the harness is wired to nothing and every other row is meaningless.
 *   - a BASELINE run with no mutation, which must be fully green; if it is
 *     red, every "killed" row is red for the wrong reason.
 *   - every mutant asserts its search string was actually FOUND and replaced.
 *     A mutation that silently no-ops is scored SURVIVED and would read as a
 *     coverage gap that does not exist.
 *
 * Run: node scripts/mutation-check.mjs  (needs PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
 * for the browser-tier rows).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const vitest = join(pkgRoot, 'node_modules', '.bin', 'vitest');

/** @type {{id:string,file:string,find:string,replace:string,test:string,project:'unit'|'browser',expect:string[]}[]} */
const MUTANTS = [
  {
    id: 'POSITIVE-CONTROL: button default variant filled -> light',
    file: 'src/button/civitai-button.ts',
    find: "this.variant = 'filled';",
    replace: "this.variant = 'light';",
    test: 'test/button.test.ts',
    project: 'unit',
    expect: ['reflects the documented defaults'],
  },
  {
    id: 'A1: civitai-stack templates its children (the naive React port)',
    file: 'src/internal/CivitaiEnhanceElement.ts',
    find: '  override connectedCallback(): void {\n    super.connectedCallback();',
    replace:
      '  override connectedCallback(): void {\n    super.connectedCallback();\n    this.replaceChildren(document.createElement("div"));',
    test: 'test/light-dom-children.test.ts',
    project: 'unit',
    expect: ['keeps the SAME child nodes'],
  },
  {
    id: 'A2: the loading spinner becomes a real child element',
    file: 'src/button/civitai-button.ts',
    find: "      if (this.loading) this.setAttribute('aria-busy', 'true');",
    replace:
      "      if (this.loading) { this.insertAdjacentHTML('afterbegin', '<span data-spinner></span>'); this.setAttribute('aria-busy', 'true'); }",
    test: 'test/light-dom-children.test.ts',
    project: 'unit',
    expect: ['adds NO element of its own'],
  },
  {
    id: 'A3: a wrapper entrypoint reaches lit',
    file: 'src/stack.ts',
    find: "import { define } from './internal/define.js';",
    replace: "import { define } from './internal/define.js';\nimport { html } from 'lit';\nvoid html;",
    test: 'test/enhance-only.test.ts',
    project: 'unit',
    expect: ['stack.ts never reaches a templating library'],
  },
  {
    id: 'B1: the inner <select> grows a name (DOUBLE SUBMIT)',
    file: 'src/select/civitai-select.ts',
    find: '        data-civitai-ui-control\n',
    replace: '        data-civitai-ui-control\n        name=${this.name}\n',
    test: 'test/form-participation.browser.test.ts',
    project: 'browser',
    expect: ['submits its value exactly ONCE', 'carries NO name', 'one entry per control'],
  },
  {
    id: 'B2: the inner range input grows a name (DOUBLE SUBMIT)',
    file: 'src/slider/civitai-slider.ts',
    find: '        type="range"\n',
    replace: '        type="range"\n        name=${this.name}\n',
    test: 'test/form-participation.browser.test.ts',
    project: 'browser',
    expect: ['submits its value exactly ONCE', 'carries NO name', 'one entry per control'],
  },
  {
    id: 'B3: setFormValue is never called',
    file: 'src/internal/CivitaiFieldElement.ts',
    find: 'internals.setFormValue(this.disabled ? null : this.formValue);',
    replace: 'void this.formValue;',
    test: 'test/form-participation.browser.test.ts',
    project: 'browser',
    expect: ['submits its value exactly ONCE'],
  },
  {
    id: 'C1: required never reaches validity',
    file: 'src/internal/CivitaiFieldElement.ts',
    find: 'if (this.required && this.valueMissing && !this.disabled) {',
    replace: 'if (false) {',
    test: 'test/required-reaches-control.browser.test.ts',
    project: 'browser',
    expect: ['blocks submission while empty', 'valueMissing until the user moves it'],
  },
  {
    id: 'C2: aria-required never reaches the select control',
    file: 'src/select/civitai-select.ts',
    find: "aria-required=${this.required ? 'true' : nothing}",
    replace: 'aria-required=${nothing}',
    test: 'test/required-reaches-control.browser.test.ts',
    project: 'browser',
    expect: ['aria-required and the marker'],
  },
  {
    id: 'C3: the validation message is not anchored on the control',
    file: 'src/internal/CivitaiFieldElement.ts',
    find: 'const anchor = this.control ?? undefined;',
    replace: 'const anchor = undefined;',
    test: 'test/required-reaches-control.browser.test.ts',
    project: 'browser',
    expect: ['anchors the validation message'],
  },
  {
    id: 'D1: the inner event is not stopped (DOUBLE FIRE)',
    file: 'src/internal/CivitaiFieldElement.ts',
    find: 'inner.stopPropagation();',
    replace: 'void inner;',
    test: 'test/event-identity.browser.test.ts',
    project: 'browser',
    expect: ['fires change ONCE', 'does not escape on its own'],
  },
  {
    id: 'F1: the midpoint default clobbers a PROPERTY-set value (the React seam bug)',
    file: 'src/slider/civitai-slider.ts',
    find: '  get value(): number {\n    return this.#value ?? (this.min + this.max) / 2;\n  }',
    replace:
      '  get value(): number {\n    return this.hasAttribute("value") ? (this.#value ?? 0) : (this.min + this.max) / 2;\n  }',
    test: 'test/slider-value-seeding.test.ts',
    project: 'unit',
    // NOT 'set as a PROPERTY after connect': `value` reflects, so by the time
    // that case reads the getter the attribute exists and the mutant's guard
    // is satisfied — it passes UNDER the mutant. Listing it here scored this
    // mutant SURVIVED on the first run, which read as a coverage gap that does
    // not exist. The before-connect case is the one that discriminates,
    // because it is the mutant's own first render that writes the attribute.
    expect: ['set as a PROPERTY before connect'],
  },
  {
    id: 'F2: the midpoint default is deleted entirely',
    file: 'src/slider/civitai-slider.ts',
    find: 'return this.#value ?? (this.min + this.max) / 2;',
    replace: 'return this.#value ?? 0;',
    test: 'test/slider-value-seeding.test.ts',
    project: 'unit',
    expect: ['defaults to the midpoint', 'midpoint tracks min/max'],
  },
  {
    id: 'G1: a generated CSS module goes stale',
    file: 'src/generated/stack.css.ts',
    find: 'display: flex;',
    replace: 'display: block;',
    test: 'test/generation-parity.test.ts',
    project: 'unit',
    expect: ['stack.css is in sync'],
  },
  {
    id: 'E1: a named gap step falls through to an inline length (gap: md)',
    file: 'src/stack/civitai-stack.ts',
    find: "} else if (typeof raw === 'string' && STEPS.has(raw)) {",
    replace: '} else if (false) {',
    test: 'test/stack-gap.test.ts',
    project: 'unit',
    expect: ['named step lands on the attribute'],
  },
];

const baselineFailures = run('test/', 'unit') + run('test/', 'browser');
if (baselineFailures > 0) {
  console.error(`BASELINE IS RED (${baselineFailures} failures) — every result below is void.`);
  process.exit(1);
}
console.log('BASELINE: green in both tiers.\n');

let surviving = 0;
for (const m of MUTANTS) {
  const path = join(pkgRoot, m.file);
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(m.find).length - 1;
  if (occurrences !== 1) {
    console.error(
      `!! ${m.id}\n   search string occurs ${occurrences} times in ${m.file} — refusing to guess. A no-op mutation would score SURVIVED.`
    );
    process.exitCode = 1;
    continue;
  }
  writeFileSync(path, original.replace(m.find, m.replace));
  let out = '';
  try {
    out = capture(m.test, m.project);
  } finally {
    writeFileSync(path, original);
  }
  const failed = [...out.matchAll(/×\s+.*?>\s*(.+?)(?:\s+\d+ms)?$/gm)].map((x) => x[1].trim());
  const failedLine = /Tests\s+(\d+) failed/.exec(out);
  const nFailed = failedLine ? Number(failedLine[1]) : 0;
  const hit = m.expect.filter((e) => failed.some((f) => f.includes(e)));
  const killed = nFailed > 0 && hit.length === m.expect.length;
  if (!killed) surviving += 1;
  console.log(`${killed ? 'KILLED  ' : 'SURVIVED'} ${m.id}`);
  console.log(`         failures (${nFailed}): ${failed.join(' | ') || '(none)'}`);
  if (!killed) console.log(`         expected to see: ${m.expect.join(' | ')}`);
}

console.log(`\n${MUTANTS.length - surviving}/${MUTANTS.length} mutants killed.`);
process.exitCode = surviving === 0 ? process.exitCode ?? 0 : 1;

function capture(test, project) {
  try {
    return execFileSync(vitest, ['run', '--project', project, '--reporter=verbose', test], {
      cwd: pkgRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  } catch (e) {
    // A failing run exits non-zero; its output is the thing we want. Never
    // branch on the exit code alone — count the reported per-test lines.
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

function run(test, project) {
  const out = capture(test, project);
  const m = /Tests\s+(\d+) failed/.exec(out);
  if (!/Tests\s+\d+ passed/.test(out) && !m) {
    console.error(`could not parse a result line from the ${project} tier:\n${out.slice(-2000)}`);
    return 1;
  }
  return m ? Number(m[1]) : 0;
}
