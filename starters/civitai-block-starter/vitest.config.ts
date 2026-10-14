import { defineConfig } from 'vitest/config';

// happy-dom, not a real browser: these tests drive the block's BRIDGE (the
// postMessage handshake, the host context reaching the page, the outbound
// messages) and check that the `<civitai-*>` elements are registered and
// upgraded. happy-dom does no layout, so nothing here asserts a size or a
// position — `RESIZE_IFRAME` is checked for being sent, not for its height.
//
// The setup file gives happy-dom the `ElementInternals` it lacks. Without it
// `<civitai-button>` and every form control (`<civitai-text-input>`,
// `<civitai-select>`, …) throw `this.attachInternals is not a function` the
// moment they are created. It does nothing in a real browser.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['@civitai/components/testing/happy-dom'],
    // `include` alone keeps `scratch/` (the gitignored probe dir, see
    // AGENTS.md) out of the run; an `exclude` here would only REPLACE vitest's
    // default exclude list.
    include: ['test/**/*.test.ts'],
  },
});
