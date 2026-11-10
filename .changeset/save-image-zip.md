---
'@civitai/blocks-react': minor
---

`useSaveImage({ bytes })` can save a `.zip` (e.g. an image dataset with caption files): a buffer that starts like a zip is held to a 256 MiB cap instead of 50 MiB before sending, and the host validates the archive (entry types png/jpg/jpeg/webp/txt/json/csv, safe paths, no duplicates, stored or deflate, no encryption or zip64, at most 10,000 entries and 1 GiB uncompressed) and saves it as `<name>.zip`. `createMockHost` applies the same validator (a copy of the host's) and reports `application/zip` through `onSaveBytes`. Needs a host with civitai/civitai#8420; an older host refuses a zip with `file type is not allowed` (or `file exceeds the maximum save size` over 50 MiB).
