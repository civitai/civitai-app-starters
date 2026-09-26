/**
 * A11y / visual fixtures, expressed against the ELEMENT bindings.
 *
 * These used to be dual-consumption fixtures (a React arm + a hand-written HTML
 * arm) for the parity test that proved the two rendered identically. That test
 * went away with the hand-written React layer: the custom elements are now the
 * only implementation, so there is no second arm to compare against and nothing
 * to drift. What survives — and is what these fixtures still buy — is the axe
 * sweep over every component family in light and dark, which asserts the
 * ELEMENTS' own semantics: labels, roles, ARIA wiring and accessible names.
 *
 * axe pierces shadow roots, so a case only needs to mount the element; the
 * element supplies its own chrome and injects the theme tokens itself.
 */
import {
  CivitaiAlert,
  CivitaiBadge,
  CivitaiButton,
  CivitaiCard,
  CivitaiCheckbox,
  CivitaiGroup,
  CivitaiImage,
  CivitaiLoader,
  CivitaiNumberInput,
  CivitaiRadioGroup,
  CivitaiSegmentedControl,
  CivitaiSelect,
  CivitaiSlider,
  CivitaiStack,
  CivitaiTextInput,
  CivitaiTextarea,
  CivitaiToast,
  CivitaiToastRegion,
  CivitaiTooltip,
} from '../src/index.js';

export interface Case {
  id: string;
  node: React.ReactElement;
  /** Element (within the mount) to screenshot; the mount itself when absent. */
  selector?: string;
}

/** 1×1 transparent GIF — no network in the browser test runner. */
const PIXEL_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const SELECT_OPTIONS = [
  { value: 'euler', label: 'Euler' },
  { value: 'ddim', label: 'DDIM' },
];

const RADIO_OPTIONS = [
  { value: 'sd15', label: 'SD 1.5' },
  { value: 'sdxl', label: 'SDXL' },
];

const SEGMENTS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];

export const A11Y_CASES: Case[] = [
  {
    id: 'button-filled-md',
    node: (
      <CivitaiButton variant="filled" size="md">
        Generate
      </CivitaiButton>
    ),
    selector: 'civitai-button',
  },
  {
    id: 'button-loading',
    node: (
      <CivitaiButton variant="filled" size="md" loading>
        Generating
      </CivitaiButton>
    ),
    selector: 'civitai-button',
  },
  {
    id: 'text-input-default',
    node: <CivitaiTextInput label="Prompt" description="What to generate" />,
    selector: 'civitai-text-input',
  },
  {
    id: 'text-input-invalid',
    node: <CivitaiTextInput label="Prompt" error="Prompt is required" required />,
    selector: 'civitai-text-input',
  },
  {
    id: 'textarea-default',
    node: <CivitaiTextarea label="Negative prompt" rows={3} />,
    selector: 'civitai-textarea',
  },
  {
    id: 'number-input-default',
    node: <CivitaiNumberInput label="Steps" min="1" max="50" step="1" />,
    selector: 'civitai-number-input',
  },
  {
    id: 'select-default',
    node: <CivitaiSelect label="Sampler" data={SELECT_OPTIONS} placeholder="Pick one" />,
    selector: 'civitai-select',
  },
  {
    id: 'select-invalid',
    node: <CivitaiSelect label="Sampler" data={SELECT_OPTIONS} error="Pick a sampler" />,
    selector: 'civitai-select',
  },
  {
    id: 'checkbox-default',
    node: <CivitaiCheckbox label="Save to my library" />,
    selector: 'civitai-checkbox',
  },
  {
    id: 'radio-group-default',
    node: <CivitaiRadioGroup label="Base model" data={RADIO_OPTIONS} />,
    selector: 'civitai-radio-group',
  },
  {
    id: 'radio-group-invalid',
    node: <CivitaiRadioGroup label="Base model" data={RADIO_OPTIONS} error="Choose a model" />,
    selector: 'civitai-radio-group',
  },
  {
    id: 'card-border-md',
    node: (
      <CivitaiCard padding="md" withBorder>
        Card body
      </CivitaiCard>
    ),
    selector: 'civitai-card',
  },
  {
    id: 'stack-default',
    node: (
      <CivitaiStack gap="md">
        <span>one</span>
        <span>two</span>
      </CivitaiStack>
    ),
    selector: 'civitai-stack',
  },
  {
    id: 'group-default',
    node: (
      <CivitaiGroup gap="md">
        <span>one</span>
        <span>two</span>
      </CivitaiGroup>
    ),
    selector: 'civitai-group',
  },
  {
    id: 'alert-info',
    node: (
      <CivitaiAlert color="info" heading="Heads up">
        Your generation is queued.
      </CivitaiAlert>
    ),
    selector: 'civitai-alert',
  },
  {
    id: 'alert-closable',
    node: (
      <CivitaiAlert color="error" heading="Failed" closable closeLabel="Dismiss">
        The workflow was rejected.
      </CivitaiAlert>
    ),
    selector: 'civitai-alert',
  },
  {
    id: 'badge-filled-md',
    node: (
      <CivitaiBadge variant="filled" size="md">
        ready
      </CivitaiBadge>
    ),
    selector: 'civitai-badge',
  },
  {
    id: 'loader-md',
    node: <CivitaiLoader size="md" label="Loading" />,
    selector: 'civitai-loader',
  },
  {
    id: 'slider-a11y',
    node: (
      <CivitaiSlider
        label="Steps"
        min="0"
        max="100"
        step="1"
        description="How many diffusion steps"
        showValue
      />
    ),
    selector: 'civitai-slider',
  },
  {
    id: 'segmented-control-a11y',
    node: <CivitaiSegmentedControl label="Layout" data={SEGMENTS} size="md" />,
    selector: 'civitai-segmented-control',
  },
  {
    id: 'toast-a11y',
    node: (
      <CivitaiToastRegion>
        <CivitaiToast color="success" heading="Saved" closable closeLabel="Dismiss">
          Your changes are live.
        </CivitaiToast>
      </CivitaiToastRegion>
    ),
    selector: 'civitai-toast',
  },
  {
    id: 'tooltip-a11y',
    node: (
      <CivitaiTooltip label="Randomize the seed">
        <CivitaiButton variant="filled" size="md">
          Seed
        </CivitaiButton>
      </CivitaiTooltip>
    ),
    selector: 'civitai-tooltip',
  },
  {
    id: 'image-a11y',
    node: <CivitaiImage src={PIXEL_GIF} alt="Preview" fit="cover" />,
    selector: 'civitai-image',
  },
];
