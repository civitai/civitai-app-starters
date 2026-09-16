/**
 * The peer-resolution guard in `src/orchestrator/steps.ts`, tested the only way
 * that means anything: by compiling a CONSUMER against this package's own
 * emitted `steps.d.ts`, once with `@civitai/client` resolvable and once
 * without.
 *
 * WHY IT CANNOT BE A TYPE TEST. Everything in `step-templates.test-d.ts` runs
 * inside this package, where the peer is a devDependency and always resolves —
 * so the arm that matters (peer missing) is structurally invisible there. It is
 * also invisible in CI for the same reason. Without this file the guard could
 * be deleted, or quietly reduced to a no-op by a refactor that unwraps
 * `GuardPeer<…>` from an export, and every other check in the repo would stay
 * green.
 *
 * WHAT MAKES IT RED, watched rather than assumed (matrix in the module's own
 * docblock): run against the declarations emitted at the commit before the
 * guard existed, the peer-absent arm reported no guard diagnostic at all — only
 * the planted control — and the ledger assertion below failed. Each of the four
 * guarded exports was also unwrapped one at a time; every one of those four
 * mutants was killed here, by the ledger naming the file that stopped
 * reporting. The peer-present arms are unchanged before and after the guard,
 * which is the other half of the claim: the guard must cost a correct consumer
 * nothing.
 *
 * The consumer is compiled with `skipLibCheck: true` on purpose. That is the
 * TypeScript default for an app, it is what every starter in this repo sets,
 * and it is exactly the setting that swallows the `TS2307` on the unresolved
 * import and leaves the hole this guard closes.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..', '..');
const STEPS_SRC = join(PKG_ROOT, 'src', 'orchestrator', 'steps.ts');

/** Resolved path of the real peer's declaration entry point. */
const CLIENT_TYPES = join(PKG_ROOT, 'node_modules', '@civitai', 'client', 'dist', 'index.d.ts');

/** A fragment of the guard's message — enough to identify it, short enough to survive rewording of the rest. */
const GUARD_MARKER = 'is not type-checking';

const BASE_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
};

/**
 * Emit the declarations a consumer would actually install.
 *
 * Not `readFileSync(dist/orchestrator/steps.d.ts)`: that file may be stale or
 * absent depending on whether `pnpm build` ran, and a test that silently reads
 * last week's artifact is worse than no test. This emits from source, in the
 * package root so the peer resolves.
 */
function emitStepsDeclaration(): string {
  const program = ts.createProgram([STEPS_SRC], {
    ...BASE_OPTIONS,
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    outDir: join(tmpdir(), 'unused-declaration-out'),
  });
  let text: string | undefined;
  program.emit(undefined, (fileName, contents) => {
    if (fileName.endsWith('steps.d.ts')) text = contents;
  });
  if (text === undefined) throw new Error('declaration emit produced no steps.d.ts');
  return text;
}

/** Compile `files` in a throwaway directory and return every diagnostic as `file(line): message`. */
function compile(
  dir: string,
  files: Record<string, string>,
  options: ts.CompilerOptions = {},
): string[] {
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents, 'utf8');
  }
  const entries = Object.keys(files)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => join(dir, f));
  const program = ts.createProgram(entries, { ...BASE_OPTIONS, ...options });
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    if (!d.file || d.start === undefined) return `<no file>: ${message}`;
    const { line } = d.file.getLineAndCharacterOfPosition(d.start);
    return `${d.file.fileName.split('/').pop()}(${line + 1}): ${message}`;
  });
}

/**
 * One CORRECT consumer per guarded export, each in its OWN file.
 *
 * 🔴 A LEDGER, NOT A SAMPLE. A single consumer touching two of these would stay
 * green while the guard was unwrapped from one of them — the other export's
 * message would still be in the output and `some(…)` would still be true. One
 * file each, every file asserted, so dropping `GuardPeer<…>` from any single
 * export is visible. Adding a guarded export means adding an entry here; the
 * count is asserted below so a silently-shrinking ledger fails too.
 */
