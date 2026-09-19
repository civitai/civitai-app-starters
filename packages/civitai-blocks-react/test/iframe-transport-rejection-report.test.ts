import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, ParentToBlockMessage } from '@civitai/app-sdk/blocks';
import { OTHER_MESSAGE_TYPE_LABEL } from '@civitai/app-sdk/blocks';

import { IframeTransport } from '../src/internal/iframeTransport.js';
import { sendTypedRequest } from '../src/internal/transport.js';
import { mockParentMessage } from '../src/testing.js';

/**
 * The FIFTH bridge silence: a host reply that fails the SDK's own validator.
 *
 * Four of the bridge's five drop paths are host-side and counted since
 * civitai#4946 (`civitai_app_block_bridge_messages_total` over
 * `{handled, no_handler, rate_limited, deduped, no_token}`). This one is not and
 * cannot be: the validator runs in the iframe AFTER the host has already replied,
 * so from the host's side the exchange reads `handled` while the block's request
 * hangs to its timeout with no network call and no host-visible error.
 *
 * 🔴 IT IS THE ONLY ONE OF THE FIVE WITH A CONFIRMED PRODUCTION INCIDENT. On
 * 2026-09-18 `custom-generators` served *"Couldn't load your kept images just
 * now."* from relist until a human found it by hand, and
 * `civitai_app_block_renders_total` read `result=ok, error_class=none` for the
 * whole window because that metric fires once per mount.
 *
 * What this suite pins is that the transport now POSTS `BLOCK_MESSAGE_REJECTED`
 * naming the request left hanging — and, just as load-bearing, that it stays
 * SILENT on a well-formed reply. A reporter that fires on its own control
 * attributes nothing.
 */

const PARENT_ORIGIN = 'https://civitai.com';

function buildInitPayload(overrides: Partial<BlockInitPayload> = {}): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'my-block',
    appId: 'app_test',
    token: {
      raw: 'jwt-1',
      scopes: ['models:read:self'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 'model.sidebar_top', modelId: 42 },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 1, username: 'alice', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
    ...overrides,
  };
}

type PostedMessage = { type: string; payload: unknown };

