import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ManifestSettings } from '@civitai/app-sdk/blocks';

import {
  SettingsForm,
  SettingsFormError,
  isFieldVisible,
} from '../src/ui/SettingsForm.js';

/**
 * Behavioral coverage for SettingsForm. Hits scope filtering, requires_scope
 * gating, value editing, submit happy path, client-side validation, and
 * server-side error inlining via SettingsFormError.
 *
 * Renders unstyled native controls — the host applies CSS. Tests assert on
 * data-* attributes so they're robust against any future re-styling pass.
 */

const sampleManifest: ManifestSettings = {
  buzz_budget_per_gen: {
    scope: 'publisher',
    type: 'number',
    widget: 'number',
    label: 'Max Buzz per generation',
    description: 'Cap on Buzz spent per generation request.',
    default: 10,
    min: 1,
    max: 1000,
    requires_scope: 'ai:write:budgeted',
  },
  default_checkpoint: {
    scope: 'publisher',
    type: 'number',
    widget: 'resource_picker',
    label: 'Default checkpoint',
    description: 'Pin a checkpoint for this install.',
    default: null,
  },
  show_advanced: {
    scope: 'publisher',
    type: 'boolean',
    widget: 'toggle',
    label: 'Show advanced controls',
    description: 'Reveal seed/sampler/steps.',
    default: false,
  },
  ecosystem: {
    scope: 'publisher',
    type: 'string',
    widget: 'select',
    label: 'Ecosystem',
    description: 'Restrict to a base-model family.',
    enum: ['flux', 'sdxl'],
    default: 'flux',
  },
  greeting: {
    scope: 'publisher',
    type: 'string',
    widget: 'text',
    label: 'Greeting',
    description: 'Header text.',
    default: 'hi',
    max_length: 20,
  },
  viewer_pref: {
    scope: 'viewer',
    type: 'number',
    widget: 'number',
    label: 'Per-viewer override',
    description: 'Tweak for your account.',
    default: 5,
  },
};

const declaredScopes = ['ai:write:budgeted', 'models:read:self', 'buzz:read:self'];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('isFieldVisible', () => {
  it('returns true when scope matches and requires_scope is satisfied', () => {
    expect(
      isFieldVisible(sampleManifest.buzz_budget_per_gen!, 'publisher', declaredScopes)
    ).toBe(true);
  });
  it('returns false when requires_scope is not declared', () => {
    expect(isFieldVisible(sampleManifest.buzz_budget_per_gen!, 'publisher', [])).toBe(false);
  });
  it('returns false when scope mismatches', () => {
    expect(isFieldVisible(sampleManifest.viewer_pref!, 'publisher', declaredScopes)).toBe(false);
  });
});

describe('SettingsForm — render filtering', () => {
  it('renders only the publisher fields whose requires_scope is satisfied', () => {
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{}}
        onSubmit={async () => {}}
      />
    );
    expect(screen.getByText('Max Buzz per generation')).toBeTruthy();
    expect(screen.getByText('Default checkpoint')).toBeTruthy();
    expect(screen.getByText('Show advanced controls')).toBeTruthy();
    expect(screen.getByText('Ecosystem')).toBeTruthy();
    expect(screen.getByText('Greeting')).toBeTruthy();
    expect(screen.queryByText('Per-viewer override')).toBeNull();
  });

  it('hides budget field when ai:write:budgeted is not declared', () => {
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={['models:read:self']}
        forScope="publisher"
        initialValues={{}}
        onSubmit={async () => {}}
      />
    );
    expect(screen.queryByText('Max Buzz per generation')).toBeNull();
    expect(screen.getByText('Greeting')).toBeTruthy();
  });

  it('renders empty state when no fields are visible', () => {
    render(
      <SettingsForm
        manifestSettings={{}}
        declaredScopes={[]}
        forScope="publisher"
        initialValues={{}}
        onSubmit={async () => {}}
      />
    );
    expect(screen.getByText('No settings to configure.')).toBeTruthy();
  });

  it('renders viewer slice when forScope=viewer', () => {
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="viewer"
        initialValues={{}}
        onSubmit={async () => {}}
      />
    );
    expect(screen.getByText('Per-viewer override')).toBeTruthy();
    expect(screen.queryByText('Max Buzz per generation')).toBeNull();
  });
});

