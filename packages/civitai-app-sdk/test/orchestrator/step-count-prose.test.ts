/**
 * Every prose statement of "how many workflow step types are there" is DERIVED
 * here and compared against the files, instead of being typed by hand in
 * sixteen places (#382).
 *
 * WHY THIS EXISTS. `44a79dc` (#315) synced `WORKFLOW_STEP_TYPES` from the live
 * orchestrator spec and moved it from 47 entries to 50. Sixteen prose sites
 * went on saying 47, and — the part that mattered — the docs kept arguing that
 * the `$type` → template map "is only sound as a lookup if it is total over
 * `WorkflowStepType`", a claim the same commit falsified. Nothing went red,
 * because no check in the repo read the prose.
 *
 * WHAT IS DERIVED, AND FROM WHAT:
 *
 *  - `catalog` — `Object.keys(WORKFLOW_STEP_TYPES).length`, the module itself.
 *  - `mapped`  — the member count of `interface StepTemplateMap`, read off
 *                `src/orchestrator/steps.ts`'s own AST. Not the export
 *                `WorkflowStepTemplates`, which is a mapped type over it and
 *                would need a type-level count; the interface is the source.
 *  - `gap`     — catalog keys minus map keys, sorted. The `$type`s the SDK
 *                documents but cannot type yet.
 *
 * Nothing below hardcodes 50, 47 or 3.
 *
 * WHAT IT ASSERTS:
 *
 *  1. Every claim in `CLAIMS` appears in its file EXACTLY ONCE, with the
 *     derived values substituted, after whitespace/comment-marker
 *     normalisation. The whole sentence is pinned, not the number — a guard on
 *     "47" is walkable by rewording, and a reworded claim that still says 47
 *     is the bug this is here to catch. A cosmetic reword fails this test on
 *     purpose; update the claim.
 *  2. COVERAGE: after removing every claim and every allowlisted non-count
 *     number, no integer in [30, 199] survives in either file. That is what
 *     makes (1) a statement about ALL the counts rather than about the ones
 *     somebody remembered to add. A seventeenth site cannot arrive unpinned.
 *  3. The gap named in prose, the `never` ledger in
 *     `step-templates.test-d.ts`, and the derived gap are THE SAME SET. Three
 *     surfaces, one fact — the seam #382 fell through.
 *
 * WATCHED TO FAIL: at `f913811` (before this PR's prose fix) claim `catalog-1`
 * reported `expected 1 occurrence, found 0` for the 50-substituted sentence,
 * and the coverage sweep reported nine uncovered `47`s in `steps.ts` plus seven
 * in `README.md`. The positive controls at the bottom keep that ability
 * observable: each feeds a synthetic file that MUST produce a non-zero count.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { WORKFLOW_STEP_TYPES } from '../../src/orchestrator/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..');

const STEPS_TS = join(PKG, 'src/orchestrator/steps.ts');
const README = join(PKG, 'README.md');
const TYPE_LEDGER = join(PKG, 'test/orchestrator/step-templates.test-d.ts');

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** The `$type` names `interface StepTemplateMap` actually carries keys for. */
function readStepTemplateMapKeys(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );
  const decl = source.statements.find(
    (s): s is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(s) && s.name.text === 'StepTemplateMap',
  );
  if (!decl) throw new Error(`interface StepTemplateMap not found in ${file}`);
  const keys = decl.members.map((m) => {
    const name = m.name;
    if (!name || !ts.isIdentifier(name)) {
      throw new Error(`StepTemplateMap member with a non-identifier name in ${file}`);
    }
    return name.text;
  });
  if (keys.length === 0) throw new Error(`StepTemplateMap is empty in ${file}`);
  return keys;
}

/** The union members of the `never`-ledger alias in the type test. */
function readTypeLedger(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );
  const decl = source.statements.find(
    (s): s is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(s) && s.name.text === 'CatalogStepTypesWithoutAGeneratedType',
  );
  if (!decl) throw new Error(`CatalogStepTypesWithoutAGeneratedType not found in ${file}`);
  const node = decl.type;
  if (node.kind === ts.SyntaxKind.NeverKeyword) return [];
  const members = ts.isUnionTypeNode(node) ? node.types : [node];
  return members.map((m) => {
    if (!ts.isLiteralTypeNode(m) || !ts.isStringLiteral(m.literal)) {
      throw new Error(`ledger member is not a string literal in ${file}: ${m.getText()}`);
    }
    return m.literal.text;
  });
}

