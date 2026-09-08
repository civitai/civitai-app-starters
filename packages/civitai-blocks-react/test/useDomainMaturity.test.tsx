import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowsingLevel } from '@civitai/app-sdk/blocks';
import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

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

  /**
   * 🔴 The per-VIEWER ceiling. `maxBrowsingLevel` is a property of the DOMAIN,
   * so every viewer on `red` gets the same maximally-wide value — including one
   * whose own NSFW setting is off. These cases pin that `isSfw` /
   * `isLevelAllowed` answer for the PERSON, not the domain.
   *
   * Each case makes the domain and the viewer DISAGREE. A fixture where they
   * agree cannot distinguish gating on the effective ceiling from gating on
   * either input, which is exactly the bug being guarded against.
   */
  describe('per-viewer effective ceiling', () => {
    it('🔴 red domain + a PG-only viewer → isSfw TRUE, even though the DOMAIN allows everything', async () => {
      // Without the viewer half this reads isSfw:false and the block shows
      // mature UI to someone who asked not to see it.
      uninstall = createMockHost({
        domain: 'red',
        viewerBrowsingLevel: BrowsingLevel.PG,
      }).install();
      const { result } = renderHook(() => useDomainMaturity());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      // The domain ceiling is still reported wide — the two are different facts.
      expect(result.current.maxBrowsingLevel).toBe(
        BrowsingLevel.PG |
          BrowsingLevel.PG13 |
          BrowsingLevel.R |
          BrowsingLevel.X |
          BrowsingLevel.XXX
      );
      expect(result.current.effectiveBrowsingLevel).toBe(BrowsingLevel.PG);
      expect(result.current.isSfw).toBe(true);
      expect(result.current.isLevelAllowed(BrowsingLevel.X)).toBe(false);
      expect(result.current.isLevelAllowed(BrowsingLevel.R)).toBe(false);
      expect(result.current.isLevelAllowed(BrowsingLevel.PG)).toBe(true);
      // The domain ceiling on its own would have said the opposite.
      expect(result.current.effectiveBrowsingLevel).not.toBe(result.current.maxBrowsingLevel);
    });

    it('red domain + a full-NSFW viewer → still mature (this is not a blanket clamp)', async () => {
      uninstall = createMockHost({
        domain: 'red',
        viewerBrowsingLevel:
          BrowsingLevel.PG |
          BrowsingLevel.PG13 |
          BrowsingLevel.R |
          BrowsingLevel.X |
          BrowsingLevel.XXX,
      }).install();
      const { result } = renderHook(() => useDomainMaturity());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      expect(result.current.isSfw).toBe(false);
      expect(result.current.isLevelAllowed(BrowsingLevel.X)).toBe(true);
      expect(result.current.effectiveBrowsingLevel).toBe(result.current.maxBrowsingLevel);
    });

    it('red domain + an R-capped viewer → R allowed, XXX refused (a middle value, not a binary)', async () => {
      // A third distinct answer, so neither "always the domain" nor "always
      // SFW" satisfies the suite.
      uninstall = createMockHost({
        domain: 'red',
        viewerBrowsingLevel: BrowsingLevel.PG | BrowsingLevel.PG13 | BrowsingLevel.R,
      }).install();
      const { result } = renderHook(() => useDomainMaturity());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      expect(result.current.isSfw).toBe(false);
      expect(result.current.isLevelAllowed(BrowsingLevel.R)).toBe(true);
      expect(result.current.isLevelAllowed(BrowsingLevel.X)).toBe(false);
      expect(result.current.isLevelAllowed(BrowsingLevel.XXX)).toBe(false);
    });

    it('🔴 a viewer WIDER than the domain cannot widen it: green domain + a full-NSFW viewer stays SFW', async () => {
      // The mock host clamps to the ceiling exactly as the real host does, so
      // the state "viewer wider than domain" is unreachable here — which is the
      // property being asserted, not a limitation of the fixture.
      uninstall = createMockHost({
        domain: 'green',
        viewerBrowsingLevel:
          BrowsingLevel.PG | BrowsingLevel.PG13 | BrowsingLevel.R | BrowsingLevel.X,
      }).install();
      const { result } = renderHook(() => useDomainMaturity());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      expect(result.current.isSfw).toBe(true);
      expect(result.current.isLevelAllowed(BrowsingLevel.R)).toBe(false);
      expect(result.current.effectiveBrowsingLevel).toBe(BrowsingLevel.PG | BrowsingLevel.PG13);
      expect(result.current.effectiveBrowsingLevel).toBe(result.current.maxBrowsingLevel);
    });

    it('🔴 a host that omits the viewer field behaves EXACTLY as before (no regression, no widening)', async () => {
      // The upgrade contract. Same fixture as the pre-existing red-domain case
      // above; the assertions are deliberately identical to it.
      uninstall = createMockHost({ domain: 'red' }).install();
      const { result } = renderHook(() => useDomainMaturity());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      expect(result.current.isSfw).toBe(false);
      expect(result.current.isLevelAllowed(BrowsingLevel.X)).toBe(true);
      expect(result.current.isLevelAllowed(BrowsingLevel.PG13)).toBe(true);
      // Falls back to the domain ceiling rather than reading undefined.
      expect(result.current.effectiveBrowsingLevel).toBe(result.current.maxBrowsingLevel);
    });

    it('fail-closes to SFW before BLOCK_INIT even with a viewer level configured', () => {
      uninstall = createMockHost({ domain: 'red', viewerBrowsingLevel: 31 }).install();
      const { result } = renderHook(() => useDomainMaturity());
      // Deliberately NOT awaiting init — the pre-init snapshot is the case.
      expect(result.current.isSfw).toBe(true);
      expect(result.current.effectiveBrowsingLevel).toBeUndefined();
      expect(result.current.isLevelAllowed(BrowsingLevel.R)).toBe(false);
    });

    /**
     * 🔴 A HOSTILE / BUGGY HOST — the case `createMockHost` CANNOT produce.
     *
     * The mock clamps its `viewerBrowsingLevel` to the ceiling, deliberately,
     * because the real host does. That fidelity is why every case above is
     * blind to whether the HOOK re-clamps or merely forwards what it was given:
     * the two are indistinguishable when the input is already a subset. So the
     * hook's own intersection is unreachable through the mock, and a sweep that
     * only used the mock scored it as untested — correctly.
     *
     * This drives the transport directly with a payload NO honest host emits:
     * a SFW domain ceiling alongside an all-levels viewer value. Note that the
     * `isValidBlockInitPayload` guard ACCEPTS this — it shape-checks each field
     * independently and has no cross-field rule — so the hook's clamp is the
     * only thing standing between a wrong number on the wire and a block
     * rendering XXX affordances on a SFW domain.
     */
    it('🔴 re-clamps a host that sends a viewer level WIDER than its own domain ceiling', () => {
      Object.defineProperty(window, 'parent', {
        value: { postMessage: vi.fn() },
        configurable: true,
        writable: true,
      });
      const payload = {
        blockInstanceId: 'inst-hostile',
        blockId: 'b',
        appId: 'app_test',
        token: {
          raw: 'jwt-1',
          scopes: [],
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        context: { slotId: 'model.sidebar_top' },
        settings: { publisherSettings: {}, userSettings: {} },
        viewer: null,
        theme: 'dark',
        renderMode: 'iframe',
        domain: 'green',
        maxBrowsingLevel: BrowsingLevel.PG | BrowsingLevel.PG13,
        // 🔴 WIDER than the ceiling on the same message.
        effectiveBrowsingLevel:
          BrowsingLevel.PG |
          BrowsingLevel.PG13 |
          BrowsingLevel.R |
          BrowsingLevel.X |
          BrowsingLevel.XXX,
      } as unknown as BlockInitPayload;

      const { result } = renderHook(() => useDomainMaturity());
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'BLOCK_INIT', payload },
            origin: ORIGIN,
          })
        );
      });

      // The payload was accepted (this is not a "the guard dropped it" pass).
      expect(getTransport().getSnapshot().ready).toBe(true);
      expect(result.current.maxBrowsingLevel).toBe(BrowsingLevel.PG | BrowsingLevel.PG13);
      // …and the wider viewer value did NOT come through.
      expect(result.current.effectiveBrowsingLevel).toBe(BrowsingLevel.PG | BrowsingLevel.PG13);
      expect(result.current.isSfw).toBe(true);
      expect(result.current.isLevelAllowed(BrowsingLevel.R)).toBe(false);
      expect(result.current.isLevelAllowed(BrowsingLevel.XXX)).toBe(false);
    });

    it('🔴 fails closed to SFW when a host sends a NEGATIVE viewer level on a mature domain', () => {
      // Also unreachable through the mock (it drops a negative rather than
      // emitting it). `-1 & 31 === 31`, so a masked junk value would resolve to
      // the FULL mature ceiling — the widest possible viewer.
      Object.defineProperty(window, 'parent', {
        value: { postMessage: vi.fn() },
        configurable: true,
        writable: true,
      });
      const ALL =
        BrowsingLevel.PG |
        BrowsingLevel.PG13 |
        BrowsingLevel.R |
        BrowsingLevel.X |
        BrowsingLevel.XXX;
      const payload = {
        blockInstanceId: 'inst-neg',
        blockId: 'b',
        appId: 'app_test',
        token: {
          raw: 'jwt-1',
          scopes: [],
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        context: { slotId: 'model.sidebar_top' },
        settings: { publisherSettings: {}, userSettings: {} },
        viewer: null,
        theme: 'dark',
        renderMode: 'iframe',
        domain: 'red',
        maxBrowsingLevel: ALL,
        effectiveBrowsingLevel: -1,
      } as unknown as BlockInitPayload;

      const { result } = renderHook(() => useDomainMaturity());
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'BLOCK_INIT', payload },
            origin: ORIGIN,
          })
        );
      });

      // 🔴 The deployed validator REJECTS this payload outright, so the block
      // never initialises — which is itself the fail-closed outcome, and is why
      // `ready` is asserted rather than assumed. Either way the hook must not
      // report a mature ceiling.
      expect(result.current.isSfw).toBe(true);
      expect(result.current.isLevelAllowed(BrowsingLevel.X)).toBe(false);
      expect(result.current.effectiveBrowsingLevel).not.toBe(ALL);
    });

    /**
     * 🔴 THE MOCK HOST'S OWN CLAMP, OBSERVED ON THE WIRE.
     *
     * Every other case here reads through `useDomainMaturity`, and the hook
     * clamps too — so if the mock stopped clamping, the hook would absorb it
     * and all of them would stay green. A mutation sweep proved exactly that:
     * deleting the mock's `resolvedCeiling &` SURVIVED a fully green 1458-test
     * run. The two guards are redundant by design (defense in depth), which is
     * precisely why neither can be certified through the other.
     *
     * So this one asserts on the raw `BLOCK_INIT` payload as it crosses the
     * wire, before any SDK code touches it. What it pins is a MOCK-FIDELITY
     * property, not a safety one: a mock that emits a viewer level wider than
     * its own ceiling lets a block be developed and tested against a state
     * production cannot produce — the drift a mock exists to prevent.
     */
    it('🔴 the MOCK HOST clamps on the wire: it cannot emit a viewer level wider than its ceiling', async () => {
      const seen: Array<Record<string, unknown>> = [];
      const listener = (e: MessageEvent) => {
        const data = e.data as { type?: string; payload?: Record<string, unknown> };
        if (data?.type === 'BLOCK_INIT' && data.payload) seen.push(data.payload);
      };
      window.addEventListener('message', listener);
      try {
        uninstall = createMockHost({
          domain: 'green', // ceiling = PG | PG13
          viewerBrowsingLevel:
            BrowsingLevel.PG |
            BrowsingLevel.PG13 |
            BrowsingLevel.R |
            BrowsingLevel.X |
            BrowsingLevel.XXX,
        }).install();
        renderHook(() => useDomainMaturity());
        await waitFor(() => expect(seen.length).toBeGreaterThan(0));
        const payload = seen[0];
        // Positive control: the mock DID emit the field (a mock that emitted
        // nothing would satisfy a "never wider" assertion vacuously).
        expect(payload.effectiveBrowsingLevel).toBeDefined();
        expect(payload.maxBrowsingLevel).toBe(BrowsingLevel.PG | BrowsingLevel.PG13);
        expect(payload.effectiveBrowsingLevel).toBe(BrowsingLevel.PG | BrowsingLevel.PG13);
        // The mature bits requested by the option never reach the wire.
        expect((payload.effectiveBrowsingLevel as number) & BrowsingLevel.R).toBe(0);
        expect((payload.effectiveBrowsingLevel as number) & BrowsingLevel.XXX).toBe(0);
      } finally {
        window.removeEventListener('message', listener);
      }
    });

    it('the MOCK HOST emits a NARROWER viewer level unchanged (the clamp only ever narrows)', async () => {
      // The other arm: without it, "always emit the ceiling" would pass the
      // case above. Red ceiling + a PG viewer must reach the wire as PG.
      const seen: Array<Record<string, unknown>> = [];
      const listener = (e: MessageEvent) => {
        const data = e.data as { type?: string; payload?: Record<string, unknown> };
        if (data?.type === 'BLOCK_INIT' && data.payload) seen.push(data.payload);
      };
      window.addEventListener('message', listener);
      try {
        uninstall = createMockHost({
          domain: 'red',
          viewerBrowsingLevel: BrowsingLevel.PG,
        }).install();
        renderHook(() => useDomainMaturity());
        await waitFor(() => expect(seen.length).toBeGreaterThan(0));
        expect(seen[0].effectiveBrowsingLevel).toBe(BrowsingLevel.PG);
        expect(seen[0].effectiveBrowsingLevel).not.toBe(seen[0].maxBrowsingLevel);
      } finally {
        window.removeEventListener('message', listener);
      }
    });

    it('the MOCK HOST omits the field entirely when no viewer level is configured', async () => {
      // Models a host that predates the field — the default, so the harness
      // does not silently start asserting a contract the platform may not ship.
      const seen: Array<Record<string, unknown>> = [];
      const listener = (e: MessageEvent) => {
        const data = e.data as { type?: string; payload?: Record<string, unknown> };
        if (data?.type === 'BLOCK_INIT' && data.payload) seen.push(data.payload);
      };
      window.addEventListener('message', listener);
      try {
        uninstall = createMockHost({ domain: 'red' }).install();
        renderHook(() => useDomainMaturity());
        await waitFor(() => expect(seen.length).toBeGreaterThan(0));
        expect('effectiveBrowsingLevel' in seen[0]).toBe(false);
        expect(seen[0].maxBrowsingLevel).toBeDefined();
      } finally {
        window.removeEventListener('message', listener);
      }
    });

    it('an empty viewer level (0) hides everything, including PG', async () => {
      // 0 is falsy; an `effective || max` implementation would fall back to the
      // full red ceiling here — the widest possible answer for the narrowest
      // possible viewer.
      uninstall = createMockHost({ domain: 'red', viewerBrowsingLevel: 0 }).install();
      const { result } = renderHook(() => useDomainMaturity());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      expect(result.current.effectiveBrowsingLevel).toBe(0);
      expect(result.current.isSfw).toBe(true);
      expect(result.current.isLevelAllowed(BrowsingLevel.PG)).toBe(false);
      expect(result.current.isLevelAllowed(BrowsingLevel.X)).toBe(false);
    });
  });
});