describe('SettingsForm — value editing + submit', () => {
  it('submits manifest defaults when nothing is edited', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{}}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      buzz_budget_per_gen: 10,
      default_checkpoint: null,
      show_advanced: false,
      ecosystem: 'flux',
      greeting: 'hi',
    });
  });

  it('seeds initialValues over manifest defaults', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{ buzz_budget_per_gen: 50, greeting: 'hello' }}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0].buzz_budget_per_gen).toBe(50);
    expect(onSubmit.mock.calls[0]![0].greeting).toBe('hello');
  });

  it('updates a number field through user input', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{}}
        onSubmit={onSubmit}
      />
    );
    const input = document.getElementById('setting-buzz_budget_per_gen') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0].buzz_budget_per_gen).toBe(42);
  });

  it('toggles a boolean field', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{}}
        onSubmit={onSubmit}
      />
    );
    const toggle = document.getElementById('setting-show_advanced') as HTMLInputElement;
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0].show_advanced).toBe(true);
  });

  it('selects from an enum', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{}}
        onSubmit={onSubmit}
      />
    );
    const select = document.getElementById('setting-ecosystem') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'sdxl' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0].ecosystem).toBe('sdxl');
  });
});

describe('SettingsForm — client-side validation', () => {
  it('blocks submit and surfaces inline error for out-of-range number', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{}}
        onSubmit={onSubmit}
      />
    );
    const input = document.getElementById('setting-buzz_budget_per_gen') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99999' } });
    fireEvent.click(screen.getByText('Save'));
    // Client check fires synchronously before onSubmit; give the microtask
    // queue a tick to ensure no surprise async submit.
    await Promise.resolve();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Max Buzz per generation must be <= 1000/)).toBeTruthy();
  });

  it('blocks submit when text exceeds max_length', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{}}
        onSubmit={onSubmit}
      />
    );
    const input = document.getElementById('setting-greeting') as HTMLInputElement;
    // happy-dom respects maxLength on user typing, but fireEvent.change
    // bypasses it — exactly what we want for the test.
    fireEvent.change(input, { target: { value: 'x'.repeat(50) } });
    fireEvent.click(screen.getByText('Save'));
    await Promise.resolve();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Greeting exceeds max length 20/)).toBeTruthy();
  });
});

describe('SettingsForm — server-side error inlining', () => {
  it('surfaces SettingsFormError.fieldErrors per field', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new SettingsFormError({ buzz_budget_per_gen: 'wrong-ecosystem' })
    );
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{}}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(screen.getByText('wrong-ecosystem')).toBeTruthy();
    });
  });

  it('surfaces a plain Error message as a form-level error', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('network down'));
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{}}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(screen.getByText('network down')).toBeTruthy();
    });
  });
});

describe('SettingsForm — resource_picker integration', () => {
  it('invokes the picker callback and stores the returned versionId', async () => {
    const resourcePicker = vi.fn().mockResolvedValue(691639);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{}}
        onSubmit={onSubmit}
        resourcePicker={resourcePicker}
      />
    );
    fireEvent.click(screen.getByText('Choose…'));
    await waitFor(() =>
      expect(resourcePicker).toHaveBeenCalledWith({
        fieldKey: 'default_checkpoint',
        widgetOptions: {},
        currentValue: null,
      })
    );
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0].default_checkpoint).toBe(691639);
  });

  it('stores null when the picker is dismissed', async () => {
    const resourcePicker = vi.fn().mockResolvedValue(null);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsForm
        manifestSettings={sampleManifest}
        declaredScopes={declaredScopes}
        forScope="publisher"
        initialValues={{ default_checkpoint: 100 }}
        onSubmit={onSubmit}
        resourcePicker={resourcePicker}
      />
    );
    // Initial render shows the chosen versionId; click to re-pick.
    fireEvent.click(screen.getByText('Selected: #100'));
    await waitFor(() => expect(resourcePicker).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0].default_checkpoint).toBeNull();
  });
});
