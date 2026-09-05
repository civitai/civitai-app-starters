import type { BlockResourceInfo } from '@civitai/app-sdk/blocks';

import { Badge } from './Badge.js';
import { useBlocksStyles } from './styles.js';

/**
 * 🔴 FROZEN — the LoRA/Checkpoint distinction, and it is deliberately NOT a
 * prop. Three blocks rendered `modelType` three ways ('LORA' verbatim, a local
 * map, and not at all), which means the same resource read as a different KIND
 * of thing depending on which app you were in. A viewer who thinks a LoRA is a
 * checkpoint picks a base model that cannot generate.
 *
 * Keys are lower-cased `modelType` values. LyCORIS/LoCon/DoRA are LoRA-family
 * adapters the host may resolve for a LoRA pick, so they render as "LoRA"
 * rather than as three near-synonyms nobody outside the training world can
 * rank.
 */
const TYPE_LABELS: Readonly<Record<string, string>> = {
  checkpoint: 'Checkpoint',
  lora: 'LoRA',
  locon: 'LoRA',
  lycoris: 'LoRA',
  dora: 'LoRA',
};

/**
 * 🔴 FROZEN — shown in the `card` variant's thumbnail frame when the caller has
 * no image. Not a prop, and not blank: see {@link ResourceCardProps.thumbnailUrl}
 * for why this state is the COMMON one rather than an edge case. "No preview"
 * says the picture is missing; an empty grey box reads as an image that failed
 * to load, and "Loading…" would be an outright lie.
 */
const NO_THUMBNAIL_LABEL = 'No preview';

/**
 * 🔴 FROZEN — the last-resort name when neither a name nor a usable id exists.
 * See {@link resourceDisplayName}. This is an INVARIANT guard, not a regression
 * fix: no host has been observed omitting `versionId`. It exists because the
 * alternative is rendering the literal string "#undefined" at people.
 */
const UNKNOWN_NAME = 'Unknown resource';

/**
 * 🔴 FROZEN — the name a resource renders under, and the single most important
 * thing this component takes away from its callers.
 *
 * `BlockResourceInfo.modelName` is typed `string` (REQUIRED), and that type is
 * optimistic: `civitai-app-model-benchmarking` writes `modelName ?? '#'+versionId`
 * in its own code, i.e. a first-party block has already seen it absent at
 * runtime. A resource rendered as an empty string is indistinguishable from a
 * broken card — the row is there, the name is not, and nothing tells the viewer
 * which of the two it is.
 *
 * So the fallback is `#<versionId>`: still WRONG-looking, but wrong in a way
 * that identifies the resource and can be pasted into a URL. It is not a prop
 * because a per-app placeholder ("Untitled model", "Unnamed LoRA") is
 * indistinguishable from a resource actually called that.
 *
 * Whitespace-only counts as absent — a name of `'   '` renders as nothing at
 * all, which is the failure this function exists to prevent.
 */
export function resourceDisplayName(resource: BlockResourceInfo): string {
  const name = typeof resource.modelName === 'string' ? resource.modelName.trim() : '';
  if (name !== '') return name;
  return Number.isFinite(resource.versionId) ? `#${resource.versionId}` : UNKNOWN_NAME;
}

/** Which shape to render. See {@link ResourceCardProps.variant}. */
export type ResourceCardVariant = 'card' | 'row';

interface ResourceCardBaseProps {
  /**
   * The picked resource, exactly as the host handed it over
   * (`RESOURCE_PICKER_RESULT.selected`, `useResourcePicker`, or the
   * `generation-resources` rehydrate endpoint). Pass it through — do not
   * pre-format it, and do not re-type it locally.
   */
  resource: BlockResourceInfo;
  /**
   * `'card'` — thumbnail-first tile for a picker or browse GRID.
   * `'row'` — compact line for a list of already-selected resources.
   *
   * REQUIRED on purpose. There is no defensible default: the two exist because
   * three first-party blocks split evenly-ish between them, and a component
   * that silently picks one renders the wrong shape for half its callers with
   * no diagnostic.
   */
  variant: ResourceCardVariant;
  /**
   * Thumbnail image URL. OPTIONAL, and its absence is the NORMAL case.
   *
   * 🔴 `BlockResourceInfo` CARRIES NO IMAGE FIELD — measured against
   * `packages/civitai-app-sdk/src/blocks/types.ts`, which declares
   * `versionId, modelId, modelName, versionName, baseModel, modelType` plus the
   * optional recommended-settings projection (`strength`, `minStrength`,
   * `maxStrength`, `trainedWords`, `clipSkip`) and nothing image-shaped. The
   * host's resource picker does not return a thumbnail, so this component
   * CANNOT fetch or derive one, and a caller who has one got it from somewhere
   * else (`civitai-app-gen-matrix` fetches its own catalog).
   *
   * Consequence, and the reason this is worth a paragraph: BOTH variants must
   * look deliberate with no image, and `'card'` renders
   * {@link NO_THUMBNAIL_LABEL} in a frame that keeps its aspect ratio rather
   * than collapsing the tile. Two of the three known consumers have no
   * thumbnail at all.
   */
  thumbnailUrl?: string;
  /**
   * Trailing slot — a weight slider, a Remove button, a "Change" link, an
   * "Added" pill.
   *
   * 🔴 Rendered as a SIBLING of the interactive hit area, never inside it. A
   * `<button>` nested in a `<button>` is invalid HTML: browsers reparent it, so
   * the inner control is unreachable by keyboard and its click is eaten by the
   * outer one. That is why this slot exists at all rather than callers wrapping
   * their own controls around the card.
   */
  actions?: React.ReactNode;
  /**
   * Test hook for the ROOT. Every inner hook is DERIVED from it by suffix, so
   * two cards in one grid stay distinguishable: `<id>-hit`, `<id>-thumb`,
   * `<id>-placeholder`, `<id>-name`, `<id>-meta`, `<id>-type`, `<id>-actions`.
   *
   * 🔴 Grep for the SUFFIX, never for the composed value — a composed testid
   * appears nowhere in source as a literal, so a search for `foo-name` returns
   * zero whether the selector works or has just been deleted.
   *
   * Omitted, the ids are `resource-card`, `resource-card-hit`, and so on.
   */
  'data-testid'?: string;
}

