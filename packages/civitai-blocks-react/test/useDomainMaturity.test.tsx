import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BrowsingLevel } from '@civitai/app-sdk/blocks';

import { useDomainMaturity } from '../src/hooks/useDomainMaturity.js';
import { getTransport } from '../src/internal/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * Exercises `useDomainMaturity` end-to-end against the REAL SDK transport via
 * `createMockHost`, which emits the #2670 `domain`/`maxBrowsingLevel` fields on
 * BLOCK_INIT. The mock host fires from window.location.origin, so the
 * transport's allowlist must include it.
 */
const ORIGIN = window.location.origin;

describe('useDomainMaturity', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });

  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  it('fail-closes to SFW before BLOCK_INIT lands', () => {
    const { result } = renderHook(() => useDomainMaturity());
    expect(result.current.isSfw).toBe(true);
    expect(result.current.domain).toBeUndefined();
    expect(result.current.maxBrowsingLevel).toBeUndefined();
    expect(result.current.isLevelAllowed(BrowsingLevel.R)).toBe(false);
    expect(result.current.isLevelAllowed(BrowsingLevel.PG13)).toBe(true);
  });

  it('green domain → SFW ceiling → isSfw true', async () => {
    uninstall = createMockHost({ domain: 'green' }).install();
    const { result } = renderHook(() => useDomainMaturity());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(result.current.domain).toBe('green');
    expect(result.current.isSfw).toBe(true);
    expect(result.current.isLevelAllowed(BrowsingLevel.R)).toBe(false);
  });

  it('blue domain → SFW ceiling → isSfw true', async () => {
    uninstall = createMockHost({ domain: 'blue' }).install();
    const { result } = renderHook(() => useDomainMaturity());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(result.current.domain).toBe('blue');
    expect(result.current.isSfw).toBe(true);
  });

  it('red domain → all-levels ceiling → isSfw false, NSFW levels allowed', async () => {
    uninstall = createMockHost({ domain: 'red' }).install();
    const { result } = renderHook(() => useDomainMaturity());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(result.current.domain).toBe('red');
    expect(result.current.isSfw).toBe(false);
    expect(result.current.isLevelAllowed(BrowsingLevel.X)).toBe(true);
    expect(result.current.isLevelAllowed(BrowsingLevel.PG13)).toBe(true);
  });

  it('maturity:"mature" convenience → isSfw false even without a domain', async () => {
    uninstall = createMockHost({ maturity: 'mature' }).install();
    const { result } = renderHook(() => useDomainMaturity());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(result.current.isSfw).toBe(false);
  });

  it('explicit maxBrowsingLevel overrides the domain-derived ceiling', async () => {
    // A red domain but an explicit SFW ceiling — the bitmask wins (policy is
    // server-side, the SDK never reads `domain` for the SFW decision).
    uninstall = createMockHost({
      domain: 'red',
      maxBrowsingLevel: BrowsingLevel.PG | BrowsingLevel.PG13,
    }).install();
    const { result } = renderHook(() => useDomainMaturity());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(result.current.domain).toBe('red');
    expect(result.current.isSfw).toBe(true);
  });

  it('host predating #2670 (no fields emitted) → fail-closed SFW after init', async () => {
    uninstall = createMockHost({ viewer: { id: 1, username: 'x', status: 'active' } }).install();
    const { result } = renderHook(() => useDomainMaturity());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(result.current.domain).toBeUndefined();
    expect(result.current.maxBrowsingLevel).toBeUndefined();
    expect(result.current.isSfw).toBe(true);
  });
});
