/**
 * `civitai bundle` is reserved for v2 inline mode (host-rendered blocks
 * loaded as static asset bundles rather than embedded iframes). The v1
 * iframe path doesn't need a bundle step — `vite build` is the build.
 */
export async function bundleCommand(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    'civitai bundle — coming soon.\n' +
      'Builds a static asset bundle for host-mode (inline) deployment.\n' +
      'Not applicable to v1 iframe blocks; use `vite build` for those.',
  );
}
