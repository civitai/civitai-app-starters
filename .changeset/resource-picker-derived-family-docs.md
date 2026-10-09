---
'@civitai/blocks-react': patch
---

README: the `useResourcePicker()` warning now separates the two `baseModelGroup` cases in the prose the developer docs publish. A hardcoded ecosystem string is still wrong, because it hides the viewer's valid LoRAs. A family derived from the selected checkpoint (`checkpoint.baseModel`) is the recommended pattern for stack and matrix apps. The section also points multi-LoRA apps at `starters/examples/generate-studio`. Docs only, with no runtime change. The README ships in the package tarball, so the change needs a release.
