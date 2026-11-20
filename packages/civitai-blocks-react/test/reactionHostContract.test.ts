// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { HUMAN_GATED_REQUEST_TYPES } from '../src/transport/requestTimeouts.js';

/**
 * The SEAM between this package's reaction bridge and the host that answers it.
 *
 * `useReactions` awaits `ENTITY_REACTION_RESULT` / `ENTITY_REACTIONS_RESULT` and
 * reads `result` or `error` off them. Those names come from `@civitai/app-sdk`'s
 * message union, which nothing ties to the host: a host that renamed a reply
 * would leave this package compiling, green, and hanging every call to its
 * timeout. The committed snapshot of civitai's own handler inventory
 * (`@civitai/sdk`'s `snapshots/host-messages.json`, refreshed with
 * `pnpm --filter @civitai/sdk snapshot:host`) is the host's side; this pins the
 * two together.
 */
const snapshot = JSON.parse(
  readFileSync(new URL('../../civitai-sdk/snapshots/host-messages.json', import.meta.url), 'utf8'),
) as {
  capturedFrom: string;
  messages: Record<
    string,
    { request: boolean; reply: string; replyKeys: string[]; errorKeys: string[]; framing: string }
  >;
  scopes: string[];
};

describe('the reaction bridge matches the host snapshot', () => {
  it.each([
    ['SET_ENTITY_REACTION', 'ENTITY_REACTION_RESULT'],
    ['GET_ENTITY_REACTIONS', 'ENTITY_REACTIONS_RESULT'],
  ])('%s is a request the host answers with %s, as { result } or { error }', (type, reply) => {
    const host = snapshot.messages[type];
    expect(host, `the host snapshot (${snapshot.capturedFrom}) has no ${type}`).toBeDefined();
    expect(host!.request).toBe(true);
    expect(host!.reply).toBe(reply);
    expect(host!.framing).toBe('legacy');
    expect(host!.replyKeys).toEqual(['result']);
    expect(host!.errorKeys).toEqual(['error']);
  });

  it('the host grants the social:react:self scope', () => {
    expect(snapshot.scopes).toContain('social:react:self');
  });

  it('both are answered without a person in the loop, so the 30s default applies', () => {
    // No host confirm on this bridge (the grant is the consent). A `'human'`
    // bucket would stretch a hung request to ten minutes for no reason.
    expect(HUMAN_GATED_REQUEST_TYPES).not.toContain('SET_ENTITY_REACTION');
    expect(HUMAN_GATED_REQUEST_TYPES).not.toContain('GET_ENTITY_REACTIONS');
  });
});