/**
 * The `$type`s pinned as a live compile error by `@ts-expect-error` in the type
 * test — one `_NoGeneratedTemplateFor_<$type>` alias each.
 */
function readCompileErrorPins(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );
  const prefix = '_NoGeneratedTemplateFor_';
  return source.statements
    .filter(
      (s): s is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(s) && s.name.text.startsWith(prefix),
    )
    .map((s) => s.name.text.slice(prefix.length))
    .sort();
}

const catalogKeys = Object.keys(WORKFLOW_STEP_TYPES);
const mappedKeys = readStepTemplateMapKeys(STEPS_TS);
const gap = catalogKeys.filter((k) => !mappedKeys.includes(k)).sort();
const phantom = mappedKeys.filter((k) => !catalogKeys.includes(k)).sort();

const DERIVED: Record<string, string> = {
  catalog: String(catalogKeys.length),
  mapped: String(mappedKeys.length),
  gapCount: String(gap.length),
  gapList: gap.map((k) => `\`${k}\``).join(', '),
};

// ---------------------------------------------------------------------------
// Normalisation + the claim ledger
// ---------------------------------------------------------------------------

/**
 * Collapse a file to one line of single-spaced text, with JSDoc `*` and
 * markdown `>` line prefixes removed, so a claim can be written the way it
 * reads in the source rather than with the line wrapping baked in.
 */
