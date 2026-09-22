import { darkTokens, tokens } from '@civitai/theme';
import { afterEach, describe, expect, it } from 'vitest';

import { componentsCss } from '../src/styles.generated.js';
import { CivitaiButton } from '../src/elements/civitai-button.js';
import { defineElement, VERSION } from '../src/elements/internals.js';
import '../src/elements/register.js';

/** `#rrggbb` as the `rgb(r, g, b)` form `getComputedStyle` returns. */
function solid(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

let scope: HTMLElement | undefined;

function mount(theme: 'light' | 'dark', markup: string): HTMLElement {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', theme);
  scope.innerHTML = markup;
  document.body.append(scope);
  return scope;
}

/** Custom elements upgrade synchronously once defined, but Lit renders async. */
const rendered = async (el: CivitaiButton): Promise<CivitaiButton> => {
  await el.updateComplete;
  return el;
};

const partOf = (el: CivitaiButton): HTMLButtonElement =>
  el.shadowRoot!.querySelector('button')!;

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-button> registration', () => {
  it('is defined and upgrades to the class', () => {
    expect(customElements.get('civitai-button')).toBe(CivitaiButton);
    const el = mount('light', '<civitai-button>Go</civitai-button>').firstElementChild;
    expect(el).toBeInstanceOf(CivitaiButton);
  });

  it('stamps the package version on the constructor', () => {
    expect((CivitaiButton as { civitaiElementsVersion?: string }).civitaiElementsVersion).toBe(
      VERSION
    );
  });

  it('a duplicate define is a no-op, not a throw that aborts the caller', () => {
    class Other extends HTMLElement {}
    let reached = false;
    expect(() => {
      defineElement('civitai-button', Other);
      reached = true;
    }).not.toThrow();
    // The whole point: the statement AFTER a conflicting define still runs.
    expect(reached).toBe(true);
    expect(customElements.get('civitai-button')).toBe(CivitaiButton);
  });
});

