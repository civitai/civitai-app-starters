/**
 * `@civitai/blocks-react/ui` — opinionated UI components for App Block authoring.
 *
 * v0 scope: just the generic, manifest-driven `SettingsForm`. The W6
 * component pack (Button, Input, Card, Modal, …) will land here too as
 * separate exports; importing from `/ui` (not the root) keeps the
 * transport-only consumer's bundle lean.
 */

export { SettingsForm, SettingsFormError, isFieldVisible } from './SettingsForm.js';
export type { SettingsFormProps } from './SettingsForm.js';
