import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Messages this package invents, which no host handler answers yet. Each is a
 * standing promise to the host; an entry leaves the day the host implements it.
 */
const AWAITING_HOST = [
  'BUZZ_GET_ACCOUNTS',
  'BUZZ_LIST_TRANSACTIONS',
  'BUZZ_REQUEST_PURCHASE',
  'ORCHESTRATION_ESTIMATE_WORKFLOW',
  'ORCHESTRATION_SUBMIT_WORKFLOW',
  'ORCHESTRATION_GET_WORKFLOW',
  'ORCHESTRATION_CANCEL_WORKFLOW',
];

/** Sent by the transport itself rather than by a domain. */
const HANDSHAKE = ['BLOCK_HELLO', 'BLOCK_READY'];

const problems = [];
function fail(message) {
  console.error(message);
  process.exit(1);
}

const host = JSON.parse(readFileSync('snapshots/host-messages.json', 'utf8'));

const domains = readdirSync('src', { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'core')
  .map((entry) => entry.name);

const sent = domains.flatMap((domain) => {
  const source = readFileSync(join('src', domain, 'protocol.ts'), 'utf8');
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

// Guard the guard: a grep that silently matches nothing would pass everything.
if (sent.length === 0) fail('no messages found in any src/*/protocol.ts — the shape changed.');
if (Object.keys(legacy).length === 0) fail('LEGACY_REPLIES parsed empty — the shape changed.');

const answered = new Set([...Object.keys(host.messages), ...AWAITING_HOST, ...HANDSHAKE]);
for (const type of sent) {
  if (!answered.has(type)) problems.push(`${type} is sent but no host handler answers it.`);
}

for (const type of AWAITING_HOST) {
  if (type in host.messages) {
    problems.push(`${type} now has a host handler — drop it from AWAITING_HOST.`);
  }
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

console.log(
  `host parity ok: ${sent.length} messages, ${AWAITING_HOST.length} awaiting a host handler ` +
    `(snapshot ${host.capturedFrom}).`,
);