describe('<civitai-button> styling anchors', () => {
  it('bare element renders the documented default: filled, md', async () => {
    const el = mount('light', '<civitai-button>Go</civitai-button>')
      .firstElementChild as CivitaiButton;
    const cs = getComputedStyle(partOf(await rendered(el)));
    expect(cs.backgroundColor).toBe(solid(tokens.colorPrimary));
    expect(cs.color).toBe(solid(tokens.colorPrimaryFg));
    expect(cs.height).toBe('36px');
    expect(cs.fontSize).toBe('14px');
  });

  it('tracks the dark primary token from an ancestor data-theme', async () => {
    const el = mount('dark', '<civitai-button>Go</civitai-button>')
      .firstElementChild as CivitaiButton;
    const cs = getComputedStyle(partOf(await rendered(el)));
    expect(cs.backgroundColor).toBe(solid(darkTokens.colorPrimary));
    expect(cs.backgroundColor).not.toBe(solid(tokens.colorPrimary));
  });

  it.each([
    ['sm', '30px', '13px'],
    ['md', '36px', '14px'],
    ['lg', '44px', '16px'],
  ])('size=%s is %s tall', async (size, height, fontSize) => {
    const el = mount('light', `<civitai-button size="${size}">Go</civitai-button>`)
      .firstElementChild as CivitaiButton;
    const cs = getComputedStyle(partOf(await rendered(el)));
    expect(cs.height).toBe(height);
    expect(cs.fontSize).toBe(fontSize);
  });

  it('outline variant is transparent with a primary border', async () => {
    const el = mount('light', '<civitai-button variant="outline">Go</civitai-button>')
      .firstElementChild as CivitaiButton;
    const cs = getComputedStyle(partOf(await rendered(el)));
    expect(cs.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(cs.borderTopColor).toBe(solid(tokens.colorPrimary));
    expect(cs.color).toBe(solid(tokens.colorPrimary));
  });

  it('the attribute API and the property API compute identically', async () => {
    mount('light', '<civitai-button variant="outline" size="lg">A</civitai-button><civitai-button>B</civitai-button>');
    const [viaAttr, viaProp] = [...scope!.children] as CivitaiButton[];
    viaProp!.variant = 'outline';
    viaProp!.size = 'lg';
    const a = getComputedStyle(partOf(await rendered(viaAttr!)));
    const b = getComputedStyle(partOf(await rendered(viaProp!)));
    for (const prop of ['backgroundColor', 'color', 'borderTopColor', 'height', 'fontSize', 'padding'] as const) {
      expect(b[prop], prop).toBe(a[prop]);
    }
  });

  describe('matches the legacy attribute markup it replaces', () => {
    const VARIANTS = ['filled', 'light', 'outline', 'subtle'] as const;
    const SIZES = ['sm', 'md', 'lg'] as const;
    const COMPARED = [
      'backgroundColor', 'color', 'borderTopColor', 'borderTopWidth', 'borderTopStyle',
      'height', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'borderRadius',
      'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'gap',
      'alignItems', 'justifyContent', 'cursor', 'userSelect', 'textDecorationLine',
      'transitionDuration', 'transitionProperty',
    ] as const;

    const cases = VARIANTS.flatMap((variant) =>
      SIZES.flatMap((size) =>
        (['light', 'dark'] as const).map((theme) => [theme, variant, size] as const)
      )
    );

    it.each(cases)('%s / %s / %s', async (theme, variant, size) => {
      const style = document.createElement('style');
      style.textContent = componentsCss;
      document.head.append(style);
      try {
        mount(
          theme,
          `<civitai-button variant="${variant}" size="${size}">X</civitai-button>` +
            `<button data-civitai-ui="button" data-variant="${variant}" data-size="${size}">X</button>`
        );
        const [host, legacy] = [...scope!.children] as [CivitaiButton, HTMLElement];
        const a = getComputedStyle(partOf(await rendered(host)));
        const b = getComputedStyle(legacy);

        // `display` is compared on the HOST, because the host is what stands in
        // the document where the legacy <button> stood. The inner button is a
        // flex item of the host, so its own `inline-flex` blockifies to `flex`.
        expect(getComputedStyle(host).display).toBe(b.display);

        for (const prop of COMPARED) {
          expect(a[prop], prop).toBe(b[prop]);
        }

        // The proof that pixels do not move.
        const box = host.getBoundingClientRect();
        const legacyBox = legacy.getBoundingClientRect();
        expect(box.width).toBeCloseTo(legacyBox.width, 1);
        expect(box.height).toBeCloseTo(legacyBox.height, 1);
      } finally {
        style.remove();
      }
    });
  });
});

describe('<civitai-button> behaviour', () => {
  it('clicking emits a click that reaches document', async () => {
    const el = mount('light', '<civitai-button>Go</civitai-button>')
      .firstElementChild as CivitaiButton;
    await rendered(el);
    let seen = 0;
    const onClick = (): void => void (seen += 1);
    document.addEventListener('click', onClick);
    try {
      partOf(el).click();
    } finally {
      document.removeEventListener('click', onClick);
    }
    expect(seen).toBe(1);
  });

  it.each(['disabled', 'loading'])('%s swallows the click entirely', async (attr) => {
    const el = mount('light', `<civitai-button ${attr}>Go</civitai-button>`)
      .firstElementChild as CivitaiButton;
    await rendered(el);
    let seen = 0;
    el.addEventListener('click', () => void (seen += 1));
    el.click();
    expect(seen).toBe(0);
    expect(partOf(el).disabled).toBe(true);
  });

  it('loading marks the control busy without hiding the label', async () => {
    const el = mount('light', '<civitai-button loading>Go</civitai-button>')
      .firstElementChild as CivitaiButton;
    await rendered(el);
    expect(partOf(el).getAttribute('aria-busy')).toBe('true');
    expect(el.shadowRoot!.querySelector('.spinner')).not.toBeNull();
    expect(el.textContent).toContain('Go');
  });

  it('is not busy by default', async () => {
    const el = mount('light', '<civitai-button>Go</civitai-button>')
      .firstElementChild as CivitaiButton;
    await rendered(el);
    expect(partOf(el).hasAttribute('aria-busy')).toBe(false);
  });
});

describe('<civitai-button> form participation', () => {
  const FORM = `<form><input name="q" value="hi" /><civitai-button type="submit">S</civitai-button><civitai-button type="reset">R</civitai-button></form>`;

  it('finds the form it lives in across the shadow boundary', async () => {
    mount('light', FORM);
    const el = scope!.querySelector('civitai-button')!;
    await rendered(el);
    expect(el.form).toBe(scope!.querySelector('form'));
  });

  it('type=submit submits the outer form', async () => {
    mount('light', FORM);
    const form = scope!.querySelector('form')!;
    const el = scope!.querySelector<CivitaiButton>('civitai-button[type="submit"]')!;
    await rendered(el);
    let submitted: FormData | undefined;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitted = new FormData(form);
    });
    partOf(el).click();
    expect(submitted?.get('q')).toBe('hi');
  });

  it('type=reset restores the form', async () => {
    mount('light', FORM);
    const form = scope!.querySelector('form')!;
    const input = form.querySelector('input')!;
    const el = scope!.querySelector<CivitaiButton>('civitai-button[type="reset"]')!;
    await rendered(el);
    input.value = 'changed';
    partOf(el).click();
    expect(input.value).toBe('hi');
  });

  it('the default type=button submits nothing', async () => {
    mount('light', `<form><civitai-button>S</civitai-button></form>`);
    const form = scope!.querySelector('form')!;
    const el = scope!.querySelector('civitai-button')!;
    await rendered(el);
    let submits = 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submits += 1;
    });
    partOf(el).click();
    expect(submits).toBe(0);
  });
});

