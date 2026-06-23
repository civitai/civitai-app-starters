---
'@civitai/blocks-react': patch
---

fix(testing): the dev `Harness` log badge no longer overlaps or intercepts the block's own bottom content. The fixed bottom-right badge now reserves matching bottom padding on the harness frame and is `pointer-events: none` (re-enabled only on the summary/log), so clicks on a block's last row of controls (e.g. action buttons) land on the controls instead of the badge.
