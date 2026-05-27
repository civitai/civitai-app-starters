---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Manifest-driven settings (W3 v0):

- `@civitai/app-sdk/blocks`: `ManifestSettings`, `SettingField`, and per-widget field types (`NumberSettingField`, `StringSettingField`, `BooleanSettingField`). Each field declares `scope: 'publisher' | 'viewer'`, a widget hint (`number | slider | toggle | text | textarea | select | resource_picker`), and optional `requires_scope` gating. Manifests now declare their settings shape directly; the host renders the UI generically.
- `@civitai/blocks-react/ui`: `SettingsForm` headless component. Renders a typed form from a `ManifestSettings` declaration, filters fields by scope + `requires_scope`, surfaces inline server-side validation errors, and delegates `resource_picker` widgets to the host via the existing `useCheckpointPicker` bridge.

Replaces the in-tree per-block-id schema map pattern with a declarative contract third-party apps can ship without a civitai-side PR.
