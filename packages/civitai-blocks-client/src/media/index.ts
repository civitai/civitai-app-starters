import { createCaller, type CallOptions } from '../core/messaging.js';

import type { MediaRequests, DownloadRequest } from './protocol.js';

const call = createCaller<MediaRequests>();

export type { DownloadRequest } from './protocol.js';

/**
 * Downloads to the viewer's device through the host's own chrome, because a
 * block cannot: the sandbox withholds `allow-downloads` by default, and even
 * with it the `download` attribute is ignored cross-origin, so the filename is
 * lost. The host fetches only from origins it allowlists. Images and video
 * both. It saves nothing on civitai; a collection is a different thing.
 */
export async function download(request: DownloadRequest, opts: CallOptions = {}): Promise<void> {
  await call('SAVE_IMAGE', request, opts);
}
