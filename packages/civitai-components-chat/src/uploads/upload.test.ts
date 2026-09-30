import { describe, expect, it, vi } from 'vitest';

import { MAX_UPLOAD_BYTES, UploadError, uploadFile } from './upload.js';

class FakeXhr {
  static last: FakeXhr;
  status = 201;
  responseText = JSON.stringify({ id: 'blob1', url: 'https://x/blob1', width: 800, height: 600 });
  responseType = '';
  headers: Record<string, string> = {};
  url = '';
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXhr.last = this;
  }
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    queueMicrotask(() => this.onload?.());
  }
  abort() {}
}

const file = (type = 'image/png', size = 10) => new File([new Uint8Array(size)], 'photo.png', { type });

function api() {
  return {
    presignUpload: vi.fn(async () => ({ uploadUrl: 'https://orch/v2/consumer/blobs?sig=abc' })),
    uploadDirect: vi.fn(async () => ({ id: 'blob2', url: 'https://x/blob2' })),
  };
}

describe('uploadFile', () => {
  it('uploads to a presigned URL, reporting progress', async () => {
    const progress: number[] = [];
    const a = api();
    const blob = await uploadFile({ api: a, xhr: () => new FakeXhr() as never }, file(), { onProgress: (f) => progress.push(f) });
    expect(blob).toMatchObject({ id: 'blob1', width: 800 });
    expect(FakeXhr.last.url).toBe('https://orch/v2/consumer/blobs?sig=abc');
    expect(FakeXhr.last.headers['Content-Type']).toBe('image/png');
    expect(progress).toEqual([0.5, 1]);
  });

  it('falls back to a direct upload when the presigned one fails', async () => {
    const a = api();
    a.presignUpload.mockRejectedValueOnce(new Error('nope'));
    expect(await uploadFile({ api: a }, file())).toMatchObject({ id: 'blob2' });
  });

  it('refuses unsupported, oversized and blocked files in plain words', async () => {
    await expect(uploadFile({ api: api() }, file('application/pdf'))).rejects.toMatchObject({ kind: 'type' });
    await expect(uploadFile({ api: api() }, file('image/png', MAX_UPLOAD_BYTES + 1))).rejects.toMatchObject({ kind: 'size' });
    const a = api();
    a.presignUpload.mockRejectedValueOnce(new Error('nope'));
    a.uploadDirect.mockResolvedValueOnce({ id: 'b', blockedReason: 'minor' } as never);
    await expect(uploadFile({ api: a }, file())).rejects.toBeInstanceOf(UploadError);
  });
});
