/**
 * PURE (no fs) so the build writer and the guard tests read one source of
 * truth, the way `@civitai/theme`'s TOKEN_SPEC does.
 */

export interface Utility {
  /** The class, without the `ci-` prefix the generator adds. */
  name: string;
  decls: readonly string[];
  /**
   * Bootstrap classes this stands in for. `{bp}` marks where Bootstrap puts the
   * breakpoint — `col-{bp}-6`, `row-cols-{bp}-3`, `d-{bp}-flex` — which is not
   * the same segment in every family, so it is declared rather than inferred.
   */
  bootstrap?: readonly string[];
  /** Also emit `ci-<bp>-<name>` for every breakpoint. */
  responsive?: boolean;
}

/**
 * Spacing is the one scale `@civitai/theme` does not carry, because Mantine
 * expresses it per component rather than as a ramp. Indices 0-6 rather than
 * Bootstrap's 0-5: 12px is the gap that markup reaches for and Bootstrap skips.
 */
export const SPACE = ['0', '4px', '8px', '12px', '16px', '24px', '48px'] as const;

/** Bootstrap's 0-5 onto ours, so the transitional sheet keeps its own metrics. */
const BS_SPACE: Record<string, number> = { '0': 0, '1': 1, '2': 2, '3': 4, '4': 5, '5': 6 };

const SIDES = [
  { key: '', props: [''], bs: '' },
  { key: 't', props: ['-block-start'], bs: 't' },
  { key: 'b', props: ['-block-end'], bs: 'b' },
  { key: 's', props: ['-inline-start'], bs: 's' },
  { key: 'e', props: ['-inline-end'], bs: 'e' },
  { key: 'x', props: ['-inline'], bs: 'x' },
  { key: 'y', props: ['-block'], bs: 'y' },
] as const;

function spacing(): Utility[] {
  const out: Utility[] = [];
  for (const kind of ['m', 'p'] as const) {
    const property = kind === 'm' ? 'margin' : 'padding';
    for (const side of SIDES) {
      for (let step = 0; step < SPACE.length; step += 1) {
        const bsStep = Object.entries(BS_SPACE).find(([, ours]) => ours === step)?.[0];
        out.push({
          name: `${kind}${side.key}-${step}`,
          decls: side.props.map((p) => `${property}${p}: var(--civitai-space-${step})`),
          bootstrap: bsStep === undefined ? [] : [`${kind}${side.bs}-${bsStep}`],
        });
      }
      // `auto` only makes sense on margin, where it is how a row pushes apart.
      if (kind === 'm') {
        out.push({
          name: `m${side.key}-auto`,
          decls: side.props.map((p) => `margin${p}: auto`),
          bootstrap: [`m${side.bs}-auto`],
        });
      }
    }
  }
  for (let step = 0; step < SPACE.length; step += 1) {
    const bsStep = Object.entries(BS_SPACE).find(([, ours]) => ours === step)?.[0];
    out.push({
      name: `gap-${step}`,
      decls: [`gap: var(--civitai-space-${step})`],
      bootstrap: bsStep === undefined ? [] : [`gap-${bsStep}`, `g-${bsStep}`],
    });
  }
  return out;
}

const COLUMNS = 12;

function grid(): Utility[] {
  const out: Utility[] = [
    { name: 'row', decls: [`display: grid`, `grid-template-columns: repeat(${COLUMNS}, 1fr)`, 'gap: var(--civitai-space-3)'], bootstrap: ['row'] },
  ];
  for (let span = 1; span <= COLUMNS; span += 1) {
    out.push({
      name: `col-${span}`,
      decls: [`grid-column: span ${span} / span ${span}`],
      bootstrap: [`col-{bp}-${span}`],
      responsive: true,
    });
  }
  out.push(
    { name: 'col', decls: ['grid-column: span 1 / span 1', 'min-width: 0'], bootstrap: ['col-{bp}'], responsive: true },
    { name: 'col-auto', decls: ['grid-column: auto', 'min-width: 0'], bootstrap: ['col-{bp}-auto'], responsive: true },
    { name: 'col-full', decls: [`grid-column: 1 / -1`], bootstrap: [] },
  );
  for (let n = 1; n <= 6; n += 1) {
    out.push({
      name: `cols-${n}`,
      decls: ['display: grid', `grid-template-columns: repeat(${n}, minmax(0, 1fr))`, 'gap: var(--civitai-space-3)'],
      bootstrap: [`row-cols-{bp}-${n}`],
      responsive: true,
    });
  }
  return out;
}