const GUARDED_EXPORT_CONSUMERS: Record<string, string> = {
  'uses-template.ts': [
    "import type { WorkflowStepTemplateFor } from './steps.js';",
    "const step: WorkflowStepTemplateFor<'textToImage'> = {",
    "  $type: 'textToImage',",
    "  input: { prompt: 'a fox', cfgScale: 5, seed: 1234 },",
    '};',
    'void step;',
  ].join('\n'),
  'uses-input.ts': [
    "import type { WorkflowStepInputFor } from './steps.js';",
    "const input: WorkflowStepInputFor<'textToImage'> = {",
    "  prompt: 'a fox',",
    '  cfgScale: 5,',
    '  seed: 1234,',
    '};',
    'void input;',
  ].join('\n'),
  'uses-union.ts': [
    "import type { AnyWorkflowStepTemplate } from './steps.js';",
    'const any_: AnyWorkflowStepTemplate = {',
    "  $type: 'textToImage',",
    "  input: { prompt: 'a fox', cfgScale: 5, seed: 1234 },",
    '};',
    'void any_;',
  ].join('\n'),
  'uses-envelope.ts': [
    "import type { TypedWorkflowTemplate } from './steps.js';",
    "const body: TypedWorkflowTemplate = { steps: [], tags: ['t'] };",
    'void body;',
  ].join('\n'),
};

/**
 * Positive control: proves the program was really checked. A run that reports
 * nothing at all is indistinguishable from a compiler wired to nothing, so
 * every arm asserts this line reported.
 */
const PLANTED_CONSUMER = ["const planted: number = 'not a number';", 'void planted;'].join('\n');

const GOOD_CONSUMER: Record<string, string> = {
  ...GUARDED_EXPORT_CONSUMERS,
  'planted.ts': PLANTED_CONSUMER,
};

/** A consumer whose `$type` is wrong — the error the subpath exists to produce. */
const BAD_CONSUMER: Record<string, string> = {
  'consumer.ts': [
    "import type { WorkflowStepTemplateFor } from './steps.js';",
    '',
    "const bad: WorkflowStepTemplateFor<'textToImage'> = {",
    "  $type: 'definitelyNotAStepType',",
    "  input: { prompt: 'a fox', cfgScale: 5, seed: 1234 },",
    '};',
    'void bad;',
  ].join('\n'),
};

const PLANTED_CONTROL = "Type 'string' is not assignable to type 'number'";

const tempDirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'app-sdk-peer-guard-'));
  tempDirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

describe('the missing-peer guard on @civitai/app-sdk/orchestrator/steps', () => {
  const stepsDeclaration = emitStepsDeclaration();

  it('emits declarations that really do depend on the peer', () => {
    // Without this, every assertion below could be passing against an empty or
    // wrong file.
    expect(stepsDeclaration).toContain('@civitai/client');
    expect(stepsDeclaration).toContain('WorkflowStepTemplateFor');
  });

  it('PEER ABSENT: every guarded export reports in the CONSUMER’s own file', () => {
    // The temp dir is outside this repo, so `@civitai/client` resolves nowhere
    // — the same state as an app that never installed the optional peer.
    const diagnostics = compile(tempDir(), {
      'steps.d.ts': stepsDeclaration,
      ...GOOD_CONSUMER,
    });

    const guard = diagnostics.filter((d) => d.includes(GUARD_MARKER));
    // In the consumers' own files, not in node_modules — that is the point.
    const guardedFiles = new Set(guard.map((d) => d.slice(0, d.indexOf('('))));
    expect([...guardedFiles].sort()).toEqual(Object.keys(GUARDED_EXPORT_CONSUMERS).sort());
    // Four today. A new guarded export without an entry above, or an entry
    // deleted, moves this number.
    expect(guardedFiles.size).toBe(4);
    // It must name the remediation, not merely fail.
    expect(guard.join('\n')).toContain('@civitai/client@beta');
    // And the run really happened.
    expect(diagnostics.join('\n')).toContain(PLANTED_CONTROL);
  });

  it('PEER PRESENT: is silent on every one of those same consumers', () => {
    const dir = tempDir();
    const diagnostics = compile(
      dir,
      { 'steps.d.ts': stepsDeclaration, ...GOOD_CONSUMER },
      { baseUrl: dir, paths: { '@civitai/client': [CLIENT_TYPES] } },
    );

    expect(diagnostics.filter((d) => d.includes(GUARD_MARKER))).toEqual([]);
    // The planted error is the ONLY thing reported: four correct consumers
    // against four guarded exports contribute nothing.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain(PLANTED_CONTROL);
  });

  it('PEER PRESENT: still reports a genuinely wrong $type (negative control)', () => {
    // A guard that silenced real errors would pass the arm above and be
    // useless. This is the arm that says the types still check.
    const dir = tempDir();
    const diagnostics = compile(
      dir,
      { 'steps.d.ts': stepsDeclaration, ...BAD_CONSUMER },
      { baseUrl: dir, paths: { '@civitai/client': [CLIENT_TYPES] } },
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('"definitelyNotAStepType"');
    expect(diagnostics[0]).toContain('"textToImage"');
  });
});
