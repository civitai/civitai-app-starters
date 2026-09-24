import { describe, expect, it } from 'vitest';

import { createHost } from '../../src/host/index.js';
import type { ImageScanResult, PendingImage, UploadedImage } from '../../src/host/index.js';
import { createFakeTransport, type FakeTransport } from '../../src/testing.js';
import { init, mountTransport } from '../support/iframe-host.js';

const MODERATED: UploadedImage = {
  imageId: 77,
  nsfwLevel: 1,
  contentRating: 'pg',
  url: 'https://image.civitai.com/77/width=1200',
};

/** The reply an `asyncScan` host sends: persisted, not yet judged. */
const PENDING = { status: 'pending' as const, imageId: 77, url: MODERATED.url };

const openDisplay = async (t: FakeTransport, selected: unknown) => {
  t.reply('OPEN_IMAGE_UPLOAD', { selected });
  return createHost(t).openImageUpload();
};

describe('host.openImageUpload — generationSource', () => {
  it('names the purpose and resolves the unscanned source', async () => {
    const t = createFakeTransport();
    t.reply('OPEN_IMAGE_UPLOAD', { selected: { url: 'https://src/x.png', width: 512, height: 768 } });

    await expect(createHost(t).openImageUpload({ purpose: 'generationSource' })).resolves.toEqual({
      url: 'https://src/x.png',
      width: 512,
      height: 768,
    });
    expect(t.sent.at(-1)).toEqual({
      type: 'OPEN_IMAGE_UPLOAD',
      payload: { purpose: 'generationSource' },
    });
  });

  it('resolves null when the viewer closes the modal', async () => {
    const t = createFakeTransport();
    t.reply('OPEN_IMAGE_UPLOAD', {});

    await expect(
      createHost(t).openImageUpload({ purpose: 'generationSource' }),
    ).resolves.toBeNull();
  });
});

describe('host.openImageUpload — display', () => {
  /**
   * The host normalises an absent purpose to `'display'` and an unrecognised one
   * the same way, so the display call sends NO purpose: byte-identical to the
   * wire every host has answered. Asserted as the WHOLE payload — a check for
   * `asyncScan` alone would pass with a `purpose` field beside it.
   */
  it('sends asyncScan and nothing else', async () => {
    const t = createFakeTransport();
    await openDisplay(t, PENDING);

    expect(t.sent.at(-1)).toEqual({ type: 'OPEN_IMAGE_UPLOAD', payload: { asyncScan: true } });
  });

  it('resolves the persisted image before the host has judged it', async () => {
    const t = createFakeTransport();
    const handle = await openDisplay(t, PENDING);

    expect(handle).toMatchObject({ imageId: 77, url: MODERATED.url });
    expect(handle).not.toHaveProperty('nsfwLevel');
  });

  it('resolves null when the viewer closes the modal, and stops listening', async () => {
    const t = createFakeTransport();
    t.reply('OPEN_IMAGE_UPLOAD', {});

    await expect(createHost(t).openImageUpload()).resolves.toBeNull();
    expect(t.listenerCount('IMAGE_SCAN_RESOLVED')).toBe(0);
  });

  it('resolves null — never a handle — for a reply it cannot read as an image', async () => {
    const t = createFakeTransport();

    await expect(openDisplay(t, { imageId: 'not-a-number' })).resolves.toBeNull();
    expect(t.listenerCount('IMAGE_SCAN_RESOLVED')).toBe(0);
  });
});

