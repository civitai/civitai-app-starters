/**
 * Unit suite (happy-dom) — asserts each binding renders the correct
 * `data-civitai-ui` markup contract + ARIA wiring. Layout/computed-style parity
 * is covered separately in the browser suite (`*.browser.test.tsx`).
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  ToastProvider,
  Tooltip,
  useToast,
} from '../src/index.js';

afterEach(cleanup);

describe('markup contract', () => {
  it('Button renders the attribute contract + defaults', () => {
    const { container } = render(<Button>Go</Button>);
    const btn = container.querySelector('[data-civitai-ui="button"]')!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('data-variant')).toBe('filled');
    expect(btn.getAttribute('data-size')).toBe('md');
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('Button loading sets aria-busy + disabled + a loader child', () => {
    const { container } = render(<Button loading>Go</Button>);
    const btn = container.querySelector<HTMLButtonElement>('[data-civitai-ui="button"]')!;
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector('[data-civitai-ui="loader"]')).toBeTruthy();
  });

  it('Button variant/size/fullWidth pass through', () => {
    const { container } = render(
      <Button variant="outline" size="lg" fullWidth>
        Go
      </Button>
    );
    const btn = container.querySelector('[data-civitai-ui="button"]')!;
    expect(btn.getAttribute('data-variant')).toBe('outline');
    expect(btn.getAttribute('data-size')).toBe('lg');
    expect(btn.getAttribute('data-full-width')).toBe('true');
  });

  it('TextInput wires label htmlFor to the control id', () => {
    const { container } = render(<TextInput label="Name" id="t1" />);
    const label = container.querySelector('label[data-civitai-ui-label]')!;
    const input = container.querySelector('[data-civitai-ui-control]')!;
    expect(label.getAttribute('for')).toBe('t1');
    expect(input.getAttribute('id')).toBe('t1');
    expect(container.querySelector('[data-civitai-ui="text-input"]')).toBeTruthy();
  });

  it('TextInput error sets aria-invalid + describedby + role=alert message', () => {
    const { container } = render(<TextInput label="Name" error="Required" id="t2" />);
    const input = container.querySelector('[data-civitai-ui-control]')!;
    const err = container.querySelector('[data-civitai-ui-error]')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(err.getAttribute('role')).toBe('alert');
    expect(input.getAttribute('aria-describedby')).toContain(err.id);
  });

  it('TextInput required sets native required + asterisk', () => {
    const { container } = render(<TextInput label="Name" required id="t3" />);
    const input = container.querySelector<HTMLInputElement>('[data-civitai-ui-control]')!;
    expect(input.required).toBe(true);
    expect(container.querySelector('[data-civitai-ui-required]')).toBeTruthy();
  });

  it('Textarea renders a <textarea> control', () => {
    const { container } = render(<Textarea label="Prompt" id="ta" />);
    const el = container.querySelector('[data-civitai-ui-control]')!;
    expect(el.tagName).toBe('TEXTAREA');
    expect(container.querySelector('[data-civitai-ui="textarea"]')).toBeTruthy();
  });

  it('NumberInput renders input[type=number]', () => {
    const { container } = render(<NumberInput label="Steps" id="n1" />);
    const el = container.querySelector<HTMLInputElement>('[data-civitai-ui-control]')!;
    expect(el.getAttribute('type')).toBe('number');
    expect(container.querySelector('[data-civitai-ui="number-input"]')).toBeTruthy();
  });

  it('Select renders a <select> control on the shared field chrome (#181 F6)', () => {
    const { container } = render(
      <Select label="Model" id="sel1">
        <option value="a">A</option>
      </Select>
    );
    const wrap = container.querySelector('[data-civitai-ui="select"]')!;
    const control = container.querySelector('[data-civitai-ui-control]')!;
    const label = container.querySelector('label[data-civitai-ui-label]')!;
    expect(wrap).toBeTruthy();
    expect(control.tagName).toBe('SELECT');
    expect(label.getAttribute('for')).toBe('sel1');
    expect(control.getAttribute('id')).toBe('sel1');
    expect(container.querySelector('option')!.textContent).toBe('A');
  });

  it('Select error wires aria-invalid + describedby + role=alert (#181 F6)', () => {
    const { container } = render(
      <Select label="Model" error="Required" id="sel2">
        <option value="a">A</option>
      </Select>
    );
    const control = container.querySelector('[data-civitai-ui-control]')!;
    const err = container.querySelector('[data-civitai-ui-error]')!;
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(err.getAttribute('role')).toBe('alert');
    expect(control.getAttribute('aria-describedby')).toContain(err.id);
    expect(container.querySelector('[data-civitai-ui="select"]')!.getAttribute('data-invalid')).toBe('true');
  });

  it('Checkbox renders type=checkbox in a -choice row, label associated (#181 F6)', () => {
    const { container } = render(<Checkbox label="I agree" id="cb1" description="Terms" />);
    const wrap = container.querySelector('[data-civitai-ui="checkbox"]')!;
    const row = container.querySelector('[data-civitai-ui-choice]')!;
    const input = row.querySelector<HTMLInputElement>('input')!;
    const label = container.querySelector('label[data-civitai-ui-label]')!;
    const desc = container.querySelector('[data-civitai-ui-description]')!;
    expect(wrap).toBeTruthy();
    expect(input.getAttribute('type')).toBe('checkbox');
    // The checkbox does NOT carry the field-input chrome marker.
    expect(input.hasAttribute('data-civitai-ui-control')).toBe(false);
    expect(label.getAttribute('for')).toBe('cb1');
    expect(input.getAttribute('id')).toBe('cb1');
    expect(input.getAttribute('aria-describedby')).toContain(desc.id);
  });

  it('Checkbox controlled checked + disabled reflect (#181 F6)', () => {
    const { container } = render(<Checkbox label="x" id="cb2" checked disabled onChange={() => {}} />);
    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(true);
  });

  it('Radio renders type=radio with name for grouping (#181 F6)', () => {
    const { container } = render(<Radio label="Euler" name="sampler" id="rd1" />);
    const input = container.querySelector<HTMLInputElement>('input')!;
    expect(input.getAttribute('type')).toBe('radio');
    expect(input.getAttribute('name')).toBe('sampler');
    expect(container.querySelector('label[data-civitai-ui-label]')!.getAttribute('for')).toBe('rd1');
  });

  it('RadioGroup is role=radiogroup with aria-labelledby + options layout (#181 F6)', () => {
    const { container } = render(
      <RadioGroup label="Sampler" orientation="horizontal">
        <Radio label="Euler" name="s" id="g1" />
        <Radio label="DDIM" name="s" id="g2" />
      </RadioGroup>
    );
    const group = container.querySelector('[data-civitai-ui="radio-group"]')!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    const labelId = group.getAttribute('aria-labelledby')!;
    expect(labelId).toBeTruthy();
    expect(container.querySelector(`#${labelId}`)!.textContent).toBe('Sampler');
    const options = container.querySelector('[data-civitai-ui-radio-options]')!;
    expect(options.getAttribute('data-orientation')).toBe('horizontal');
    expect(options.querySelectorAll('[data-civitai-ui="radio"]')).toHaveLength(2);
  });

  it('RadioGroup error wires group-level aria-invalid + data-invalid + describedby + role=alert (0.2.0)', () => {
    const { container } = render(
      <RadioGroup label="Sampler" description="Pick one" error="Selection required">
        <Radio label="Euler" name="s" id="ge1" />
        <Radio label="DDIM" name="s" id="ge2" />
      </RadioGroup>
    );
    const group = container.querySelector('[data-civitai-ui="radio-group"]')!;
    const err = container.querySelector('[data-civitai-ui-error]')!;
    const desc = container.querySelector('[data-civitai-ui-description]')!;
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('data-invalid')).toBe('true');
    expect(err.getAttribute('role')).toBe('alert');
    // errId joined into aria-describedby alongside the description id
    expect(group.getAttribute('aria-describedby')).toContain(err.id);
    expect(group.getAttribute('aria-describedby')).toContain(desc.id);
  });

  it('RadioGroup without error emits no invalid attributes / no error node (backward-compat)', () => {
    const { container } = render(
      <RadioGroup label="Sampler">
        <Radio label="Euler" name="s" id="gn1" />
      </RadioGroup>
    );
    const group = container.querySelector('[data-civitai-ui="radio-group"]')!;
    expect(group.hasAttribute('data-invalid')).toBe(false);
    expect(group.hasAttribute('aria-invalid')).toBe(false);
    expect(container.querySelector('[data-civitai-ui-error]')).toBeNull();
  });

  it('Card exposes border + padding attributes', () => {
    const { container } = render(<Card padding="lg">x</Card>);
    const card = container.querySelector('[data-civitai-ui="card"]')!;
    expect(card.getAttribute('data-with-border')).toBe('true');
    expect(card.getAttribute('data-padding')).toBe('lg');
  });

  it('Stack / Group render layout markers + gap', () => {
    const { container: s } = render(<Stack gap="lg">x</Stack>);
    expect(s.querySelector('[data-civitai-ui="stack"]')!.getAttribute('data-gap')).toBe('lg');
    const { container: g } = render(<Group gap="sm">x</Group>);
    expect(g.querySelector('[data-civitai-ui="group"]')!.getAttribute('data-gap')).toBe('sm');
  });

  it('Alert has role=alert, color, title, and dismiss button', () => {
    const { container } = render(
      <Alert color="success" title="Saved" onClose={() => {}}>
        body
      </Alert>
    );
    const alert = container.querySelector('[data-civitai-ui="alert"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('data-color')).toBe('success');
    expect(container.querySelector('[data-civitai-ui-alert-title]')!.textContent).toBe('Saved');
    const close = container.querySelector('[data-civitai-ui-alert-close]')!;
    expect(close.getAttribute('aria-label')).toBe('Dismiss');
  });

  it('Loader / Badge render markers + size/variant', () => {
    const { container: l } = render(<Loader size="lg" />);
    expect(l.querySelector('[data-civitai-ui="loader"]')!.getAttribute('data-size')).toBe('lg');
    const { container: b } = render(
      <Badge variant="light" size="sm">
        new
      </Badge>
    );
    const badge = b.querySelector('[data-civitai-ui="badge"]')!;
    expect(badge.getAttribute('data-variant')).toBe('light');
    expect(badge.getAttribute('data-size')).toBe('sm');
    // No `color` prop => no data-color attribute (default primary, non-breaking).
    expect(badge.hasAttribute('data-color')).toBe(false);
  });

  it('Badge color maps to data-color (mirrors Alert)', () => {
    const { container } = render(
      <Badge color="success" variant="filled">
        ready
      </Badge>
    );
    const badge = container.querySelector('[data-civitai-ui="badge"]')!;
    expect(badge.getAttribute('data-color')).toBe('success');
  });
});

describe('Slider (new primitive)', () => {
  it('renders a type=range control in the slider wrapper, label associated', () => {
    const { container } = render(<Slider label="Steps" id="sl" />);
    const wrap = container.querySelector('[data-civitai-ui="slider"]')!;
    const input = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    const label = container.querySelector('label[data-civitai-ui-label]')!;
    expect(wrap).toBeTruthy();
    expect(input.getAttribute('type')).toBe('range');
    // Like checkbox/radio, the range input does NOT carry the field chrome marker.
    expect(input.hasAttribute('data-civitai-ui-control')).toBe(false);
    expect(label.getAttribute('for')).toBe('sl');
    expect(input.getAttribute('id')).toBe('sl');
  });

  it('error wires aria-invalid + describedby + role=alert + data-invalid', () => {
    const { container } = render(<Slider label="Steps" error="Too high" id="sl2" />);
    const input = container.querySelector('input[type="range"]')!;
    const err = container.querySelector('[data-civitai-ui-error]')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(err.getAttribute('role')).toBe('alert');
    expect(input.getAttribute('aria-describedby')).toContain(err.id);
    expect(container.querySelector('[data-civitai-ui="slider"]')!.getAttribute('data-invalid')).toBe('true');
  });

  it('valueLabel renders a live read-out that tracks the value', () => {
    const { container } = render(
      <Slider label="V" id="sl3" min={0} max={100} defaultValue={10} valueLabel={(v) => `${v}%`} />
    );
    const out = container.querySelector('[data-civitai-ui-slider-value]')!;
    expect(out.textContent).toBe('10%');
    const input = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    fireEvent.change(input, { target: { value: '55' } });
    expect(container.querySelector('[data-civitai-ui-slider-value]')!.textContent).toBe('55%');
  });
});

describe('SegmentedControl (new primitive)', () => {
  const DATA = [
    { value: 'grid', label: 'Grid' },
    { value: 'list', label: 'List' },
    { value: 'map', label: 'Map' },
  ];

  it('is role=tablist with role=tab buttons + roving tabindex', () => {
    const { container } = render(
      <SegmentedControl aria-label="View" defaultValue="grid" data={DATA} />
    );
    const tablist = container.querySelector('[data-civitai-ui="segmented-control"]')!;
    expect(tablist.getAttribute('role')).toBe('tablist');
    expect(tablist.getAttribute('aria-label')).toBe('View');
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs).toHaveLength(3);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('tabindex')).toBe('0');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('tabindex')).toBe('-1');
    expect(tabs[2].getAttribute('tabindex')).toBe('-1');
  });

  it('click selects + fires onChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SegmentedControl aria-label="View" defaultValue="grid" data={DATA} onChange={onChange} />
    );
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    fireEvent.click(tabs[1]);
    expect(onChange).toHaveBeenCalledWith('list');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('tabindex')).toBe('0');
    expect(tabs[0].getAttribute('tabindex')).toBe('-1');
  });

  it('ArrowRight/ArrowLeft move selection (roving + follows focus), wrapping', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SegmentedControl aria-label="View" defaultValue="grid" data={DATA} onChange={onChange} />
    );
    const tablist = container.querySelector('[data-civitai-ui="segmented-control"]')!;
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('list');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('grid');
    // wrap: ArrowLeft from first goes to last
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('map');
  });

  it('Home/End jump to the first/last segment', () => {
    const { container } = render(
      <SegmentedControl aria-label="View" defaultValue="list" data={DATA} />
    );
    const tablist = container.querySelector('[data-civitai-ui="segmented-control"]')!;
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    fireEvent.keyDown(tablist, { key: 'End' });
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('disabled segments are skipped by arrow-key nav and not selectable', () => {
    const onChange = vi.fn();
    const data = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true },
      { value: 'c', label: 'C' },
    ];
    const { container } = render(
      <SegmentedControl aria-label="X" defaultValue="a" data={data} onChange={onChange} />
    );
    const tablist = container.querySelector('[data-civitai-ui="segmented-control"]')!;
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[1].disabled).toBe(true);
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('c'); // skipped disabled 'b'
    fireEvent.click(tabs[1]);
    expect(onChange).not.toHaveBeenCalledWith('b');
  });

  it('panelId sets aria-controls; explicit id lets a TabPanel reference the tab', () => {
    const { container } = render(
      <SegmentedControl
        aria-label="View"
        defaultValue="grid"
        data={[{ value: 'grid', label: 'Grid', id: 'tab-grid', panelId: 'panel-grid' }]}
      />
    );
    const tab = container.querySelector('[role="tab"]')!;
    expect(tab.getAttribute('id')).toBe('tab-grid');
    expect(tab.getAttribute('aria-controls')).toBe('panel-grid');
  });

  it('controlled value ignores internal state (stays put until prop changes)', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SegmentedControl aria-label="V" value="grid" data={DATA} onChange={onChange} />
    );
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    fireEvent.click(tabs[1]);
    expect(onChange).toHaveBeenCalledWith('list');
    // Controlled: still shows 'grid' selected because the prop did not change.
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });
});

describe('TabPanel (new primitive)', () => {
  it('active panel: role=tabpanel, aria-labelledby, tabindex 0, not hidden', () => {
    const { container } = render(
      <TabPanel id="p1" tabId="t1" active>
        body
      </TabPanel>
    );
    const panel = container.querySelector('[data-civitai-ui-tabpanel]')!;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('t1');
    expect(panel.getAttribute('tabindex')).toBe('0');
    expect(panel.hasAttribute('hidden')).toBe(false);
  });

  it('inactive panel is hidden', () => {
    const { container } = render(
      <TabPanel id="p2" tabId="t2" active={false}>
        body
      </TabPanel>
    );
    expect(container.querySelector('[data-civitai-ui-tabpanel]')!.hasAttribute('hidden')).toBe(true);
  });
});

describe('Toast (presentational, new primitive)', () => {
  it('renders role=status, data-color, title, message, dismiss button', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Toast color="success" title="Saved" onClose={onClose}>
        Done
      </Toast>
    );
    const toast = container.querySelector('[data-civitai-ui="toast"]')!;
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('data-color')).toBe('success');
    expect(container.querySelector('[data-civitai-ui-toast-title]')!.textContent).toBe('Saved');
    const close = container.querySelector('[data-civitai-ui-toast-close]')!;
    expect(close.getAttribute('aria-label')).toBe('Dismiss');
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalled();
  });

  it('urgent toast uses role=alert; no color => no data-color attribute', () => {
    const { container } = render(
      <Toast urgent>Heads up</Toast>
    );
    const toast = container.querySelector('[data-civitai-ui="toast"]')!;
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.hasAttribute('data-color')).toBe(false);
  });
});

describe('ToastProvider / useToast (new primitive)', () => {
  function Trigger({ options }: { options: Parameters<ReturnType<typeof useToast>['show']>[0] }) {
    const toast = useToast();
    return (
      <button type="button" onClick={() => toast.show(options)}>
        go
      </button>
    );
  }

  it('mounts an aria-live toast-region and show() enqueues a toast', () => {
    const { container } = render(
      <ToastProvider>
        <Trigger options={{ message: 'Saved', color: 'success', duration: 0 }} />
      </ToastProvider>
    );
    const region = document.body.querySelector('[data-civitai-ui="toast-region"]')!;
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-label')).toBe('Notifications');
    fireEvent.click(container.querySelector('button')!);
    const toasts = document.body.querySelectorAll('[data-civitai-ui="toast"]');
    expect(toasts).toHaveLength(1);
    expect(toasts[0].textContent).toContain('Saved');
    expect(toasts[0].getAttribute('data-color')).toBe('success');
  });

  it('dismiss via the close button removes the toast', () => {
    const { container } = render(
      <ToastProvider>
        <Trigger options={{ message: 'X', duration: 0 }} />
      </ToastProvider>
    );
    fireEvent.click(container.querySelector('button')!);
    expect(document.body.querySelectorAll('[data-civitai-ui="toast"]')).toHaveLength(1);
    fireEvent.click(document.body.querySelector('[data-civitai-ui-toast-close]')!);
    expect(document.body.querySelectorAll('[data-civitai-ui="toast"]')).toHaveLength(0);
  });

  it('auto-dismisses after the duration elapses', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <ToastProvider>
          <Trigger options={{ message: 'bye', duration: 3000 }} />
        </ToastProvider>
      );
      fireEvent.click(container.querySelector('button')!);
      expect(document.body.querySelectorAll('[data-civitai-ui="toast"]')).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(document.body.querySelectorAll('[data-civitai-ui="toast"]')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('useToast throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Trigger options={{ message: 'x' }} />)).toThrow(/ToastProvider/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Tooltip (new primitive)', () => {
  it('wires the trigger aria-describedby to a role=tooltip bubble', () => {
    const { container } = render(
      <Tooltip label="Info">
        <button type="button">t</button>
      </Tooltip>
    );
    const wrap = container.querySelector('[data-civitai-ui="tooltip"]')!;
    const bubble = container.querySelector('[data-civitai-ui-tooltip-bubble]')!;
    const trigger = container.querySelector('button')!;
    expect(wrap).toBeTruthy();
    expect(bubble.getAttribute('role')).toBe('tooltip');
    expect(bubble.textContent).toBe('Info');
    expect(trigger.getAttribute('aria-describedby')).toBe(bubble.id);
  });

  it('preserves an existing aria-describedby on the trigger', () => {
    const { container } = render(
      <Tooltip label="Info">
        <button type="button" aria-describedby="existing">
          t
        </button>
      </Tooltip>
    );
    const bubble = container.querySelector('[data-civitai-ui-tooltip-bubble]')!;
    const trigger = container.querySelector('button')!;
    expect(trigger.getAttribute('aria-describedby')).toBe(`existing ${bubble.id}`);
  });

  it('opens on mouseenter/focus and Escape dismisses (data-open)', () => {
    const { container } = render(
      <Tooltip label="Info">
        <button type="button">t</button>
      </Tooltip>
    );
    const wrap = container.querySelector('[data-civitai-ui="tooltip"]')!;
    const bubble = container.querySelector('[data-civitai-ui-tooltip-bubble]')!;
    expect(bubble.hasAttribute('data-open')).toBe(false);
    fireEvent.mouseEnter(wrap);
    expect(bubble.getAttribute('data-open')).toBe('true');
    fireEvent.keyDown(wrap, { key: 'Escape' });
    expect(bubble.hasAttribute('data-open')).toBe(false);
  });
});

describe('Image (new primitive)', () => {
  it('renders the container + img with data-fit + a fallback', () => {
    const { container } = render(
      <Image src="/x.jpg" alt="Preview" fit="contain" fallback="unavailable" />
    );
    const wrap = container.querySelector('[data-civitai-ui="image"]')!;
    const img = container.querySelector<HTMLImageElement>('[data-civitai-ui-image-img]')!;
    expect(wrap).toBeTruthy();
    expect(img.getAttribute('alt')).toBe('Preview');
    expect(img.getAttribute('data-fit')).toBe('contain');
    expect(container.querySelector('[data-civitai-ui-image-fallback]')!.textContent).toBe('unavailable');
  });

  it('onError flips data-status to error', () => {
    const { container } = render(<Image src="/broken.jpg" alt="p" fallback="oops" />);
    const wrap = container.querySelector('[data-civitai-ui="image"]')!;
    const img = container.querySelector('[data-civitai-ui-image-img]')!;
    fireEvent.error(img);
    expect(wrap.getAttribute('data-status')).toBe('error');
  });

  it('onLoad flips data-status to loaded', () => {
    const { container } = render(<Image src="/ok.jpg" alt="p" />);
    const wrap = container.querySelector('[data-civitai-ui="image"]')!;
    const img = container.querySelector('[data-civitai-ui-image-img]')!;
    fireEvent.load(img);
    expect(wrap.getAttribute('data-status')).toBe('loaded');
  });
});
