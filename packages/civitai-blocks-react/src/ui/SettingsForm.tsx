import { useCallback, useMemo, useState } from 'react';

import type {
  ManifestSettings,
  ManifestSettingField,
  ManifestNumberField,
  ManifestStringField,
  ManifestBooleanField,
  SettingScope,
} from '@civitai/app-sdk/blocks';

/**
 * W3 v0 — generic, manifest-driven settings form.
 *
 * Renders one of seven primitive inputs per field based on the manifest's
 * widget hint, filters by `forScope` + `requires_scope`, and posts the
 * collected values back via `onSubmit`. Designed to be used from:
 *   1. Platform-side `/apps/installed` settings modal (publisher slice).
 *   2. Same page (viewer slice).
 *   3. Per-app settings page (`/apps/[appBlockId]/settings`).
 *   4. Model edit page banner (publisher slice).
 *
 * Intentionally headless-styled. No design tokens, no Mantine, no CSS
 * imports — the host page applies CSS via wrapper / className. The W6
 * component pack (when it lands) will own theming for `<Button>` etc.;
 * until then this form ships unstyled native controls so the platform
 * pages can theme them inline.
 *
 * Validation note: the form does client-side type / range checks only
 * (NaN, out-of-bounds). Server-side `validateBlockSettings` is the
 * authoritative gate; this layer just prevents obvious typos before the
 * round trip. Server errors surface inline via `onSubmit` rejecting with
 * `{ fieldErrors }`.
 */

export interface SettingsFormProps {
  /** App's manifest.settings declaration (already validated server-side). */
  manifestSettings: ManifestSettings;
  /** App's declared scopes — drives `requires_scope` field gating. */
  declaredScopes: string[];
  /** Which slice of fields to render. */
  forScope: SettingScope;
  /**
   * Initial values keyed by field name. Missing keys fall back to the
   * manifest field's `default`. Unknown keys are ignored.
   */
  initialValues: Record<string, unknown>;
  /**
   * Persist the form's collected values. May throw a SettingsFormError
   * with per-field messages — the form surfaces them inline.
   */
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  /**
   * Resource picker integration. Required when the manifest declares any
   * `widget: 'resource_picker'` field. Pass the host-mediated picker —
   * typically a thin wrapper around `useCheckpointPicker()` for the
   * Checkpoint case, or a future `useResourcePicker()` hook.
   *
   * The callback receives the field's `widget_options` (e.g.
   * `{ resource_type: 'Checkpoint', filter_by_ecosystem: true }`) plus
   * the current value, and returns the picked resource's id (or null if
   * the user dismissed without picking).
   */
  resourcePicker?: (opts: {
    fieldKey: string;
    widgetOptions: Record<string, unknown>;
    currentValue: number | null;
  }) => Promise<number | null>;
  /** Button label. Defaults to 'Save'. */
  submitLabel?: string;
  /** Optional className applied to the form root for the host to style. */
  className?: string;
}

/**
 * Thrown by `onSubmit` callers to surface per-field server errors back to
 * the form. The form renders the message under the named field.
 */
export class SettingsFormError extends Error {
  override readonly name = 'SettingsFormError';
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Settings validation failed');
  }
}

/**
 * Test if a field should render for the current scope + declared-scopes
 * combination. Exposed for callers that want to count visible fields
 * before rendering (e.g. "no settings to configure" empty state).
 */
export function isFieldVisible(
  field: ManifestSettingField,
  forScope: SettingScope,
  declaredScopes: string[]
): boolean {
  if (field.scope !== forScope) return false;
  if (field.requires_scope && !declaredScopes.includes(field.requires_scope)) return false;
  return true;
}

