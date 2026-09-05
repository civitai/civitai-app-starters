---
'@civitai/blocks-react': minor
---

Add `ResourceCard` to `/ui` — a presentational, stateless renderer for a picked Civitai generation resource (a checkpoint or a LoRA), in two variants: `variant="card"` (thumbnail-first tile for a picker/browse grid) and `variant="row"` (compact line for a list of already-selected resources).

Derived from three first-party blocks that each built one independently: `civitai-app-gen-matrix` (`CardTile` — thumbnail, model name, base model, rendered as a `<button>` with `aria-pressed`, a disabled "already added" state), `civitai-app-model-benchmarking` (`CombinationForm` — compact rows showing `modelName ?? '#'+versionId` then `baseModel → <ecosystem>`, with a weight slider and a Remove button per LoRA), and `civitai-block-generate-from-model` (an inline "Generating with: **Name (Version)**" plus a Change link). The first is the `card` shape; the other two are `row`. Adopting it in those apps is deliberately NOT part of this change — each needs the published version first.

🔴 **`BlockResourceInfo` carries NO image field.** Measured against `packages/civitai-app-sdk/src/blocks/types.ts`: it declares `versionId`, `modelId`, `modelName`, `versionName`, `baseModel`, `modelType` plus the optional recommended-settings projection (`strength`, `minStrength`, `maxStrength`, `trainedWords`, `clipSkip`), and nothing image-shaped. The host's resource picker does not return a thumbnail. Three consequences, and they shape the whole component:

- `thumbnailUrl` is an OPTIONAL prop the caller supplies from its own source (gen-matrix fetches a catalog). The component cannot derive one and does not try.
- Having no thumbnail is the COMMON case, not an edge case — two of the three known consumers have none — so both variants must look deliberate without one. `variant="card"` renders a frame that keeps its `aspect-ratio: 1 / 1` and says "No preview"; it does not collapse to a text sliver. `variant="row"` omits the 36px tile entirely rather than stamping an empty grey square on every line of a list.
- The frame is the SAME element in both states, so a mixed grid does not render ragged rows.

**What is deliberately NOT a prop.** This is the half that makes promoting the component worth anything — the markup was never the expensive part. Each frozen item is a statement about what a resource *is*, and three apps disagreeing about it is three apps telling a viewer different things about the same model:

- **The name fallback.** `modelName` is typed `string` (required) and the type is optimistic — model-benchmarking writes `modelName ?? '#'+versionId` in its own source, i.e. a first-party block has already seen it absent at runtime. A card rendering an empty string is indistinguishable from a broken card. The fallback is `#<versionId>`: still wrong-looking, but wrong in a way that identifies the resource. It is not overridable because a per-app placeholder ("Untitled model") is indistinguishable from a resource actually called that. Whitespace-only counts as absent. Exported as `resourceDisplayName` so a caller composing its own label agrees with the card rather than re-deriving it.
- **The LoRA/Checkpoint distinction.** A frozen, case-insensitive map (`checkpoint` → "Checkpoint"; `lora`/`locon`/`lycoris`/`dora` → "LoRA"), rendered as a text label rather than by colour — colour alone is not an accessible distinction. 🔴 An UNRECOGNISED `modelType` renders VERBATIM and is never coerced into a known label: a Controlnet announced as "Checkpoint" is a confident lie about what the viewer is generating with, where the raw string is merely unpolished. A blank type renders no pill at all.
- **The missing-thumbnail copy** ("No preview"). An empty grey box reads as an image that failed to load; "Loading…" would be a lie.
- **The accessible-name composition** for an interactive card: `"<name>, <version>, <type>, <baseModel>"`, absent segments dropped. The visible tile read as raw content is `"Detail TweakerLoRARev2SDXL 1.0"`, so the button carries an explicit label — and because it LEADS with the visible name it satisfies WCAG 2.5.3 (Label in Name) rather than diverging from it. The selected state is not spelled into the name; `aria-pressed` already carries it.

What legitimately varies is a prop: `variant`, `thumbnailUrl`, `selected`, `disabled`, the `actions` slot, `data-testid`, and the surrounding grid or list.

**Accessibility, decided rather than defaulted:**

- Interactivity is an explicit **discriminant prop**, not something inferred from whether `onSelect` happens to be defined. `ResourceCardProps` is a union: `interactive: true` requires `onSelect` and permits `selected`/`disabled`; the static arm forbids all three. Inference gets both halves wrong in practice — an `onSelect` on something rendered static is a handler that silently never fires, and an interactive card without one is a tab stop that does nothing. Under the union each is a type error.
- Interactive → exactly one `<button type="button">` with `aria-pressed` and the composed label. Static → a plain `<div>` with no role, no `tabIndex` and no handler: a list of already-chosen resources must not put N dead focus stops between a keyboard user and the control they actually want.
- 🔴 **NOT a link,** though it has `modelId`/`versionId` and could build a civitai.com URL. A block renders in a sandboxed iframe where a top-level navigation is host-mediated (`useCivitaiNavigate`), so an `<a href>` here would either be inert or punch the viewer out of the app mid-task. A card that navigates is a different component.
- The `actions` slot renders as a SIBLING of the hit area, never inside it. A `<button>` nested in a `<button>` is invalid HTML: the browser reparents it, the inner control becomes unreachable by keyboard, and its click is eaten by the outer one. That is why the slot exists at all rather than callers wrapping their own controls around the card.
- The thumbnail is decorative (`alt=""` + `aria-hidden`), so the resource is read once, not twice.

`variant` is REQUIRED. There is no defensible default: the two exist because the known consumers split between them, and silently picking one renders the wrong shape for half the callers with no diagnostic.

**Styling** follows the pack: attribute-driven CSS on `--civitai-*` tokens, added to this package's local stylesheet (`@civitai/components` has no counterpart for it), with the `Badge` primitive reused for the type pill. Every selector is double-qualified with `[data-civitai-ui='resource-card']` because `data-variant` is also emitted by Button and Badge.

**Not covered:** the component does not surface `trainedWords`, `strength`/`minStrength`/`maxStrength` or `clipSkip`. Model-benchmarking's weight slider reads those and passes the control in via `actions`, which works, but a block that wants a *built-in* weight control would have to reach past this component — worth deciding before wide adoption.
