/**
 * DS-MIGRATION SAFETY NET (0.35.0) — token parity of the /ui pack.
 *
 * After migrating the /ui pack off its private `--ci-*` palette onto
 * `@civitai/theme` + `@civitai/components`, this test PINS the resulting
 * computed styles to the design-system's token-derived values — for BOTH the
 * presentational-10 (now delegated to `@civitai/components`) AND the
 * interactive-5 that stay in this package (Modal / Select / Slider / Collapse /
 * SegmentedControl), in light AND dark.
 *
 * Mirrors `@civitai/components-react`'s `html-vs-react-parity` anchor approach:
 * a browser PROBE oracle evaluates the same color expression from the LITERAL
 * token hex (`@civitai/theme`'s `tokens` / `darkTokens`, NOT via the stylesheet
 * var), so the expectation is (a) external to the pack's CSS (meaningless-proof:
 * neuter `injectBlocksStyles()` and these anchors FAIL), (b) theme-tracking, and
 * (c) serialization-robust (browser serializes probe + component identically,
 * incl. `color-mix()`).
 *
 * Every INTENDED repaint delta is encoded here as the NEW expected value and
 * TAGGED `[approved delta]`: radius 8px→4px, success green→teal, dark primary
 * `#228be6`→`#1971C2`, SegmentedControl track `#f4f4f5`→`#fefefe`. If a future
 * DS bump moves a token, THIS test is where the change surfaces.
 *
 * Also asserts (structurally) that the interactive-5 `<style>` reads
 * `--civitai-*`, never the retired `--ci-*`.
 */
import { darkTokens, tokens } from '@civitai/theme';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  TextInput,
} from '../src/ui/index.js';
import { injectBlocksStyles } from '../src/ui/styles.js';

beforeAll(() => {
  injectBlocksStyles(document);
});

// ---------------------------------------------------------------------------
// Probe oracle + mount helpers (mirrors components-react render.tsx / parity).
// ---------------------------------------------------------------------------

function probeColor(colorExpr: string): string {
  const el = document.createElement('div');
  el.style.color = colorExpr;
  document.body.appendChild(el);
  const v = getComputedStyle(el).color;
  el.remove();
  return v;
}
/** Solid token color -> canonical serialization. */
const solid = (hex: string): string => probeColor(hex);
/** `color-mix(in srgb, <hex> <pct>, transparent)` -> canonical serialization. */
const mix = (hex: string, pct: string): string =>
  probeColor(`color-mix(in srgb, ${hex} ${pct}, transparent)`);

interface Mounted {
  mount: HTMLElement;
  cleanup: () => void;
}
function mountReact(theme: string, node: React.ReactElement): Mounted {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-theme', theme);
  const mount = document.createElement('div');
  wrapper.appendChild(mount);
  document.body.appendChild(wrapper);
  const root = createRoot(mount);
  flushSync(() => root.render(node));
  return {
    mount,
    cleanup: () => {
      root.unmount();
      wrapper.remove();
    },
  };
}

/** Render `node` under `[data-theme]`, run `assert` against the selector's computed style. */
function anchor(
  theme: string,
  node: React.ReactElement,
  selector: string,
  assert: (cs: CSSStyleDeclaration) => void
): void {
  const m = mountReact(theme, node);
  try {
    const el = m.mount.querySelector(selector);
    expect(el, `no element for ${selector}`).toBeTruthy();
    assert(getComputedStyle(el!));
  } finally {
    m.cleanup();
  }
}

// ===========================================================================
// PRESENTATIONAL-10 — now sourced from @civitai/components (delegation proof)
// ===========================================================================

