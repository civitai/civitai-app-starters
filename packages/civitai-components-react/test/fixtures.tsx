/**
 * Dual-consumption fixtures: for each component/variant/size, the React element
 * AND the equivalent hand-written HTML (per @civitai/components/MARKUP.md).
 * The parity test asserts identical computed styles between the two.
 */
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  NumberInput,
  Stack,
  TextInput,
  Textarea,
} from '../src/index.js';

export interface Case {
  id: string;
  node: React.ReactElement;
  html: string;
  /** Element (within the mount) whose computed style is compared. */
  selector: string;
  /** Computed-style properties that must match. */
  compare: string[];
}

const TEXT = ['fontFamily', 'fontSize', 'fontWeight', 'color'];
const BORDER = ['borderTopColor', 'borderTopWidth', 'borderTopStyle', 'borderTopLeftRadius'];
const PAD = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
const BTN = [...TEXT, 'backgroundColor', ...BORDER, ...PAD, 'height', 'opacity'];
const CONTROL = [...TEXT, 'backgroundColor', ...BORDER, ...PAD];

const buttonVariants = ['filled', 'light', 'outline', 'subtle'] as const;
const buttonSizes = ['sm', 'md', 'lg'] as const;
const badgeVariants = ['filled', 'light', 'outline'] as const;
const badgeSizes = ['sm', 'md', 'lg'] as const;
const loaderSizes = ['sm', 'md', 'lg'] as const;
const alertColors = ['info', 'success', 'warning', 'error'] as const;

