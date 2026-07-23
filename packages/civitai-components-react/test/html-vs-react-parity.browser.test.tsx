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
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Radio,
  Select,
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

  // issue #181 F8: the dark theme now emits --civitai-color-primary-fg for
  // symmetry. A filled button consumes it as its text color in dark — this
  // anchors that the dark token resolves (white) rather than inheriting nothing.
  it('filled dark: fg consumes dark --civitai-color-primary-fg (white)', () => {
    both(
      pair(
        'dark',
        <Button variant="filled" size="md">Go</Button>,
        `<button data-civitai-ui="button" data-variant="filled" data-size="md" type="button">Go</button>`,
        '[data-civitai-ui="button"]'
      ),
      (cs, who) => {
        expect(cs.color, who).toBe(solid(darkTokens.colorPrimaryFg));
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

// ---------------------------------------------------------------------------
// Badge `data-color` intent anchors (issue #181 F2 — parity with Alert).
// Each intent recolors filled + light variants from the SAME token the probe
// oracle evaluates, on BOTH the React (`<Badge color=…>`) and hand-HTML
// (`data-color=…`) consumers, in light + dark where the token differs.
// ---------------------------------------------------------------------------
describe('styling anchors — Badge data-color (issue #181 F2)', () => {
  const COLORS = [
    { name: 'info', light: tokens.colorInfo, dark: darkTokens.colorInfo },
    { name: 'success', light: tokens.colorSuccess, dark: darkTokens.colorSuccess },
    { name: 'warning', light: tokens.colorWarning, dark: darkTokens.colorWarning },
    { name: 'error', light: tokens.colorError, dark: darkTokens.colorError },
  ] as const;

  for (const { name, light, dark } of COLORS) {
    it(`filled ${name} light: bg+border=${name} token, fg stays primaryFg (white)`, () => {
      both(
        pair(
          'light',
          <Badge color={name} variant="filled" size="md">
            x
          </Badge>,
          `<span data-civitai-ui="badge" data-color="${name}" data-variant="filled" data-size="md">x</span>`,
          '[data-civitai-ui="badge"]'
        ),
        (cs, who) => {
          expect(cs.backgroundColor, `${who} ${name}`).toBe(solid(light));
          expect(cs.borderTopColor, `${who} ${name}`).toBe(solid(light));
          expect(cs.color, `${who} ${name}`).toBe(solid(tokens.colorPrimaryFg));
          // Actually recolored — not the default primary accent. (`info` maps to
          // the same blue as primary, so the recolor is a no-op there; guard
          // only where the intent token genuinely differs from primary.)
          if (light !== tokens.colorPrimary) {
            expect(cs.backgroundColor, `${who} ${name}`).not.toBe(solid(tokens.colorPrimary));
          }
        }
      );
    });

    it(`light-variant ${name} light: bg=mix(${name} 14%), text=${name} token`, () => {
      both(
        pair(
          'light',
          <Badge color={name} variant="light" size="md">
            x
          </Badge>,
          `<span data-civitai-ui="badge" data-color="${name}" data-variant="light" data-size="md">x</span>`,
          '[data-civitai-ui="badge"]'
        ),
        (cs, who) => {
          expect(cs.backgroundColor, `${who} ${name}`).toBe(mix(light, '14%'));
          expect(cs.color, `${who} ${name}`).toBe(solid(light));
        }
      );
    });

    it(`filled ${name} dark: bg+border=dark ${name} token (theme-tracked)`, () => {
      both(
        pair(
          'dark',
          <Badge color={name} variant="filled" size="md">
            x
          </Badge>,
          `<span data-civitai-ui="badge" data-color="${name}" data-variant="filled" data-size="md">x</span>`,
          '[data-civitai-ui="badge"]'
        ),
        (cs, who) => {
          expect(cs.backgroundColor, `${who} ${name}`).toBe(solid(dark));
          expect(cs.borderTopColor, `${who} ${name}`).toBe(solid(dark));
          // Theme actually switched (dark token differs from light).
          expect(cs.backgroundColor, `${who} ${name}`).not.toBe(solid(light));
        }
      );
    });
  }

  it('DEFAULT badge (no data-color) still renders the primary accent — non-regression', () => {
    both(
      pair(
        'light',
        <Badge variant="filled" size="md">
          x
        </Badge>,
        `<span data-civitai-ui="badge" data-variant="filled" data-size="md">x</span>`,
        '[data-civitai-ui="badge"]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(solid(tokens.colorPrimary));
        expect(cs.color, who).toBe(solid(tokens.colorPrimaryFg));
      }
    );
    // And the React binding omits the attribute entirely when `color` is unset.
    const r = mountReact(
      'light',
      <Badge variant="filled" size="md">
        x
      </Badge>
    );
    try {
      const el = r.mount.querySelector('[data-civitai-ui="badge"]')!;
      expect(el.hasAttribute('data-color'), 'no color prop => no data-color attribute').toBe(false);
    } finally {
      r.cleanup();
    }
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

  // -------------------------------------------------------------------------
  // issue #181 F5 — default light-mode hairline. In light, surface == body, so
  // a BORDERLESS card was invisible; it now carries a subtle default border
  // (a low-alpha mix of the border token). `data-with-border` stays the
  // stronger, fully-opaque border. Dark is visually unchanged (no hairline on
  // a borderless card). Anchored on BOTH consumers (React `withBorder={false}`
  // and hand-HTML without `data-with-border`).
  // -------------------------------------------------------------------------
  describe('styling anchors — Card default hairline (issue #181 F5)', () => {
    const HAIRLINE = mix(tokens.colorBorder, '55%');

    it('borderless light: visible hairline = mix(border 55%), width 1px', () => {
      both(
        pair(
          'light',
          <Card withBorder={false} padding="sm">x</Card>,
          `<div data-civitai-ui="card" data-padding="sm">x</div>`,
          '[data-civitai-ui="card"]'
        ),
        (cs, who) => {
          expect(cs.borderTopStyle, who).toBe('solid');
          expect(cs.borderTopWidth, who).toBe('1px');
          expect(cs.borderTopColor, who).toBe(HAIRLINE);
          // Actually visible: not transparent, and NOT the strong border token.
          expect(cs.borderTopColor, who).not.toBe('rgba(0, 0, 0, 0)');
          expect(cs.borderTopColor, who).not.toBe(solid(tokens.colorBorder));
        }
      );
    });

    it('with-border light stays STRONGER: full opaque border token (not the hairline)', () => {
      both(
        pair(
          'light',
          <Card withBorder padding="sm">x</Card>,
          `<div data-civitai-ui="card" data-with-border="true" data-padding="sm">x</div>`,
          '[data-civitai-ui="card"]'
        ),
        (cs, who) => {
          expect(cs.borderTopColor, who).toBe(solid(tokens.colorBorder));
          expect(cs.borderTopColor, who).not.toBe(HAIRLINE);
        }
      );
    });

    it('borderless dark: UNCHANGED — no visible border (hairline removed)', () => {
      both(
        pair(
          'dark',
          <Card withBorder={false} padding="sm">x</Card>,
          `<div data-civitai-ui="card" data-padding="sm">x</div>`,
          '[data-civitai-ui="card"]'
        ),
        (cs, who) => {
          expect(cs.borderTopColor, who).toBe('rgba(0, 0, 0, 0)');
        }
      );
    });

    it('with-border dark still renders the dark border token', () => {
      both(
        pair(
          'dark',
          <Card withBorder padding="sm">x</Card>,
          `<div data-civitai-ui="card" data-with-border="true" data-padding="sm">x</div>`,
          '[data-civitai-ui="card"]'
        ),
        (cs, who) => {
          expect(cs.borderTopColor, who).toBe(solid(darkTokens.colorBorder));
        }
      );
    });
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

// ---------------------------------------------------------------------------
// issue #181 F6 — Select / Checkbox / Radio. Token-derived anchors on BOTH the
// React binding and hand-HTML (per MARKUP.md), in light AND dark, plus the
// checked/unchecked + disabled states. Select reuses the shared `-control`
// field chrome (bg/border/radius from tokens); checkbox/radio carry the theme
// tint via `accent-color` = --civitai-color-primary + custom 16px sizing.
// ---------------------------------------------------------------------------
describe('styling anchors — Select (issue #181 F6)', () => {
  const SEL_HTML = (id: string, extra = '') =>
    `<div data-civitai-ui="select"${extra}><label data-civitai-ui-label for="${id}">M</label><select data-civitai-ui-control id="${id}"><option value="a">A</option></select></div>`;

  it('light: bg=surface, border=colorBorder, radius=4px(token), caret room padding-right=28px', () => {
    both(
      pair(
        'light',
        <Select label="M" id="s1"><option value="a">A</option></Select>,
        SEL_HTML('s1'),
        '[data-civitai-ui-control]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(solid(tokens.colorSurface));
        expect(cs.borderTopColor, who).toBe(solid(tokens.colorBorder));
        expect(cs.borderTopLeftRadius, who).toBe('4px');
        expect(cs.paddingRight, who).toBe('28px');
        expect(cs.cursor, who).toBe('pointer');
      }
    );
  });

  it('dark: bg=dark surface, border=dark border (theme-tracked)', () => {
    both(
      pair(
        'dark',
        <Select label="M" id="s2"><option value="a">A</option></Select>,
        SEL_HTML('s2'),
        '[data-civitai-ui-control]'
      ),
      (cs, who) => {
        expect(cs.backgroundColor, who).toBe(solid(darkTokens.colorSurface));
        expect(cs.borderTopColor, who).toBe(solid(darkTokens.colorBorder));
        expect(cs.backgroundColor, who).not.toBe(solid(tokens.colorSurface));
      }
    );
  });

  it('invalid (data-invalid/aria-invalid): border=error', () => {
    both(
      pair(
        'light',
        <Select label="M" error="Required" id="s3"><option value="a">A</option></Select>,
        `<div data-civitai-ui="select" data-invalid="true"><label data-civitai-ui-label for="s3">M</label><select data-civitai-ui-control id="s3" aria-invalid="true" aria-describedby="s3-err"><option value="a">A</option></select><span id="s3-err" data-civitai-ui-error role="alert">Required</span></div>`,
        '[data-civitai-ui-control]'
      ),
      (cs, who) => {
        expect(cs.borderTopColor, who).toBe(solid(tokens.colorError));
        expect(cs.borderTopColor, who).not.toBe(solid(tokens.colorBorder));
      }
    );
  });
});

describe('styling anchors — Checkbox / Radio (issue #181 F6)', () => {
  const CB_HTML = (id: string, attrs = '') =>
    `<div data-civitai-ui="checkbox"><div data-civitai-ui-choice><input type="checkbox" id="${id}"${attrs} /><label data-civitai-ui-label for="${id}">L</label></div></div>`;
  const RD_HTML = (id: string) =>
    `<div data-civitai-ui="radio"><div data-civitai-ui-choice><input type="radio" id="${id}" /><label data-civitai-ui-label for="${id}">L</label></div></div>`;

  it('checkbox light: accent-color=primary token, 16×16 custom size, pointer', () => {
    both(
      pair('light', <Checkbox label="L" id="c1" />, CB_HTML('c1'), 'input[type="checkbox"]'),
      (cs, who) => {
        expect(cs.accentColor, who).toBe(solid(tokens.colorPrimary));
        expect(cs.width, who).toBe('16px');
        expect(cs.height, who).toBe('16px');
        expect(cs.cursor, who).toBe('pointer');
      }
    );
  });

  it('checkbox dark: accent-color=dark primary (theme actually switched)', () => {
    both(
      pair('dark', <Checkbox label="L" id="c2" />, CB_HTML('c2'), 'input[type="checkbox"]'),
      (cs, who) => {
        expect(cs.accentColor, who).toBe(solid(darkTokens.colorPrimary));
        expect(cs.accentColor, who).not.toBe(solid(tokens.colorPrimary));
      }
    );
  });

  it('checkbox CHECKED still carries the primary accent (unchecked ≡ checked tint)', () => {
    both(
      pair(
        'light',
        <Checkbox label="L" id="c3" defaultChecked />,
        CB_HTML('c3', ' checked'),
        'input[type="checkbox"]'
      ),
      (cs, who) => {
        expect(cs.accentColor, who).toBe(solid(tokens.colorPrimary));
      }
    );
    // The checked state is really applied (native property), both consumers.
    const r = mountReact('light', <Checkbox label="L" id="c3r" defaultChecked />);
    const h = mountHtml('light', CB_HTML('c3h', ' checked'));
    try {
      expect((r.mount.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
      expect((h.mount.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    } finally {
      r.cleanup();
      h.cleanup();
    }
  });

  it('checkbox DISABLED: opacity 0.6 + not-allowed cursor', () => {
    both(
      pair(
        'light',
        <Checkbox label="L" id="c4" disabled />,
        CB_HTML('c4', ' disabled'),
        'input[type="checkbox"]'
      ),
      (cs, who) => {
        expect(cs.opacity, who).toBe('0.6');
        expect(cs.cursor, who).toBe('not-allowed');
      }
    );
  });

  it('radio light: accent-color=primary token, 16×16', () => {
    both(
      pair('light', <Radio label="L" id="r1" />, RD_HTML('r1'), 'input[type="radio"]'),
      (cs, who) => {
        expect(cs.accentColor, who).toBe(solid(tokens.colorPrimary));
        expect(cs.width, who).toBe('16px');
        expect(cs.height, who).toBe('16px');
      }
    );
  });

  it('radio dark: accent-color=dark primary (theme-tracked)', () => {
    both(
      pair('dark', <Radio label="L" id="r2" />, RD_HTML('r2'), 'input[type="radio"]'),
      (cs, who) => {
        expect(cs.accentColor, who).toBe(solid(darkTokens.colorPrimary));
        expect(cs.accentColor, who).not.toBe(solid(tokens.colorPrimary));
      }
    );
  });
});
