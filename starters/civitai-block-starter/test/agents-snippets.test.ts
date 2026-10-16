// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Fences opened by EXACTLY three backticks whose info string's first word is
 * `ts`, `tsx` or `typescript` (so ```ts title="x.ts" counts), indented by
 * spaces or tabs or not at all, and closed by the next line that is exactly
 * three backticks (optionally indented, optionally followed by spaces or
 * tabs). Fences of four or more backticks, tilde fences and other languages are
 * not extracted themselves, but only ts fences are tracked, so a ```ts block
 * nested inside another kind of fence is still extracted. Each body line loses as
 * much of the opening fence's exact indent as it starts with. Lines split on
 * LF or CRLF.
 */
function extractSnippets(md: string): string[] {
  const snippets: string[] = [];
  let open: { indent: string; lines: string[] } | null = null;
  for (const line of md.split(/\r?\n/)) {
    if (!open) {
      const m = /^([ \t]*)```[ \t]*(?:ts|tsx|typescript)(?:[ \t].*)?$/.exec(line);
      if (m) open = { indent: m[1]!, lines: [] };
      continue;
    }
    if (/^[ \t]*```[ \t]*$/.test(line)) {
      snippets.push(open.lines.join('\n'));
      open = null;
      continue;
    }
    let cut = 0;
    while (cut < open.indent.length && line[cut] === open.indent[cut]) cut++;
    open.lines.push(line.slice(cut));
  }
  expect(open, 'the markdown ends inside an unclosed ```ts fence').toBeNull();
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

  it('positive control: finds the snippets this guide teaches', () => {
    // A floor, not a pin: an extractor that silently matched nothing would
    // otherwise make the typecheck below vacuously green.
    expect(snippets.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('app.workflows.submit(workflowBody, { idempotencyKey })');
  });

  it('typecheck against the built @civitai/sdk', () => {
    expect(typecheck(source)).toEqual([]);
  }, 60_000);

  it('negative control: the same check rejects a submit without its idempotency key', () => {
    const broken = source.replace(
      'app.workflows.submit(workflowBody, { idempotencyKey })',
      'app.workflows.submit(workflowBody, {})',
    );
    expect(broken).not.toBe(source);
    expect(typecheck(broken).some((d) => d.includes('idempotencyKey'))).toBe(true);
  }, 60_000);
});

describe('the fence extractor', () => {
  it('finds the same snippets in AGENTS.md checked out with CRLF line endings', () => {
    const lf = readFileSync(AGENTS_MD, 'utf8').replace(/\r\n/g, '\n');
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(crlf).not.toBe(lf);
    const fromLf = extractSnippets(lf);
    expect(fromLf.length).toBeGreaterThanOrEqual(3);
    expect(extractSnippets(crlf)).toEqual(fromLf);
  });

  it('extracts ```typescript, an info string after the language, and tab-indented fences — each typechecks red', () => {
    const md = [
      '```typescript',
      "const fromTypescriptFence: number = 'typescript';",
      '```',
      '',
      '```ts title="example.ts"',
      "const fromTitledFence: number = 'titled';",
      '```',
      '',
      '-\titem',
      '\t```ts',
      "\tconst fromTabFence: number = 'tab';",
      '\t```',
      '',
      '```bash',
      'echo not typescript',
      '```',
    ].join('\n');

    const snippets = extractSnippets(md);
    expect(snippets).toEqual([
      "const fromTypescriptFence: number = 'typescript';",
      "const fromTitledFence: number = 'titled';",
      "const fromTabFence: number = 'tab';",
    ]);
    for (const snippet of snippets) {
      expect(typecheck(`${snippet}\nexport {};\n`).some((d) => d.includes('TS2322'))).toBe(true);
    }
  }, 60_000);
});

/**
 * Every `node_modules/@civitai/<pkg>/<file>` AGENTS.md sends a reader to must
 * exist in the package this starter installs AND be in that package's published
 * `files` — so a renamed or unshipped file fails here, not in the reader's
 * sandbox. (Inside the workspace `node_modules/@civitai/*` links to the local
 * package, so `files` is what decides whether the tarball has it.)
 */
describe('AGENTS.md package pointers', () => {
  const md = readFileSync(AGENTS_MD, 'utf8');
  const pointers = [...new Set([...md.matchAll(/node_modules\/(@civitai\/[a-z-]+)\/([A-Za-z0-9_.-]+\.(?:md|json))/g)].map((m) => `${m[1]}/${m[2]}`))];

  it('positive control: finds the package pointers this guide teaches', () => {
    // A floor, so the `it.each` below cannot go vacuously green on an extractor
    // that matched nothing.
    expect(pointers).toContain('@civitai/sdk/README.md');
    expect(pointers).toContain('@civitai/components/README.md');
  });

  /**
   * The element reference is a COMMAND, not a file — mirrors the civitai CLI's
   * `agents_sdk_pointers_test.go` for the page-elements scaffold. Agents pointed
   * at `custom-elements.json` write ad-hoc parsers for it, and it omits the form
   * controls' inherited attributes besides, so the guide names
   * `civitai app elements <tag>` and must not name the JSON file at all: any
   * mention invites parsing it. Asserted on the command and the file NAME, not
   * on the surrounding prose.
   */
  it('names `civitai app elements <tag>` as the element reference, and never custom-elements.json', () => {
    expect(md.includes('`civitai app elements <tag>`'), 'AGENTS.md does not name `civitai app elements <tag>`').toBe(true);
    expect(md.includes('custom-elements.json'), 'AGENTS.md names custom-elements.json').toBe(false);
  });

  /**
   * A tiged starter does not install the CLI, so a fresh sandbox answers
   * `civitai: command not found` — and with the JSON pointer gone it then has
   * no element reference at all. The npx form must sit in the SAME paragraph
   * as the command (the doc's generic npx note is hundreds of lines later, and
   * names `app validate`), in AGENTS.md and README.md alike.
   */
  it.each(['AGENTS.md', 'README.md'])('%s gives the npx form of `civitai app elements` inline', (file) => {
    const doc = readFileSync(join(STARTER, file), 'utf8').replace(/\r\n/g, '\n');
    const bare = doc.indexOf('civitai app elements <tag>`');
    const npx = doc.indexOf('`npx -y @civitai/cli@latest app elements <tag>`');
    expect(bare, `${file} does not name civitai app elements <tag>`).toBeGreaterThanOrEqual(0);
    expect(npx, `${file} lacks \`npx -y @civitai/cli@latest app elements <tag>\``).toBeGreaterThan(bare);
    expect(doc.slice(bare, npx).includes('\n\n'), `${file}'s npx form is not in the same paragraph as the command`).toBe(false);
  });

  it('names MARKUP.md only inside the warning that it is NOT the elements\' reference', () => {
    const norm = md.replace(/\s+/g, ' ');
    const warning =
      "🔴 `node_modules/@civitai/components/MARKUP.md` is NOT the elements' reference: " +
      'it is the `data-civitai-ui` contract for HAND-WRITTEN HTML ' +
      '(`<div data-civitai-ui="text-input"><label>…<input>`), which the `<civitai-*>` elements do not use. ' +
      'Here, write `<civitai-text-input>`.';
    // Booleans with a message, so a failure does not print the whole guide.
    expect(norm.includes(warning), 'AGENTS.md lost (or reworded) the MARKUP.md warning').toBe(true);
    const rest = norm.replace(warning, '');
    const stray = rest.indexOf('MARKUP');
    expect(stray, `AGENTS.md names MARKUP outside the warning: …${rest.slice(stray - 80, stray + 40)}…`).toBe(-1);
  });

  it.each(pointers)('%s exists and is published', (pointer) => {
    const [scope, name, file] = pointer.split('/');
    const pkgDir = join(STARTER, 'node_modules', scope!, name!);
    expect(existsSync(join(pkgDir, file!)), `${pointer} is not in the installed package`).toBe(true);
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { files?: string[] };
    expect(pkg.files ?? [], `${pointer} is not in ${scope}/${name}'s published files`).toContain(file);
  });

  it('the vitest setup file is a declared export of @civitai/components', () => {
    const config = readFileSync(join(STARTER, 'vitest.config.ts'), 'utf8');
    expect(config).toContain("setupFiles: ['@civitai/components/testing/happy-dom']");
    const pkg = JSON.parse(
      readFileSync(join(STARTER, 'node_modules/@civitai/components/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };
    expect(Object.keys(pkg.exports)).toContain('./testing/happy-dom');
  });
});
