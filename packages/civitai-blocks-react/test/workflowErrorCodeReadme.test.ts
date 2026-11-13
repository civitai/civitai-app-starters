/**
 * Every `errorCode` the SDK declares for a workflow snapshot has a row in an
 * `errorCode` table of this package's README, and every row names a declared
 * code.
 *
 * WHY. The developer docs build their hook pages from this README, so a code
 * with no row here has no row on the site either. `source-scan-pending` was
 * added to `KnownBlockWorkflowErrorCode` (#812) with no README row, and the
 * inline-graph refusals the host sends were in neither the union nor the README.
 *
 * WHAT IS COMPARED.
 *  - The SDK side is `KnownBlockWorkflowErrorCode`, read with the TypeScript
 *    checker from `@civitai/app-sdk`'s published `blocks` entry (its source),
 *    and expanded to its string-literal members. No list is copied here, so a
 *    code added to the union needs a README row before this goes green.
 *  - The README side is every table whose header's first cell is
 *    `` `errorCode` ``. Each body row's first cell must be a quoted code
 *    (`` `'x'` ``) or the word `absent`; any other shape fails, so a row cannot
 *    drop out of the comparison by being written differently.
 *  - Both directions: a declared code with no row, and a row naming a code the
 *    union does not declare, each fail and name the code.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_SDK_ROOT = path.resolve(PKG_ROOT, '../civitai-app-sdk');
const README = path.join(PKG_ROOT, 'README.md');
const UNION = 'KnownBlockWorkflowErrorCode';

function loadTs(): typeof import('typescript') {
  const require = createRequire(path.join(PKG_ROOT, 'package.json'));
  return require('typescript') as typeof import('typescript');
}

/** The string-literal members of `KnownBlockWorkflowErrorCode`, as the checker sees them. */
function declaredCodes(): string[] {
  const ts = loadTs();
  const configPath = path.join(APP_SDK_ROOT, 'tsconfig.json');
  const parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    APP_SDK_ROOT,
  );
  const entry = path.join(APP_SDK_ROOT, 'src/blocks/index.ts');
  const program = ts.createProgram([entry], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (!source) throw new Error('@civitai/app-sdk src/blocks/index.ts must be in the program');
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error('@civitai/app-sdk src/blocks/index.ts must resolve as a module');
  const exported = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === UNION);
  if (!exported) throw new Error(`@civitai/app-sdk/blocks no longer exports ${UNION}`);
  const symbol =
    exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  const members = type.isUnion() ? type.types : [type];
  return members.map((member) => {
    if (!member.isStringLiteral()) {
      throw new Error(`${UNION} has a member that is not a string literal: ${checker.typeToString(member)}`);
    }
    return member.value;
  });
}

/** Codes named by the body rows of every `errorCode` table in `markdown`. */
function readmeCodes(markdown: string): { codes: string[]; tables: number } {
  const lines = markdown.split('\n');
  const codes: string[] = [];
  let tables = 0;
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i]!.split('|').map((cell) => cell.trim());
    if (header[1] !== '`errorCode`' || !/^\|\s*-/.test(lines[i + 1] ?? '')) continue;
    tables++;
    for (let row = i + 2; row < lines.length && lines[row]!.startsWith('|'); row++) {
      const first = lines[row]!.split('|')[1]!.trim();
      const quoted = /^`'([^'`]+)'`$/.exec(first);
      if (quoted) codes.push(quoted[1]!);
      else if (first !== 'absent') {
        throw new Error(
          `README line ${row + 1}: an errorCode row's first cell must be a quoted code like \`'x'\` or "absent", got: ${first}`,
        );
      }
    }
  }
  return { codes, tables };
}

/** Declared codes with no README row, and README rows naming no declared code. */
function compare(declared: readonly string[], documented: readonly string[]) {
  const doc = new Set(documented);
  const dec = new Set(declared);
  return {
    missingFromReadme: declared.filter((code) => !doc.has(code)),
    notDeclared: [...doc].filter((code) => !dec.has(code)),
  };
}

describe('README errorCode tables cover KnownBlockWorkflowErrorCode', () => {
  const declared = declaredCodes();
  const readme = readFileSync(README, 'utf8');

  it('reads the union from the SDK (positive control: the instrument sees codes)', () => {
    // A checker that resolved nothing would make the comparison vacuous.
    expect(declared.length).toBeGreaterThanOrEqual(15);
    expect(declared).toContain('training-quote-rejected');
    expect(new Set(declared).size).toBe(declared.length);
  }, 60_000);

  it('every declared code has a README row', () => {
    const { codes, tables } = readmeCodes(readme);
    expect(tables).toBeGreaterThanOrEqual(4);
    const { missingFromReadme } = compare(declared, codes);
    expect(
      missingFromReadme,
      `${UNION} declares codes with no row in a README errorCode table: ${missingFromReadme.join(', ')}`,
    ).toEqual([]);
  });

  it('every README row names a declared code', () => {
    const { notDeclared } = compare(declared, readmeCodes(readme).codes);
    expect(
      notDeclared,
      `README errorCode rows name codes ${UNION} does not declare: ${notDeclared.join(', ')}`,
    ).toEqual([]);
  });

  it('negative control: a deleted row is reported by name', () => {
    const victim = declared[declared.length - 1]!;
    const row = readme.split('\n').find((line) => line.startsWith(`| \`'${victim}'\` |`));
    expect(row, `no README row starts with \`'${victim}'\``).toBeDefined();
    const without = readme.replace(`${row}\n`, '');
    expect(compare(declared, readmeCodes(without).codes).missingFromReadme).toEqual([victim]);
  });

  it('negative control: a row in another shape is refused, not skipped', () => {
    const table = '| `errorCode` | Means |\n|---|---|\n| `source-scan-pending` | unquoted |\n';
    expect(() => readmeCodes(table)).toThrow(/must be a quoted code/);
  });
});
