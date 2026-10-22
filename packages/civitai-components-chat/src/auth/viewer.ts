import type { AppClient, BlockAppClient } from '@civitai/sdk';

/**
 * A client `initialize()` made inside a civitai.com page, told apart by the members only that kind
 * has. Whichever token it holds, the host's `viewer` names the person, so no API call is needed.
 */
export function isBlockClient(app: AppClient): app is BlockAppClient {
  return 'host' in app && 'viewer' in app;
}

/** The signed-in viewer's id; `/me` accepts an OAuth token but refuses a block-scoped one. */
export async function viewerId(app: AppClient): Promise<number | undefined> {
  if (isBlockClient(app)) return app.viewer?.id;
  return (await app.site.get<{ id?: number }>('me')).id;
}
