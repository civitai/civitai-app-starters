import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseInventory } from '../../scripts/lib/host-inventory.mjs';

// civitai/civitai#5983's hostHandlerParity.ts, verbatim (head c5628734697f). It is
// the first inventory to declare `replyKeys`/`errorKeys`, with a `?` suffix for an
// optional key and `errorKeys: 'none'` for a type that never fails at top level.
const fixture = readFileSync(new URL('../fixtures/host-inventory-5983.ts.txt', import.meta.url), 'utf8');
const inventory = parseInventory(fixture);
const requests = Object.entries(inventory).filter(([, m]) => m.request);

describe('parseInventory over a declared-keys inventory', () => {
  it('reads the whole inventory', () => {
    expect(requests.length).toBeGreaterThanOrEqual(43);
  });

  it('keeps a ?-suffixed key, marked optional', () => {
    expect(inventory.OPEN_RESOURCE_PICKER!.declared.replyKeys).toEqual({
      names: ['selected', 'selectedResources'],
      optional: ['selected', 'selectedResources'],
    });
    expect(inventory.APP_STORAGE_GET!.declared.errorKeys).toEqual({
      names: ['error', 'value'],
      optional: ['value'],
    });
  });

  it('reads a plain list with nothing optional', () => {
    expect(inventory.GET_VIEWER!.declared).toEqual({
      replyKeys: { names: ['viewer'], optional: [] },
      errorKeys: { names: ['error'], optional: [] },
    });
  });

  it("reads errorKeys: 'none'", () => {
    expect(inventory.REQUEST_TOKEN!.declared.errorKeys).toBe('none');
    expect(inventory.SUBMIT_WORKFLOW!.declared.errorKeys).toBe('none');
  });

  it('reads null for a fire-and-forget type', () => {
    expect(inventory.BLOCK_HELLO!.declared).toEqual({ replyKeys: null, errorKeys: null });
  });

  it('refuses a list entry it cannot read rather than dropping it', () => {
    const entry = "  X: {\n    request: true,\n    reply: 'X_RESULT',\n    replyKeys: ['ok', KEY],\n  },\n";
    expect(() => parseInventory(entry)).toThrow('replyKeys has an entry this reader cannot parse');
  });

  // The hazard: a declared shape that parsed EMPTY would override the keys the
  // snapshot otherwise reads off the host's own reply literals.
  it.each(requests)('%s declares a non-empty shape', (_type, message) => {
    const { replyKeys, errorKeys } = message.declared;
    expect(replyKeys === null || (replyKeys !== undefined && replyKeys.names.length > 0)).toBe(true);
    expect(errorKeys === 'none' || errorKeys === null || (errorKeys !== undefined && errorKeys.names.includes('error'))).toBe(
      true,
    );
  });
});
