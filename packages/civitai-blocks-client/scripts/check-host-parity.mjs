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

const table = readFileSync('src/core/transports/iframe-transport.ts', 'utf8').match(
  /const LEGACY_REPLIES[^=]*= \{([\s\S]*?)^\};$/m,
);
if (!table) fail('LEGACY_REPLIES table not found in iframe-transport.ts — the shape changed.');
const legacy = Object.fromEntries(
  [...table[1].matchAll(/^ {2}([A-Z_]+): '([A-Z_]+)',$/gm)].map(([, type, reply]) => [type, reply]),
);

// A grep that silently matches nothing would pass everything.
if (sent.length === 0) fail('no messages found in any src/*/protocol.ts — the shape changed.');
if (Object.keys(legacy).length === 0) fail('LEGACY_REPLIES parsed empty — the shape changed.');

const answered = new Set([...Object.keys(host.messages), ...HANDSHAKE]);
for (const type of sent) {
  if (!answered.has(type)) problems.push(`${type} is sent but no host handler answers it.`);
}

for (const [type, reply] of Object.entries(legacy)) {
  const known = host.messages[type];
  if (!known) {
    problems.push(`${type} declares a legacy reply but the host has no such message.`);
  } else if (known.reply !== reply) {
    problems.push(`${type} expects ${reply}; the host answers ${known.reply}.`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`\nSnapshot is civitai/civitai ${host.capturedFrom} (${host.capturedAt}).`);
  console.error('Refresh it with `npm run snapshot:host` if the host moved.');
  process.exit(1);
}

console.log(`host parity ok: ${sent.length} messages (snapshot ${host.capturedFrom}).`);