describe('IframeTransport — validator-rejection reporting', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;
  let originalParent: Window;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  /**
   * 🔴 DISPOSAL IS IN `afterEach`, NOT AT THE END OF EACH TEST BODY, AND THAT IS
   * LOAD-BEARING FOR THE SUITE'S OWN HONESTY. A transport attaches a `message`
   * listener to the shared `window`; a test that fails BEFORE an inline
   * `dispose()` leaves that listener attached, so every later test's
   * `dispatchEvent` reaches the leaked transport too and it reports through the
   * CURRENT `postMessage` mock. Measured while mutation-testing this suite: one
   * genuine failure turned a 30-report budget assertion into 59 (30 from the live
   * transport + 29 from the leaked one), i.e. a second failure that says nothing
   * about the code under test and reads exactly like a real defect.
   */
  const transports: IframeTransport[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    postMessageMock = vi.fn();
    originalParent = window.parent;
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    while (transports.length) transports.pop()?.dispose();
    warnSpy.mockRestore();
    vi.useRealTimers();
    Object.defineProperty(window, 'parent', {
      value: originalParent,
      configurable: true,
      writable: true,
    });
  });

  function trackTransport(transport: IframeTransport): IframeTransport {
    transports.push(transport);
    return transport;
  }

  /** Init, then clear the mock so only post-init traffic is under assertion. */
  async function initTransport() {
    const transport = trackTransport(
      new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] }),
    );
    window.dispatchEvent(
      mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN),
    );
    await transport.waitForInit();
    postMessageMock.mockClear();
    return transport;
  }

  function rejectionReports(): PostedMessage[] {
    return postMessageMock.mock.calls
      .map((call) => call[0] as PostedMessage)
      .filter((msg) => msg.type === 'BLOCK_MESSAGE_REJECTED');
  }

  /** Start a GET_IMAGES_BY_IDS request and return its assigned requestId. */
  function startImagesRequest(transport: IframeTransport): { requestId: string } {
    const pending = sendTypedRequest(
      transport,
      { type: 'GET_IMAGES_BY_IDS', payload: { imageIds: [1] } },
      'IMAGES_RESULT',
      { timeoutMs: 1_000 },
    );
    // The request will never settle in the rejection cases; swallow so the
    // eventual timeout is not an unhandled rejection.
    void pending.catch(() => {});
    const sent = postMessageMock.mock.calls.at(-1)?.[0] as { payload: { requestId: string } };
    return { requestId: sent.payload.requestId };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 1 — the before/after, driven by a deliberately malformed reply
  // ───────────────────────────────────────────────────────────────────────────

  it('NEGATIVE CONTROL: a well-formed IMAGES_RESULT reports nothing', async () => {
    // The "before" half of the before/after. If this reported, the "after" below
    // would prove nothing — a probe that fires identically on its control
    // attributes nothing to the variable under test.
    const transport = await initTransport();
    const { requestId } = startImagesRequest(transport);

    window.dispatchEvent(
      mockParentMessage(
        {
          type: 'IMAGES_RESULT',
          payload: {
            requestId,
            result: {
              images: [
                {
                  imageId: 1,
                  status: 'visible',
                  url: 'https://image.civitai.com/x/1.jpeg',
                  width: 512,
                  height: 512,
                  nsfwLevel: 1,
                  contentRating: 'pg',
                },
              ],
            },
          },
        } as ParentToBlockMessage,
        PARENT_ORIGIN,
      ),
    );

    expect(rejectionReports()).toEqual([]);
  });

  it('reports BLOCK_MESSAGE_REJECTED naming the hanging request when a reply fails its validator', async () => {
    const transport = await initTransport();
    const { requestId } = startImagesRequest(transport);

    // Deliberately malformed: `status` is not a member of the gated-image status
    // set, so `isValidGatedImage` — and with it the WHOLE reply — is rejected.
    window.dispatchEvent(
      mockParentMessage(
        {
          type: 'IMAGES_RESULT',
          payload: {
            requestId,
            result: { images: [{ imageId: 1, status: 'not-a-status' }] },
          },
        } as unknown as ParentToBlockMessage,
        PARENT_ORIGIN,
      ),
    );

    expect(rejectionReports()).toEqual([
      { type: 'BLOCK_MESSAGE_REJECTED', payload: { type: 'GET_IMAGES_BY_IDS' } },
    ]);
    // The console.warn stays, and now carries both halves a diagnosis needs: the
    // validator that rejected, and the request the viewer is now waiting on.
    const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(warned).toContain('IMAGES_RESULT');
    expect(warned).toContain('isValidImagesResult');
    expect(warned).toContain('GET_IMAGES_BY_IDS');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 2 — the 2026-09-18 shape, in both directions
  // ───────────────────────────────────────────────────────────────────────────

  it("the 2026-09-18 shape is ACCEPTED, not dropped: `ratingPending` with no `nsfwLevel` resolves the request", async () => {
    // 🔴 THIS IS THE SHAPE THAT CAUSED THE INCIDENT, AND IT IS NO LONGER A DROP.
    // Since civitai#4895 a viewer's own unrated image returns `visible +
    // ratingPending` with NO `nsfwLevel`; `isValidGatedImage` required the level,
    // `isValidImagesResult` failed the whole reply on the one entry, and
    // GET_IMAGES_BY_IDS hung to its 30s timeout. app-starters #307 fixed the
    // validator. So the faithful pin for the shipped case is that it now PASSES —
    // a re-tightening guard, so the fix cannot regress into the incident again.
    // The counted half is the sibling test below; a shape the validator accepts
    // has, by construction, nothing to count.
    const transport = await initTransport();
    const pending = sendTypedRequest(
      transport,
      { type: 'GET_IMAGES_BY_IDS', payload: { imageIds: [7] } },
      'IMAGES_RESULT',
      { timeoutMs: 1_000 },
    );
    const sent = postMessageMock.mock.calls.at(-1)?.[0] as { payload: { requestId: string } };

    window.dispatchEvent(
      mockParentMessage(
        {
          type: 'IMAGES_RESULT',
          payload: {
            requestId: sent.payload.requestId,
            result: {
              images: [
                {
                  imageId: 7,
                  status: 'visible',
                  url: 'https://image.civitai.com/x/7.jpeg',
                  width: 1024,
                  height: 1024,
                  ratingPending: true,
                },
              ],
            },
          },
        } as ParentToBlockMessage,
        PARENT_ORIGIN,
      ),
    );

    const settled = (await pending) as { result: { images: Array<{ imageId: number }> } };
    expect(settled.result.images[0]?.imageId).toBe(7);
    expect(rejectionReports()).toEqual([]);
  });

  it.each([
    [
      'a ratingPending marker that is not exactly `true`',
      { imageId: 7, status: 'visible', url: 'https://i/7.jpg', width: 1, height: 1, ratingPending: 1 },
    ],
    [
      'ratingPending asserted alongside a rating',
      {
        imageId: 7,
        status: 'visible',
        url: 'https://i/7.jpg',
        width: 1,
        height: 1,
        ratingPending: true,
        nsfwLevel: 1,
        contentRating: 'pg',
      },
    ],
    [
      'neither a rating nor the pending marker',
      { imageId: 7, status: 'visible', url: 'https://i/7.jpg', width: 1, height: 1 },
    ],
  ])(
    'an IMAGES_RESULT rejected for %s is COUNTED against GET_IMAGES_BY_IDS, not silently dropped',
    async (_label, image) => {
      // The three near-misses of the 2026-09-18 shape that `isValidGatedImage`
      // still rejects on purpose. Had the incident recurred in any of these
      // forms with this reporter in place, it would have been a number within a
      // scrape interval instead of 15 days of `result=ok`.
      const transport = await initTransport();
      const { requestId } = startImagesRequest(transport);

      window.dispatchEvent(
        mockParentMessage(
          {
            type: 'IMAGES_RESULT',
            payload: { requestId, result: { images: [image] } },
          } as unknown as ParentToBlockMessage,
          PARENT_ORIGIN,
        ),
      );

      expect(rejectionReports()).toEqual([
        { type: 'BLOCK_MESSAGE_REJECTED', payload: { type: 'GET_IMAGES_BY_IDS' } },
      ]);
      },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // The label, and what it does when there is no request to name
  // ───────────────────────────────────────────────────────────────────────────

  it("reports `other` for a rejected host PUSH, because nothing was awaiting it", async () => {
    // A push (THEME_CHANGE, CONSENT_UNAVAILABLE, TOKEN_REFRESH) has no requestId
    // and hangs nothing — validate.ts calls that the safe side of the too-strict
    // trap. There is no request to name, and `other` is the label the host's own
    // clamp would produce, so the emitted value equals the stored one.
    const transport = await initTransport();
    window.dispatchEvent(
      mockParentMessage(
        { type: 'THEME_CHANGE', payload: { theme: 'chartreuse' } } as unknown as ParentToBlockMessage,
        PARENT_ORIGIN,
      ),
    );
    expect(rejectionReports()).toEqual([
      { type: 'BLOCK_MESSAGE_REJECTED', payload: { type: OTHER_MESSAGE_TYPE_LABEL } },
    ]);
  });

  it("reports `other` when the reply's requestId matches no pending request", async () => {
    const transport = await initTransport();
    window.dispatchEvent(
      mockParentMessage(
        {
          type: 'IMAGES_RESULT',
          payload: { requestId: 'never-issued', result: { images: [{ imageId: 1 }] } },
        } as unknown as ParentToBlockMessage,
        PARENT_ORIGIN,
      ),
    );
    expect(rejectionReports()).toEqual([
      { type: 'BLOCK_MESSAGE_REJECTED', payload: { type: OTHER_MESSAGE_TYPE_LABEL } },
    ]);
  });

  it('clamps a request type the protocol does not declare, so it cannot reach a prom label', async () => {
    // `sendRequest` is typed, but a JavaScript consumer — or a block built against
    // a NEWER protocol than the host serving it — can put any string there, and
    // this value becomes a Prometheus label on a host that retains every distinct
    // label set in heap forever. The cast is the point of the test.
    const transport = await initTransport();
    const pending = transport.sendRequest(
      { type: 'TOTALLY_MADE_UP', payload: {} } as never,
      'IMAGES_RESULT',
      { timeoutMs: 1_000 },
    );
    void pending.catch(() => {});
    const sent = postMessageMock.mock.calls.at(-1)?.[0] as { payload: { requestId: string } };

    window.dispatchEvent(
      mockParentMessage(
        {
          type: 'IMAGES_RESULT',
          payload: { requestId: sent.payload.requestId, result: { images: [{ imageId: 1 }] } },
        } as unknown as ParentToBlockMessage,
        PARENT_ORIGIN,
      ),
    );

    expect(rejectionReports()).toEqual([
      { type: 'BLOCK_MESSAGE_REJECTED', payload: { type: OTHER_MESSAGE_TYPE_LABEL } },
    ]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The budget, and failing soft
  // ───────────────────────────────────────────────────────────────────────────

  it('bounds reports to 30 per 10s window, then resumes in the next window', async () => {
    // An uncapped reporter turns a broken-reply flood into a postMessage flood on
    // a bridge whose inbound budget is 30/sec — the budget `bridgeLabels.ts` says
    // legitimate BLOCK_ERROR reporting needs. The consequence is a deliberate
    // undercount, which is why the series is read as "which types, and when it
    // started", never as an exact total.
    const transport = await initTransport();
    const flood = (n: number) => {
      for (let i = 0; i < n; i += 1) {
        window.dispatchEvent(
          mockParentMessage(
            {
              type: 'IMAGES_RESULT',
              payload: { requestId: `r-${i}`, result: { images: [{ imageId: 1 }] } },
            } as unknown as ParentToBlockMessage,
            PARENT_ORIGIN,
          ),
        );
      }
    };

    flood(45);
    expect(rejectionReports()).toHaveLength(30);

    // Same window: still capped.
    vi.advanceTimersByTime(5_000);
    flood(5);
    expect(rejectionReports()).toHaveLength(30);

    // Past the window: the budget refills.
    vi.advanceTimersByTime(10_001);
    flood(3);
    expect(rejectionReports()).toHaveLength(33);
  });

  it('fails soft: a throwing postMessage does not abort dispatch for the event', async () => {
    // Telemetry must never break the transport it observes. A throw here would
    // propagate out of the `message` listener and add a second silent drop on top
    // of the one being reported.
    const transport = await initTransport();
    postMessageMock.mockImplementation(() => {
      throw new Error('postMessage exploded');
    });

    expect(() => {
      window.dispatchEvent(
        mockParentMessage(
          { type: 'THEME_CHANGE', payload: { theme: 'nope' } } as unknown as ParentToBlockMessage,
          PARENT_ORIGIN,
        ),
      );
    }).not.toThrow();
  });

  it('queues a pre-init rejection report and flushes it once a valid BLOCK_INIT lands', async () => {
    // `dispatch` has no parentOrigin before the first valid BLOCK_INIT, so a report
    // raised while rejecting a MALFORMED init is queued, not sent — and is lost if
    // no init ever succeeds. That residual gap is covered by a different series
    // (the host's ready timeout ⇒ `renders_total{result="timeout"}`); this test
    // pins the queueing rather than leaving the ordering to inference.
    const transport = trackTransport(
      new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] }),
    );
    window.dispatchEvent(
      mockParentMessage(
        { type: 'BLOCK_INIT', payload: { blockInstanceId: '' } } as unknown as ParentToBlockMessage,
        PARENT_ORIGIN,
      ),
    );
    expect(rejectionReports()).toEqual([]);

    window.dispatchEvent(
      mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN),
    );
    await transport.waitForInit();

    expect(rejectionReports()).toEqual([
      { type: 'BLOCK_MESSAGE_REJECTED', payload: { type: OTHER_MESSAGE_TYPE_LABEL } },
    ]);
  });
});
