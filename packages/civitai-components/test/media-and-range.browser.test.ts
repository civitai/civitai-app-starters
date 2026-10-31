import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiImage } from '../src/elements/civitai-image.js';
import type { CivitaiSlider } from '../src/elements/civitai-slider.js';
import '../src/elements/register.js';

const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const BROKEN = 'data:image/gif;base64,not-an-image';

let scope: HTMLElement | undefined;

async function mount(markup: string): Promise<HTMLElement> {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  scope.innerHTML = markup;
  document.body.append(scope);
  await Promise.all(
    [...scope.querySelectorAll('*')]
      .filter((el): el is HTMLElement & { updateComplete: Promise<boolean> } => 'updateComplete' in el)
      .map((el) => el.updateComplete)
  );
  return scope;
}

/** Waits for the element to leave `loading`, or gives up after ~2s. */
async function settled(el: CivitaiImage): Promise<string> {
  for (let i = 0; i < 200 && el.status === 'loading'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await el.updateComplete;
  return el.status;
}

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-image>', () => {
  it('reaches loaded and announces it on the host', async () => {
    scope?.remove();
    scope = document.createElement('div');
    document.body.append(scope);

    // Listen BEFORE it can settle: a cached image resolves immediately, so a
    // consumer attaching after mount would miss the event entirely. `status`
    // is the reliable contract; the event is the convenience on top.
    const el = document.createElement('civitai-image');
    let loads = 0;
    el.addEventListener('load', () => void (loads += 1));
    el.setAttribute('src', PIXEL);
    el.setAttribute('alt', 'p');
    scope.append(el);

    expect(await settled(el)).toBe('loaded');
    expect(el.getAttribute('status')).toBe('loaded');
    expect(loads).toBe(1);
  });

  it('shows the fallback on error and announces it', async () => {
    scope?.remove();
    scope = document.createElement('div');
    document.body.append(scope);

    const el = document.createElement('civitai-image');
    let errors = 0;
    el.addEventListener('error', () => void (errors += 1));
    el.setAttribute('src', BROKEN);
    el.setAttribute('alt', 'p');
    el.setAttribute('fallback', 'Gone');
    scope.append(el);

    expect(await settled(el)).toBe('error');
    expect(errors).toBe(1);
    const fallback = el.shadowRoot!.querySelector('[part="fallback"]')!;
    expect(getComputedStyle(fallback).display).toBe('flex');
    expect(getComputedStyle(el.shadowRoot!.querySelector('img')!).opacity).toBe('0');
  });

  it('reconciles a cached image that fires no event', async () => {
    // Warm the cache, then mount a second element on the same src: it can be
    // `complete` before the listeners attach, so no load event ever fires.
    await mount(`<civitai-image src="${PIXEL}" alt="p"></civitai-image>`);
    await settled(scope!.querySelector<CivitaiImage>('civitai-image')!);

    await mount(`<civitai-image src="${PIXEL}" alt="p"></civitai-image>`);
    const second = scope!.querySelector<CivitaiImage>('civitai-image')!;
    expect(await settled(second)).toBe('loaded');
  });

  it('settles a 404 to error, and records what a failed image looks like', async () => {
    // A real 404 is complete WITH a currentSrc and zero naturalWidth, unlike a
    // malformed data: URI which never gets a currentSrc at all. Pinned because
    // it is the state the reconcile path has to tell apart from success.
    await mount('<civitai-image src="/does-not-exist.png" alt="p"></civitai-image>');
    const el = scope!.querySelector<CivitaiImage>('civitai-image')!;
    expect(await settled(el)).toBe('error');

    const img = el.shadowRoot!.querySelector('img')!;
    expect(img.complete, 'the 404 must have settled').toBe(true);
    expect(img.currentSrc, 'a 404 still sets currentSrc').not.toBe('');
    expect(img.naturalWidth, 'but decodes nothing').toBe(0);

    // A second element on the same failed URL takes the reconcile path, where
    // naturalWidth is the only thing separating error from loaded.
    await mount('<civitai-image src="/does-not-exist.png" alt="p"></civitai-image>');
    expect(await settled(scope!.querySelector<CivitaiImage>('civitai-image')!)).toBe('error');
  });

  it.each([
    ['', 'cover'],
    ['fit="cover"', 'cover'],
    ['fit="contain"', 'contain'],
  ])('%s fits %s', async (attrs, expected) => {
    await mount(`<civitai-image src="${PIXEL}" alt="p" ${attrs}></civitai-image>`);
    const el = scope!.querySelector<CivitaiImage>('civitai-image')!;
    await settled(el);
    expect(getComputedStyle(el.shadowRoot!.querySelector('img')!).objectFit).toBe(expected);
  });

  it('keeps an empty alt out of the accessibility tree by default', async () => {
    await mount(`<civitai-image src="${PIXEL}"></civitai-image>`);
    const el = scope!.querySelector<CivitaiImage>('civitai-image')!;
    expect(el.shadowRoot!.querySelector('img')!.alt).toBe('');
  });

  /*
   * A grid of off-screen tiles decodes every one of them eagerly unless the
   * consumer can say otherwise, and the `<img>` is built inside the shadow root
   * where no outer-tree markup reaches it. These pin the PASSTHROUGH rather than
   * the property's existence: a declared property that never reaches the `<img>`
   * is exactly the shape that reads as support while providing none.
   *
   * Five of the seven were watched red before the passthrough existed ("expected
   * null to be 'lazy'"). The other two — the unset case below, and the lazy
   * image settling — were already green beforehand and are INVARIANT guards, not
   * regression coverage: the first pins that the default rendered DOM does not
   * move, the second that adding `loading` did not strand `status` on 'loading'.
   */
  it('renders no loading or decoding attribute unless asked, matching HTML', async () => {
    await mount(`<civitai-image src="${PIXEL}" alt="p"></civitai-image>`);
    const img = scope!.querySelector<CivitaiImage>('civitai-image')!.shadowRoot!.querySelector('img')!;
    expect(img.getAttribute('loading')).toBeNull();
    expect(img.getAttribute('decoding')).toBeNull();
  });

  it.each([
    ['loading', 'lazy'],
    ['loading', 'eager'],
    ['decoding', 'async'],
    ['decoding', 'sync'],
    ['decoding', 'auto'],
  ])('carries %s="%s" through to the img', async (name, value) => {
    await mount(`<civitai-image src="${PIXEL}" alt="p" ${name}="${value}"></civitai-image>`);
    const el = scope!.querySelector<CivitaiImage>('civitai-image')!;
    expect(el.shadowRoot!.querySelector('img')!.getAttribute(name)).toBe(value);
  });

  it('carries the property form through too, and reflects it onto the host', async () => {
    await mount(`<civitai-image src="${PIXEL}" alt="p"></civitai-image>`);
    const el = scope!.querySelector<CivitaiImage>('civitai-image')!;
    el.loading = 'lazy';
    el.decoding = 'async';
    await el.updateComplete;
    const img = el.shadowRoot!.querySelector('img')!;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(el.getAttribute('loading')).toBe('lazy');
    expect(el.getAttribute('decoding')).toBe('async');
  });

  it('a lazy image still settles once it loads, so status is not stranded', async () => {
    await mount(`<civitai-image src="${PIXEL}" alt="p" loading="lazy"></civitai-image>`);
    const el = scope!.querySelector<CivitaiImage>('civitai-image')!;
    expect(await settled(el)).toBe('loaded');
  });

  it('keeps the passthrough on the openable variant, where the img is nested in a button', async () => {
    await mount(`<civitai-image openable src="${PIXEL}" alt="p" loading="lazy" decoding="async"></civitai-image>`);
    const el = scope!.querySelector<CivitaiImage>('civitai-image')!;
    const img = el.shadowRoot!.querySelector('button.open img')!;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
  });
});

