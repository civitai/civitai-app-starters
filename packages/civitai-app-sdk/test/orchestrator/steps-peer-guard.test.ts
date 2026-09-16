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
 * THREE THINGS ARE PINNED HERE, and each one is a separate failure:
 *
 *  1. Every guarded export reports IN THE CONSUMER'S OWN FILE when the peer is
 *     missing — asserted as a set of export names, so unwrapping the guard from
 *     any single export names that export in the failure.
 *  2. The ledger below covers every export of `steps.ts`. The export list is
 *     read out of the module's own symbol table via the TypeScript API, not
 *     from a hand-kept count, so adding an export without adding a consumer
 *     file fails here rather than passing unnoticed.
 *  3. `NodeNext` resolution degrades the peer EVEN WHEN IT IS INSTALLED, and
 *     the guard reports there too — with the same directory compiled under
 *     `Bundler` as the control that says the installed copy is fine.
 *
 * WATCHED RED, not assumed. Unwrapping `GuardPeer<…>` from each export in turn —
 * five mutants, one per export, each applied to an otherwise pristine tree —
 * fails (1) and (3), with that export's own name missing from the reported set
 * and no other test moving. Adding a sixth guarded export with no consumer file
 * fails (2) alone, naming it under `unledgeredExports`; that same mutant left
 * the whole suite green before (2) existed, which is why the claim it replaces
 * ("a new guarded export without an entry moves this number") was wrong — the
 * count is built from the diagnostics of the files that exist, so an export
 * nobody consumes contributes nothing to it. Against the pre-guard revision
 * `be503a9d`, the compiles behind (1) and (3) produce nothing but the planted
 * control, so both fail there.
 *
 * The consumer is compiled with `skipLibCheck: true` on purpose. That is the
 * TypeScript default for an app, it is what every starter in this repo sets,
 * and it is exactly the setting that swallows the `TS2307` on the unresolved
 * import and leaves the hole this guard closes.
 */
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..', '..');
const STEPS_SRC = join(PKG_ROOT, 'src', 'orchestrator', 'steps.ts');

/** The real peer, as installed in this package. */
const CLIENT_PKG = join(PKG_ROOT, 'node_modules', '@civitai', 'client');
/** Resolved path of the real peer's declaration entry point. */
const CLIENT_TYPES = join(CLIENT_PKG, 'dist', 'index.d.ts');

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
 * Emit the declarations a consumer would actually install, and read this
 * module's exported symbols out of the same program.
 *
 * Not `readFileSync(dist/orchestrator/steps.d.ts)`: that file may be stale or
 * absent depending on whether `pnpm build` ran, and a test that silently reads
 * last week's artifact is worse than no test. This emits from source, in the
 * package root so the peer resolves.
 *
 * The export list comes from the type checker rather than a regex over the
 * source, so it cannot be fooled by how an export happens to be spelled.
 */
