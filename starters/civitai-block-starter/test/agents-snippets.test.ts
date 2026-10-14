// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Typechecks the ```ts fences in this starter's AGENTS.md against the
 * `@civitai/sdk` this starter resolves (the workspace package's BUILT
 * declarations, through its real `exports` map), with this starter's own
 * compiler options.
 *
 * The fences are compiled as ONE module, in document order, because they are
 * written as one: the workflows and goods snippets call `askConsent` and name
 * `Scope`, both of which only the first snippet declares.
 *
 * What the doc leaves to the reader — the names its own prose says "stand for
 * your own UI" — are declared below with concrete types, so a call the SDK's
 * types forbid is an error here rather than a call on `any`. A NEW free name in
 * a snippet fails this test until it is added here, on purpose.
 */

const STARTER = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_MD = join(STARTER, 'AGENTS.md');
/** Never written to disk: served to the compiler by `hostFor`. Inside the starter so `@civitai/sdk` resolves from its node_modules. */
const VIRTUAL = join(STARTER, '__agents_snippets__.ts');

const STAND_INS = `
declare const app: import('@civitai/sdk').BlockAppClient;
declare const workflowBody: import('@civitai/sdk').WorkflowBody;
declare const generateButton: HTMLElement;
declare const buyButton: HTMLElement;
declare function confirmSpend(cost: number | undefined): Promise<boolean>;
declare function showMessage(message: string): void;
declare function showImages(urls: string[]): void;
declare function askRetry(message: string): Promise<boolean>;
`;

/** Every ```ts / ```tsx fence, indented or not, de-indented by its opening fence's indent. */
function extractSnippets(md: string): string[] {
  const snippets: string[] = [];
  let open: { indent: number; lines: string[] } | null = null;
  for (const line of md.split('\n')) {
    if (!open) {
      const m = /^( *)```(tsx?)\s*$/.exec(line);
      if (m) open = { indent: m[1]!.length, lines: [] };
      continue;
    }
    if (/^ *```\s*$/.test(line)) {
      snippets.push(open.lines.join('\n'));
      open = null;
      continue;
    }
    open.lines.push(line.slice(Math.min(open.indent, line.length - line.trimStart().length)));
  }
  expect(open, 'AGENTS.md ends inside an unclosed ```ts fence').toBeNull();
  return snippets;
}

function hostFor(options: ts.CompilerOptions, source: string): ts.CompilerHost {
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (f) => f === VIRTUAL || fileExists.call(host, f);
  host.readFile = (f) => (f === VIRTUAL ? source : readFile.call(host, f));
  host.getSourceFile = (f, lang, ...rest) =>
    f === VIRTUAL ? ts.createSourceFile(f, source, lang, true) : getSourceFile.call(host, f, lang, ...rest);
  return host;
}

/** The diagnostics `tsc` would print for `source` under the starter's tsconfig. */
function typecheck(source: string): string[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(join(STARTER, 'tsconfig.json'), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  });
  if (!parsed) throw new Error('could not parse the starter tsconfig.json');
  const options = { ...parsed.options, noEmit: true };
  const program = ts.createProgram({ rootNames: [VIRTUAL], options, host: hostFor(options, source) });
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
    const loc = where ? `${d.file!.fileName === VIRTUAL ? 'snippets' : d.file!.fileName}:${where.line + 1}` : '';
    return `${loc} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
  });
}

describe('AGENTS.md code snippets', () => {
  const snippets = extractSnippets(readFileSync(AGENTS_MD, 'utf8'));
  const source = `${STAND_INS}\n${snippets.join('\n\n')}\nexport {};\n`;

  it('finds the snippets this guide teaches', () => {
    // A floor, not a pin: an extractor that silently matched nothing would
    // otherwise make the typecheck below vacuously green.
    expect(snippets.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('app.workflows.submit(workflowBody, { idempotencyKey })');
  });

  it('typecheck against the built @civitai/sdk', () => {
    expect(typecheck(source)).toEqual([]);
  }, 60_000);

  it('positive control: the same check rejects a submit without its idempotency key', () => {
    const broken = source.replace(
      'app.workflows.submit(workflowBody, { idempotencyKey })',
      'app.workflows.submit(workflowBody, {})',
    );
    expect(broken).not.toBe(source);
    expect(typecheck(broken).some((d) => d.includes('idempotencyKey'))).toBe(true);
  }, 60_000);
});