function normalise(text: string): string {
  return text
    .replace(/^[ \t]*(?:\*|>)[ \t]?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function substitute(claim: string): string {
  return normalise(
    claim.replace(/\{(\w+)\}/g, (_, key: string) => {
      if (!(key in DERIVED)) throw new Error(`unknown placeholder {${key}} in claim`);
      return DERIVED[key];
    }),
  );
}

interface Claim {
  id: string;
  files: string[];
  text: string;
}

/**
 * 🔴 WHOLE CLAIMS, NOT NUMBERS. Each entry is the full sentence as it appears
 * in the file, with `{catalog}` / `{mapped}` / `{gapCount}` / `{gapList}` where
 * a derived value goes. Pinning the sentence is what makes the check
 * machine-readable: a reword that keeps a stale number, or a number fix that
 * quietly drops the qualifier ("all 50" for a map that covers 47), both fail.
 */
const CLAIMS: Claim[] = [
  {
    id: 'catalog-1',
    files: [STEPS_TS],
    text: '(`WORKFLOW_STEP_TYPES` — {catalog} `$type` names and what each one does)',
  },
  {
    id: 'catalog-2',
    files: [STEPS_TS],
    text: 'of its {catalog} entries, exactly TWO sit under its "Platform internals" heading',
  },
  {
    id: 'catalog-3',
    files: [README],
    text: '`imageUpscaler` among them ({catalog} in total)',
  },
  {
    id: 'catalog-4',
    files: [README],
    text:
      'Note that `WORKFLOW_STEP_TYPES` does **not** mark most of them: of its {catalog} ' +
      'entries exactly two',
  },
  {
    id: 'mapped-1',
    files: [STEPS_TS],
    text: 'The practical consequence: a number of the {mapped} step types below exist to serve',
  },
  {
    id: 'mapped-2',
    files: [STEPS_TS],
    text: 'Enumerated over all {mapped} mapped templates',
  },
  {
    id: 'mapped-3',
    files: [STEPS_TS],
    text: 'The {mapped} wire-name → generated-template rows, UNGUARDED and NOT exported.',
  },
  {
    id: 'mapped-4',
    files: [STEPS_TS],
    text:
      'This is why neither the {mapped} `*Input` types nor the {mapped} `*StepTemplate` ' +
      'types are re-exported one by one',
  },
  {
    id: 'mapped-5',
    files: [README],
    text: 'Discriminated union of all {mapped} mapped templates',
  },
  {
    id: 'mapped-6',
    files: [README],
    text: 'it is `false` for all {mapped} generated templates',
  },
  {
    id: 'mapped-7',
    files: [README],
    text: "Several of the {mapped} exist to serve Civitai's own pipelines",
  },
  {
    id: 'map-coverage-docblock',
    files: [STEPS_TS],
    text: "`$type` → its step-template type, for {mapped} of the catalog's {catalog} step types.",
  },
  {
    id: 'map-coverage-readme-row',
    files: [README],
    text: "`$type` → template type, for {mapped} of the catalog's {catalog} step types.",
  },
  /**
   * 🔴 THE INVARIANT CLAIM. This is the sentence #382 is really about: the docs
   * used to argue totality, the map is partial, and the three uncovered
   * `$type`s were undocumented. Pinned identically in both files so neither can
   * drift from the other, and every number in it is derived — including the
   * NAMES, so a client republish that closes one third of the gap fails here
   * until the prose says so.
   */
  {
    id: 'gap',
    files: [STEPS_TS, README],
    text:
      '`WORKFLOW_STEP_TYPES` documents {catalog} `$type`s; this map covers {mapped}. ' +
      'The {gapCount} with no generated template in the pinned `@civitai/client` are ' +
      '{gapList}, and `WorkflowStepTemplateFor<…>` is a compile error for each of them.',
  },
  {
    id: 'gap-derivation-note',
    files: [README],
    text: 'derives all four numbers ({catalog}, {mapped}, {gapCount}, and the names)',
  },
];

/**
 * Numbers in [30, 199] that are NOT step-type counts. Each is the literal text
 * around it, so the allowlist cannot swallow a real count that happens to share
 * a digit run. Added only after reading the site.
 */
const NON_COUNT_NUMBERS: { files: string[]; text: string }[] = [
  { files: [STEPS_TS], text: '~97 betas behind the `beta` tag' },
  { files: [README], text: 'roughly 97 betas behind the `beta` tag' },
  { files: [README], text: 'a ~30-line framework adapter' },
  { files: [README], text: 'a 64-character `$type` cap' },
  { files: [README], text: '(real cancel, gotcha #51)' },
  { files: [README], text: 'whole number in `[0, 2**31-1]` is **not** used' },
  { files: [README], text: 'whole number in `[0, 2**31-1]`; `NaN`' },
];

/**
 * Digit runs that are not embedded in an identifier, a version, a SHA or a
 * numeric separator — `44a79dc`, `0.2.0-beta.98`, `30_000`, `base64` and
 * `~30.` are all excluded by the boundaries, which is why the allowlist above
 * is seven entries and not thirty.
 */
const STANDALONE_INTEGER = /(?<![A-Za-z0-9_.])\d+(?![A-Za-z0-9_.])/g;
const SWEEP_MIN = 30;
const SWEEP_MAX = 199;

interface Finding {
  kind: 'claim-count' | 'uncovered-number' | 'missing-allowlist';
  file: string;
  detail: string;
}

/**
 * The whole check as a pure function over file contents, so the positive
 * controls below can feed it text that MUST produce findings. A checker that
 * only ever reports zero against the real tree is indistinguishable from one
 * wired to nothing.
 */
export function auditStepCountProse(
  contents: Record<string, string>,
  claims: Claim[],
  allowlist: { files: string[]; text: string }[],
): Finding[] {
  const findings: Finding[] = [];

  for (const [file, raw] of Object.entries(contents)) {
    let residue = normalise(raw);

    const applicable = claims.filter((c) => c.files.includes(file));
    for (const claim of applicable) {
      const needle = substitute(claim.text);
      const occurrences = residue.split(needle).length - 1;
      if (occurrences !== 1) {
        findings.push({
          kind: 'claim-count',
          file,
          detail: `claim ${claim.id}: expected 1 occurrence, found ${occurrences} of: ${needle}`,
        });
      }
      residue = residue.split(needle).join(' ');
    }

    for (const entry of allowlist.filter((a) => a.files.includes(file))) {
      const needle = normalise(entry.text);
      if (!residue.includes(needle)) {
        findings.push({
          kind: 'missing-allowlist',
          file,
          detail: `allowlisted non-count text is gone — drop the entry: ${needle}`,
        });
        continue;
      }
      residue = residue.split(needle).join(' ');
    }

    for (const m of residue.matchAll(STANDALONE_INTEGER)) {
      const n = Number(m[0]);
      if (n < SWEEP_MIN || n > SWEEP_MAX) continue;
      findings.push({
        kind: 'uncovered-number',
        file,
        detail: `unpinned number ${n} near: …${residue.slice(Math.max(0, (m.index ?? 0) - 70), (m.index ?? 0) + 40)}…`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// The assertions
// ---------------------------------------------------------------------------

describe('workflow step-type counts in prose (#382)', () => {
  it('derives the catalog, the map and the gap from source, not from a literal', () => {
    // Sanity on the derivation itself — if these ever go wrong, every claim
    // below is measuring the wrong thing.
    expect(catalogKeys.length).toBeGreaterThan(0);
    expect(mappedKeys.length).toBeGreaterThan(0);
    expect(phantom, 'StepTemplateMap keys that are not catalog entries').toEqual([]);
    expect(mappedKeys.length + gap.length).toBe(catalogKeys.length);
  });

  it('states every count correctly, and leaves no count unpinned', () => {
    const contents = {
      [STEPS_TS]: readFileSync(STEPS_TS, 'utf8'),
      [README]: readFileSync(README, 'utf8'),
    };
    const findings = auditStepCountProse(contents, CLAIMS, NON_COUNT_NUMBERS);
    expect(
      findings.map((f) => `${f.kind} [${f.file.replace(PKG + '/', '')}] ${f.detail}`),
      `derived: catalog=${DERIVED.catalog} mapped=${DERIVED.mapped} gap=${DERIVED.gapCount} (${DERIVED.gapList})`,
    ).toEqual([]);
  });

  it('agrees with the type-level never ledger about which $types are missing', () => {
    // Three surfaces, one fact: the runtime catalog, the interface's AST, and
    // the compile-time ledger. #382 happened because two of them moved and the
    // third did not.
    expect(readTypeLedger(TYPE_LEDGER).slice().sort()).toEqual(gap);
  });

  it('pins one live compile error per gap $type', () => {
    // The `never` ledger is a claim about a SET; these pin the CONSEQUENCE. A
    // ledger entry with no `@ts-expect-error` alias means the map grew a hole
    // nobody demonstrated.
    expect(readCompileErrorPins(TYPE_LEDGER)).toEqual(gap);
  });
});

describe('POSITIVE CONTROL — the checker can produce a non-zero count', () => {
  const claim: Claim = {
    id: 'probe',
    files: ['probe.md'],
    text: 'the catalog documents {catalog} step types',
  };

  it('reports a stale count (the exact #382 shape)', () => {
    // 47 where the derived value is 50 — written as `catalog - gap` so the
    // fixture cannot accidentally equal the derived number.
    const stale = catalogKeys.length - gap.length;
    expect(stale).not.toBe(catalogKeys.length);
    const findings = auditStepCountProse(
      { 'probe.md': `intro\n\nthe catalog documents ${stale} step types\n` },
      [claim],
      [],
    );
    expect(findings.filter((f) => f.kind === 'claim-count')).toHaveLength(1);
    // …and the stale number is ALSO caught by the coverage sweep, which is the
    // half that sees a site nobody added to the ledger.
    expect(findings.filter((f) => f.kind === 'uncovered-number')).toHaveLength(1);
  });

  it('reports a reworded claim that still carries the right number', () => {
    const findings = auditStepCountProse(
      { 'probe.md': `the catalog lists ${catalogKeys.length} step types\n` },
      [claim],
      [],
    );
    expect(findings.filter((f) => f.kind === 'claim-count')).toHaveLength(1);
  });

  it('reports a seventeenth count site that nobody added to the ledger', () => {
    const findings = auditStepCountProse(
      {
        'probe.md':
          `the catalog documents ${catalogKeys.length} step types\n\n` +
          `and elsewhere, breezily: there are ${catalogKeys.length - 1} of them\n`,
      },
      [claim],
      [],
    );
    expect(findings.filter((f) => f.kind === 'claim-count')).toHaveLength(0);
    expect(findings.filter((f) => f.kind === 'uncovered-number')).toHaveLength(1);
  });

  it('reports a duplicated claim (two sites, one ledger entry)', () => {
    const twice = `the catalog documents ${catalogKeys.length} step types`;
    const findings = auditStepCountProse({ 'probe.md': `${twice}\n\n${twice}\n` }, [claim], []);
    expect(findings.filter((f) => f.kind === 'claim-count')).toHaveLength(1);
    expect(findings[0].detail).toContain('found 2');
  });

  it('reports an allowlist entry whose text no longer exists', () => {
    const findings = auditStepCountProse({ 'probe.md': 'nothing here\n' }, [], [
      { files: ['probe.md'], text: 'a ~30-line framework adapter' },
    ]);
    expect(findings.filter((f) => f.kind === 'missing-allowlist')).toHaveLength(1);
  });

  it('NEGATIVE CONTROL — a correct file produces nothing', () => {
    const findings = auditStepCountProse(
      { 'probe.md': `the catalog documents ${catalogKeys.length} step types\n` },
      [claim],
      [],
    );
    expect(findings).toEqual([]);
  });
});