/** A card nobody can activate: no button, no tab stop, no toggle semantics. */
interface ResourceCardStaticProps extends ResourceCardBaseProps {
  interactive?: false;
  onSelect?: never;
  selected?: never;
  disabled?: never;
}

/** A card that IS the control: one `<button>`, with toggle semantics. */
interface ResourceCardInteractiveProps extends ResourceCardBaseProps {
  interactive: true;
  /** Fires on activation (click, Enter, Space). Required — see `interactive`. */
  onSelect: () => void;
  /**
   * This resource is already picked. Sets `aria-pressed`, so assistive tech
   * announces the toggle state rather than the caller having to spell it into
   * visible text.
   */
  selected?: boolean;
  /** Cannot be activated. Sets the native `disabled`. */
  disabled?: boolean;
}

/**
 * @see ResourceCard
 *
 * 🔴 A UNION, not a flat prop bag, and that is the load-bearing half of design
 * decision 4. `interactive` is an explicit DISCRIMINANT: a caller states
 * whether this card is a control, rather than the component inferring it from
 * whether `onSelect` happens to be defined. Inference gets both halves wrong in
 * practice — an `onSelect` passed to something rendered as static is a handler
 * that silently never fires, and an interactive card without one is a tab stop
 * that does nothing. Under the union each is a type error.
 */
export type ResourceCardProps = ResourceCardStaticProps | ResourceCardInteractiveProps;

/**
 * 🔴 FROZEN — the accessible name of an interactive card, composed in ONE fixed
 * order everywhere.
 *
 * The visible tile is a name, a muted meta row and a pill; read as raw content
 * that is `"Juggernaut XLv9Checkpoint SDXL 1.0"`. So the button carries an
 * explicit label instead — and because it LEADS with the same string the tile
 * shows, it satisfies WCAG 2.5.3 (Label in Name) rather than diverging from it.
 *
 * Absent segments are dropped, never rendered as an empty gap. The selected
 * state is NOT spelled here: `aria-pressed` already carries it, and duplicating
 * it in the name is how a control comes to announce "Added Added".
 */
function accessibleName(resource: BlockResourceInfo, typeLabel: string): string {
  const version = typeof resource.versionName === 'string' ? resource.versionName.trim() : '';
  const base = typeof resource.baseModel === 'string' ? resource.baseModel.trim() : '';
  return [resourceDisplayName(resource), version, typeLabel, base]
    .filter((part) => part !== '')
    .join(', ');
}

/**
 * 🔴 FROZEN — see {@link TYPE_LABELS}. An UNKNOWN type renders VERBATIM rather
 * than being coerced into one of the two known labels: a Controlnet or an
 * embedding shown as "Checkpoint" is a confident lie, whereas the raw string is
 * merely unpolished. Blank in, blank out — the pill is then omitted entirely,
 * because an empty badge is chrome that means nothing.
 */
function typeLabelOf(resource: BlockResourceInfo): string {
  const raw = typeof resource.modelType === 'string' ? resource.modelType.trim() : '';
  if (raw === '') return '';
  return TYPE_LABELS[raw.toLowerCase()] ?? raw;
}