describe('<civitai-slider>', () => {
  const range = (el: CivitaiSlider): HTMLInputElement =>
    el.shadowRoot!.querySelector('input')!;

  it('is a native range carrying min, max and step', async () => {
    await mount('<civitai-slider min="10" max="90" step="5" value="50"></civitai-slider>');
    const el = scope!.querySelector<CivitaiSlider>('civitai-slider')!;
    const control = range(el);
    expect(control.type).toBe('range');
    expect(control.min).toBe('10');
    expect(control.max).toBe('90');
    expect(control.step).toBe('5');
    expect(control.value).toBe('50');
  });

  it('round-trips through the form and resets to the attribute', async () => {
    await mount('<form><civitai-slider name="cfg" value="7"></civitai-slider></form>');
    const form = scope!.querySelector('form')!;
    const el = scope!.querySelector<CivitaiSlider>('civitai-slider')!;
    expect(new FormData(form).get('cfg')).toBe('7');

    const control = range(el);
    control.value = '3';
    control.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(new FormData(form).get('cfg')).toBe('3');

    form.reset();
    await el.updateComplete;
    expect(el.value).toBe('7');
    expect(range(el).value).toBe('7');
  });

  it('shows the value beside the label only when asked', async () => {
    await mount('<civitai-slider label="CFG" value="7"></civitai-slider>');
    let el = scope!.querySelector<CivitaiSlider>('civitai-slider')!;
    expect(el.shadowRoot!.querySelector('[part="value"]')).toBeNull();

    await mount('<civitai-slider label="CFG" value="7" show-value></civitai-slider>');
    el = scope!.querySelector<CivitaiSlider>('civitai-slider')!;
    expect(el.shadowRoot!.querySelector('[part="value"]')!.textContent?.trim()).toBe('7');
  });

  it('exposes the value as a number', async () => {
    await mount('<civitai-slider min="10" value="42"></civitai-slider>');
    const el = scope!.querySelector<CivitaiSlider>('civitai-slider')!;
    expect(el.valueAsNumber).toBe(42);
  });

  it('adopts the native default when no value is given', async () => {
    // A range is never empty: the browser parks it at the midpoint, so the
    // element must agree with what is on screen rather than report ''.
    await mount('<form><civitai-slider name="cfg" min="0" max="10"></civitai-slider></form>');
    const el = scope!.querySelector<CivitaiSlider>('civitai-slider')!;
    await el.updateComplete;
    expect(el.value).toBe('5');
    expect(el.valueAsNumber).toBe(5);
    expect(range(el).value).toBe('5');
    expect(new FormData(scope!.querySelector('form')!).get('cfg')).toBe('5');
  });

  it('tints the track accent with the error token when invalid', async () => {
    await mount('<civitai-slider value="5" error="Too low"></civitai-slider>');
    const el = scope!.querySelector<CivitaiSlider>('civitai-slider')!;
    expect(el.hasAttribute('data-invalid')).toBe(true);
    const invalidAccent = getComputedStyle(range(el)).accentColor;

    el.error = '';
    await el.updateComplete;
    expect(getComputedStyle(range(el)).accentColor).not.toBe(invalidAccent);
  });

  it('wires description and error to the range', async () => {
    await mount('<civitai-slider label="CFG" description="How closely" error="Too low"></civitai-slider>');
    const el = scope!.querySelector<CivitaiSlider>('civitai-slider')!;
    const root = el.shadowRoot!;
    const control = range(el);
    expect(root.querySelector('label')!.getAttribute('for')).toBe(control.id);
    expect(control.getAttribute('aria-invalid')).toBe('true');
    const described = control.getAttribute('aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    for (const id of described) expect(root.getElementById(id), id).not.toBeNull();
  });
});
