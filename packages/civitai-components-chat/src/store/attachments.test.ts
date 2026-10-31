import { describe, expect, it, vi } from 'vitest';

import type { Attachment } from '../types.js';
import { MissingAttachmentError, resolveAttachmentArgs } from './attachments.js';

const photo: Attachment = { id: 'up1-1', kind: 'image', source: { type: 'upload', blobId: 'b1' }, url: 'https://x/photo' };
const result: Attachment = { id: 'gen2-1-1', kind: 'image', source: { type: 'result', workflowId: 'w', job: 'gen2-1', path: 'output.images[0]' } };

describe('resolveAttachmentArgs', () => {
  const lookup = (id: string) => [photo, result].find((a) => a.id === id);

  it('swaps attachment ids for URLs in strings and string arrays, leaving everything else alone', async () => {
    const refresh = vi.fn(async () => 'https://x/fresh');
    const args = await resolveAttachmentArgs({ prompt: 'up1-1 as a watercolor', images: ['up1-1', 'gen2-1-1'], sourceImage: 'up1-1', quantity: 2 }, lookup, refresh);
    expect(args).toEqual({ prompt: 'up1-1 as a watercolor', images: ['https://x/photo', 'https://x/fresh'], sourceImage: 'https://x/photo', quantity: 2 });
    expect(refresh).toHaveBeenCalledWith(result);
  });

  it('finds ids anywhere in a step input or a list of steps', async () => {
    const args = await resolveAttachmentArgs(
      { steps: [{ $type: 'videoGen', input: { images: ['up1-1'], firstFrame: { url: 'up1-1' }, prompt: 'up1-1' } }] },
      lookup,
      async () => undefined,
    );
    expect(args).toEqual({ steps: [{ $type: 'videoGen', input: { images: ['https://x/photo'], firstFrame: { url: 'https://x/photo' }, prompt: 'https://x/photo' } }] });
  });

  it('names the missing file when the assistant invents an id', async () => {
    await expect(resolveAttachmentArgs({ sourceImage: 'up9-9' }, lookup, async () => undefined)).rejects.toThrow(MissingAttachmentError);
    await expect(resolveAttachmentArgs({ sourceImage: 'up9-9' }, lookup, async () => undefined)).rejects.toThrow('up9-9');
  });
});
