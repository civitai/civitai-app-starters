---
'@civitai/blocks-react': patch
---

**The mock host now allows 8 `useUploadImageBytes()` uploads per 60 seconds, as the real host does.** The host raised its limit from 3 to 8 uploads per 60 seconds per page in civitai/civitai#5888. `createMockHost` (and so `dev:harness` and block tests) still refused the 4th upload with `busy`, so a block tested against the mock could not reach what production allows. The 80 MiB per 60 seconds budget and the 40 MiB per-file cap are unchanged, and the README and hook docs now say 8.