function emitStepsModule(): { declaration: string; exportedNames: string[] } {
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

  const source = program.getSourceFile(STEPS_SRC);
  if (!source) throw new Error(`steps.ts not in the program: ${STEPS_SRC}`);
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error('steps.ts has no module symbol');
  const exportedNames = checker
    .getExportsOfModule(moduleSymbol)
    .map((s) => s.getName())
    .sort();

  return { declaration: text, exportedNames };
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
 * One CORRECT consumer per exported type, each in its OWN file.
 *
 * 🔴 A LEDGER, NOT A SAMPLE. A single consumer touching two of these would stay
 * green while the guard was unwrapped from one of them — the other export's
 * message would still be in the output and `some(…)` would still be true. One
 * file each, and the arms below assert the exact SET of exports that reported,
 * so dropping `GuardPeer<…>` from any single export names that export in the
 * failure.
 *
 * The keys are export names, and `the ledger covers every export` below reads
 * the real export list off the module. That is what makes this a ledger of the
 * module rather than of whatever someone remembered to add: a new export with
 * no entry here fails that test, and an entry here for an export that no longer
 * exists fails it too.
 */
const GUARDED_EXPORT_CONSUMERS: Record<string, { file: string; source: string }> = {
  WorkflowStepTemplates: {
    file: 'uses-map.ts',
    source: [
      "import type { WorkflowStepTemplates } from './steps.js';",
      "const fromMap: WorkflowStepTemplates['textToImage'] = {",
      "  $type: 'textToImage',",
      "  input: { prompt: 'a fox', cfgScale: 5, seed: 1234 },",
      '};',
      'void fromMap;',
    ].join('\n'),
  },
  WorkflowStepTemplateFor: {
    file: 'uses-template.ts',
    source: [
      "import type { WorkflowStepTemplateFor } from './steps.js';",
      "const step: WorkflowStepTemplateFor<'textToImage'> = {",
      "  $type: 'textToImage',",
      "  input: { prompt: 'a fox', cfgScale: 5, seed: 1234 },",
      '};',
      'void step;',
    ].join('\n'),
  },
  WorkflowStepInputFor: {
    file: 'uses-input.ts',
    source: [
      "import type { WorkflowStepInputFor } from './steps.js';",
      "const input: WorkflowStepInputFor<'textToImage'> = {",
      "  prompt: 'a fox',",
      '  cfgScale: 5,',
      '  seed: 1234,',
      '};',
      'void input;',
    ].join('\n'),
  },
  AnyWorkflowStepTemplate: {
    file: 'uses-union.ts',
    source: [
      "import type { AnyWorkflowStepTemplate } from './steps.js';",
      'const any_: AnyWorkflowStepTemplate = {',
      "  $type: 'textToImage',",
      "  input: { prompt: 'a fox', cfgScale: 5, seed: 1234 },",
      '};',
      'void any_;',
    ].join('\n'),
  },
  TypedWorkflowTemplate: {
    file: 'uses-envelope.ts',
    source: [
      "import type { TypedWorkflowTemplate } from './steps.js';",
      "const body: TypedWorkflowTemplate = { steps: [], tags: ['t'] };",
      'void body;',
    ].join('\n'),
  },
};

const LEDGERED_EXPORTS = Object.keys(GUARDED_EXPORT_CONSUMERS).sort();

/** file name → the export it exercises, so a failure names the export and not just a path. */
const EXPORT_BY_FILE = new Map(
  Object.entries(GUARDED_EXPORT_CONSUMERS).map(([name, { file }]) => [file, name]),
);

/**
 * Positive control: proves the program was really checked. A run that reports
 * nothing at all is indistinguishable from a compiler wired to nothing, so
 * every arm asserts this line reported.
 */
const PLANTED_CONSUMER = ["const planted: number = 'not a number';", 'void planted;'].join('\n');

const GOOD_CONSUMER: Record<string, string> = {
  ...Object.fromEntries(
    Object.values(GUARDED_EXPORT_CONSUMERS).map(({ file, source }) => [file, source]),
  ),
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

/**
 * A consumer directory with the REAL peer package copied into its own
 * `node_modules`, rather than mapped in through `paths`.
 *
 * `paths` would answer the wrong question for the NodeNext arm: the thing under
 * test there is Node's own ESM resolution of the published package layout, so
 * the package has to be resolved the way Node resolves it. `dereference` is
 * required because the workspace copy is a pnpm symlink into the store.
 */
function consumerDirWithRealPeer(): string {
  const dir = tempDir();
  const dest = join(dir, 'node_modules', '@civitai', 'client');
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(CLIENT_PKG, dest, { recursive: true, dereference: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'peer-guard-consumer', private: true, type: 'module' }, null, 2),
    'utf8',
  );
  return dir;
}

/** The set of exports whose consumer file reported the guard message. */
function reportingExports(diagnostics: string[]): string[] {
  const guard = diagnostics.filter((d) => d.includes(GUARD_MARKER));
  const names = guard.map((d) => {
    const file = d.slice(0, d.indexOf('('));
    return EXPORT_BY_FILE.get(file) ?? `<no ledger entry for ${file}>`;
  });
  return [...new Set(names)].sort();
}

afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

describe('the missing-peer guard on @civitai/app-sdk/orchestrator/steps', () => {
  const { declaration: stepsDeclaration, exportedNames } = emitStepsModule();

  it('emits declarations that really do depend on the peer', () => {
    // Without this, every assertion below could be passing against an empty or
    // wrong file.
    expect(stepsDeclaration).toContain('@civitai/client');
    expect(stepsDeclaration).toContain('WorkflowStepTemplateFor');
  });

  it('the ledger covers every export of steps.ts', () => {
    // The export list is the module's own, read through the type checker. An
    // export added without a consumer file above would otherwise contribute no
    // diagnostic to the peer-absent arm, so that arm could not notice it —
    // which is exactly how an unguarded export would ship.
    const unledgeredExports = exportedNames.filter((n) => !LEDGERED_EXPORTS.includes(n));
    const staleLedgerEntries = LEDGERED_EXPORTS.filter((n) => !exportedNames.includes(n));
    expect({ unledgeredExports, staleLedgerEntries }).toEqual({
      unledgeredExports: [],
      staleLedgerEntries: [],
    });
  });

  it('PEER ABSENT: every guarded export reports in the CONSUMER’s own file', () => {
    // The temp dir is outside this repo, so `@civitai/client` resolves nowhere
    // — the same state as an app that never installed the optional peer.
    const diagnostics = compile(tempDir(), {
      'steps.d.ts': stepsDeclaration,
      ...GOOD_CONSUMER,
    });

    // In the consumers' own files, not in node_modules — that is the point.
    expect(reportingExports(diagnostics)).toEqual(LEDGERED_EXPORTS);
    // It must name the remediation, not merely fail.
    expect(diagnostics.filter((d) => d.includes(GUARD_MARKER)).join('\n')).toContain(
      '@civitai/client@beta',
    );
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
    // The planted error is the ONLY thing reported: a correct consumer per
    // guarded export contributes nothing.
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

  describe('module resolution: the peer is installed and STILL does not resolve under NodeNext', () => {
    // `@civitai/client@0.2.0-beta.98` ships `"type": "module"`, no `exports`
    // map, and extensionless relative re-exports (`export * from './generated'`)
    // that Node's ESM resolution does not resolve. Without the guard this looks
    // exactly like a healthy build: measured at the pre-guard commit be503a9d,
    // the NodeNext arm reported ONE diagnostic — the planted control — with the
    // peer correctly installed.
    const dir = consumerDirWithRealPeer();
    const files = { 'steps.d.ts': stepsDeclaration, ...GOOD_CONSUMER };

    it('CONTROL — the same directory under Bundler is clean', () => {
      // Without this, the NodeNext arm below cannot tell "NodeNext resolution
      // degrades the peer" from "the copied node_modules is broken".
      const diagnostics = compile(dir, files);

      expect(diagnostics.filter((d) => d.includes(GUARD_MARKER))).toEqual([]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toContain(PLANTED_CONTROL);
    });

    it('NodeNext: every guarded export reports, in the consumer’s own file', () => {
      const diagnostics = compile(dir, files, {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      });

      expect(reportingExports(diagnostics)).toEqual(LEDGERED_EXPORTS);
      // The message names this cause, not just the missing-install one. Matched
      // on the unescaped half of the sentence: TypeScript renders the quotes
      // inside the string-literal type escaped, so a substring containing
      // `"moduleResolution"` would never match however right it looked.
      expect(diagnostics.filter((d) => d.includes(GUARD_MARKER)).join('\n')).toContain(
        'does not resolve under NodeNext/Node16',
      );
      expect(diagnostics.join('\n')).toContain(PLANTED_CONTROL);
    });
  });
});
