---
'@civitai/app-sdk': minor
---

Split OAuth endpoints (auth.civitai.com) from API endpoints (civitai.com) after the auth server breakout; add CIVITAI_AUTH_URL.

The OAuth flow now lives on the standalone auth hub. `buildAuthorizeUrl`, `exchangeCode`, `refreshToken`, and `revokeToken` default `baseUrl` to `https://auth.civitai.com`, while `fetchMe` (`/api/v1/me`) and `fetchBuzzAccount` (buzz tRPC) stay on `https://civitai.com`. The starters gain a `CIVITAI_AUTH_URL` env var and point their OAuth calls at it, keeping `CIVITAI_BASE_URL` for `/api/v1/me` and tRPC/buzz calls.
