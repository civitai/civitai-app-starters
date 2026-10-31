import type { OrchestrationApi, UploadedBlob } from '../orchestration/api.js';
import type { Attachment, MediaKind } from '../types.js';

export const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
];
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',');
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

export type UploadErrorKind = 'type' | 'size' | 'blocked' | 'failed';

const WORDS: Record<UploadErrorKind, string> = {
  type: 'That kind of file cannot be used here. Try a JPEG, PNG, WebP, GIF, MP4, WebM, MP3 or WAV.',
  size: 'That file is too big; the limit is 64 MB.',
  blocked: 'That file was blocked by the safety filter.',
  failed: 'The upload did not go through. Try again.',
};

export class UploadError extends Error {
  readonly kind: UploadErrorKind;
  constructor(kind: UploadErrorKind, cause?: unknown) {
    super(WORDS[kind], { cause });
    this.name = 'UploadError';
    this.kind = kind;
  }
}

export function kindOfMime(mime: string): MediaKind | null {
  if (!ACCEPTED_TYPES.includes(mime)) return null;
  return mime.split('/')[0] as MediaKind;
}

export interface UploadDeps {
  api: Pick<OrchestrationApi, 'presignUpload' | 'uploadDirect'>;
  xhr?: () => XMLHttpRequest;
}

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export async function uploadFile(deps: UploadDeps, file: File, opts: UploadOptions = {}): Promise<UploadedBlob> {
  if (!kindOfMime(file.type)) throw new UploadError('type');
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError('size');
  let blob: UploadedBlob;
  try {
    const { uploadUrl } = await deps.api.presignUpload({ signal: opts.signal });
    blob = await post(uploadUrl, file, opts, deps.xhr ?? (() => new XMLHttpRequest()));
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    // The presigned route is the one that reports progress; the direct one still works.
    try {
      blob = await deps.api.uploadDirect(file, { signal: opts.signal });
    } catch (direct) {
      throw new UploadError('failed', direct);
    }
  }
  if (blob.blockedReason) throw new UploadError('blocked');
  opts.onProgress?.(1);
  return blob;
}

function post(url: string, file: File, { onProgress, signal }: UploadOptions, makeXhr: () => XMLHttpRequest): Promise<UploadedBlob> {
  return new Promise((resolve, reject) => {
    const xhr = makeXhr();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`upload failed: ${xhr.status}`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as UploadedBlob);
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => reject(new Error('upload failed: network'));
    xhr.onabort = () => reject(signal?.reason ?? new Error('upload aborted'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export interface MediaInfo {
  width?: number;
  height?: number;
  durationSec?: number;
}

export function uploadAttachment(id: string, file: File, blob: UploadedBlob, info: MediaInfo = {}): Attachment {
  return {
    id,
    kind: kindOfMime(file.type) ?? 'image',
    source: { type: 'upload', blobId: blob.id },
    url: blob.url ?? undefined,
    mime: file.type,
    name: file.name,
    width: blob.width ?? info.width,
    height: blob.height ?? info.height,
    durationSec: info.durationSec,
    nsfwLevel: blob.nsfwLevel ?? undefined,
  };
}

/** Size and length read in the browser before upload, so the assistant knows them at once. */
export async function probeMedia(file: File): Promise<MediaInfo> {
  const kind = kindOfMime(file.type);
  if (kind === 'image' && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const info = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return info;
    } catch {
      return {};
    }
  }
  if (kind === 'video' || kind === 'audio') {
    const element = document.createElement(kind);
    const url = URL.createObjectURL(file);
    try {
      element.preload = 'metadata';
      element.src = url;
      await new Promise<void>((resolve, reject) => {
        element.onloadedmetadata = () => resolve();
        element.onerror = () => reject(new Error('unreadable media'));
      });
      const video = element as HTMLVideoElement;
      return {
        durationSec: Number.isFinite(element.duration) ? element.duration : undefined,
        width: kind === 'video' ? video.videoWidth : undefined,
        height: kind === 'video' ? video.videoHeight : undefined,
      };
    } catch {
      return {};
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return {};
}
