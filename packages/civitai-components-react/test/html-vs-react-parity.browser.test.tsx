/**
 * HEADLINE TEST — dual-consumption.
 *
 * Two independent claims, proven by two blocks:
 *
 *  1. CONSUMER-EQUIVALENCE (the `computed-style parity` block): for every
 *     component/variant/size, the `@civitai/components-react` render and
 *     hand-written plain HTML with the same `data-*` contract produce IDENTICAL
 *     key computed styles in both themes. This proves React ≡ HTML *as
 *     consumers of the same stylesheet* — but on its own it is NOT proof the
 *     design-system CSS is doing anything: if no stylesheet were applied, both
 *     paths would fall back to identical UA defaults and still match.
 *
 *  2. STYLING-CORRECTNESS (the `styling anchors` block): absolute assertions
 *     that specific computed values equal the DERIVED TOKENS / design-system
 *     scale — values that can only come from the `@civitai/components` +
 *     `@civitai/theme` CSS, never from UA defaults. EVERY one of the 10
 *     components carries ≥1 anchor, on BOTH the React and the HTML render, in
 *     light AND dark where the value is theme-dependent. Neuter `injectStyles()`
 *     and these anchors FAIL (verified), even though the pure equality
 *     assertions still pass.
 *
 * Color anchors use a browser PROBE oracle: the same color expression is
 * evaluated from the LITERAL token hex (from `@civitai/theme`'s `tokens` export,
 * NOT via the stylesheet var), so the expectation (a) is external to the
 * component CSS (meaningless-proof — the probe resolves even when the stylesheet
 * is absent), (b) tracks the theme (we feed `tokens` vs `darkTokens`), and
 * (c) is serialization-robust (the browser serializes probe + component
 * identically, incl. `color-mix()` results).
 */
import { darkTokens, tokens } from '@civitai/theme';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  NumberInput,
  Stack,
  Textarea,
  TextInput,
} from '../src/index.js';
import { CASES } from './fixtures.js';
import { ensureStyles, mountHtml, mountReact } from './render.js';

const THEMES = ['light', 'dark'] as const;

beforeAll(() => {
  ensureStyles();
});