describe('host.openImageUpload — the scan verdict', () => {
  /**
   * 🔴 The moderation signal itself. A design that hands back only the upload
   * removes it silently, so this asserts the refusal ARRIVES, with the host's
   * own reason, at the caller that has to fail closed on it.
   */
  it('delivers a blocked verdict, with the reason the host gave', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;

    t.push('IMAGE_SCAN_RESOLVED', {
      requestId: 'rq-1',
      imageId: 77,
      result: { status: 'blocked', reason: 'above the SFW ceiling' },
    });

    await expect(handle.scan()).resolves.toEqual({
      status: 'blocked',
      reason: 'above the SFW ceiling',
    });
  });

  it('delivers a blocked verdict that carries no reason', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;

    t.push('IMAGE_SCAN_RESOLVED', { requestId: 'rq-1', imageId: 77, result: { status: 'blocked' } });

    await expect(handle.scan()).resolves.toEqual({ status: 'blocked' });
  });

  it('delivers a clean verdict with the moderated image', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;

    t.push('IMAGE_SCAN_RESOLVED', {
      requestId: 'rq-1',
      imageId: 77,
      result: { status: 'scanned', image: MODERATED },
    });

    await expect(handle.scan()).resolves.toEqual({ status: 'scanned', image: MODERATED });
  });

  it('awaits a verdict that has not arrived yet', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;

    const pending = handle.scan();
    t.push('IMAGE_SCAN_RESOLVED', { requestId: 'rq-1', imageId: 77, result: { status: 'blocked' } });

    await expect(pending).resolves.toEqual({ status: 'blocked' });
  });

  it('answers every later read with the same verdict', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;

    t.push('IMAGE_SCAN_RESOLVED', {
      requestId: 'rq-1',
      imageId: 77,
      result: { status: 'blocked', reason: 'no' },
    });

    await expect(handle.scan()).resolves.toEqual({ status: 'blocked', reason: 'no' });
    await expect(handle.scan()).resolves.toEqual({ status: 'blocked', reason: 'no' });
    expect(t.listenerCount('IMAGE_SCAN_RESOLVED')).toBe(0);
  });

  /**
   * The listener is attached before the request goes out precisely so this
   * cannot happen: a scan that finishes before the reply is read would
   * otherwise be a verdict nobody heard.
   */
  it('keeps a verdict that arrives before the upload reply does', async () => {
    const t = createFakeTransport();
    const opening = createHost(t).openImageUpload();

    t.push('IMAGE_SCAN_RESOLVED', {
      requestId: 'rq-1',
      imageId: 77,
      result: { status: 'blocked', reason: 'early' },
    });
    t.reply('OPEN_IMAGE_UPLOAD', { selected: PENDING });

    const handle = (await opening)!;
    await expect(handle.scan()).resolves.toEqual({ status: 'blocked', reason: 'early' });
  });

  it('ignores a verdict for an image it did not upload', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;

    t.push('IMAGE_SCAN_RESOLVED', {
      requestId: 'rq-1',
      imageId: 78,
      result: { status: 'scanned', image: { ...MODERATED, imageId: 78 } },
    });
    t.push('IMAGE_SCAN_RESOLVED', { requestId: 'rq-1', imageId: 77, result: { status: 'blocked' } });

    await expect(handle.scan()).resolves.toEqual({ status: 'blocked' });
  });

  it('honours the first verdict and ignores a second', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;

    t.push('IMAGE_SCAN_RESOLVED', { requestId: 'rq-1', imageId: 77, result: { status: 'blocked' } });
    t.push('IMAGE_SCAN_RESOLVED', {
      requestId: 'rq-1',
      imageId: 77,
      result: { status: 'scanned', image: MODERATED },
    });

    await expect(handle.scan()).resolves.toEqual({ status: 'blocked' });
  });

  /** 🔴 Never claim a clean scan the host did not back with an image. */
  it('refuses to read a clean verdict that carries no image', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;

    t.push('IMAGE_SCAN_RESOLVED', { requestId: 'rq-1', imageId: 77, result: { status: 'scanned' } });

    const result = await handle.scan();
    expect(result.status).toBe('error');
    expect(result).not.toHaveProperty('image');
  });

  it('reads a verdict it does not recognise as an error, not as a pass', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;

    t.push('IMAGE_SCAN_RESOLVED', { requestId: 'rq-1', imageId: 77, result: { status: 'weird' } });

    await expect(handle.scan()).resolves.toEqual({ status: 'error' });
  });

  it('carries the host’s message on a retryable error', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;

    t.push('IMAGE_SCAN_RESOLVED', {
      requestId: 'rq-1',
      imageId: 77,
      result: { status: 'error', message: 'Image scan timed out — please try again.' },
    });

    await expect(handle.scan()).resolves.toEqual({
      status: 'error',
      message: 'Image scan timed out — please try again.',
    });
  });
});

