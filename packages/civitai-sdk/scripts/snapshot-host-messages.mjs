// Snapshots the host's handler inventory so the parity guard can run without the
// civitai repo. Maintainer step, not CI: node scripts/snapshot-host-messages.mjs [path]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_SOURCE = resolve(
  process.cwd(),
  '../../../../civitai/repo/src/components/AppBlocks/hostHandlerParity.ts',
);
const OUT = 'snapshots/host-messages.json';
const SCOPES_SOURCE = '../../shared/constants/block-scope.constants.ts';

const source = resolve(process.argv[2] ?? DEFAULT_SOURCE);
const text = readFileSync(source, 'utf8');

const messages = {};
const entry = /^ {2}([A-Z_]+): \{\n([\s\S]*?)^ {2}\},$/gm;
for (const [, name, body] of text.matchAll(entry)) {
  // The inventory's `reply` is prose in places ("X (or a Y push when ...)"), so
  // the snapshot keeps the reply NAME and the sentence it came from separately.
  const declared = body.match(/reply: '([^']*)'/)?.[1] ?? '';
  const reply = declared.match(/^[A-Z_]+/)?.[0] ?? '';
  messages[name] = {
    request: /request: true/.test(body),
    reply,
    ...(declared === reply ? {} : { replyNote: declared }),
  };
}

if (Object.keys(messages).length === 0) {
  throw new Error(`no INVENTORY entries parsed from ${source} — the shape changed`);
}

let capturedFrom = 'unknown';
try {
  capturedFrom = execFileSync('git', ['-C', dirname(source), 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
} catch {
  // A source tree without git still snapshots; provenance is best-effort.
}

const scopeSource = readFileSync(resolve(dirname(source), SCOPES_SOURCE), 'utf8');
const scopeTable = scopeSource.match(/BLOCK_SCOPE_TO_OAUTH_BIT[^=]*= \{([\s\S]*?)^\};$/m);
if (!scopeTable) throw new Error(`BLOCK_SCOPE_TO_OAUTH_BIT not found in ${SCOPES_SOURCE} — the shape changed`);
const scopes = [...scopeTable[1].matchAll(/^ {2}'([a-z:]+)':/gm)].map((m) => m[1]).sort();

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      source: 'civitai/civitai src/components/AppBlocks/hostHandlerParity.ts',
      capturedFrom,
      capturedAt: new Date().toISOString().slice(0, 10),
      messages: Object.fromEntries(Object.entries(messages).sort(([a], [b]) => a.localeCompare(b))),
      scopes,
    },
    null,
    2,
  )}\n`,
);

console.log(`Wrote ${OUT} — ${Object.keys(messages).length} messages, ${scopes.length} scopes from ${capturedFrom}`);