for (const theme of THEMES) {
  describe(`computed-style parity — [data-theme='${theme}']`, () => {
    for (const c of CASES) {
      it(c.id, () => {
        const react = mountReact(theme, c.node);
        const html = mountHtml(theme, c.html);
        try {
          const rEl = react.mount.querySelector(c.selector);
          const hEl = html.mount.querySelector(c.selector);
          expect(rEl, `react: no element for ${c.selector}`).toBeTruthy();
          expect(hEl, `html: no element for ${c.selector}`).toBeTruthy();

          const rCs = getComputedStyle(rEl!);
          const hCs = getComputedStyle(hEl!);

          const diffs: string[] = [];
          for (const prop of c.compare) {
            const rv = (rCs as unknown as Record<string, string>)[prop];
            const hv = (hCs as unknown as Record<string, string>)[prop];
            // Both must be a real resolved value (guards a typo'd property name
            // that would make both `undefined` and vacuously "match").
            expect(rv, `computed ${prop} missing on react element`).toBeTruthy();
            if (rv !== hv) diffs.push(`  ${prop}: react=${JSON.stringify(rv)} html=${JSON.stringify(hv)}`);
          }
          expect(diffs, `[${theme}] ${c.id} — React and HTML diverge:\n${diffs.join('\n')}`).toEqual([]);
        } finally {
          react.cleanup();
          html.cleanup();
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// STYLING-CORRECTNESS ANCHORS (all 10 components; token-derived; UA-default-proof)
// ---------------------------------------------------------------------------

/**
 * Canonical browser serialization of a `<color>` expression, evaluated from a
 * LITERAL hex (external oracle). `color-mix(...)` supported. Returns e.g.
 * `rgb(34, 139, 230)` / `rgba(250, 82, 82, 0.12)`.
 */
function probeColor(colorExpr: string): string {
  const el = document.createElement('div');
  el.style.color = colorExpr;
  document.body.appendChild(el);
  const v = getComputedStyle(el).color;
  el.remove();
  return v;
}

/** Solid token color -> its canonical serialization. */
const solid = (hex: string): string => probeColor(hex);
/** `color-mix(in srgb, <hex> <pct>, transparent)` -> its canonical serialization. */
const mix = (hex: string, pct: string): string =>
  probeColor(`color-mix(in srgb, ${hex} ${pct}, transparent)`);

interface Pair {
  react: CSSStyleDeclaration;
  html: CSSStyleDeclaration;
  cleanup: () => void;
}

/** Render node (React) + html (plain) under `[data-theme]` and expose both computed styles. */
function pair(theme: string, node: React.ReactElement, html: string, selector: string): Pair {
  const r = mountReact(theme, node);
  const h = mountHtml(theme, html);
  const rEl = r.mount.querySelector(selector);
  const hEl = h.mount.querySelector(selector);
  expect(rEl, `react: no element for ${selector}`).toBeTruthy();
  expect(hEl, `html: no element for ${selector}`).toBeTruthy();
  return {
    react: getComputedStyle(rEl!),
    html: getComputedStyle(hEl!),
    cleanup: () => {
      r.cleanup();
      h.cleanup();
    },
  };
}

/** Run `assert(cs, consumer)` against BOTH the React and the HTML computed styles. */
function both(p: Pair, assert: (cs: CSSStyleDeclaration, consumer: string) => void): void {
  try {
    assert(p.react, 'react');
    assert(p.html, 'html');
  } finally {
    p.cleanup();
  }
}

describe('styling anchors — Button', () => {
  it('filled light: bg=primary, fg=primaryFg, radius=4px(token), md height=36px, padding-x=18px', () => {
    both(
      pair(
        'light',
        <Button variant="filled" size="md">Go</Button>,
        `<button data-civitai-ui="button" data-variant="filled" data-size="md" type="button">Go</button>`,
        '[data-civitai-ui="button"]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(solid(tokens.colorPrimary)); // rgb(34,139,230)
        expect(cs.color, who).toBe(solid(tokens.colorPrimaryFg));
        expect(cs.borderTopLeftRadius, who).toBe('4px'); // --civitai-radius = 0.25rem
        expect(cs.height, who).toBe('36px');
        expect(cs.paddingLeft, who).toBe('18px');
        expect(cs.backgroundColor, who).not.toBe(solid(tokens.colorSurface)); // not a UA button bg
      }
    );
  });

  it('filled dark: bg=dark primary shade (#1971C2)', () => {
    both(
      pair(
        'dark',
        <Button variant="filled" size="md">Go</Button>,
        `<button data-civitai-ui="button" data-variant="filled" data-size="md" type="button">Go</button>`,
        '[data-civitai-ui="button"]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(solid(darkTokens.colorPrimary));
        expect(cs.backgroundColor, who).not.toBe(solid(tokens.colorPrimary)); // theme actually switched
      }
    );
  });

  it('outline light: text+border=primary, bg transparent', () => {
    both(
      pair(
        'light',
        <Button variant="outline" size="md">Go</Button>,
        `<button data-civitai-ui="button" data-variant="outline" data-size="md" type="button">Go</button>`,
        '[data-civitai-ui="button"]'
      ),
      (cs, who) => {
        expect(cs.color, who).toBe(solid(tokens.colorPrimary));
        expect(cs.borderTopColor, who).toBe(solid(tokens.colorPrimary));
        expect(cs.backgroundColor, who).toBe('rgba(0, 0, 0, 0)');
      }
    );
  });

  it('subtle light: text=primary, sm height=30px / lg height=44px', () => {
    both(
      pair(
        'light',
        <Button variant="subtle" size="sm">Go</Button>,
        `<button data-civitai-ui="button" data-variant="subtle" data-size="sm" type="button">Go</button>`,
        '[data-civitai-ui="button"]'
      ),
      (cs, who) => {
        expect(cs.color, who).toBe(solid(tokens.colorPrimary));
        expect(cs.height, who).toBe('30px');
      }
    );
    both(
      pair(
        'light',
        <Button variant="filled" size="lg">Go</Button>,
        `<button data-civitai-ui="button" data-variant="filled" data-size="lg" type="button">Go</button>`,
        '[data-civitai-ui="button"]'
      ),
      (cs, who) => expect(cs.height, who).toBe('44px')
    );
  });
});

describe('styling anchors — Badge', () => {
  it('filled light: bg=primary, pill radius=999px', () => {
    both(
      pair(
        'light',
        <Badge variant="filled" size="md">new</Badge>,
        `<span data-civitai-ui="badge" data-variant="filled" data-size="md">new</span>`,
        '[data-civitai-ui="badge"]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(solid(tokens.colorPrimary));
        expect(cs.borderTopLeftRadius, who).toBe('999px'); // pill token
      }
    );
  });

  it('filled dark: bg=dark primary', () => {
    both(
      pair(
        'dark',
        <Badge variant="filled" size="md">new</Badge>,
        `<span data-civitai-ui="badge" data-variant="filled" data-size="md">new</span>`,
        '[data-civitai-ui="badge"]'
      ),
      (cs, who) => expect(cs.backgroundColor, who).toBe(solid(darkTokens.colorPrimary))
    );
  });

  it('light variant: bg=color-mix(primary 14%), text=primary', () => {
    both(
      pair(
        'light',
        <Badge variant="light" size="md">new</Badge>,
        `<span data-civitai-ui="badge" data-variant="light" data-size="md">new</span>`,
        '[data-civitai-ui="badge"]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(mix(tokens.colorPrimary, '14%'));
        expect(cs.color, who).toBe(solid(tokens.colorPrimary));
      }
    );
  });
});

describe('styling anchors — Alert', () => {
  it('error light: bg=mix(error 12%), border=mix(error 35%)', () => {
    both(
      pair(
        'light',
        <Alert color="error" title="t">b</Alert>,
        `<div data-civitai-ui="alert" data-color="error" role="alert"><div data-civitai-ui-alert-body>b</div></div>`,
        '[data-civitai-ui="alert"]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(mix(tokens.colorError, '12%'));
        expect(cs.borderTopColor, who).toBe(mix(tokens.colorError, '35%'));
      }
    );
  });

  it('error dark: border=mix(dark error 35%)', () => {
    both(
      pair(
        'dark',
        <Alert color="error" title="t">b</Alert>,
        `<div data-civitai-ui="alert" data-color="error" role="alert"><div data-civitai-ui-alert-body>b</div></div>`,
        '[data-civitai-ui="alert"]'
      ),
      (cs, who) => {
        expect(cs.borderTopColor, who).toBe(mix(darkTokens.colorError, '35%'));
        expect(cs.borderTopColor, who).not.toBe(mix(tokens.colorError, '35%'));
      }
    );
  });

  it('success light: bg=mix(success 12%), border=mix(success 35%)', () => {
    both(
      pair(
        'light',
        <Alert color="success" title="t">b</Alert>,
        `<div data-civitai-ui="alert" data-color="success" role="alert"><div data-civitai-ui-alert-body>b</div></div>`,
        '[data-civitai-ui="alert"]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(mix(tokens.colorSuccess, '12%'));
        expect(cs.borderTopColor, who).toBe(mix(tokens.colorSuccess, '35%'));
      }
    );
  });
});

describe('styling anchors — inputs (TextInput / NumberInput / Textarea)', () => {
  it('TextInput light: bg=surface, border=colorBorder, radius=4px(token)', () => {
    both(
      pair(
        'light',
        <TextInput label="N" id="a1" />,
        `<div data-civitai-ui="text-input"><label data-civitai-ui-label for="a1">N</label><input data-civitai-ui-control id="a1" /></div>`,
        '[data-civitai-ui-control]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(solid(tokens.colorSurface));
        expect(cs.borderTopColor, who).toBe(solid(tokens.colorBorder));
        expect(cs.borderTopLeftRadius, who).toBe('4px');
      }
    );
  });

  it('TextInput dark: bg=dark surface, border=dark border', () => {
    both(
      pair(
        'dark',
        <TextInput label="N" id="a2" />,
        `<div data-civitai-ui="text-input"><label data-civitai-ui-label for="a2">N</label><input data-civitai-ui-control id="a2" /></div>`,
        '[data-civitai-ui-control]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(solid(darkTokens.colorSurface));
        expect(cs.borderTopColor, who).toBe(solid(darkTokens.colorBorder));
      }
    );
  });

  it('TextInput invalid (data-invalid/aria-invalid): border=error', () => {
    both(
      pair(
        'light',
        <TextInput label="N" error="Required" id="a3" />,
        `<div data-civitai-ui="text-input" data-invalid="true"><label data-civitai-ui-label for="a3">N</label><input data-civitai-ui-control id="a3" aria-invalid="true" aria-describedby="a3-err" /><span id="a3-err" data-civitai-ui-error role="alert">Required</span></div>`,
        '[data-civitai-ui-control]'
      ),
      (cs, who) => {
        expect(cs.borderTopColor, who).toBe(solid(tokens.colorError));
        expect(cs.borderTopColor, who).not.toBe(solid(tokens.colorBorder)); // invalid state actually applied
      }
    );
  });

  it('NumberInput light: border=colorBorder', () => {
    both(
      pair(
        'light',
        <NumberInput label="S" id="a4" />,
        `<div data-civitai-ui="number-input"><label data-civitai-ui-label for="a4">S</label><input type="number" data-civitai-ui-control id="a4" /></div>`,
        '[data-civitai-ui-control]'
      ),
      (cs, who) => expect(cs.borderTopColor, who).toBe(solid(tokens.colorBorder))
    );
  });

  it('Textarea light: bg=surface, border=colorBorder', () => {
    both(
      pair(
        'light',
        <Textarea label="P" id="a5" />,
        `<div data-civitai-ui="textarea"><label data-civitai-ui-label for="a5">P</label><textarea data-civitai-ui-control id="a5"></textarea></div>`,
        '[data-civitai-ui-control]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(solid(tokens.colorSurface));
        expect(cs.borderTopColor, who).toBe(solid(tokens.colorBorder));
      }
    );
  });
});

describe('styling anchors — Card', () => {
  it('light: bg=surface, border=colorBorder, radius=4px(token), padding md=16px', () => {
    both(
      pair(
        'light',
        <Card withBorder padding="md">x</Card>,
        `<div data-civitai-ui="card" data-with-border="true" data-padding="md">x</div>`,
        '[data-civitai-ui="card"]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(solid(tokens.colorSurface));
        expect(cs.borderTopColor, who).toBe(solid(tokens.colorBorder));
        expect(cs.borderTopLeftRadius, who).toBe('4px');
        expect(cs.paddingTop, who).toBe('16px');
      }
    );
  });

  it('dark: bg=dark surface (differs from light)', () => {
    const cardHtml = `<div data-civitai-ui="card" data-with-border="true" data-padding="md">x</div>`;
    both(
      pair('dark', <Card withBorder padding="md">x</Card>, cardHtml, '[data-civitai-ui="card"]'),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(solid(darkTokens.colorSurface));
        expect(cs.backgroundColor, who).not.toBe(solid(tokens.colorSurface));
      }
    );
  });
});

describe('styling anchors — Stack / Group / Loader', () => {
  it('Stack: default gap=12px, gap="lg"=24px', () => {
    both(
      pair(
        'light',
        <Stack>
          <span>a</span>
        </Stack>,
        `<div data-civitai-ui="stack"><span>a</span></div>`,
        '[data-civitai-ui="stack"]'
      ),
      (cs, who) => expect(cs.gap, who).toBe('12px')
    );
    both(
      pair(
        'light',
        <Stack gap="lg">
          <span>a</span>
        </Stack>,
        `<div data-civitai-ui="stack" data-gap="lg"><span>a</span></div>`,
        '[data-civitai-ui="stack"]'
      ),
      (cs, who) => expect(cs.gap, who).toBe('24px')
    );
  });

  it('Group: default gap=8px, flex-direction=row', () => {
    both(
      pair(
        'light',
        <Group>
          <span>a</span>
        </Group>,
        `<div data-civitai-ui="group"><span>a</span></div>`,
        '[data-civitai-ui="group"]'
      ),
      (cs, who) => {
        expect(cs.gap, who).toBe('8px');
        expect(cs.flexDirection, who).toBe('row');
      }
    );
  });

  it('Loader: md size=22px×22px, color=primary', () => {
    both(
      pair(
        'light',
        <Loader size="md" />,
        `<span data-civitai-ui="loader" data-size="md"></span>`,
        '[data-civitai-ui="loader"]'
      ),
      (cs, who) => {
        expect(cs.width, who).toBe('22px');
        expect(cs.height, who).toBe('22px');
        expect(cs.color, who).toBe(solid(tokens.colorPrimary));
      }
    );
  });
});