const STATIC: readonly Utility[] = [
  // Display
  { name: 'block', decls: ['display: block'], bootstrap: ['d-{bp}-block'], responsive: true },
  { name: 'inline-block', decls: ['display: inline-block'], bootstrap: ['d-{bp}-inline-block'], responsive: true },
  { name: 'flex', decls: ['display: flex'], bootstrap: ['d-{bp}-flex'], responsive: true },
  { name: 'inline-flex', decls: ['display: inline-flex'], bootstrap: ['d-{bp}-inline-flex'], responsive: true },
  { name: 'grid', decls: ['display: grid'], bootstrap: ['d-{bp}-grid'], responsive: true },
  { name: 'hidden', decls: ['display: none'], bootstrap: ['d-{bp}-none'], responsive: true },

  // Flex
  { name: 'column', decls: ['flex-direction: column'], bootstrap: ['flex-column'] },
  { name: 'wrap', decls: ['flex-wrap: wrap'], bootstrap: ['flex-wrap'] },
  { name: 'nowrap', decls: ['flex-wrap: nowrap'], bootstrap: ['flex-nowrap'] },
  { name: 'grow', decls: ['flex-grow: 1'], bootstrap: ['flex-grow-1'] },
  { name: 'shrink-0', decls: ['flex-shrink: 0'], bootstrap: ['flex-shrink-0'] },
  { name: 'items-start', decls: ['align-items: flex-start'], bootstrap: ['align-items-start'] },
  { name: 'items-center', decls: ['align-items: center'], bootstrap: ['align-items-center'] },
  { name: 'items-end', decls: ['align-items: flex-end'], bootstrap: ['align-items-end'] },
  { name: 'items-baseline', decls: ['align-items: baseline'], bootstrap: ['align-items-baseline'] },
  { name: 'self-center', decls: ['align-self: center'], bootstrap: ['align-self-center'] },
  { name: 'justify-start', decls: ['justify-content: flex-start'], bootstrap: ['justify-content-start'] },
  { name: 'justify-center', decls: ['justify-content: center'], bootstrap: ['justify-content-center'] },
  { name: 'justify-end', decls: ['justify-content: flex-end'], bootstrap: ['justify-content-end'] },
  { name: 'justify-between', decls: ['justify-content: space-between'], bootstrap: ['justify-content-between'] },

  // Sizing
  { name: 'w-full', decls: ['width: 100%'], bootstrap: ['w-100'] },
  { name: 'h-full', decls: ['height: 100%'], bootstrap: ['h-100'] },
  { name: 'fluid', decls: ['width: 100%', 'max-width: 100%', 'height: auto'], bootstrap: ['img-fluid', 'container-fluid'] },

  // Position
  { name: 'relative', decls: ['position: relative'], bootstrap: ['position-relative'] },
  { name: 'absolute', decls: ['position: absolute'], bootstrap: ['position-absolute'] },
  { name: 'sticky-top', decls: ['position: sticky', 'top: 0', 'z-index: 2'], bootstrap: ['sticky-top'] },
  { name: 'top-0', decls: ['top: 0'], bootstrap: ['top-0'] },
  { name: 'start-0', decls: ['inset-inline-start: 0'], bootstrap: ['start-0'] },
  { name: 'end-0', decls: ['inset-inline-end: 0'], bootstrap: ['end-0'] },

  // Type
  { name: 'text-start', decls: ['text-align: start'], bootstrap: ['text-start'] },
  { name: 'text-center', decls: ['text-align: center'], bootstrap: ['text-center'] },
  { name: 'text-end', decls: ['text-align: end'], bootstrap: ['text-end'] },
  { name: 'nowrap-text', decls: ['white-space: nowrap'], bootstrap: ['text-nowrap'] },
  { name: 'truncate', decls: ['overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap'], bootstrap: ['text-truncate'] },
  { name: 'uppercase', decls: ['text-transform: uppercase'], bootstrap: ['text-uppercase'] },
  { name: 'mono', decls: ['font-family: var(--civitai-font-mono)'], bootstrap: ['font-monospace'] },
  { name: 'normal', decls: ['font-weight: 400'], bootstrap: ['fw-normal'] },
  { name: 'semibold', decls: ['font-weight: 600'], bootstrap: ['fw-semibold'] },
  { name: 'bold', decls: ['font-weight: 700'], bootstrap: ['fw-bold'] },
  { name: 'small', decls: ['font-size: 0.875em'], bootstrap: ['small'] },
  { name: 'fs-1', decls: ['font-size: 2.5rem'], bootstrap: ['fs-1'] },
  { name: 'fs-2', decls: ['font-size: 2rem'], bootstrap: ['fs-2'] },
  { name: 'fs-3', decls: ['font-size: 1.75rem'], bootstrap: ['fs-3'] },
  { name: 'fs-4', decls: ['font-size: 1.5rem'], bootstrap: ['fs-4'] },
  { name: 'fs-5', decls: ['font-size: 1.25rem'], bootstrap: ['fs-5'] },
  { name: 'fs-6', decls: ['font-size: 1rem'], bootstrap: ['fs-6'] },
  { name: 'no-underline', decls: ['text-decoration: none'], bootstrap: ['text-decoration-none'] },

  // Semantic colour, on tokens rather than a palette
  { name: 'muted', decls: ['color: var(--civitai-color-text-dimmed)'], bootstrap: ['text-muted', 'text-secondary'] },
  { name: 'text-default', decls: ['color: var(--civitai-color-text)'], bootstrap: ['text-reset', 'text-body'] },
  { name: 'text-primary', decls: ['color: var(--civitai-color-primary)'], bootstrap: ['text-primary'] },
  { name: 'text-success', decls: ['color: var(--civitai-color-success)'], bootstrap: ['text-success'] },
  { name: 'text-warning', decls: ['color: var(--civitai-color-warning)'], bootstrap: ['text-warning', 'text-warning-emphasis'] },
  { name: 'text-error', decls: ['color: var(--civitai-color-error)'], bootstrap: ['text-danger'] },
  { name: 'text-info', decls: ['color: var(--civitai-color-info)'], bootstrap: ['text-info', 'text-info-emphasis'] },
  { name: 'bg-surface', decls: ['background: var(--civitai-color-surface)'], bootstrap: ['bg-body'] },
  { name: 'bg-surface-2', decls: ['background: var(--civitai-color-surface-2)'], bootstrap: ['bg-body-secondary', 'bg-body-tertiary'] },

  // Solid fills. `-fg` alongside, because a fill that does not carry its own
  // text colour is how markup ends up dark-on-dark.
  { name: 'fill-primary', decls: ['background: var(--civitai-color-primary)', 'color: var(--civitai-color-primary-fg)'], bootstrap: ['bg-primary'] },
  { name: 'fill-success', decls: ['background: var(--civitai-color-success)', 'color: var(--civitai-color-gray-0)'], bootstrap: ['bg-success'] },
  { name: 'fill-warning', decls: ['background: var(--civitai-color-warning)', 'color: var(--civitai-color-gray-0)'], bootstrap: ['bg-warning'] },
  { name: 'fill-error', decls: ['background: var(--civitai-color-error)', 'color: var(--civitai-color-gray-0)'], bootstrap: ['bg-danger'] },
  { name: 'fill-info', decls: ['background: var(--civitai-color-info)', 'color: var(--civitai-color-gray-0)'], bootstrap: ['bg-info'] },
  { name: 'fill-muted', decls: ['background: var(--civitai-color-primary-light)'], bootstrap: ['bg-info-subtle', 'bg-secondary'] },
  { name: 'fill-light', decls: ['background: var(--civitai-color-gray-0)', 'color: var(--civitai-color-gray-9)'], bootstrap: ['bg-light'] },
  { name: 'fill-dark', decls: ['background: var(--civitai-color-gray-9)', 'color: var(--civitai-color-gray-0)'], bootstrap: ['bg-dark'] },
  { name: 'text-light', decls: ['color: var(--civitai-color-gray-0)'], bootstrap: ['text-light'] },
  { name: 'text-dark', decls: ['color: var(--civitai-color-gray-9)'], bootstrap: ['text-dark'] },

  // Border and shape
  { name: 'border', decls: ['border: 1px solid var(--civitai-color-border)'], bootstrap: ['border'] },
  { name: 'border-top', decls: ['border-block-start: 1px solid var(--civitai-color-border)'], bootstrap: ['border-top'] },
  { name: 'border-start', decls: ['border-inline-start: 1px solid var(--civitai-color-border)'], bootstrap: ['border-start'] },
  { name: 'border-bottom', decls: ['border-block-end: 1px solid var(--civitai-color-border)'], bootstrap: ['border-bottom'] },
  { name: 'border-end', decls: ['border-inline-end: 1px solid var(--civitai-color-border)'], bootstrap: ['border-end'] },
  { name: 'rounded', decls: ['border-radius: var(--civitai-radius)'], bootstrap: ['rounded'] },
  { name: 'border-2', decls: ['border-width: 2px'], bootstrap: ['border-2'] },
  { name: 'border-primary', decls: ['border-color: var(--civitai-color-primary)'], bootstrap: ['border-primary'] },
  { name: 'border-success', decls: ['border-color: var(--civitai-color-success)'], bootstrap: ['border-success'] },
  { name: 'border-warning', decls: ['border-color: var(--civitai-color-warning)'], bootstrap: ['border-warning'] },
  { name: 'border-error', decls: ['border-color: var(--civitai-color-error)'], bootstrap: ['border-danger'] },

  // Lists and overflow
  { name: 'list-bare', decls: ['list-style: none', 'padding-inline-start: 0', 'margin: 0'], bootstrap: ['list-unstyled'] },
  { name: 'list-inline', decls: ['list-style: none', 'padding-inline-start: 0', 'margin: 0', 'display: flex', 'flex-wrap: wrap', 'gap: var(--civitai-space-2)'], bootstrap: ['list-inline'] },
  { name: 'middle', decls: ['vertical-align: middle'], bootstrap: ['align-middle'] },
  { name: 'opacity-25', decls: ['opacity: 0.25'], bootstrap: ['opacity-25'] },
  { name: 'opacity-50', decls: ['opacity: 0.5'], bootstrap: ['opacity-50'] },
  { name: 'opacity-75', decls: ['opacity: 0.75'], bootstrap: ['opacity-75'] },
  { name: 'scroll-x', decls: ['overflow-x: auto'], bootstrap: ['table-responsive'] },

  // Accessibility
  {
    name: 'sr-only',
    decls: [
      'position: absolute',
      'width: 1px',
      'height: 1px',
      'padding: 0',
      'margin: -1px',
      'overflow: hidden',
      'clip-path: inset(50%)',
      'white-space: nowrap',
      'border: 0',
    ],
    bootstrap: ['visually-hidden'],
  },
];

export const UTILITIES: readonly Utility[] = [...STATIC, ...spacing(), ...grid()];
