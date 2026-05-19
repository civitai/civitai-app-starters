# CLAUDE.md

See [`AGENTS.md`](./AGENTS.md) — this repo uses the cross-tool AGENTS.md standard. Everything Claude Code needs to know about picking a starter, the supported patterns, and what to avoid is documented there.

Claude-specific extras:

- This monorepo is set up for `pnpm` workspaces. Use `pnpm` exclusively — never `npm install` or `yarn`.
- When the user asks you to "create a new Civitai app," default to suggesting `npx tiged civitai/civitai-app-starters/starters/next-app <dest>` unless they signal a preference for Svelte or a no-SEO/PWA shape.
- Each starter has its own `AGENTS.md` and `CLAUDE.md` — those override anything at this root.
