import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { KNOWN_GAPS } from '../../src/manifest/defineBlock.js';

/**
 * civitai.com removed counters, marks and `write: "none"` (civitai/civitai#10391). The manifest
 * types KEEP them, because a collection that already declares one may keep it, so the type
 * system cannot pin the removal: these pin the DOCS instead, against the vendored canonical
 * schema (itself byte-pinned to civitai.com by `scripts/check-canonical-schema.sh`).
 *
 * The `@deprecated` text of `counters` and `marks` must be the canonical description's opening,
 * word for word (whitespace normalised), so the two cannot drift apart: a reworded canonical
 * fails here until the types follow it.
 */

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const TYPES = fileURLToPath(new URL('../../src/blocks/types.ts', import.meta.url));
const source = ts.createSourceFile(TYPES, readFileSync(TYPES, 'utf8'), ts.ScriptTarget.Latest, true);

function member(iface: string, name: string): ts.PropertySignature {
  let found: ts.PropertySignature | undefined;
  source.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === iface) {
      for (const m of node.members) {
        if (ts.isPropertySignature(m) && m.name.getText(source) === name) found = m;
      }
    }
  });
  if (!found) throw new Error(`${iface}.${name} not found in types.ts`);
  return found;
}

const docOf = (m: ts.PropertySignature) =>
  norm(ts.getJSDocCommentsAndTags(m).map((d) => d.getText(source).replace(/^\s*\/?\*+\/?/gm, ' ')).join(' '));

const deprecatedOf = (m: ts.PropertySignature) => {
  const tag = ts.getJSDocTags(m).find((t) => t.tagName.text === 'deprecated');
  return tag === undefined ? undefined : norm(ts.getTextOfJSDocComment(tag.comment) ?? '');
};

const canonical = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../schemas/app-block/v1.json', import.meta.url)), 'utf8'),
) as { properties: { storage: { properties: { collections: { patternProperties: Record<string, { properties: Record<string, { description: string; deprecated?: boolean }> }> } } } } };
const collection = Object.values(canonical.properties.storage.properties.collections.patternProperties)[0]!.properties;

describe('counters, marks and write "none" are documented as REMOVED', () => {
  it.each(['counters', 'marks'])('%s: @deprecated, and its text opens the canonical description word for word', (name) => {
    const text = deprecatedOf(member('BlockStorageSharedCollectionDeclaration', name));
    expect(text, `${name} has no @deprecated tag`).toBeDefined();
    expect(text!.startsWith('REMOVED — use a viewer-keyed collection (`keyedBy`) instead')).toBe(true);
    // Not a fragment: it carries the whole "serves none / refuses a new one" statement.
    expect(text!.length).toBeGreaterThan(250);
    expect(collection[name]!.deprecated).toBe(true);
    expect(norm(collection[name]!.description).startsWith(text!)).toBe(true);
  });

  it("write: the 'none' bullet is the canonical's REMOVED statement", () => {
    const doc = docOf(member('BlockStorageSharedCollectionDeclaration', 'write'));
    const bullet =
      "`'none'` — REMOVED (it existed for counters, which were removed): civitai.com refuses it on a collection that the " +
      "app's previous approved version did not already declare with `'none'`, and serves a collection that keeps it " +
      "READ-ONLY (nobody creates, updates or deletes its documents). Use `'own'` with `keyedBy` (a viewer-keyed " +
      'collection) instead.';
    expect(doc).toContain(bullet);
    // The same statement, in the canonical's quoting.
    const asCanonical = bullet.replace(/`'(\w+)'`/g, '"$1"').replace('"none" — REMOVED', '"none" is REMOVED');
    expect(norm(collection.write!.description)).toContain(asCanonical);
    // The text that presented them as live is gone.
    expect(doc).not.toContain('viewers only increment');
    expect(doc).not.toContain('can still mark and count');
  });

  it('KNOWN_GAPS names them as removed and refused at submit', () => {
    expect(norm(KNOWN_GAPS['storage-server-only-rules'])).toContain(
      '`counters`, `marks` and `write` "none" are REMOVED (civitai.com serves none of them and refuses one a ' +
        "collection did not already declare in the app's previous approved version; use a viewer-keyed " +
        'collection, `keyedBy`, instead)',
    );
  });
});