describe('<civitai-button> intent', () => {
  const button = async (markup: string): Promise<CivitaiButton> => {
    const el = mount('dark', markup).firstElementChild as CivitaiButton;
    return rendered(el);
  };

  it.each(['info', 'success', 'warning', 'error'])('color=%s recolours the filled button', async (color) => {
    const el = await button(`<civitai-button color="${color}">Go</civitai-button>`);
    const inner = el.shadowRoot!.querySelector('button')!;

    expect(getComputedStyle(inner).backgroundColor).toBe(solid(darkTokens[`color${color[0]!.toUpperCase()}${color.slice(1)}` as keyof typeof darkTokens] as string));
  });

  it('recolours every variant from the one intent, not just filled', async () => {
    const el = await button('<civitai-button color="error" variant="outline">Go</civitai-button>');
    const inner = el.shadowRoot!.querySelector('button')!;

    expect(getComputedStyle(inner).color).toBe(solid(darkTokens.colorError as string));
    expect(getComputedStyle(inner).borderColor).toBe(solid(darkTokens.colorError as string));
  });

  it('keeps the primary accent when no intent is given', async () => {
    const el = await button('<civitai-button>Go</civitai-button>');
    const inner = el.shadowRoot!.querySelector('button')!;

    expect(getComputedStyle(inner).backgroundColor).toBe(solid(darkTokens.colorPrimary as string));
  });
});

describe('<civitai-button> as a link', () => {
  const button = async (markup: string): Promise<CivitaiButton> =>
    rendered(mount('dark', markup).firstElementChild as CivitaiButton);

  it('renders an anchor when given an href, because navigation is a link', async () => {
    const el = await button('<civitai-button href="/jobs">Jobs</civitai-button>');
    const inner = el.shadowRoot!.querySelector('[part="button"]')!;

    expect(inner.tagName).toBe('A');
    expect(inner.getAttribute('href')).toBe('/jobs');
  });

  /* Both in ONE scope: `mount` replaces the previous one, so measuring across
     two calls reads a detached element and every value comes back empty. */
  it('looks the same as the button it replaces', async () => {
    const scoped = mount(
      'dark',
      '<civitai-button href="/jobs" variant="outline" size="sm">Jobs</civitai-button>' +
        '<civitai-button variant="outline" size="sm">Jobs</civitai-button>'
    );
    const [link, plain] = [...scoped.children] as CivitaiButton[];
    await rendered(link!);
    await rendered(plain!);

    const look = (el: CivitaiButton): string[] => {
      const s = getComputedStyle(el.shadowRoot!.querySelector('[part="button"]')!);
      return [s.height, s.padding, s.fontSize, s.color, s.borderColor, s.borderRadius];
    };
    expect(look(link!)).toEqual(look(plain!));
  });

  /* An anchor has no disabled state, so it must lose its href — otherwise it
     still navigates while looking inert. */
  it('stops being a link when disabled', async () => {
    const el = await button('<civitai-button href="/jobs" disabled>Jobs</civitai-button>');
    const inner = el.shadowRoot!.querySelector('[part="button"]')!;

    expect(inner.hasAttribute('href')).toBe(false);
    expect(inner.getAttribute('aria-disabled')).toBe('true');
  });
});
