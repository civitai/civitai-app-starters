import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { CivitaiMediaElement } from '../src/elements/media-base.js';
import '../src/elements/register.js';

const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

let scope: HTMLElement | undefined;

async function mount<T extends CivitaiMediaElement>(markup: string): Promise<T> {
  scope?.remove();
  scope = document.createElement('div');
  scope.innerHTML = markup;
  document.body.append(scope);
  const el = scope.firstElementChild as T;
  await el.updateComplete;
  return el;
}

/** Waits for the element to leave `loading`, or gives up after ~2s. */
async function settled(el: CivitaiMediaElement): Promise<string> {
  for (let i = 0; i < 200 && el.status === 'loading'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await el.updateComplete;
  return el.status;
}

const part = (el: HTMLElement, name: string) => el.shadowRoot!.querySelector<HTMLElement>(`[part~="${name}"]`);

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe.each([
  ['civitai-image', 'image'],
  ['civitai-video', 'video'],
  ['civitai-audio', 'audio'],
])('<%s>', (tag, mediaPart) => {
  it('shows a loader while the file is still being made, then the file once it is not', async () => {
    const el = await mount(`<${tag} pending></${tag}>`);
    expect(part(el, 'pending')).not.toBeNull();
    expect(part(el, mediaPart)).toBeNull();

    el.pending = false;
    await el.updateComplete;
    expect(part(el, mediaPart)).not.toBeNull();
  });

  it('withholds a blocked file, whatever its source, and says why in the blocked slot', async () => {
    const el = await mount(`<${tag} blocked src="${PIXEL}"><span slot="blocked">Mature content</span></${tag}>`);
    expect(el.status).toBe('blocked');
    expect(part(el, mediaPart)).toBeNull();
    const slot = part(el, 'blocked')!.querySelector('slot')!;
    expect(slot.assignedElements().map((node) => node.textContent)).toEqual(['Mature content']);
  });

  it('shows its fallback and announces the error when the file fails', async () => {
    scope = document.createElement('div');
    document.body.append(scope);
    const el = document.createElement(tag) as CivitaiMediaElement;
    let errors = 0;
    el.addEventListener('error', () => void (errors += 1));
    el.src = '/does-not-exist';
    el.fallback = 'This file is gone';
    scope.append(el);

    expect(await settled(el)).toBe('error');
    expect(errors).toBe(1);
    expect(part(el, 'fallback')!.textContent).toContain('This file is gone');
  });
});

describe('<civitai-image openable>', () => {
  it('opens from a click or the keyboard, and is a plain image otherwise', async () => {
    const el = await mount(`<civitai-image openable alt="A cat" src="${PIXEL}"></civitai-image>`);
    let opens = 0;
    scope!.addEventListener('open', () => void (opens += 1));
    const button = part(el, 'open') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('A cat');
    button.click();
    button.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(opens).toBe(3);

    const plain = await mount(`<civitai-image alt="A cat" src="${PIXEL}"></civitai-image>`);
    expect(part(plain, 'open')).toBeNull();
  });
});

describe('<civitai-video>', () => {
  it('keeps native controls on a full video, and plays a preview muted and looping without them', async () => {
    const full = await mount('<civitai-video src="/clip.mp4"></civitai-video>');
    expect(full.shadowRoot!.querySelector('video')!.controls).toBe(true);

    const preview = await mount('<civitai-video preview openable alt="A boat" src="/clip.mp4"></civitai-video>');
    const video = preview.shadowRoot!.querySelector('video')!;
    expect(video.controls).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(part(preview, 'open')!.getAttribute('aria-label')).toBe('A boat');
  });

  it('opens only as a preview, where clicks are not needed for the controls', async () => {
    const full = await mount('<civitai-video openable src="/clip.mp4"></civitai-video>');
    expect(part(full, 'open')).toBeNull();
  });
});

describe('<civitai-audio>', () => {
  it('plays with native controls, named by its alt', async () => {
    const el = await mount('<civitai-audio alt="A jingle" src="/jingle.mp3"></civitai-audio>');
    const audio = el.shadowRoot!.querySelector('audio')!;
    expect(audio.controls).toBe(true);
    expect(audio.getAttribute('aria-label')).toBe('A jingle');
  });
});
