@AGENTS.md

## Claude-specific

- This monorepo uses `pnpm` workspaces. Use `pnpm` exclusively — never `npm install` or `yarn`.
- When the user asks you to "create a new Civitai app," default to suggesting `npx tiged civitai/civitai-app-starters/starters/next-app <dest>` unless they signal a preference for Svelte or a no-SEO/PWA shape.
- Each starter ships its own `AGENTS.md` — those override this root file when you're working inside a starter directory.
