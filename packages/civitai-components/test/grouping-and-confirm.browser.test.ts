import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiButton } from '../src/elements/civitai-button.js';
import type { CivitaiConfirmDialog } from '../src/elements/civitai-confirm-dialog.js';
import type { CivitaiTextInput } from '../src/elements/civitai-text-input.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

async function mount(markup: string): Promise<HTMLElement> {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  scope.innerHTML = markup;
  document.body.append(scope);
  await Promise.all(
    [...scope.querySelectorAll('*')]
      .filter((el): el is HTMLElement & { updateComplete: Promise<boolean> } =>
        'updateComplete' in el
      )
      .map((el) => el.updateComplete)
  );
  return scope;
}

const radii = (el: Element): string[] => {
  const inner = (el as CivitaiButton).shadowRoot!.querySelector('button')!;
  const s = getComputedStyle(inner);
  return [s.borderTopLeftRadius, s.borderTopRightRadius];
};

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-button-group>', () => {
  it('rounds only the outside, because a part reaches across one boundary', async () => {
    await mount(
      '<civitai-button-group>' +
        '<civitai-button>One</civitai-button>' +
        '<civitai-button>Two</civitai-button>' +
        '<civitai-button>Three</civitai-button>' +
        '</civitai-button-group>'
    );
    const [first, middle, last] = [...scope!.querySelectorAll('civitai-button')];

    expect(radii(first!)[0]).not.toBe('0px');
    expect(radii(first!)[1]).toBe('0px');
    expect(radii(middle!)).toEqual(['0px', '0px']);
    expect(radii(last!)[1]).not.toBe('0px');
  });

  it('collapses the seam between neighbours to one hairline', async () => {
    await mount(
      '<civitai-button-group><civitai-button>One</civitai-button>' +
        '<civitai-button>Two</civitai-button></civitai-button-group>'
    );
    const second = [...scope!.querySelectorAll('civitai-button')][1]!;
    const inner = second.shadowRoot!.querySelector('button')!;

    expect(getComputedStyle(inner).marginInlineStart).toBe('-1px');
  });

  it('announces itself as a group', async () => {
    await mount('<civitai-button-group><civitai-button>One</civitai-button></civitai-button-group>');
    expect(scope!.querySelector('civitai-button-group')!.getAttribute('role')).toBe('group');
  });
});

describe('<civitai-input-group>', () => {
  it('joins a field to the button beside it', async () => {
    await mount(
      '<civitai-input-group><civitai-text-input></civitai-text-input>' +
        '<civitai-button>Go</civitai-button></civitai-input-group>'
    );
    const input = scope!.querySelector<CivitaiTextInput>('civitai-text-input')!;
    const control = input.shadowRoot!.querySelector('.control')!;
    const button = scope!.querySelector<CivitaiButton>('civitai-button')!;

    expect(getComputedStyle(control).borderTopRightRadius).toBe('0px');
    expect(getComputedStyle(control).borderTopLeftRadius).not.toBe('0px');
    expect(radii(button)[1]).not.toBe('0px');
  });

  it('gives the field the room the button does not take', async () => {
    await mount(
      '<civitai-input-group style="width: 400px"><civitai-text-input></civitai-text-input>' +
        '<civitai-button>Go</civitai-button></civitai-input-group>'
    );
    const input = scope!.querySelector('civitai-text-input')!.getBoundingClientRect();
    const button = scope!.querySelector('civitai-button')!.getBoundingClientRect();

    expect(input.width).toBeGreaterThan(button.width);
    expect(input.width + button.width).toBeGreaterThan(380);
  });
});

describe('<civitai-confirm-dialog>', () => {
  const open = async (attrs = ''): Promise<CivitaiConfirmDialog> => {
    await mount(`<civitai-confirm-dialog heading="Cancel job" message="This refunds nothing." ${attrs}></civitai-confirm-dialog>`);
    return scope!.querySelector<CivitaiConfirmDialog>('civitai-confirm-dialog')!;
  };
  const press = (el: CivitaiConfirmDialog, part: string): void =>
    el.shadowRoot!.querySelector<HTMLButtonElement>(`[part="${part}"]`)!.click();

  it('resolves true when confirmed', async () => {
    const el = await open();
    const answer = el.ask();
    await el.updateComplete;
    press(el, 'confirm');

    await expect(answer).resolves.toBe(true);
    expect(el.open).toBe(false);
  });

  it('resolves false when cancelled', async () => {
    const el = await open();
    const answer = el.ask();
    await el.updateComplete;
    press(el, 'cancel');

    await expect(answer).resolves.toBe(false);
  });

  it('answers a dismissal rather than leaving the caller waiting', async () => {
    const el = await open();
    const answer = el.ask();
    await el.updateComplete;

    el.open = false;
    await el.updateComplete;

    await expect(answer).resolves.toBe(false);
  });

  it('fires confirm only when confirmed', async () => {
    const el = await open();
    let confirms = 0;
    el.addEventListener('confirm', () => void (confirms += 1));

    void el.ask();
    await el.updateComplete;
    press(el, 'cancel');
    expect(confirms).toBe(0);

    void el.ask();
    await el.updateComplete;
    press(el, 'confirm');
    expect(confirms).toBe(1);
  });

  it('is still a real modal, so the platform traps focus', async () => {
    const el = await open();
    void el.ask();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector('dialog')!;

    expect(dialog.matches(':modal')).toBe(true);
  });

  it('lands focus on cancel when the action is destructive', async () => {
    const el = await open('destructive');
    void el.ask();
    await el.updateComplete;

    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector('[part="cancel"]'));
  });
});
