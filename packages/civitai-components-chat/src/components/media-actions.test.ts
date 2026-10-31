import { describe, expect, it } from 'vitest';

import { mediaActions } from './media-actions.js';

const ids = (actions: { id: string }[]) => actions.map((action) => action.id);

describe('mediaActions', () => {
  it('offers Post on what this chat can post, just before Download', () => {
    const site = mediaActions({ available: true, takesVideos: true });
    expect(ids(site.image)).toEqual(['reference', 'animate', 'upscale', 'info', 'post', 'download']);
    expect(ids(site.video)).toEqual(['reference', 'upscale', 'info', 'post', 'download']);
    expect(ids(site.audio)).not.toContain('post');

    const onCivitai = mediaActions({ available: true, takesVideos: false });
    expect(ids(onCivitai.video)).not.toContain('post');
    expect(ids(mediaActions({ available: false, takesVideos: false }).image)).not.toContain('post');
  });
});
