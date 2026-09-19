import { forwardRef, useImperativeHandle, useRef } from 'react';

import '@civitai/components/register';
import type { CivitaiButton } from '@civitai/components/civitai-button';
import type {
  CivitaiSegmentedControl,
  SegmentItem,
  SegmentedControlSize,
} from '@civitai/components/civitai-segmented-control';
import type { CivitaiTextInput } from '@civitai/components/civitai-text-input';

import { useEventListener, useProperties } from './use-custom-element.js';

export type { SegmentItem, SegmentedControlSize };

/** Attributes React may pass through to a custom element, plus its own. */
type ElementAttrs<T> = React.DetailedHTMLProps<React.HTMLAttributes<T>, T> &
  Record<string, unknown>;

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        'civitai-button': ElementAttrs<CivitaiButton>;
        'civitai-text-input': ElementAttrs<CivitaiTextInput>;
        'civitai-segmented-control': ElementAttrs<CivitaiSegmentedControl>;
      }
    }
  }
}

const useForwarded = <T,>(ref: React.ForwardedRef<T>): React.RefObject<T | null> => {
  const own = useRef<T>(null);
  useImperativeHandle(ref, () => own.current as T, []);
  return own;
};

export interface ButtonElementProps {
  variant?: 'filled' | 'light' | 'outline' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit' | 'reset';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  children?: React.ReactNode;
  'aria-label'?: string;
}

/** `<civitai-button>` as a React component. */
export const ButtonElement = forwardRef<CivitaiButton, ButtonElementProps>(function ButtonElement(
  { variant, size, type, loading, disabled, fullWidth, children, ...rest },
  ref
) {
  const own = useForwarded<CivitaiButton>(ref);
  useProperties(own, { variant, size, type, loading, disabled, fullWidth });
  return (
    <civitai-button ref={own} {...rest}>
      {children}
    </civitai-button>
  );
});

export interface TextInputElementProps {
  name?: string;
  value?: string;
  label?: string;
  description?: string;
  error?: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
}

/** `<civitai-text-input>` as a React component. */
export const TextInputElement = forwardRef<CivitaiTextInput, TextInputElementProps>(
  function TextInputElement(
    { value, required, disabled, readOnly, onInput, onChange, ...rest },
    ref
  ) {
    const own = useForwarded<CivitaiTextInput>(ref);
    // All as properties. `value` especially: the ATTRIBUTE is the reset
    // default, so writing it each render would make `form.reset()` a no-op.
    useProperties(own, { ...rest, value, required, disabled, readOnly });
    useEventListener(own, 'input', (event) =>
      onInput?.((event.target as CivitaiTextInput).value)
    );
    useEventListener(own, 'change', (event) =>
      onChange?.((event.target as CivitaiTextInput).value)
    );
    return <civitai-text-input ref={own} />;
  }
);

export interface SegmentedControlElementProps {
  data: SegmentItem[];
  value?: string;
  name?: string;
  size?: SegmentedControlSize;
  onChange?: (value: string) => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/** `<civitai-segmented-control>` as a React component. */
export const SegmentedControlElement = forwardRef<
  CivitaiSegmentedControl,
  SegmentedControlElementProps
>(function SegmentedControlElement({ data, value, onChange, ...rest }, ref) {
  const own = useForwarded<CivitaiSegmentedControl>(ref);
  // `data` is an array and `value` is the live selection — neither survives
  // being stringified into an attribute.
  useProperties(own, { data, value, size: rest.size });
  useEventListener(own, 'change', (event) =>
    onChange?.((event.target as CivitaiSegmentedControl).value)
  );
  const { size: _size, ...attrs } = rest;
  return <civitai-segmented-control ref={own} {...attrs} />;
});