export const CASES: Case[] = [
  // ---- Button: every variant (md) + every size (filled) + states ----
  ...buttonVariants.map(
    (variant): Case => ({
      id: `button-${variant}-md`,
      node: (
        <Button variant={variant} size="md">
          Generate
        </Button>
      ),
      html: `<button data-civitai-ui="button" data-variant="${variant}" data-size="md" type="button">Generate</button>`,
      selector: '[data-civitai-ui="button"]',
      compare: BTN,
    })
  ),
  ...buttonSizes.map(
    (size): Case => ({
      id: `button-filled-${size}`,
      node: (
        <Button variant="filled" size={size}>
          Generate
        </Button>
      ),
      html: `<button data-civitai-ui="button" data-variant="filled" data-size="${size}" type="button">Generate</button>`,
      selector: '[data-civitai-ui="button"]',
      compare: BTN,
    })
  ),
  {
    id: 'button-fullwidth',
    node: (
      <Button fullWidth>
        Wide
      </Button>
    ),
    html: `<button data-civitai-ui="button" data-variant="filled" data-size="md" data-full-width="true" type="button">Wide</button>`,
    selector: '[data-civitai-ui="button"]',
    compare: [...BTN, 'width'],
  },
  {
    id: 'button-loading',
    node: <Button loading>Submit</Button>,
    html: `<button data-civitai-ui="button" data-variant="filled" data-size="md" type="button" aria-busy="true" disabled><span data-civitai-ui="loader" data-size="sm" aria-hidden="true"></span>Submit</button>`,
    selector: '[data-civitai-ui="button"]',
    compare: BTN,
  },

  // ---- Badge: every variant (md) + every size (filled) ----
  ...badgeVariants.map(
    (variant): Case => ({
      id: `badge-${variant}-md`,
      node: (
        <Badge variant={variant} size="md">
          new
        </Badge>
      ),
      html: `<span data-civitai-ui="badge" data-variant="${variant}" data-size="md">new</span>`,
      selector: '[data-civitai-ui="badge"]',
      compare: [...TEXT, 'backgroundColor', ...BORDER, ...PAD, 'height', 'borderTopLeftRadius'],
    })
  ),
  ...badgeSizes.map(
    (size): Case => ({
      id: `badge-filled-${size}`,
      node: (
        <Badge variant="filled" size={size}>
          new
        </Badge>
      ),
      html: `<span data-civitai-ui="badge" data-variant="filled" data-size="${size}">new</span>`,
      selector: '[data-civitai-ui="badge"]',
      compare: [...TEXT, 'backgroundColor', 'height', ...PAD],
    })
  ),
  // ---- Badge: data-color intents (issue #181 F2) — filled + light, each color
  ...alertColors.flatMap((color): Case[] => [
    {
      id: `badge-color-${color}-filled`,
      node: (
        <Badge color={color} variant="filled" size="md">
          new
        </Badge>
      ),
      html: `<span data-civitai-ui="badge" data-color="${color}" data-variant="filled" data-size="md">new</span>`,
      selector: '[data-civitai-ui="badge"]',
      compare: [...TEXT, 'backgroundColor', ...BORDER, ...PAD],
    },
    {
      id: `badge-color-${color}-light`,
      node: (
        <Badge color={color} variant="light" size="md">
          new
        </Badge>
      ),
      html: `<span data-civitai-ui="badge" data-color="${color}" data-variant="light" data-size="md">new</span>`,
      selector: '[data-civitai-ui="badge"]',
      compare: [...TEXT, 'backgroundColor', ...BORDER, ...PAD],
    },
  ]),

  // ---- Loader: every size ----
  ...loaderSizes.map(
    (size): Case => ({
      id: `loader-${size}`,
      node: <Loader size={size} aria-hidden="true" />,
      html: `<span data-civitai-ui="loader" data-size="${size}" aria-hidden="true"></span>`,
      selector: '[data-civitai-ui="loader"]',
      compare: ['width', 'height', 'borderTopWidth', 'borderTopColor', 'borderTopStyle', 'color'],
    })
  ),

  // ---- Card: padding sizes + border toggle ----
  {
    id: 'card-border-md',
    node: (
      <Card withBorder padding="md">
        body
      </Card>
    ),
    html: `<div data-civitai-ui="card" data-with-border="true" data-padding="md">body</div>`,
    selector: '[data-civitai-ui="card"]',
    compare: ['backgroundColor', 'color', ...BORDER, ...PAD],
  },
  {
    id: 'card-noborder-sm',
    node: (
      <Card withBorder={false} padding="sm">
        body
      </Card>
    ),
    html: `<div data-civitai-ui="card" data-padding="sm">body</div>`,
    selector: '[data-civitai-ui="card"]',
    compare: ['backgroundColor', 'color', 'borderTopWidth', ...PAD],
  },
  {
    id: 'card-lg',
    node: (
      <Card padding="lg">body</Card>
    ),
    html: `<div data-civitai-ui="card" data-with-border="true" data-padding="lg">body</div>`,
    selector: '[data-civitai-ui="card"]',
    compare: ['backgroundColor', 'color', ...BORDER, ...PAD],
  },

  // ---- Alert: every color ----
  ...alertColors.map(
    (color): Case => ({
      id: `alert-${color}`,
      node: (
        <Alert color={color} title="Heads up">
          Something happened.
        </Alert>
      ),
      html: `<div data-civitai-ui="alert" data-color="${color}" role="alert"><div data-civitai-ui-alert-body><div data-civitai-ui-alert-title>Heads up</div>Something happened.</div></div>`,
      selector: '[data-civitai-ui="alert"]',
      compare: ['backgroundColor', 'color', 'fontSize', ...BORDER, ...PAD],
    })
  ),

  // ---- Inputs: default + invalid ----
  {
    id: 'text-input-default',
    node: <TextInput label="Name" defaultValue="" id="fx-text" />,
    html: `<div data-civitai-ui="text-input"><label data-civitai-ui-label for="fx-text">Name</label><input data-civitai-ui-control id="fx-text" /></div>`,
    selector: '[data-civitai-ui-control]',
    compare: CONTROL,
  },
  {
    id: 'text-input-invalid',
    node: <TextInput label="Name" error="Required" id="fx-text-err" />,
    html: `<div data-civitai-ui="text-input" data-invalid="true"><label data-civitai-ui-label for="fx-text-err">Name</label><input data-civitai-ui-control id="fx-text-err" aria-invalid="true" aria-describedby="fx-text-err-err" /><span id="fx-text-err-err" data-civitai-ui-error role="alert">Required</span></div>`,
    selector: '[data-civitai-ui-control]',
    compare: CONTROL,
  },
  {
    id: 'textarea-default',
    node: <Textarea label="Prompt" defaultValue="" id="fx-ta" />,
    html: `<div data-civitai-ui="textarea"><label data-civitai-ui-label for="fx-ta">Prompt</label><textarea data-civitai-ui-control id="fx-ta"></textarea></div>`,
    selector: '[data-civitai-ui-control]',
    compare: [...CONTROL, 'resize', 'lineHeight'],
  },
  {
    id: 'number-input-default',
    node: <NumberInput label="Steps" id="fx-num" />,
    html: `<div data-civitai-ui="number-input"><label data-civitai-ui-label for="fx-num">Steps</label><input type="number" data-civitai-ui-control id="fx-num" /></div>`,
    selector: '[data-civitai-ui-control]',
    compare: CONTROL,
  },

  // ---- Stack / Group ----
  {
    id: 'stack-default',
    node: (
      <Stack>
        <span>a</span>
        <span>b</span>
      </Stack>
    ),
    html: `<div data-civitai-ui="stack"><span>a</span><span>b</span></div>`,
    selector: '[data-civitai-ui="stack"]',
    compare: ['display', 'flexDirection', 'gap'],
  },
  {
    id: 'stack-gap-lg',
    node: (
      <Stack gap="lg">
        <span>a</span>
      </Stack>
    ),
    html: `<div data-civitai-ui="stack" data-gap="lg"><span>a</span></div>`,
    selector: '[data-civitai-ui="stack"]',
    compare: ['display', 'flexDirection', 'gap'],
  },
  {
    id: 'group-default',
    node: (
      <Group>
        <span>a</span>
        <span>b</span>
      </Group>
    ),
    html: `<div data-civitai-ui="group"><span>a</span><span>b</span></div>`,
    selector: '[data-civitai-ui="group"]',
    compare: ['display', 'flexDirection', 'alignItems', 'gap'],
  },
];

/** The 10 component families, for the a11y sweep. */
export const A11Y_CASES: Case[] = [
  CASES.find((c) => c.id === 'button-filled-md')!,
  CASES.find((c) => c.id === 'text-input-default')!,
  CASES.find((c) => c.id === 'text-input-invalid')!,
  CASES.find((c) => c.id === 'textarea-default')!,
  CASES.find((c) => c.id === 'number-input-default')!,
  CASES.find((c) => c.id === 'card-border-md')!,
  CASES.find((c) => c.id === 'stack-default')!,
  CASES.find((c) => c.id === 'group-default')!,
  CASES.find((c) => c.id === 'alert-info')!,
  CASES.find((c) => c.id === 'badge-filled-md')!,
  CASES.find((c) => c.id === 'loader-md')!,
];