describe('parity — Button (delegated)', () => {
  it('filled light: bg=primary token, fg=primaryFg, radius=4px [approved delta 8→4], md height=36px', () => {
    anchor('light', <Button variant="filled" size="md">Go</Button>, '[data-civitai-ui="button"]', (cs) => {
      expect(cs.backgroundColor).toBe(solid(tokens.colorPrimary));
      expect(cs.color).toBe(solid(tokens.colorPrimaryFg));
      expect(cs.borderTopLeftRadius).toBe('4px'); // --civitai-radius = 0.25rem [approved delta]
      expect(cs.height).toBe('36px');
    });
  });

  it('filled dark: bg=#1971C2 dark primary [approved delta from #228be6]', () => {
    anchor('dark', <Button variant="filled" size="md">Go</Button>, '[data-civitai-ui="button"]', (cs) => {
      expect(cs.backgroundColor).toBe(solid(darkTokens.colorPrimary)); // #1971C2
      expect(cs.backgroundColor).not.toBe(solid(tokens.colorPrimary)); // theme switched
    });
  });

  it('outline light: text+border=primary, bg transparent', () => {
    anchor('light', <Button variant="outline">Go</Button>, '[data-civitai-ui="button"]', (cs) => {
      expect(cs.color).toBe(solid(tokens.colorPrimary));
      expect(cs.borderTopColor).toBe(solid(tokens.colorPrimary));
      expect(cs.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    });
  });
});

describe('parity — Badge (delegated; inline --civitai-color-primary accent)', () => {
  it('filled light: bg=primary, pill radius=999px', () => {
    anchor('light', <Badge variant="filled">new</Badge>, '[data-civitai-ui="badge"]', (cs) => {
      expect(cs.backgroundColor).toBe(solid(tokens.colorPrimary));
      expect(cs.borderTopLeftRadius).toBe('999px');
    });
  });

  it('light variant: bg=mix(primary 14%), text=primary', () => {
    anchor('light', <Badge variant="light">new</Badge>, '[data-civitai-ui="badge"]', (cs) => {
      expect(cs.backgroundColor).toBe(mix(tokens.colorPrimary, '14%'));
      expect(cs.color).toBe(solid(tokens.colorPrimary));
    });
  });

  it('semantic color prop maps onto --civitai-color-primary (success=teal token) [approved delta]', () => {
    // color="success" overrides --civitai-color-primary inline → variant reads it.
    anchor('light', <Badge color="success" variant="filled">new</Badge>, '[data-civitai-ui="badge"]', (cs) => {
      expect(cs.backgroundColor).toBe(solid(tokens.colorSuccess)); // #299C7A teal
    });
  });
});

describe('parity — Alert (delegated; success=teal) [approved delta]', () => {
  it('success light: bg=mix(success 12%), border=mix(success 35%) — success token is TEAL #299C7A', () => {
    anchor(
      'light',
      <Alert color="success" title="t">b</Alert>,
      '[data-civitai-ui="alert"]',
      (cs) => {
        expect(cs.backgroundColor).toBe(mix(tokens.colorSuccess, '12%'));
        expect(cs.borderTopColor).toBe(mix(tokens.colorSuccess, '35%'));
      }
    );
  });

  it('success dark: border=mix(dark success 35%) — dark teal #326D5C, theme-tracked', () => {
    anchor(
      'dark',
      <Alert color="success" title="t">b</Alert>,
      '[data-civitai-ui="alert"]',
      (cs) => {
        expect(cs.borderTopColor).toBe(mix(darkTokens.colorSuccess, '35%'));
        expect(cs.borderTopColor).not.toBe(mix(tokens.colorSuccess, '35%'));
      }
    );
  });
});

describe('parity — TextInput (delegated shared -control primitive)', () => {
  it('light: bg=surface, border=colorBorder, radius=4px [approved delta]', () => {
    anchor('light', <TextInput label="N" id="p1" />, '[data-civitai-ui-control]', (cs) => {
      expect(cs.backgroundColor).toBe(solid(tokens.colorSurface));
      expect(cs.borderTopColor).toBe(solid(tokens.colorBorder));
      expect(cs.borderTopLeftRadius).toBe('4px');
    });
  });

  it('dark: bg=dark surface, border=dark border (theme-tracked)', () => {
    anchor('dark', <TextInput label="N" id="p2" />, '[data-civitai-ui-control]', (cs) => {
      expect(cs.backgroundColor).toBe(solid(darkTokens.colorSurface));
      expect(cs.borderTopColor).toBe(solid(darkTokens.colorBorder));
    });
  });
});

describe('parity — Card / Stack / Group / Loader (delegated)', () => {
  it('Card light: bg=surface, border=colorBorder, radius=4px, padding md=16px [approved delta]', () => {
    anchor('light', <Card withBorder padding="md">x</Card>, '[data-civitai-ui="card"]', (cs) => {
      expect(cs.backgroundColor).toBe(solid(tokens.colorSurface));
      expect(cs.borderTopColor).toBe(solid(tokens.colorBorder));
      expect(cs.borderTopLeftRadius).toBe('4px');
      expect(cs.paddingTop).toBe('16px');
    });
  });

  // NOTE: blocks-react's Stack/Group own their `gap` via an INLINE style
  // (component default 12px), which wins over the DS `[data-gap]` CSS — so gap
  // is NOT a DS-token-derived value and is UNCHANGED by this migration. We anchor
  // the DS-CSS-derived structural props (display/flex-direction) and pin the
  // inline gap default as a non-regression.
  it('Stack: flex column, inline default gap=12px (unchanged); Group: flex row, inline default gap=12px (unchanged)', () => {
    anchor('light', <Stack><span>a</span></Stack>, '[data-civitai-ui="stack"]', (cs) => {
      expect(cs.display).toBe('flex');
      expect(cs.flexDirection).toBe('column');
      expect(cs.gap).toBe('12px'); // component inline default, not DS token
    });
    anchor('light', <Group><span>a</span></Group>, '[data-civitai-ui="group"]', (cs) => {
      expect(cs.display).toBe('flex');
      expect(cs.flexDirection).toBe('row');
      expect(cs.gap).toBe('12px'); // component inline default, not DS token
    });
  });

  it('Loader md=22px, color=primary', () => {
    anchor('light', <Loader size="md" />, '[data-civitai-ui="loader"]', (cs) => {
      expect(cs.width).toBe('22px');
      expect(cs.height).toBe('22px');
      expect(cs.color).toBe(solid(tokens.colorPrimary));
    });
  });
});

// ===========================================================================
// INTERACTIVE-5 — kept in blocks-react, repointed onto --civitai-* tokens
// ===========================================================================

describe('parity — Modal (interactive-5; repointed)', () => {
  it('light: bg=surface, border=colorBorder, radius=4px [approved delta] — proves --civitai-radius repoint', () => {
    anchor(
      'light',
      <Modal opened onClose={() => {}} title="t">body</Modal>,
      '[data-civitai-ui="modal"]',
      (cs) => {
        expect(cs.backgroundColor).toBe(solid(tokens.colorSurface));
        expect(cs.borderTopColor).toBe(solid(tokens.colorBorder));
        // If the rule still read the now-undefined --ci-radius this would be 0px.
        expect(cs.borderTopLeftRadius).toBe('4px');
      }
    );
  });

  it('dark: bg=dark surface (theme-tracked)', () => {
    anchor(
      'dark',
      <Modal opened onClose={() => {}} title="t">body</Modal>,
      '[data-civitai-ui="modal"]',
      (cs) => {
        expect(cs.backgroundColor).toBe(solid(darkTokens.colorSurface));
        expect(cs.backgroundColor).not.toBe(solid(tokens.colorSurface));
      }
    );
  });
});

describe('parity — Slider (interactive-5; repointed)', () => {
  it('light: range accent-color=primary token — proves --civitai-color-primary repoint', () => {
    anchor(
      'light',
      <Slider value={5} onChange={() => {}} label="w" />,
      '[data-civitai-ui-range]',
      (cs) => {
        // accentColor serializes to the token color; if it still read --ci-color-primary
        // (undefined) it would be `auto`.
        expect(cs.accentColor).toBe(solid(tokens.colorPrimary));
      }
    );
  });
});

describe('parity — Collapse (interactive-5; repointed)', () => {
  it('light: trigger color=text token, font-family=font token', () => {
    anchor(
      'light',
      <Collapse open onOpenChange={() => {}} title="more">body</Collapse>,
      '[data-civitai-ui-collapse-trigger]',
      (cs) => {
        expect(cs.color).toBe(solid(tokens.colorText));
        // font-family resolves from --civitai-font; non-empty proves the repoint.
        expect(cs.fontFamily.length).toBeGreaterThan(0);
        expect(cs.fontFamily).toContain('-apple-system');
      }
    );
  });
});

describe('parity — SegmentedControl (interactive-5; repointed)', () => {
  const ITEMS = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ];

  it('light: track bg=surface-2=#fefefe [approved delta from #f4f4f5], radius=4px, border=colorBorder', () => {
    anchor(
      'light',
      <SegmentedControl value="a" onChange={() => {}} data={ITEMS} />,
      '[data-civitai-ui="segmented-control"]',
      (cs) => {
        expect(cs.backgroundColor).toBe(solid(tokens.colorSurface2)); // #fefefe [approved delta]
        expect(cs.borderTopColor).toBe(solid(tokens.colorBorder));
        expect(cs.borderTopLeftRadius).toBe('4px'); // --civitai-radius [approved delta]
      }
    );
  });

  it('light: active segment color=primary token', () => {
    anchor(
      'light',
      <SegmentedControl value="a" onChange={() => {}} data={ITEMS} />,
      '[data-civitai-ui-segment][data-active]',
      (cs) => {
        expect(cs.color).toBe(solid(tokens.colorPrimary));
      }
    );
  });

  it('dark: track bg=dark surface-2=#25262B (theme-tracked)', () => {
    anchor(
      'dark',
      <SegmentedControl value="a" onChange={() => {}} data={ITEMS} />,
      '[data-civitai-ui="segmented-control"]',
      (cs) => {
        expect(cs.backgroundColor).toBe(solid(darkTokens.colorSurface2));
        expect(cs.backgroundColor).not.toBe(solid(tokens.colorSurface2));
      }
    );
  });
});

