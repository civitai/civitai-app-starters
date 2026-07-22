# @civitai/components

## 0.1.1

### Patch Changes

- b61eb57: Fix design-system onboarding papercuts found by a blind dogfood (lockstep 0.1.1).

  - **CDN styles.css now resolves on any CDN.** `@civitai/theme` and
    `@civitai/components` ship a real package-root `styles.css` file (built from
    `dist/`), so a literal path like
    `cdn.jsdelivr.net/npm/@civitai/theme@0.1.1/styles.css` resolves — jsDelivr
    ignores package.json `exports`, so the `./styles.css` export alias alone 404'd
    there. The `exports` alias still works for bundler imports.
  - **Docs CDN URLs fixed** — every README + `MARKUP.md` now uses pinned,
    resolvable jsDelivr URLs.
  - **Markup contract inlined** into the `@civitai/components` README (the
    relative `MARKUP.md` link 404'd on npmjs.com); `MARKUP.md` stays canonical.
  - **Servable `demo/index.html`** now ships in the `@civitai/components` tarball —
    a complete copy-paste plain-HTML page (CDN links, one of every component, a
    light/dark `data-theme` toggle, page theming via `--civitai-color-body`).
  - **New `--civitai-color-body` token** in `@civitai/theme` (derived from
    Mantine's `--mantine-color-body`: `#fefefe` light / `#1A1B1E` dark) — a
    page-background token for plain-HTML apps.

- Updated dependencies [b61eb57]
  - @civitai/theme@0.1.1
