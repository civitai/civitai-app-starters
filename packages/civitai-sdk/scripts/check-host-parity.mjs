import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Checked against a committed snapshot of civitai's own handler inventory, so
// it runs without the civitai repo. Refresh with `npm run snapshot:host`.

/** Sent by the transport itself rather than declared by a domain. */
const HANDSHAKE = ['BLOCK_HELLO', 'BLOCK_READY'];

const problems = [];
function fail(message) {
  console.error(message);
  process.exit(1);
}

const host = JSON.parse(readFileSync('snapshots/host-messages.json', 'utf8'));

const protocols = readdirSync('src', { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'core')
  .map((entry) => join('src', entry.name, 'protocol.ts'))
  .filter((file) => existsSync(file));

const sent = protocols.flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  const maps = source.matchAll(/export type \w+(?:Requests|Notifications) = \{([\s\S]*?)^\};$/gm);
  return [...maps].flatMap(([, body]) => [...body.matchAll(/^ {2}([A-Z_]+):/gm)].map((m) => m[1]));
});

// The transport's ledger: one JSON value per row, as gen-host-replies.mjs writes it.
const LEDGER = 'src/core/transports/host-replies.generated.ts';
const ledgerText = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : '';
const table = ledgerText.match(/export const HOST_REPLIES[^=]*= \{\n([\s\S]*?)^\};$/m);
if (!table) fail(`HOST_REPLIES not found in ${LEDGER} — run \`npm run gen:host-replies\`.`);
const ledger = Object.fromEntries(
  [...table[1].matchAll(/^ {2}("[A-Z_]+"): (\{.*\}),$/gm)].map(([, type, row]) => [
    JSON.parse(type),
    JSON.parse(row),
  ]),
);

// A grep that silently matches nothing would pass everything.
if (sent.length === 0) fail('no messages found in any src/*/protocol.ts — the shape changed.');
if (Object.keys(ledger).length === 0) fail(`HOST_REPLIES parsed empty in ${LEDGER} — the shape changed.`);

const answered = new Set([...Object.keys(host.messages), ...HANDSHAKE]);
for (const type of sent) {
  if (!answered.has(type)) problems.push(`${type} is sent but no host handler answers it.`);
}

// EVERY request the host answers, not only the ones a domain declares: a raw
// `getTransport().request(type)` reaches all of them, and a type the transport
// awaits under the wrong name hangs without an error.
const hostRequests = Object.entries(host.messages).filter(([, m]) => m.request);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const [type, known] of hostRequests) {
  const ours = ledger[type];
  if (!ours) {
    problems.push(`${type}: the host answers it with ${known.reply}, but the transport refuses it.`);
    continue;
  }
  if (ours.reply !== known.reply) {
    problems.push(`${type}: the transport awaits ${ours.reply}; the host answers ${known.reply}.`);
  }
  if (ours.framing !== known.framing) {
    problems.push(`${type}: the transport reads a ${ours.framing} reply; the host sends ${known.framing}.`);
  }
  // The transport tells a failure from a success by a top-level `error` string, so
  // an error reply the host declares without a REQUIRED `error` would resolve.
  if (Array.isArray(known.errorKeys)) {
    if (!known.errorKeys.includes('error') || (known.optionalErrorKeys ?? []).includes('error')) {
      problems.push(`${type}: the host's error reply carries no required \`error\`, so the transport would resolve it.`);
    }
    if (ours.framing !== 'legacy') {
      problems.push(`${type}: the host fails it with an \`error\` string, but the transport reads ${ours.framing} framing.`);
    }
  }
  if (!same(ours.keys, known.replyKeys)) {
    problems.push(
      `${type}: the transport expects keys ${JSON.stringify(ours.keys)}; the host sends ${JSON.stringify(known.replyKeys)}.`,
    );
  }
}
for (const type of Object.keys(ledger)) {
  if (!host.messages[type]?.request) problems.push(`${type} is in the transport's ledger but the host does not answer it.`);
}

const declared = readFileSync('src/session/index.ts', 'utf8').match(/export const SCOPES = \[([\s\S]*?)\] as const;/);
if (!declared) fail('SCOPES not found in src/session/index.ts — the shape changed.');
const ours = [...declared[1].matchAll(/'([a-z:]+)'/g)].map((m) => m[1]).sort();
for (const scope of host.scopes) {
  if (!ours.includes(scope)) problems.push(`the host grants ${scope}, but SCOPES does not name it.`);
}
for (const scope of ours) {
  if (!host.scopes.includes(scope)) problems.push(`SCOPES names ${scope}, which the host does not grant.`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`\nSnapshot is civitai/civitai ${host.capturedFrom} (${host.capturedAt}).`);
  console.error('Refresh it with `npm run snapshot:host` if the host moved.');
  process.exit(1);
}

console.log(
  `host parity ok: ${sent.length} sent, ${hostRequests.length} host requests answered, ${ours.length} scopes (snapshot ${host.capturedFrom}).`,
);
