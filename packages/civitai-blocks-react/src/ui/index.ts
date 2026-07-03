/**
 * `@civitai/blocks-react/ui` — opinionated UI components for Civitai App authoring.
 *
 * Two surfaces:
 *
 * 1. The headless, manifest-driven `SettingsForm` (W3 — host-themed native
 *    controls; its contract is intentionally unstyled).
 * 2. The W6 component pack — a small, Civitai-looking, self-styled component
 *    set (Button, TextInput, Textarea, Card, Stack, Group, Alert, Loader,
 *    Badge, Modal). Zero setup: rendering any of them runs `useBlocksStyles()`
 *    which injects the pack's CSS into the block document's `<head>` once.
 *    Theme via your block's `data-theme` root (gotcha #60).
 *
 * Importing from `/ui` (not the package root) keeps a transport-only block's
 * bundle lean.
 */

// W3 — manifest-driven settings form (host-themed native controls).
export { SettingsForm, SettingsFormError, isFieldVisible } from './SettingsForm.js';
export type { SettingsFormProps } from './SettingsForm.js';

// W6 — runtime style injection.
export {
  injectBlocksStyles,
  useBlocksStyles,
  BLOCKS_UI_STYLES,
} from './styles.js';

// W6 — component pack.
export { Button } from './Button.js';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button.js';

export { TextInput } from './TextInput.js';
export type { TextInputProps } from './TextInput.js';

export { Textarea } from './Textarea.js';
export type { TextareaProps } from './Textarea.js';

export { Card } from './Card.js';
export type { CardProps, CardPadding } from './Card.js';

export { Stack } from './Stack.js';
export type { StackProps } from './Stack.js';

export { Group } from './Group.js';
export type { GroupProps } from './Group.js';

export { Alert } from './Alert.js';
export type { AlertProps, AlertColor } from './Alert.js';

export { Loader } from './Loader.js';
export type { LoaderProps, LoaderSize } from './Loader.js';

export { Badge } from './Badge.js';
export type { BadgeProps, BadgeVariant, BadgeSize } from './Badge.js';

export { Modal } from './Modal.js';
export type { ModalProps, ModalSize } from './Modal.js';
