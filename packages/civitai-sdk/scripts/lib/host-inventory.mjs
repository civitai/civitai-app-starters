// Parses civitai's `INVENTORY` (src/components/AppBlocks/hostHandlerParity.ts)
// from its source text. Kept apart from the snapshot script so a test can run it
// over a fixture of the real inventory.

const ENTRY = /^ {2}([A-Z_]+): \{\n([\s\S]*?)^ {2}\},$/gm;

/**
 * A declared key list: `['a', 'b?']` → `{ names: ['a', 'b'], optional: ['b'] }`.
 * `null` and `'none'` pass through; `undefined` when the entry has no such field.
 * The inventory promises each list is a single-line literal of quoted names.
 */
function declaredKeys(body, field) {
  const line = body.match(new RegExp(`^ {4}${field}: (.*),$`, 'm'))?.[1];
  if (line === undefined) return undefined;
  if (line === 'null') return null;
  if (line === "'none'") return 'none';
  const list = line.match(/^\[(.*)\]$/)?.[1];
  if (list === undefined) throw new Error(`${field} is not a single-line list: ${line}`);
  const keys = [...list.matchAll(/'([A-Za-z_$][\w$]*)(\??)'/g)];
  // Anything else between the brackets would be a key this reader dropped.
  const rest = list.replace(/'[A-Za-z_$][\w$]*\??'/g, '').replace(/[\s,]/g, '');
  if (rest !== '') throw new Error(`${field} has an entry this reader cannot parse: ${line}`);
  // Sorted, so a declared list compares equal to one read off the host's literals.
  return {
    names: keys.map((m) => m[1]).sort(),
    optional: keys.filter((m) => m[2] === '?').map((m) => m[1]).sort(),
  };
}

export function parseInventory(text) {
  const messages = {};
  for (const [, name, body] of text.matchAll(ENTRY)) {
    // The inventory's `reply` is prose in places ("X (or a Y push when ...)"), so
    // the snapshot keeps the reply NAME and the sentence it came from separately.
    const declared = body.match(/reply: '([^']*)'/)?.[1] ?? '';
    const reply = declared.match(/^[A-Z_]+/)?.[0] ?? '';
    const replyKeys = declaredKeys(body, 'replyKeys');
    const errorKeys = declaredKeys(body, 'errorKeys');
    messages[name] = {
      request: /request: true/.test(body),
      reply,
      ...(declared === reply ? {} : { replyNote: declared }),
      declared: {
        ...(replyKeys === undefined ? {} : { replyKeys }),
        ...(errorKeys === undefined ? {} : { errorKeys }),
      },
    };
  }
  return messages;
}