/**
 * A picked Civitai generation resource — a checkpoint or a LoRA — rendered as a
 * grid tile (`variant="card"`) or a compact list line (`variant="row"`).
 *
 * PRESENTATIONAL AND STATELESS by construction. It does not fetch, it calls no
 * host hook, and it owns no selection state: callbacks in, markup out. Whoever
 * owns the picked-resource list owns the state; this renders it.
 *
 * Derived from three first-party blocks that each built one:
 * `civitai-app-gen-matrix` (a thumbnail tile in a browse grid, `aria-pressed`,
 * disabled once added), `civitai-app-model-benchmarking` (compact rows with a
 * weight slider and a Remove button), and `civitai-block-generate-from-model`
 * (an inline "Generating with: Name (Version)" plus a Change link). The first
 * is the `card` shape; the other two are `row`.
 *
 * 🔴 WHAT IS FROZEN, and why that is the point rather than the markup: the
 * name fallback ({@link resourceDisplayName}), the type label
 * ({@link TYPE_LABELS}), the missing-thumbnail copy
 * ({@link NO_THUMBNAIL_LABEL}) and the accessible-name composition
 * ({@link accessibleName}) are NOT props. Each is a statement about what a
 * resource IS, and three apps disagreeing about it is three apps telling a
 * viewer different things about the same model. What legitimately varies —
 * variant, thumbnail, selected/disabled, the actions slot, the surrounding
 * grid — is a prop.
 *
 * 🔴 NOT A LINK, on purpose. It has `modelId`/`versionId` and could build a
 * civitai.com URL, but a block renders inside a sandboxed iframe where a
 * top-level navigation is host-mediated (`useCivitaiNavigate`), so an `<a
 * href>` here would either be inert or would punch the viewer out of the app
 * mid-task. A card that navigates is a different component.
 *
 * @example
 * // Browse grid — the card IS the control.
 * <ResourceCard
 *   variant="card"
 *   interactive
 *   resource={r}
 *   thumbnailUrl={catalog.get(r.versionId)?.thumbnailUrl}
 *   selected={picked.has(r.versionId)}
 *   disabled={picked.has(r.versionId)}
 *   onSelect={() => add(r)}
 *   data-testid={`browse-${r.versionId}`}
 * />
 *
 * @example
 * // Selected list — static, with the per-row controls in `actions`.
 * <ResourceCard variant="row" resource={lora} actions={<RemoveButton … />} />
 */
export function ResourceCard(props: ResourceCardProps): React.JSX.Element {
  const {
    resource,
    variant,
    thumbnailUrl,
    actions,
    'data-testid': testId,
  } = props;
  const interactive = props.interactive === true;
  const selected = interactive ? props.selected === true : false;
  const disabled = interactive ? props.disabled === true : false;
  useBlocksStyles();

  const id = testId ?? 'resource-card';
  const ids = {
    hit: `${id}-hit`,
    thumb: `${id}-thumb`,
    placeholder: `${id}-placeholder`,
    name: `${id}-name`,
    meta: `${id}-meta`,
    type: `${id}-type`,
    actions: `${id}-actions`,
  };

  const name = resourceDisplayName(resource);
  const typeLabel = typeLabelOf(resource);
  const versionName =
    typeof resource.versionName === 'string' ? resource.versionName.trim() : '';
  const baseModel = typeof resource.baseModel === 'string' ? resource.baseModel.trim() : '';

  // 🔴 The frame is rendered in BOTH states, with the SAME wrapper element and
  // the same CSS box. Only its CONTENT differs. Rendering nothing when there is
  // no image collapses the tile — and since `BlockResourceInfo` has no image
  // field, "no image" is the common case, not the edge one.
  const thumb =
    variant === 'card' || thumbnailUrl != null ? (
      <span data-civitai-ui-resource-thumb="" data-testid={ids.thumb}>
        {thumbnailUrl != null ? (
          // `alt=""` + aria-hidden: DECORATIVE. The name is carried by the
          // visible text and, when interactive, by the button's own label — an
          // alt here would make a screen reader read the resource twice.
          <img src={thumbnailUrl} alt="" aria-hidden="true" loading="lazy" />
        ) : (
          <span data-civitai-ui-resource-placeholder="" data-testid={ids.placeholder}>
            {NO_THUMBNAIL_LABEL}
          </span>
        )}
      </span>
    ) : null;

  const body = (
    <>
      {thumb}
      <span data-civitai-ui-resource-text="">
        <span data-civitai-ui-resource-name="" data-testid={ids.name}>
          {name}
        </span>
        <span data-civitai-ui-resource-meta="" data-testid={ids.meta}>
          {typeLabel !== '' ? (
            <Badge size="sm" variant="outline" data-testid={ids.type}>
              {typeLabel}
            </Badge>
          ) : null}
          {versionName !== '' ? <span>{versionName}</span> : null}
          {baseModel !== '' ? <span>{baseModel}</span> : null}
        </span>
      </span>
    </>
  );

  return (
    <div
      data-civitai-ui="resource-card"
      data-variant={variant}
      data-interactive={interactive ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-testid={id}
    >
      {interactive ? (
        <button
          type="button"
          data-civitai-ui-resource-hit=""
          data-testid={ids.hit}
          aria-pressed={selected}
          disabled={disabled}
          aria-label={accessibleName(resource, typeLabel)}
          onClick={() => props.onSelect()}
        >
          {body}
        </button>
      ) : (
        // 🔴 A plain <div>, with NO role, NO tabIndex and NO handler. A static
        // card must not be a tab stop: the `row` variant exists for lists of
        // resources the viewer has ALREADY chosen, and making every one of them
        // focusable puts N dead stops between the keyboard user and the control
        // they actually want, which lives in `actions`.
        <div data-civitai-ui-resource-hit="" data-testid={ids.hit}>
          {body}
        </div>
      )}
      {actions != null ? (
        <div data-civitai-ui-resource-actions="" data-testid={ids.actions}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