export function SettingsForm(props: SettingsFormProps): React.JSX.Element {
  const visibleFields = useMemo(
    () =>
      Object.entries(props.manifestSettings).filter(([, def]) =>
        isFieldVisible(def, props.forScope, props.declaredScopes)
      ),
    [props.manifestSettings, props.forScope, props.declaredScopes]
  );

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {};
    for (const [key, def] of visibleFields) {
      if (Object.prototype.hasOwnProperty.call(props.initialValues, key)) {
        seed[key] = props.initialValues[key];
      } else if (def.default !== undefined) {
        seed[key] = def.default;
      } else {
        seed[key] = null;
      }
    }
    return seed;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const setFieldValue = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      // Client-side range guard so users get immediate feedback. Server
      // is still authoritative — same checks fire there.
      const clientErrors: Record<string, string> = {};
      for (const [key, def] of visibleFields) {
        const err = clientValidateField(key, def, values[key]);
        if (err) clientErrors[key] = err;
      }
      if (Object.keys(clientErrors).length > 0) {
        setErrors(clientErrors);
        return;
      }
      setSubmitting(true);
      setSubmitError(null);
      try {
        await props.onSubmit(values);
        setErrors({});
      } catch (err) {
        if (err instanceof SettingsFormError) {
          setErrors(err.fieldErrors);
        } else if (err instanceof Error) {
          setSubmitError(err.message);
        } else {
          setSubmitError('Failed to save settings');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [props, values, visibleFields]
  );

  if (visibleFields.length === 0) {
    return (
      <div className={props.className} data-civitai-settings-form="empty">
        <p>No settings to configure.</p>
      </div>
    );
  }

  return (
    <form
      className={props.className}
      data-civitai-settings-form={props.forScope}
      onSubmit={handleSubmit}
    >
      {visibleFields.map(([key, def]) => (
        <FieldRow
          key={key}
          fieldKey={key}
          def={def}
          value={values[key]}
          error={errors[key]}
          disabled={submitting}
          resourcePicker={props.resourcePicker}
          onChange={(v) => setFieldValue(key, v)}
        />
      ))}
      {submitError ? (
        <div data-civitai-settings-form-error role="alert">{submitError}</div>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        data-civitai-settings-form-submit
        // Don't rely on the implicit form submit event — happy-dom (and
        // some browsers in older modes) won't dispatch it for a synthetic
        // click. Calling `handleSubmit` directly mirrors the production
        // path: e.preventDefault() inside handleSubmit is a no-op when
        // `e` is undefined.
        onClick={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        {submitting ? 'Saving…' : props.submitLabel ?? 'Save'}
      </button>
    </form>
  );
}

interface FieldRowProps {
  fieldKey: string;
  def: ManifestSettingField;
  value: unknown;
  error?: string;
  disabled: boolean;
  resourcePicker: SettingsFormProps['resourcePicker'];
  onChange: (value: unknown) => void;
}

function FieldRow(props: FieldRowProps): React.JSX.Element {
  const { fieldKey, def, value, error, disabled, onChange, resourcePicker } = props;
  return (
    <div data-civitai-settings-field={fieldKey}>
      <label htmlFor={`setting-${fieldKey}`}>
        <span data-label>{def.label}</span>
        <span data-description>{def.description}</span>
      </label>
      <FieldInput
        fieldKey={fieldKey}
        def={def}
        value={value}
        disabled={disabled}
        resourcePicker={resourcePicker}
        onChange={onChange}
      />
      {error ? (
        <div data-civitai-settings-field-error role="alert">{error}</div>
      ) : null}
    </div>
  );
}

interface FieldInputProps {
  fieldKey: string;
  def: ManifestSettingField;
  value: unknown;
  disabled: boolean;
  resourcePicker: SettingsFormProps['resourcePicker'];
  onChange: (value: unknown) => void;
}

function FieldInput(props: FieldInputProps): React.JSX.Element {
  const { fieldKey, def, value, disabled, onChange, resourcePicker } = props;
  const id = `setting-${fieldKey}`;
  if (def.type === 'number') {
    return renderNumberField(id, def, value, disabled, onChange, resourcePicker, fieldKey);
  }
  if (def.type === 'string') {
    return renderStringField(id, def, value, disabled, onChange);
  }
  return renderBooleanField(id, def, value, disabled, onChange);
}

function renderNumberField(
  id: string,
  def: ManifestNumberField,
  value: unknown,
  disabled: boolean,
  onChange: (value: unknown) => void,
  resourcePicker: SettingsFormProps['resourcePicker'],
  fieldKey: string
): React.JSX.Element {
  const widget = def.widget ?? 'number';
  if (widget === 'resource_picker') {
    return (
      <button
        id={id}
        type="button"
        disabled={disabled}
        data-civitai-settings-input="resource_picker"
        onClick={async () => {
          if (!resourcePicker) return;
          const next = await resourcePicker({
            fieldKey,
            widgetOptions: def.widget_options ?? {},
            currentValue: typeof value === 'number' ? value : null,
          });
          onChange(next);
        }}
      >
        {typeof value === 'number' ? `Selected: #${value}` : 'Choose…'}
      </button>
    );
  }
  if (widget === 'slider') {
    return (
      <input
        id={id}
        type="range"
        data-civitai-settings-input="slider"
        disabled={disabled}
        min={def.min}
        max={def.max}
        step={def.step ?? 1}
        value={typeof value === 'number' ? value : def.default ?? def.min ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }
  return (
    <input
      id={id}
      type="number"
      data-civitai-settings-input="number"
      disabled={disabled}
      min={def.min}
      max={def.max}
      step={def.step}
      value={typeof value === 'number' ? value : ''}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          onChange(null);
          return;
        }
        const parsed = Number(raw);
        onChange(Number.isFinite(parsed) ? parsed : raw);
      }}
    />
  );
}

function renderStringField(
  id: string,
  def: ManifestStringField,
  value: unknown,
  disabled: boolean,
  onChange: (value: unknown) => void
): React.JSX.Element {
  const widget = def.widget ?? 'text';
  if (widget === 'select') {
    return (
      <select
        id={id}
        data-civitai-settings-input="select"
        disabled={disabled}
        value={typeof value === 'string' ? value : def.default ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {(def.enum ?? []).map((option: string) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (widget === 'textarea') {
    return (
      <textarea
        id={id}
        data-civitai-settings-input="textarea"
        disabled={disabled}
        maxLength={def.max_length}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      id={id}
      type="text"
      data-civitai-settings-input="text"
      disabled={disabled}
      maxLength={def.max_length}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function renderBooleanField(
  id: string,
  _def: ManifestBooleanField,
  value: unknown,
  disabled: boolean,
  onChange: (value: unknown) => void
): React.JSX.Element {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      data-civitai-settings-input="toggle"
      disabled={disabled}
      checked={value === true}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function clientValidateField(
  _key: string,
  def: ManifestSettingField,
  raw: unknown
): string | null {
  // null is a valid "cleared" state for any nullable field (e.g. resource
  // picker that hasn't been set). Treat as "no value to range-check."
  if (raw === null || raw === undefined) return null;
  if (def.type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return `${def.label} must be a number`;
    }
    if (def.min !== undefined && raw < def.min) return `${def.label} must be >= ${def.min}`;
    if (def.max !== undefined && raw > def.max) return `${def.label} must be <= ${def.max}`;
    return null;
  }
  if (def.type === 'string') {
    if (typeof raw !== 'string') return `${def.label} must be a string`;
    if (def.max_length !== undefined && raw.length > def.max_length) {
      return `${def.label} exceeds max length ${def.max_length}`;
    }
    if (def.pattern) {
      try {
        if (!new RegExp(def.pattern).test(raw)) return `${def.label} format invalid`;
      } catch {
        /* server reports malformed pattern */
      }
    }
    if (def.enum && !def.enum.includes(raw)) return `${def.label} not in allowed values`;
    return null;
  }
  // boolean
  if (typeof raw !== 'boolean') return `${def.label} must be a boolean`;
  return null;
}
