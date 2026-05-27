/**
 * `civitai upload` pairs with `civitai bundle` — pushes the asset bundle
 * to Civitai's CDN. Lands with v2 inline mode.
 */
export async function uploadCommand(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    'civitai upload — coming soon.\n' +
      "Pushes bundled assets to Civitai's CDN for host-mode rendering.\n" +
      'Not applicable to v1 iframe blocks.',
  );
}