describe('parity — Select wrapper (interactive-5) + delegated -control', () => {
  it('light: wrapper is flex column; control border=colorBorder, radius=4px', () => {
    anchor(
      'light',
      <Select value="a" onChange={() => {}} label="s" options={[{ value: 'a', label: 'A' }]} />,
      '[data-civitai-ui="select"]',
      (cs) => {
        expect(cs.display).toBe('flex');
        expect(cs.flexDirection).toBe('column');
      }
    );
    anchor(
      'light',
      <Select value="a" onChange={() => {}} label="s" options={[{ value: 'a', label: 'A' }]} />,
      '[data-civitai-ui-control]',
      (cs) => {
        expect(cs.borderTopColor).toBe(solid(tokens.colorBorder));
        expect(cs.borderTopLeftRadius).toBe('4px');
      }
    );
  });
});

// ===========================================================================
// STRUCTURAL — the interactive-5 <style> reads --civitai-*, never --ci-*
// ===========================================================================

describe('interactive-5 stylesheet reads --civitai-* not --ci-*', () => {
  it('the data-civitai-blocks-ui <style> uses only --civitai-* tokens', () => {
    const css = document.querySelector('style[data-civitai-blocks-ui]')?.textContent ?? '';
    expect(css.length).toBeGreaterThan(0);
    // standalone --ci-<word> form (note: --civitai- itself contains "--ci").
    expect(css).not.toMatch(/--ci-[a-z]/);
    expect(css).toContain('--civitai-radius');
    expect(css).toContain('--civitai-color-surface-2');
  });
});
