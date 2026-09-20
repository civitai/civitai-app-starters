import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { UTILITIES, type Utility } from '../src/utilities.spec.js';
import { injectTokens } from '@civitai/theme';
import { utilitiesCss } from '../src/utilities.generated.js';
// The shipped shim, not a reconstruction: this is the file consumers get.
import compatCss from '../dist/bootstrap-compat.css?raw';

let scope: HTMLElement | undefined;

beforeAll(() => {
  injectTokens(document);
  for (const css of [utilitiesCss, compatCss]) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
  }
});

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

function mount(className: string): HTMLElement {
  scope ??= Object.assign(document.createElement('div'), { id: 'utility-scope' });
  if (!scope.isConnected) document.body.append(scope);
  const el = document.createElement('div');
  el.className = className;
  scope.append(el);
  return el;
}

/** The properties a utility claims, read off its own declarations. */
const propertiesOf = (utility: Utility): string[] =>
  utility.decls.map((decl) => decl.slice(0, decl.indexOf(':')).trim());

const styles = (el: HTMLElement, properties: string[]): string[] => {
  const computed = getComputedStyle(el);
  return properties.map((property) => computed.getPropertyValue(property));
};

const STATIC_ALIASES = UTILITIES.flatMap((utility) =>
  (utility.bootstrap ?? [])
    .filter((alias) => !alias.includes('{bp}'))
    .map((alias) => [alias, utility] as const)
);

describe('the bootstrap shim', () => {
  it('covers something worth testing', () => {
    expect(STATIC_ALIASES.length).toBeGreaterThan(150);
  });

  it.each(STATIC_ALIASES.map(([alias, u]) => [alias, u.name] as const))(
    '.%s computes exactly as .ci-%s does',
    (alias, name) => {
      const utility = UTILITIES.find((u) => u.name === name)!;
      const properties = propertiesOf(utility);

      expect(styles(mount(alias), properties)).toEqual(styles(mount(`ci-${name}`), properties));
    }
  );
});

describe('the utility layer', () => {
  it('spends tokens, so a theme change moves the spacing with it', () => {
    const el = mount('ci-mb-4');
    expect(getComputedStyle(el).marginBlockEnd).toBe('16px');

    document.documentElement.style.setProperty('--civitai-space-4', '40px');
    expect(getComputedStyle(el).marginBlockEnd).toBe('40px');
    document.documentElement.style.removeProperty('--civitai-space-4');
  });

  it('follows the theme for colour rather than a palette of its own', () => {
    const el = mount('ci-muted');
    document.documentElement.style.setProperty('--civitai-color-text-dimmed', 'rgb(1, 2, 3)');
    expect(getComputedStyle(el).color).toBe('rgb(1, 2, 3)');
    document.documentElement.style.removeProperty('--civitai-color-text-dimmed');
  });

  it('lays a row out in twelve columns', () => {
    const row = mount('ci-row');
    row.append(
      Object.assign(document.createElement('div'), { className: 'ci-col-4' }),
      Object.assign(document.createElement('div'), { className: 'ci-col-8' })
    );
    row.style.width = '1200px';

    const [left, right] = [...row.children] as HTMLElement[];
    const ratio = right!.getBoundingClientRect().width / left!.getBoundingClientRect().width;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });

  it('beats a component default, whichever sheet loaded first', () => {
    const rule = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .find((r) => r.cssText.startsWith('@layer civitai.components, civitai.utilities'));
    expect(rule, 'the layer order statement is what guarantees this').toBeDefined();
  });
});
