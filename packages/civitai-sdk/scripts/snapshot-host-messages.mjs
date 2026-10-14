// Snapshots the host's handler inventory so the parity guard can run without the
// civitai repo. Maintainer step, not CI:
//   node scripts/snapshot-host-messages.mjs <civitai>/src/components/AppBlocks/hostHandlerParity.ts
// Point it at a checkout of civitai's `main` (a detached worktree is enough).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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
  // The inventory may one day declare the success keys itself; prefer that.
  const declaredKeys = body.match(/replyKeys: \[([^\]]*)\]/)?.[1];
  messages[name] = {
    request: /request: true/.test(body),
    reply,
    ...(declared === reply ? {} : { replyNote: declared }),
    ...(declaredKeys === undefined
      ? {}
      : { declaredKeys: [...declaredKeys.matchAll(/'([A-Za-z_$][\w$]*)'/g)].map((m) => m[1]) }),
  };
}

if (Object.keys(messages).length === 0) {
  throw new Error(`no INVENTORY entries parsed from ${source} — the shape changed`);
}

// ── Reply shapes, read off the hosts' own `send('<REPLY>', { … })` literals ───────
//
// The inventory names each reply but not what it carries, and that is the half a
// transport needs: which keys a success carries, and whether a failure is the
// host's sentence (`error: '…'`, "legacy") or an `{ code, message }` object
// ("envelope"). Every non-test module beside the inventory is scanned.

/** The text between the braces of the object literal opening at `start`. */
function literalAt(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c) && --depth === 0) return source.slice(start + 1, i);
  }
  throw new Error(`unbalanced object literal at offset ${start}`);
}

/** The literal's top-level members: `{ key, value }`, or `{ spread }` for `...x`. */
function members(literal) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < literal.length; i++) {
    const c = literal[i];
    if (quote) {
      if (c === '\\') current += literal[i++];
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts
    .map((part) => part.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim())
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('...')) return { spread: part.slice(3).trim() };
      const m = part.match(/^([A-Za-z_$][\w$]*)\s*(?::\s*([\s\S]*))?$/);
      if (!m) throw new Error(`unreadable member \`${part}\` in a send() literal`);
      return { key: m[1], value: (m[2] ?? m[1]).trim() };
    });
}

const hostDir = dirname(source);
const sends = new Map(); // reply type → member lists
let literalCount = 0;
for (const file of readdirSync(hostDir).sort()) {
  if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
  const code = readFileSync(join(hostDir, file), 'utf8');
  for (const m of code.matchAll(/\bsend\(\s*'([A-Z_]+)',\s*\{/g)) {
    const list = sends.get(m[1]) ?? [];
    list.push(members(literalAt(code, m.index + m[0].length - 1)));
    sends.set(m[1], list);
    literalCount++;
  }
}
// A scan that silently matches nothing would leave every reply shape unknown.
if (literalCount === 0) throw new Error(`no send('<REPLY>', { … }) literals found beside ${source}`);

for (const message of Object.values(messages)) {
  if (!message.request) continue;
  const literals = sends.get(message.reply) ?? [];
  // A failure is any literal naming `error`. A literal built by spreading another
  // object is unreadable here, so it counts for neither side.
  const failures = literals.filter((l) => l.some((m) => m.key === 'error'));
  const successes = literals.filter((l) => !failures.includes(l) && !l.some((m) => 'spread' in m));
  const objectError = failures.some((l) => l.find((m) => m.key === 'error').value.startsWith('{'));
  message.framing = objectError ? 'envelope' : 'legacy';
  // How a failure arrives, or null where no literal reports one: the host may
  // never fail that reply (REQUEST_TOKEN is exempt from the host's NACK), or
  // fail it in-band (a workflow reply carries a failed `snapshot`).
  message.failure = failures.length === 0 ? null : objectError ? 'object' : 'string';

  if (message.declaredKeys) {
    message.replyKeys = message.declaredKeys;
    message.replyKeysFrom = 'inventory';
  } else if (successes.length > 0) {
    const keys = new Set(successes.flat().map((m) => m.key));
    keys.delete('requestId');
    message.replyKeys = [...keys].sort();
    message.replyKeysFrom = 'host-source';
  } else {
    // The host builds this reply somewhere a literal scan cannot read (a gate
    // module's helper, a spread). Unknown, not empty.
    message.replyKeys = null;
    message.replyKeysFrom = 'unknown';
  }
  delete message.declaredKeys;
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

const requests = Object.values(messages).filter((m) => m.request);
console.log(
  `Wrote ${OUT} — ${Object.keys(messages).length} messages (${requests.length} requests, ` +
    `${requests.filter((m) => m.replyKeys === null).length} with unknown reply keys), ` +
    `${scopes.length} scopes from ${capturedFrom}`,
);
