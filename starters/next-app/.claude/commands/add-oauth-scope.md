---
description: Add an OAuth scope to the bitmask the app requests at login
---

Add OAuth scope `$ARGUMENTS` (e.g. `ImageRead`, `ImageWrite`, `ModelRead`).

## Files to touch

1. **`src/lib/scopes.ts`** — `REQUESTED_SCOPES` is a bitmask. OR-in the new
   constant from `@civitai/app-sdk/scopes`. Example:

   ```ts
   import { Scope } from '@civitai/app-sdk/scopes';
   export const REQUESTED_SCOPES =
     Scope.AIServicesWrite | Scope.BuzzRead | Scope.UserRead | Scope.ImageRead;
   ```

2. **`README.md`** — update the "Register a Civitai OAuth App" scopes list so
   users know which to enable when registering their app on civitai.com.

3. **`.env.example`** — if any scope-specific env is needed, document it.

## Re-consent

Existing user sessions don't pick up the new scope. After deploying:

- Tell users to **log out and back in** to re-consent, or
- Bump `SESSION_SECRET` to force-invalidate all sessions (heavy-handed).

## Verify

```
pnpm typecheck
pnpm dev          # click "Sign in"; the consent screen must list the new scope
pnpm test:e2e -- auth-flow
```

See [AGENTS.md › Verifying changes](../../AGENTS.md#verifying-changes).
