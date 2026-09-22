import { createFakeTransport, type FakeTransport } from '@civitai/sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiSignInButton } from '../src/sdk/civitai-sign-in-button.js';
import '../src/sdk/civitai-sign-in-button.define.js';

let scope: HTMLElement | undefined;

/** A transport that has NOT seen `BLOCK_INIT` yet. */
const beforeInit = (): FakeTransport =>
  createFakeTransport({ ready: false, hostOrigin: null, viewer: null });

async function mount(
  transport: FakeTransport,
  attrs: Record<string, string> = {}
): Promise<CivitaiSignInButton> {
  scope?.remove();
  scope = document.createElement('div');
  const el = document.createElement('civitai-sign-in-button');
  el.transport = transport;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  scope.append(el);
  document.body.append(scope);
  await el.updateComplete;
  await el.updateComplete;
  return el;
}

const inner = (el: CivitaiSignInButton): HTMLElement | null =>
  el.shadowRoot!.querySelector('civitai-button');

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-sign-in-button> before BLOCK_INIT', () => {
  it('sends NOTHING when pressed', async () => {
    const transport = beforeInit();
    const el = await mount(transport);

    inner(el)!.click();
    el.shadowRoot!.querySelector('civitai-button')!.shadowRoot!.querySelector('button')!.click();

    expect(transport.sent).toEqual([]);
  });

  it('renders disabled, so the press is refused visibly', async () => {
    const el = await mount(beforeInit());
    expect(inner(el)).not.toBeNull();
    expect((inner(el) as HTMLElement & { disabled: boolean }).disabled).toBe(true);
  });

  it('refuses even with the disabled control forced open', async () => {
    const transport = beforeInit();
    const el = await mount(transport);
    // Open the visual gate while the transport still says not-ready, so the
    // send guard is the ONLY thing left standing between a press and the host.
    el.ready = true;
    await el.updateComplete;
    expect((inner(el) as HTMLElement & { disabled: boolean }).disabled).toBe(false);

    inner(el)!.click();
    expect(transport.sent).toEqual([]);
  });

  it('refuses for an already-signed-in viewer even if re-rendered', async () => {
    const transport = createFakeTransport({
      ready: true,
      viewer: { id: 7, username: 'ada' } as never,
    });
    const el = await mount(transport);
    el.signedIn = false;
    await el.updateComplete;

    inner(el)!.click();
    expect(transport.sent).toEqual([]);
  });
});

describe('<civitai-sign-in-button> once ready', () => {
  it('enables and sends REQUEST_SIGN_IN', async () => {
    const transport = beforeInit();
    const el = await mount(transport);

    transport.setSnapshot({ ready: true, hostOrigin: 'https://civitai.com' });
    await el.updateComplete;

    expect((inner(el) as HTMLElement & { disabled: boolean }).disabled).toBe(false);
    inner(el)!.click();
    expect(transport.sent).toEqual([{ type: 'REQUEST_SIGN_IN', payload: {} }]);
  });

  it('carries return-url when given one', async () => {
    const transport = beforeInit();
    const el = await mount(transport, { 'return-url': '/gallery' });
    transport.setSnapshot({ ready: true });
    await el.updateComplete;

    inner(el)!.click();
    expect(transport.sent).toEqual([
      { type: 'REQUEST_SIGN_IN', payload: { returnUrl: '/gallery' } },
    ]);
  });

  it('disappears for a viewer who is already signed in', async () => {
    const transport = beforeInit();
    const el = await mount(transport);
    transport.setSnapshot({
      ready: true,
      viewer: { id: 7, username: 'ada' } as never,
    });
    await el.updateComplete;

    expect(inner(el)).toBeNull();
    expect(transport.sent).toEqual([]);
  });

  it('stops listening to the transport when removed', async () => {
    const transport = beforeInit();
    const el = await mount(transport);
    transport.setSnapshot({ ready: true });
    await el.updateComplete;

    el.remove();
    transport.setSnapshot({ ready: false });
    await el.updateComplete;
    expect(el.ready).toBe(true);
  });
});

describe('<civitai-sign-in-button> reuses the components base', () => {
  it('composes the presentational <civitai-button> rather than restyling one', async () => {
    const el = await mount(beforeInit());
    const button = inner(el)!;
    expect(button.tagName.toLowerCase()).toBe('civitai-button');
    expect(button.shadowRoot!.querySelector('button')).not.toBeNull();
    expect(button.getAttribute('exportparts')).toBe('button');
  });

  it('is stamped by the shared registry, so a duplicate cannot throw', async () => {
    const el = await mount(beforeInit());
    const ctor = el.constructor as { civitaiElementsVersion?: string };
    expect(ctor.civitaiElementsVersion).toBeTypeOf('string');
  });
});
