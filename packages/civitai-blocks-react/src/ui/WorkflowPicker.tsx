import { createElement, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import {
  blockTokenSource,
  defineCivitaiResourcePicker,
  ResourceSourceError,
  type CivitaiResourcePicker,
  type PickedResource,
  type ResourceOwner,
  type ResourceSource,
} from '@civitai/components/civitai-resource-picker';

import { useBlockToken } from '../hooks/useBlockToken.js';
import { useHostOrigin } from '../hooks/useHostOrigin.js';

/** The two model types a posted workflow can have; `ComfyWorkflows` is the retired one. */
export const WORKFLOW_PICKER_TYPES = 'Workflows ComfyWorkflows';

/**
 * Answers every search while the host origin is unknown: an error the picker
 * shows with a retry, never a silent wait. The picker searches again on its own
 * once the real source replaces this one.
 */
const NOT_CONNECTED: ResourceSource = {
  search: async () => {
    throw new ResourceSourceError('failed', 'Not connected to Civitai yet.');
  },
};

export interface WorkflowPickerProps {
  /**
   * Shows the picker. Controlled: set it back to `false` in both callbacks. The
   * picker closes itself on Escape or a backdrop click, and re-opens on the
   * next render if this still says `true`.
   */
  open: boolean;
  /**
   * The viewer picked a version. 🔴 `picked.owner` is a UX hint, never proof the
   * workflow is the viewer's own — check that server-side.
   */
  onPick: (picked: PickedResource) => void;
  /** The viewer closed the picker without picking. */
  onDismiss?: () => void;
  /** Which list shows first. Defaults to `'any'`. */
  owner?: ResourceOwner;
  /** Defaults to `'Choose a workflow'`. */
  heading?: string;
  /**
   * Where results come from. Defaults to the App Blocks catalog
   * (`/api/v1/blocks/models`) through this block's host origin and token. Pass
   * `fakeResourceSource(...)` from `@civitai/blocks-react/testing` under the
   * mock host, which has no catalog to call.
   */
  source?: ResourceSource;
}

/**
 * A workflow picker for a block: `<civitai-resource-picker>` listing
 * `Workflows` and `ComfyWorkflows`, wired to {@link useHostOrigin} and
 * {@link useBlockToken} so the viewer can pick one of their own posted
 * workflows, or anyone's.
 */
export function WorkflowPicker({
  open,
  onPick,
  onDismiss,
  owner = 'any',
  heading = 'Choose a workflow',
  source,
}: WorkflowPickerProps): React.JSX.Element {
  defineCivitaiResourcePicker();
  const host = useHostOrigin();
  const { raw, refresh } = useBlockToken();
  // Read at each request, so a refreshed token is the one sent.
  const token = useRef({ raw, refresh });
  token.current = { raw, refresh };

  const live = useMemo(
    () =>
      host
        ? blockTokenSource({
            origin: host,
            // After a 401: mint a new token (an expired one is routine in a
            // tab that slept). A failed mint returns the old token, which ends
            // the search as `unauthorized`.
            getToken: (options) =>
              options?.fresh
                ? token.current.refresh().then(
                    (fresh) => fresh.raw,
                    () => token.current.raw
                  )
                : token.current.raw,
          })
        : NOT_CONNECTED,
    [host]
  );

  const ref = useRef<CivitaiResourcePicker>(null);
  const handlers = useRef({ onPick, onDismiss });
  handlers.current = { onPick, onDismiss };

  // Properties, not attributes: React 18 would stringify the source.
  useLayoutEffect(() => {
    if (ref.current) ref.current.source = source ?? live;
  }, [source, live]);

  // No dependency list on purpose: the element closes itself on Escape or a
  // backdrop click, so it can disagree with `open` without the prop changing.
  // Every render puts it back in line, which is what lets a consumer that
  // never handled `onDismiss` open it again.
  useLayoutEffect(() => {
    if (ref.current && ref.current.open !== open) ref.current.open = open;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pick = (event: Event) => handlers.current.onPick((event as CustomEvent<PickedResource>).detail);
    const dismiss = () => handlers.current.onDismiss?.();
    el.addEventListener('pick', pick);
    el.addEventListener('dismiss', dismiss);
    return () => {
      el.removeEventListener('pick', pick);
      el.removeEventListener('dismiss', dismiss);
    };
  }, []);

  return createElement('civitai-resource-picker', {
    ref,
    types: WORKFLOW_PICKER_TYPES,
    noun: 'workflow',
    owner,
    heading,
  });
}
