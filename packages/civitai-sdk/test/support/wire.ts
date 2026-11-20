/**
 * Wire helpers shared by the two storage fakes (`fake-app-storage.ts` for the
 * per-viewer routes, `fake-shared-storage.ts` for the cross-user ones).
 *
 * These five were byte-for-byte identical in both fakes. One copy, so a fake that
 * changes how it encodes a cursor or frames a JSON reply cannot drift from its
 * sibling — the two clients page the same way and a difference here would read as
 * a difference in the clients.
 */

export const utf8 = (text: string) => new TextEncoder().encode(text);

/** Cursors are opaque base64 on both surfaces, exactly as the server mints them. */
export const toBase64 = (text: string) => btoa(String.fromCharCode(...utf8(text)));

export const fromBase64 = (encoded: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Arbitrary, non-round, and fixed: seeded stamps are then pairwise distinct. */
export const SEED_EPOCH_MS = 1_756_000_000_123;
