import { describe, expect, it } from 'vitest';

import { DIRECT_LOAD_TIMEOUT_MS, hostToRunUrl } from '../src/internal/directLoad.js';

/**
 * Pure-unit coverage for the slug → run-URL derivation. `hostToRunUrl` is the
 * exhaustively-testable core of the direct-load fallback: given the hostname a
 * block is served from, it yields the canonical `civitai.com/apps/run/<slug>`
 * route, or `null` for any host that has no meaningful redirect target (so the
 * caller never renders a broken `apps/run/localhost` link).
 */
describe('hostToRunUrl', () => {
  it('maps a deployed <slug>.civit.ai host to its apps/run route', () => {
    expect(hostToRunUrl('model-benchmarking.civit.ai')).toBe(
      'https://civitai.com/apps/run/model-benchmarking',
    );
  });

  it('works for another slug', () => {
    expect(hostToRunUrl('prompt-library.civit.ai')).toBe(
      'https://civitai.com/apps/run/prompt-library',
    );
  });

  it('is case-insensitive (hostnames are) and lowercases the slug', () => {
    expect(hostToRunUrl('Model-Benchmarking.CIVIT.AI')).toBe(
      'https://civitai.com/apps/run/model-benchmarking',
    );
  });

  it('tolerates a trailing FQDN dot', () => {
    expect(hostToRunUrl('prompt-library.civit.ai.')).toBe(
      'https://civitai.com/apps/run/prompt-library',
    );
  });

  it('takes the FIRST DNS label as the slug when extra labels are present', () => {
    expect(hostToRunUrl('sub.prompt-library.civit.ai')).toBe(
      'https://civitai.com/apps/run/sub',
    );
  });

  it('returns null for a bare civit.ai (no slug label)', () => {
    expect(hostToRunUrl('civit.ai')).toBeNull();
  });

  it('returns null for localhost (dev without the harness)', () => {
    expect(hostToRunUrl('localhost')).toBeNull();
  });

  it('returns null for an IP host', () => {
    expect(hostToRunUrl('127.0.0.1')).toBeNull();
  });

  it('returns null for a non-civit.ai host', () => {
    expect(hostToRunUrl('example.com')).toBeNull();
    expect(hostToRunUrl('civitai.com')).toBeNull();
  });

  it('does NOT match a look-alike suffix (evil-civit.ai / civit.ai.evil.com)', () => {
    // `evilcivit.ai` doesn't end with `.civit.ai` (no dot boundary) → null.
    expect(hostToRunUrl('evilcivit.ai')).toBeNull();
    // A civit.ai-looking label buried in another domain must not match.
    expect(hostToRunUrl('civit.ai.evil.com')).toBeNull();
  });

  it('returns null for empty / nullish input', () => {
    expect(hostToRunUrl('')).toBeNull();
    expect(hostToRunUrl(null)).toBeNull();
    expect(hostToRunUrl(undefined)).toBeNull();
    expect(hostToRunUrl('   ')).toBeNull();
  });

  it('exposes a sane default timeout constant', () => {
    expect(DIRECT_LOAD_TIMEOUT_MS).toBe(2000);
  });
});
