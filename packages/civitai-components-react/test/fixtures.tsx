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
  Checkbox,
  Group,
  Image,
  Loader,
  NumberInput,
  Radio,
  RadioGroup,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  TabPanel,
  TextInput,
  Textarea,
  Toast,
  Tooltip,
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
// Themed native checkbox/radio input: theme tint (accent-color) + custom sizing.
const CHOICE = ['accentColor', 'width', 'height', 'cursor'];

/** 1×1 transparent GIF (loads without network — deterministic for the Image tests). */
const PIXEL_GIF =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

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

  // ---- Select / Checkbox / Radio / RadioGroup (issue #181 F6) ----
  {
    id: 'select-default',
    node: (
      <Select label="Model" id="fx-sel">
        <option value="sdxl">SDXL</option>
        <option value="flux">Flux</option>
      </Select>
    ),
    html: `<div data-civitai-ui="select"><label data-civitai-ui-label for="fx-sel">Model</label><select data-civitai-ui-control id="fx-sel"><option value="sdxl">SDXL</option><option value="flux">Flux</option></select></div>`,
    selector: '[data-civitai-ui-control]',
    compare: CONTROL,
  },
  {
    id: 'select-invalid',
    node: (
      <Select label="Model" error="Required" id="fx-sel-err">
        <option value="sdxl">SDXL</option>
      </Select>
    ),
    html: `<div data-civitai-ui="select" data-invalid="true"><label data-civitai-ui-label for="fx-sel-err">Model</label><select data-civitai-ui-control id="fx-sel-err" aria-invalid="true" aria-describedby="fx-sel-err-err"><option value="sdxl">SDXL</option></select><span id="fx-sel-err-err" data-civitai-ui-error role="alert">Required</span></div>`,
    selector: '[data-civitai-ui-control]',
    compare: CONTROL,
  },
  {
    id: 'checkbox-default',
    node: <Checkbox label="I agree" id="fx-cb" />,
    html: `<div data-civitai-ui="checkbox"><div data-civitai-ui-choice><input type="checkbox" id="fx-cb" /><label data-civitai-ui-label for="fx-cb">I agree</label></div></div>`,
    selector: 'input[type="checkbox"]',
    compare: CHOICE,
  },
  {
    id: 'checkbox-disabled',
    node: <Checkbox label="Locked" id="fx-cb-dis" disabled />,
    html: `<div data-civitai-ui="checkbox"><div data-civitai-ui-choice><input type="checkbox" id="fx-cb-dis" disabled /><label data-civitai-ui-label for="fx-cb-dis">Locked</label></div></div>`,
    selector: 'input[type="checkbox"]',
    compare: [...CHOICE, 'opacity'],
  },
  {
    id: 'radio-default',
    node: <Radio label="Euler" name="fx-sampler" id="fx-rd" />,
    html: `<div data-civitai-ui="radio"><div data-civitai-ui-choice><input type="radio" name="fx-sampler" id="fx-rd" /><label data-civitai-ui-label for="fx-rd">Euler</label></div></div>`,
    selector: 'input[type="radio"]',
    compare: CHOICE,
  },
  {
    id: 'radio-group-default',
    node: (
      <RadioGroup label="Sampler">
        <Radio label="Euler" name="fx-grp" id="fx-grp-a" />
        <Radio label="DDIM" name="fx-grp" id="fx-grp-b" />
      </RadioGroup>
    ),
    html: `<div data-civitai-ui="radio-group" role="radiogroup" aria-labelledby="fx-grp-lbl"><span data-civitai-ui-label id="fx-grp-lbl">Sampler</span><div data-civitai-ui-radio-options data-orientation="vertical"><div data-civitai-ui="radio"><div data-civitai-ui-choice><input type="radio" name="fx-grp" id="fx-grp-a" /><label data-civitai-ui-label for="fx-grp-a">Euler</label></div></div><div data-civitai-ui="radio"><div data-civitai-ui-choice><input type="radio" name="fx-grp" id="fx-grp-b" /><label data-civitai-ui-label for="fx-grp-b">DDIM</label></div></div></div></div>`,
    selector: '[data-civitai-ui-radio-options]',
    compare: ['display', 'flexDirection', 'gap'],
  },
  {
    id: 'radio-group-invalid',
    node: (
      <RadioGroup label="Sampler" error="Selection required">
        <Radio label="Euler" name="fx-grp-e" id="fx-grp-ea" />
        <Radio label="DDIM" name="fx-grp-e" id="fx-grp-eb" />
      </RadioGroup>
    ),
    html: `<div data-civitai-ui="radio-group" role="radiogroup" data-invalid="true" aria-invalid="true" aria-labelledby="fx-grpe-lbl" aria-describedby="fx-grpe-err"><span data-civitai-ui-label id="fx-grpe-lbl">Sampler</span><div data-civitai-ui-radio-options data-orientation="vertical"><div data-civitai-ui="radio"><div data-civitai-ui-choice><input type="radio" name="fx-grp-e" id="fx-grp-ea" /><label data-civitai-ui-label for="fx-grp-ea">Euler</label></div></div><div data-civitai-ui="radio"><div data-civitai-ui-choice><input type="radio" name="fx-grp-e" id="fx-grp-eb" /><label data-civitai-ui-label for="fx-grp-eb">DDIM</label></div></div></div><span id="fx-grpe-err" data-civitai-ui-error role="alert">Selection required</span></div>`,
    selector: '[data-civitai-ui-error]',
    compare: ['fontSize', 'color'],
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
    // `flexWrap` here widens PARITY only — it catches React and HTML diverging
    // on wrap. It canNOT catch the rule being deleted from components.css,
    // because that moves both arms identically and they still match (measured:
    // 245/291 still green with `flex-wrap` gone). The absolute guard is the
    // `styling anchors — Group` block in html-vs-react-parity.browser.test.tsx.
    compare: ['display', 'flexDirection', 'alignItems', 'gap', 'flexWrap'],
  },

  // ---- Slider (new primitive) — themed native <input type="range"> ----
  {
    id: 'slider-default',
    node: <Slider label="Steps" id="fx-sl" min={0} max={100} defaultValue={20} />,
    html: `<div data-civitai-ui="slider"><label data-civitai-ui-label for="fx-sl">Steps</label><input type="range" id="fx-sl" min="0" max="100" value="20" /></div>`,
    selector: 'input[type="range"]',
    compare: ['accentColor', 'height', 'cursor'],
  },
  {
    id: 'slider-invalid',
    node: <Slider label="Steps" id="fx-sl-e" error="Too high" defaultValue={20} />,
    html: `<div data-civitai-ui="slider" data-invalid="true"><label data-civitai-ui-label for="fx-sl-e">Steps</label><input type="range" id="fx-sl-e" min="0" max="100" value="20" aria-invalid="true" aria-describedby="fx-sl-e-err" /><span id="fx-sl-e-err" data-civitai-ui-error role="alert">Too high</span></div>`,
    selector: 'input[type="range"]',
    compare: ['accentColor'],
  },

  // ---- SegmentedControl (new primitive) — role=tablist chrome ----
  {
    id: 'segmented-control-container',
    node: (
      <SegmentedControl
        mode="tabs"
        aria-label="View"
        defaultValue="grid"
        data={[
          { value: 'grid', label: 'Grid' },
          { value: 'list', label: 'List' },
        ]}
      />
    ),
    html: `<div data-civitai-ui="segmented-control" data-size="md" role="tablist" aria-label="View"><button type="button" id="sc1-grid" data-civitai-ui-segment data-size="md" role="tab" aria-selected="true" tabindex="0">Grid</button><button type="button" id="sc1-list" data-civitai-ui-segment data-size="md" role="tab" aria-selected="false" tabindex="-1">List</button></div>`,
    selector: '[data-civitai-ui="segmented-control"]',
    compare: ['display', 'backgroundColor', 'borderTopLeftRadius', ...PAD],
  },
  {
    id: 'segmented-control-selected',
    node: (
      <SegmentedControl
        mode="tabs"
        aria-label="View"
        defaultValue="grid"
        data={[
          { value: 'grid', label: 'Grid' },
          { value: 'list', label: 'List' },
        ]}
      />
    ),
    html: `<div data-civitai-ui="segmented-control" data-size="md" role="tablist" aria-label="View"><button type="button" id="sc2-grid" data-civitai-ui-segment data-size="md" role="tab" aria-selected="true" tabindex="0">Grid</button><button type="button" id="sc2-list" data-civitai-ui-segment data-size="md" role="tab" aria-selected="false" tabindex="-1">List</button></div>`,
    selector: '[data-civitai-ui-segment][aria-selected="true"]',
    compare: [...TEXT, 'backgroundColor', 'height'],
  },
  {
    id: 'segmented-control-unselected',
    node: (
      <SegmentedControl
        mode="tabs"
        aria-label="View"
        defaultValue="grid"
        data={[
          { value: 'grid', label: 'Grid' },
          { value: 'list', label: 'List' },
        ]}
      />
    ),
    html: `<div data-civitai-ui="segmented-control" data-size="md" role="tablist" aria-label="View"><button type="button" id="sc3-grid" data-civitai-ui-segment data-size="md" role="tab" aria-selected="true" tabindex="0">Grid</button><button type="button" id="sc3-list" data-civitai-ui-segment data-size="md" role="tab" aria-selected="false" tabindex="-1">List</button></div>`,
    selector: '[data-civitai-ui-segment][aria-selected="false"]',
    compare: ['color', 'height', 'backgroundColor'],
  },
  {
    // toggle mode (default): role=radiogroup/radio, aria-checked drives the
    // same selected styling as aria-selected does in tabs mode.
    id: 'segmented-control-toggle-selected',
    node: (
      <SegmentedControl
        aria-label="Layout"
        defaultValue="grid"
        data={[
          { value: 'grid', label: 'Grid' },
          { value: 'list', label: 'List' },
        ]}
      />
    ),
    html: `<div data-civitai-ui="segmented-control" data-size="md" role="radiogroup" aria-label="Layout"><button type="button" id="sct-grid" data-civitai-ui-segment data-size="md" role="radio" aria-checked="true" tabindex="0">Grid</button><button type="button" id="sct-list" data-civitai-ui-segment data-size="md" role="radio" aria-checked="false" tabindex="-1">List</button></div>`,
    selector: '[data-civitai-ui-segment][aria-checked="true"]',
    compare: [...TEXT, 'backgroundColor', 'height'],
  },

  // ---- Toast (new primitive) — presentational card ----
  {
    id: 'toast-success',
    node: (
      <Toast color="success" title="Saved">
        Your changes are live.
      </Toast>
    ),
    html: `<div data-civitai-ui="toast" data-color="success" role="status"><div data-civitai-ui-toast-body><div data-civitai-ui-toast-title>Saved</div>Your changes are live.</div></div>`,
    selector: '[data-civitai-ui="toast"]',
    compare: ['backgroundColor', 'color', 'borderLeftColor', 'fontSize', ...PAD],
  },
  {
    id: 'toast-neutral',
    node: <Toast title="Note">Body</Toast>,
    html: `<div data-civitai-ui="toast" role="status"><div data-civitai-ui-toast-body><div data-civitai-ui-toast-title>Note</div>Body</div></div>`,
    selector: '[data-civitai-ui="toast"]',
    compare: ['backgroundColor', 'borderLeftColor'],
  },

  // ---- Tooltip (new primitive) — bubble ----
  {
    id: 'tooltip-bubble',
    node: (
      <Tooltip label="Info" defaultOpen>
        <button type="button">t</button>
      </Tooltip>
    ),
    html: `<span data-civitai-ui="tooltip"><button type="button" aria-describedby="tip-fx">t</button><span data-civitai-ui-tooltip-bubble role="tooltip" id="tip-fx" data-open="true">Info</span></span>`,
    selector: '[data-civitai-ui-tooltip-bubble]',
    compare: ['backgroundColor', 'color', 'fontSize', 'borderTopLeftRadius'],
  },

  // ---- Image (new primitive) — container + img ----
  {
    id: 'image-container',
    node: <Image src={PIXEL_GIF} alt="p" fallback="unavailable" />,
    html: `<div data-civitai-ui="image" data-status="loaded"><img data-civitai-ui-image-img data-fit="cover" src="${PIXEL_GIF}" alt="p" /><div data-civitai-ui-image-fallback aria-hidden="true">unavailable</div></div>`,
    selector: '[data-civitai-ui="image"]',
    compare: ['backgroundColor', 'borderTopLeftRadius', 'position', 'overflow'],
  },
  {
    id: 'image-img',
    node: <Image src={PIXEL_GIF} alt="p" fit="cover" />,
    html: `<div data-civitai-ui="image" data-status="loaded"><img data-civitai-ui-image-img data-fit="cover" src="${PIXEL_GIF}" alt="p" /></div>`,
    selector: '[data-civitai-ui-image-img]',
    compare: ['objectFit', 'display'],
  },

  // ---- Bare markup ≡ documented defaults (0.2.1) ----
  // The React binding always emits explicit `data-variant`/`data-size`/
  // `data-color` (defaulting the prop), but hand-written HTML per MARKUP.md may
  // OMIT them — the documented default then has to come from the base CSS rule.
  // These pair a DEFAULT-PROP React render against BARE HTML (no variant/size/
  // color) and assert identical computed styles, proving the bare markup picks
  // up the documented default (filled/md/info) rather than rendering unstyled.
  {
    id: 'button-bare-default',
    node: <Button>Generate</Button>,
    html: `<button data-civitai-ui="button" type="button">Generate</button>`,
    selector: '[data-civitai-ui="button"]',
    compare: BTN,
  },
  {
    id: 'badge-bare-default',
    node: <Badge>new</Badge>,
    html: `<span data-civitai-ui="badge">new</span>`,
    selector: '[data-civitai-ui="badge"]',
    compare: [...TEXT, 'backgroundColor', ...BORDER, ...PAD, 'height'],
  },
  {
    id: 'alert-bare-default',
    node: <Alert title="Heads up">Something happened.</Alert>,
    html: `<div data-civitai-ui="alert" role="alert"><div data-civitai-ui-alert-body><div data-civitai-ui-alert-title>Heads up</div>Something happened.</div></div>`,
    selector: '[data-civitai-ui="alert"]',
    compare: ['backgroundColor', 'color', 'fontSize', ...BORDER, ...PAD],
  },
  {
    id: 'loader-bare-default',
    node: <Loader aria-hidden="true" />,
    html: `<span data-civitai-ui="loader" aria-hidden="true"></span>`,
    selector: '[data-civitai-ui="loader"]',
    compare: ['width', 'height', 'borderTopWidth', 'borderTopColor', 'borderTopStyle', 'color'],
  },
];