describe('host.openImageUpload — a host that does not know asyncScan', () => {
  /**
   * Such a host blocks its own modal on the scan and replies with the moderated
   * image. The verdict is therefore already reached, and no push is coming.
   */
  it('reads the blocking reply as the verdict it is', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, MODERATED))!;

    expect(handle).toMatchObject({ imageId: 77, url: MODERATED.url });
    await expect(handle.scan()).resolves.toEqual({ status: 'scanned', image: MODERATED });
    expect(t.listenerCount('IMAGE_SCAN_RESOLVED')).toBe(0);
  });
});

describe('host.openImageUpload — cancelling', () => {
  it('gives up the wait without deciding the verdict', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;
    const ac = new AbortController();

    const abandoned = handle.scan({ signal: ac.signal });
    ac.abort();
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });

    t.push('IMAGE_SCAN_RESOLVED', { requestId: 'rq-1', imageId: 77, result: { status: 'blocked' } });
    await expect(handle.scan()).resolves.toEqual({ status: 'blocked' });
  });

  it('rejects at once when the signal is already aborted', async () => {
    const t = createFakeTransport();
    const handle = (await openDisplay(t, PENDING))!;

    await expect(handle.scan({ signal: AbortSignal.abort() })).rejects.toBeDefined();
  });

  it('stops listening when the upload itself fails', async () => {
    const t = createFakeTransport();
    t.fail('OPEN_IMAGE_UPLOAD', { code: 'forbidden', message: 'review-mode' });

    await expect(createHost(t).openImageUpload()).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.listenerCount('IMAGE_SCAN_RESOLVED')).toBe(0);
  });
});

describe('host.openImageUpload over the real bridge', () => {
  /**
   * The host answers `OPEN_IMAGE_UPLOAD` with `IMAGE_UPLOAD_RESULT`, not with
   * the `<TYPE>_RESULT` the transport would derive. A wrong name here is silent
   * — the reply never correlates and the call waits forever — so this drives
   * the real `IframeTransport` rather than the fake, which keys on the request
   * type and so cannot see the mapping at all.
   */
  it('reads the host’s differently-named reply, then its verdict push', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const opening = createHost(transport).openImageUpload();
    const sent = posted.at(-1)!.msg as { type: string; payload: { requestId: string } };
    expect(sent.type).toBe('OPEN_IMAGE_UPLOAD');
    expect(sent.payload).toMatchObject({ asyncScan: true });

    deliver({
      type: 'IMAGE_UPLOAD_RESULT',
      payload: { requestId: sent.payload.requestId, selected: PENDING },
    });
    const handle = (await opening) as PendingImage;
    expect(handle.imageId).toBe(77);

    // The push reuses the upload's own requestId, which the transport must not
    // mistake for the reply to a request it is still holding.
    deliver({
      type: 'IMAGE_SCAN_RESOLVED',
      payload: {
        requestId: sent.payload.requestId,
        imageId: 77,
        result: { status: 'blocked', reason: 'refused' },
      },
    });

    await expect(handle.scan()).resolves.toEqual({ status: 'blocked', reason: 'refused' });
  });

  it('surfaces the host’s no-handler refusal as a BridgeError', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const opening = createHost(transport).openImageUpload();
    const sent = posted.at(-1)!.msg as { payload: { requestId: string } };
    deliver({
      type: 'IMAGE_UPLOAD_RESULT',
      payload: { requestId: sent.payload.requestId, error: 'no handler for OPEN_IMAGE_UPLOAD' },
    });

    await expect(opening).rejects.toMatchObject({
      name: 'BridgeError',
      operation: 'OPEN_IMAGE_UPLOAD',
    });
  });
});

describe('the ImageScanResult contract', () => {
  /**
   * An INVARIANT GUARD, not regression coverage: it pins that `scanned` is the
   * only variant carrying an image, so a later widening of the union cannot
   * quietly add a second way to look clean.
   */
  it('gives only the clean verdict an image', () => {
    const results: ImageScanResult[] = [
      { status: 'scanned', image: MODERATED },
      { status: 'blocked', reason: 'x' },
      { status: 'error', message: 'x' },
    ];

    expect(results.filter((r) => 'image' in r).map((r) => r.status)).toEqual(['scanned']);
  });
});
