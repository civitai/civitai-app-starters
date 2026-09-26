import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const REPORT = 'api/public-api.md';
const DIST = './dist/';

/**
 * Every public entry, DERIVED from `package.json`'s `exports` map.
 *
 * 🔴 IT USED TO BE A HAND-MAINTAINED ARRAY, AND THAT REGISTRY COULD NOT FAIL.
 * `api:check` regenerates the report and compares it to the committed one, so a
 * new `exports` subpath the author forgot to add here was missing from BOTH
 * sides: the regenerated report and the committed report agreed, and the check
 * passed green over a public entry with no public-API doc at all. Combined with
 * `scripts/check-public-type-closure.mjs` not scanning this package
 * (civitai/civitai-app-starters#459), a whole subpath could ship unexamined by
 * either gate.
 *
 * Deriving removes the forget: the `exports` map IS the list, so adding a
 * subpath changes the generated report, and `--check` goes red as stale until
 * `npm run api` is re-run and committed.
 *
 * Every refusal below is a REFUSAL, not a skip. A `continue` here would restore
 * exactly the silence this function exists to remove.
 */
function publicEntries() {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const map = manifest.exports;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error('package.json declares no `exports` object — there is nothing to report on.');
  }

  const entries = [];
  for (const [subpath, target] of Object.entries(map)) {
    if (subpath.includes('*')) {
      throw new Error(
        `exports["${subpath}"] is a subpath PATTERN. It names a set of files, not one entry, ` +
          'and this generator only knows how to report a literal entry. Widen it rather than ' +
          'let a public surface go unreported.',
      );
    }
    const types = target && typeof target === 'object' && !Array.isArray(target) ? target.types : null;
    if (typeof types !== 'string') {
      throw new Error(
        `exports["${subpath}"] declares no \`types\` target. Every public subpath must be ` +
          'reportable — add one, or drop the subpath from `exports`.',
      );
    }
    if (!types.startsWith(DIST) || !types.endsWith('.d.ts')) {
      throw new Error(
        `exports["${subpath}"].types is \`${types}\`, which this generator cannot locate: it ` +
          `reads declarations tsc emitted into a temp outDir, so the target must be \`${DIST}…\`` +
          ' and end in `.d.ts`.',
      );
    }
    entries.push([subpath, types.slice(DIST.length)]);
  }

  if (entries.length === 0) throw new Error('`exports` is empty — refusing to write an empty report.');
  return entries;
}

// In `exports` order, which is the order they appear in the report.
const ENTRIES = publicEntries();

/**
 * Splits a generated `.d.ts` into top-level declarations, each carrying the doc
 * comment above it. A declaration ends on a balanced line closing with `;` or
 * `}` — line-based splitting breaks on union members that carry their own
 * comments at column 0.
 */
function parseDeclarations(text) {
  const named =
    /(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var|interface|type|enum|namespace)\s+([A-Za-z0-9_$]+)/;

  const chunks = [];
  let lines = [];
  let depth = 0;
  let inComment = false;
  let hasCode = false;

  const finish = () => {
    const text = lines.join('\n').trim();
    lines = [];
    hasCode = false;
    if (!text) return;
    const code = text.split('\n').find((l) => !/^\s*(\/\*|\*|\/\/)/.test(l) && l.trim());
    chunks.push({ name: named.exec(code ?? '')?.[1], text, isImport: (code ?? '').startsWith('import ') });
  };

  for (const line of text.split('\n')) {
    lines.push(line);

    let code = '';
    let rest = line;
    while (rest) {
      if (inComment) {
        const close = rest.indexOf('*/');
        if (close === -1) break;
        rest = rest.slice(close + 2);
        inComment = false;
        continue;
      }
      const open = rest.indexOf('/*');
      const lineComment = rest.indexOf('//');
      if (lineComment !== -1 && (open === -1 || lineComment < open)) {
        code += rest.slice(0, lineComment);
        break;
      }
      if (open === -1) {
        code += rest;
        break;
      }
      code += rest.slice(0, open);
      rest = rest.slice(open + 2);
      inComment = true;
    }

    if (code.trim()) hasCode = true;
    for (const ch of code) {
      if (ch === '{' || ch === '(') depth += 1;
      if (ch === '}' || ch === ')') depth -= 1;
    }

    const closed = /[;}]\s*$/.test(code.trimEnd());
    if (hasCode && !inComment && depth <= 0 && closed) finish();
  }
  finish();

  return chunks;
}

function reexports(text) {
  const out = [];
  for (const [, star, names, path] of text.matchAll(
    /export\s+(?:(\*\s+as\s+[A-Za-z0-9_$]+)|(?:type\s+)?\{([^}]*)\})\s+from\s+'([^']+)'/g,
  )) {
    out.push({
      namespace: star ? star.replace(/\*\s+as\s+/, '') : null,
      names: names ? names.split(',').map((n) => n.trim().replace(/^type\s+/, '')) : null,
      path,
    });
  }
  return out;
}

const out = mkdtempSync(join(tmpdir(), 'api-'));
execFileSync('npx', ['tsc', '-p', 'tsconfig.json', '--emitDeclarationOnly', '--outDir', out], {
  stdio: 'inherit',
});

const read = (file) => readFileSync(join(out, file), 'utf8');
const resolve = (from, path) => join(dirname(from), path.replace(/\.js$/, '.d.ts'));

const sections = [];
for (const [subpath, entry] of ENTRIES) {
  const body = [];
  const entryText = read(entry);

  for (const decl of parseDeclarations(entryText)) {
    if (decl.isImport || !decl.name) continue;
    body.push(decl.text);
  }

  for (const { namespace, names, path } of reexports(entryText)) {
    if (!path.startsWith('.')) continue;
    const declarations = parseDeclarations(read(resolve(entry, path)));
    const wanted = declarations.filter(
      (d) => d.name && !d.isImport && (namespace ? true : names?.includes(d.name)),
    );
    if (!wanted.length) continue;
    body.push(
      namespace
        ? `// namespace: ${namespace}\n${wanted.map((d) => d.text).join('\n\n')}`
        : wanted.map((d) => d.text).join('\n\n'),
    );
  }

  sections.push(`## \`@civitai/sdk${subpath.slice(1)}\`\n\n\`\`\`ts\n${body.join('\n\n')}\n\`\`\``);
}

const report = `# Public API\n\nGenerated by \`npm run api\` — do not edit.\n\n${sections.join('\n\n')}\n`;
const previous = (() => {
  try {
    return readFileSync(REPORT, 'utf8');
  } catch {
    return null;
  }
})();

if (process.argv.includes('--check')) {
  if (previous !== report) {
    console.error(`${REPORT} is stale. Run \`npm run api\` and commit the result.`);
    process.exit(1);
  }
  console.log(`${REPORT} is up to date.`);
} else {
  writeFileSync(REPORT, report);
  console.log(`Wrote ${REPORT}`);
}
