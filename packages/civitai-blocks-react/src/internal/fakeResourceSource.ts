/**
 * `fakeResourceSource` — canned results for `<WorkflowPicker>` /
 * `<civitai-resource-picker>` where there is no catalog to call: the mock host,
 * a unit test, a story. No network.
 *
 * It answers the way the real endpoint does where the picker can tell:
 * it filters by `owner`, `types` and `query`, and echoes the `owner` it applied.
 */
import type {
  ResourceItem,
  ResourceOwner,
  ResourcePage,
  ResourceSearchParams,
  ResourceSource,
} from '@civitai/components/civitai-resource-picker';

/** What a {@link fakeResourceSource} lists. */
export interface FakeResourceCanned {
  /** The viewer's own resources: what `owner=mine` lists. */
  mine?: readonly ResourceItem[];
  /**
   * Everybody's: what `owner=any` lists. Defaults to `mine` plus nothing else,
   * so a fake with only `mine` still shows them under "All".
   */
  any?: readonly ResourceItem[];
}

/** A {@link ResourceSource} that also records what it was asked. */
export interface FakeResourceSource extends ResourceSource {
  /** Every search, oldest first. */
  readonly calls: readonly ResourceSearchParams[];
}

/** Canned picker results. See {@link FakeResourceCanned}. */
export function fakeResourceSource(canned: FakeResourceCanned = {}): FakeResourceSource {
  const calls: ResourceSearchParams[] = [];
  const lists: Record<ResourceOwner, readonly ResourceItem[]> = {
    mine: canned.mine ?? [],
    any: canned.any ?? canned.mine ?? [],
  };
  return {
    calls,
    async search(params, signal): Promise<ResourcePage> {
      calls.push(params);
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const query = params.query?.trim().toLowerCase() ?? '';
      const items = lists[params.owner].filter(
        (item) =>
          (params.types.length === 0 || params.types.includes(item.type)) &&
          (query === '' || item.name.toLowerCase().includes(query))
      );
      return { items: [...items], nextCursor: null, owner: params.owner };
    },
  };
}
