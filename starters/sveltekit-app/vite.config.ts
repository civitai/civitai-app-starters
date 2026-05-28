import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    strictPort: false,
  },
  ssr: {
    // @civitai/client uses extension-less internal imports (e.g. './generated')
    // which Node's ESM resolver rejects (ERR_UNSUPPORTED_DIR_IMPORT). Have Vite
    // bundle it instead of externalizing for SSR.
    noExternal: ['@civitai/client', '@civitai/app-sdk'],
  },
});