/** Full tabs example (SegmentedControl + TabPanels) with reciprocal
 * aria-controls / aria-labelledby wiring, for the a11y sweep. */
const SEG_TABS_A11Y: React.ReactElement = (
  <div>
    <SegmentedControl
      mode="tabs"
      aria-label="View"
      defaultValue="grid"
      data={[
        { value: 'grid', label: 'Grid', id: 'a11y-tab-grid', panelId: 'a11y-panel-grid' },
        { value: 'list', label: 'List', id: 'a11y-tab-list', panelId: 'a11y-panel-list' },
      ]}
    />
    <TabPanel id="a11y-panel-grid" tabId="a11y-tab-grid" active>
      Grid content
    </TabPanel>
    <TabPanel id="a11y-panel-list" tabId="a11y-tab-list" active={false}>
      List content
    </TabPanel>
  </div>
);

/** Extra a11y-only fixtures for the new primitives (structural nodes; the
 * html/selector/compare fields are unused by the axe sweep). */
const A11Y_EXTRA: Case[] = [
  {
    id: 'slider-a11y',
    node: (
      <Slider
        label="Steps"
        id="a11y-slider"
        min={0}
        max={100}
        defaultValue={20}
        description="How many diffusion steps"
        valueLabel={(v) => `${v}`}
      />
    ),
    html: '',
    selector: 'input[type="range"]',
    compare: [],
  },
  {
    id: 'segmented-control-tabs-a11y',
    node: SEG_TABS_A11Y,
    html: '',
    selector: '[data-civitai-ui="segmented-control"]',
    compare: [],
  },
  {
    id: 'segmented-control-toggle-a11y',
    node: (
      <SegmentedControl
        aria-label="Layout"
        defaultValue="grid"
        data={[
          { value: 'grid', label: 'Grid' },
          { value: 'list', label: 'List' },
        ]}
      />
    ),
    html: '',
    selector: '[data-civitai-ui="segmented-control"]',
    compare: [],
  },
  {
    id: 'toast-a11y',
    node: (
      <div
        data-civitai-ui="toast-region"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        <Toast color="success" title="Saved" onClose={() => {}}>
          Your changes are live.
        </Toast>
      </div>
    ),
    html: '',
    selector: '[data-civitai-ui="toast"]',
    compare: [],
  },
  {
    id: 'tooltip-a11y',
    node: (
      <Tooltip label="Randomize the seed">
        <button type="button" data-civitai-ui="button" data-variant="filled" data-size="md">
          Seed
        </button>
      </Tooltip>
    ),
    html: '',
    selector: '[data-civitai-ui-tooltip-bubble]',
    compare: [],
  },
  {
    id: 'image-a11y',
    node: <Image src={PIXEL_GIF} alt="Preview" fallback="Image unavailable" />,
    html: '',
    selector: '[data-civitai-ui="image"]',
    compare: [],
  },
];

/** The component families, for the a11y sweep. */
export const A11Y_CASES: Case[] = [
  CASES.find((c) => c.id === 'button-filled-md')!,
  CASES.find((c) => c.id === 'text-input-default')!,
  CASES.find((c) => c.id === 'text-input-invalid')!,
  CASES.find((c) => c.id === 'textarea-default')!,
  CASES.find((c) => c.id === 'number-input-default')!,
  CASES.find((c) => c.id === 'select-default')!,
  CASES.find((c) => c.id === 'select-invalid')!,
  CASES.find((c) => c.id === 'checkbox-default')!,
  CASES.find((c) => c.id === 'radio-default')!,
  CASES.find((c) => c.id === 'radio-group-default')!,
  CASES.find((c) => c.id === 'radio-group-invalid')!,
  CASES.find((c) => c.id === 'card-border-md')!,
  CASES.find((c) => c.id === 'stack-default')!,
  CASES.find((c) => c.id === 'group-default')!,
  CASES.find((c) => c.id === 'alert-info')!,
  CASES.find((c) => c.id === 'badge-filled-md')!,
  CASES.find((c) => c.id === 'loader-md')!,
  ...A11Y_EXTRA,
];
