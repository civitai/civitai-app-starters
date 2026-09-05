import { forwardRef, useState } from 'react';

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
 * 🔴 FROZEN — shown in the `card` variant's thumbnail frame when there is no
 * usable image. Not a prop, and not blank: see
 * {@link ResourceCardProps.thumbnailUrl} for why this state is the COMMON one
 * rather than an edge case. "No preview" says the picture is missing; an empty
 * grey box reads as an image that failed to load, and "Loading…" would be an
 * outright lie.
 *
 * 🔴 "No usable image" covers TWO cases, and an audit found the second one
 * missing: a caller who supplied no `thumbnailUrl`, AND a caller who supplied
 * one that FAILED TO LOAD (a CDN 404/403, an ad-blocked host, an offline
 * viewer). Keying only on the URL being absent produced exactly the empty grey
 * box this constant's own comment exists to prevent — measured at
 * `naturalWidth: 0`, a 206x206 frame and `textContent: ""`, with `alt=""` +
 * `aria-hidden` leaving assistive tech nothing either. The `onError` handler
 * below is what closes it; gen-matrix, the one consumer that supplies
 * thumbnails, sources them from a live catalog fetch and is the likeliest to
 * hit it.
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
 * 🔴 FROZEN — the non-colour half of the selected affordance, and it is not a
 * prop for the same reason the type label is text rather than a colour swatch:
 * colour alone is not an accessible distinction (WCAG 1.4.1).
 *
 * An audit caught this component asserting that principle for `modelType` two
 * paragraphs above while conveying SELECTION by border hue alone. `aria-pressed`
 * covered assistive tech and nothing covered a sighted viewer who cannot
 * separate the border tokens. This glyph is that cover; the border-colour change
 * stays as reinforcement, not as the only signal.
 *
 * `aria-hidden` on purpose: `selected` exists only on the interactive arm, which
 * always carries `aria-pressed`, so announcing it again would say it twice.
 */
const SELECTED_MARK = '✓';

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

/** Props that do not depend on either discriminant. */
interface ResourceCardCommonProps {
  /**
   * The picked resource, exactly as the host handed it over
   * (`RESOURCE_PICKER_RESULT.selected`, `useResourcePicker`, or the
   * `generation-resources` rehydrate endpoint). Pass it through — do not
   * pre-format it, and do not re-type it locally.
   */
  resource: BlockResourceInfo;
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
   *
   * A URL that FAILS to load falls back to the same placeholder, so a dead CDN
   * link is never an empty grey square. The image is also `loading="lazy"` —
   * load-bearing for the `card` variant, which is built for grids of dozens.
   */
  thumbnailUrl?: string;
  /**
   * Trailing slot — a weight slider, a Remove button, a "Change" link.
   *
   * 🔴 Rendered as a SIBLING of the interactive hit area, never inside it. A
   * `<button>` nested in a `<button>` is invalid HTML: browsers reparent it, so
   * the inner control is unreachable by keyboard and its click is eaten by the
   * outer one. That is why this slot exists at all rather than callers wrapping
   * their own controls around the card.
   *
   * This is the FLOW slot — its content sits after the card body. For a badge
   * that must sit ON the thumbnail, use `overlay` (card variant only).
   */
  actions?: React.ReactNode;
  /** Forwarded to the root, per the pack convention for every `/ui` primitive. */
  className?: string;
  /** Forwarded to the root, per the pack convention for every `/ui` primitive. */
  style?: React.CSSProperties;
  /**
   * Test hook for the ROOT. Every inner hook is DERIVED from it by suffix, so
   * two cards in one grid stay distinguishable: `<id>-hit`, `<id>-thumb`,
   * `<id>-placeholder`, `<id>-image`, `<id>-overlay`, `<id>-name`,
   * `<id>-selected`, `<id>-meta`, `<id>-type`, `<id>-actions`.
   *
   * 🔴 Grep for the SUFFIX, never for the composed value — a composed testid
   * appears nowhere in source as a literal, so a search for `foo-name` returns
   * zero whether the selector works or has just been deleted.
   *
   * Omitted, the ids are `resource-card`, `resource-card-hit`, and so on.
   */
  'data-testid'?: string;
}

/**
 * `variant="card"` — thumbnail-first tile for a picker or browse GRID, and the
 * only shape with a thumbnail corner for {@link ResourceCardCardProps.overlay}
 * to sit in.
 *
 * `variant` is REQUIRED on purpose. There is no defensible default: the two
 * shapes exist because three first-party blocks split evenly-ish between them,
 * and a component that silently picks one renders the wrong shape for half its
 * callers with no diagnostic.
 */
interface ResourceCardCardProps extends ResourceCardCommonProps {
  variant: 'card';
  /**
   * Decorative status pill drawn over the thumbnail corner — the "Added" /
   * "In your queue" badge every picker ends up wanting.
   *
   * 🔴 STATUS, NOT CONTROLS — and the structure enforces that rather than
   * asking you to remember it. It renders as a SIBLING of the hit area, never
   * inside it, so a `<button>` here is not nested in the card's `<button>`; and
   * it carries `pointer-events: none`, so it cannot swallow a click meant for
   * the card. An earlier version rendered it inside the thumbnail frame — i.e.
   * inside the hit `<button>` — which recreated exactly the hazard
   * {@link ResourceCardCommonProps.actions} exists to prevent: measured, an
   * `onClick` pill there fired the consumer's handler AND toggled selection, and
   * the parser reparents the inner button so hydration disagrees with the server
   * HTML. Put anything clickable in `actions`.
   *
   * 🔴 WHAT THIS SLOT IS FOR, stated accurately — an earlier version of this
   * paragraph justified it with a comparison that its own CSS change had made
   * false. It said a consumer's absolutely-positioned child in `actions` would
   * "escape the card and be clipped by it (card bottom 51, child bottom 120)".
   * That measurement was taken when the root had NO `position`; the root is now
   * `position: relative`, so it IS the containing block and a hand-rolled corner
   * badge lands where the consumer asked. The honest claim is narrower: this
   * slot owns the corner OFFSETS (which are arithmetic over the hit area's
   * padding and move with it), the `pointer-events` decision, and the
   * sibling-of-the-button placement — three things every consumer would
   * otherwise re-derive, and two of which are not obvious. It is also why the
   * root's `position: relative` is now load-bearing rather than cosmetic.
   *
   * Because it is a sibling of the labelled `<button>`, its text IS reachable to
   * assistive tech — content inside the button is not, since the explicit
   * `aria-label` overrides it (that is why {@link SELECTED_MARK} is
   * `aria-hidden`). 🔴 So do NOT put the selection state here as well: with
   * `aria-pressed` already carrying it, an "Added" pill announces it a second
   * time. Mark such a pill `aria-hidden`, or use this slot for something
   * `aria-pressed` does not say.
   *
   * If you need a control here anyway, opt back in with your own
   * `pointer-events: auto`, and accept that you are on your own for focus order.
   */
  overlay?: React.ReactNode;
}

/**
 * `variant="row"` — compact line for a list of already-selected resources.
 *
 * 🔴 `overlay` is FORBIDDEN here rather than silently dropped. A row has no
 * thumbnail corner to hang a pill on, and this component argues twice in its own
 * words against exactly this shape of failure: `variant` is required because "a
 * component that silently picks one renders the wrong shape for half its callers
 * with no diagnostic", and `interactive` is a discriminated union because a
 * handler on the wrong arm "silently never fires". An `overlay` on a row is
 * content that silently never renders — the same class — so it is a type error,
 * using the same `?: never` machinery the static arm already uses.
 */
interface ResourceCardRowProps extends ResourceCardCommonProps {
  variant: 'row';
  overlay?: never;
}

/** A card nobody can activate: no button, no tab stop, no toggle semantics. */
interface ResourceCardStaticArm {
  interactive?: false;
  onSelect?: never;
  selected?: never;
  disabled?: never;
}

/** A card that IS the control: one `<button>`, with toggle semantics. */
interface ResourceCardInteractiveArm {
  interactive: true;
  /** Fires on activation (click, Enter, Space). Required — see `interactive`. */
  onSelect: () => void;
  /**
   * This resource is already picked. Sets `aria-pressed` for assistive tech AND
   * renders the frozen {@link SELECTED_MARK} for everyone else, so the state is
   * never carried by colour alone.
   */
  selected?: boolean;
  /**
   * Cannot be activated. Sets the native `disabled`.
   *
   * 🔴 Do NOT wire this to the same expression as `selected` just because a
   * picked card should not be re-picked. A disabled button leaves the tab order
   * and can never show a focus ring, so a keyboard user tabbing a grid of 24
   * silently skips every resource they have already chosen — and `aria-pressed`
   * is exactly the affordance that makes re-pressing a selected card meaningful
   * (it deselects). Reserve `disabled` for genuinely unavailable resources.
   */
  disabled?: boolean;
}

/**
 * @see ResourceCard
 *
 * 🔴 A UNION OVER TWO DISCRIMINANTS, not a flat prop bag — the four arms below
 * are `{card, row} × {static, interactive}`.
 *
 * `interactive` states whether this card is a control, rather than the component
 * inferring it from whether `onSelect` happens to be defined. Inference gets
 * both halves wrong in practice — an `onSelect` passed to something rendered as
 * static is a handler that silently never fires, and an interactive card without
 * one is a tab stop that does nothing.
 *
 * `variant` gates `overlay` for the same reason: a row has no thumbnail corner,
 * so an `overlay` there is content that silently never renders. Both are type
 * errors rather than diagnostics nobody sees.
 *
 * 🔴 CONSEQUENCE, because TypeScript's diagnostic for it is opaque: pass a
 * LITERAL (`variant="card"`, `interactive` / `interactive={false}`) or branch on
 * your condition. A `boolean` or a widened `string` VARIABLE narrows to no arm
 * and fails with `TS2322: … not assignable to 'IntrinsicAttributes &
 * ResourceCardProps'`, which names nothing useful. That is the correct behaviour
 * — a `boolean` cannot carry a sound "then `onSelect` is required" — but it
 * costs you a round if nobody says so. Spreading an `as const` prop bag
 * compiles.
 */
export type ResourceCardProps =
  | (ResourceCardCardProps & ResourceCardStaticArm)
  | (ResourceCardCardProps & ResourceCardInteractiveArm)
  | (ResourceCardRowProps & ResourceCardStaticArm)
  | (ResourceCardRowProps & ResourceCardInteractiveArm);

/**
 * 🔴 FROZEN — the accessible name of an interactive card, composed in ONE fixed
 * order everywhere.
 *
 * The visible tile is a name, a type pill and a muted meta row; read as raw
 * content that is `"Juggernaut XLCheckpointv9SD 1.5"` — and `"✓Juggernaut XL…"`
 * once selected. So the button carries an explicit label instead — and because
 * it LEADS with the same string the tile shows, it satisfies WCAG 2.5.3 (Label
 * in Name) rather than diverging from it.
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
 * host hook, and it owns no selection state: callbacks in, markup out. (Its one
 * piece of internal state is which thumbnail URL has failed to load, which is
 * about the image element, not about your data.) Whoever owns the
 * picked-resource list owns the state; this renders it.
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
 * ({@link NO_THUMBNAIL_LABEL}), the non-colour selected mark
 * ({@link SELECTED_MARK}) and the accessible-name composition
 * ({@link accessibleName}) are NOT props. Each is a statement about what a
 * resource IS, and three apps disagreeing about it is three apps telling a
 * viewer different things about the same model. What legitimately varies —
 * variant, thumbnail, selected/disabled, the two content slots, className,
 * style, the surrounding grid — is a prop.
 *
 * 🔴 NOT A LINK, on purpose. It has `modelId`/`versionId` and could build a
 * civitai.com URL, but a block renders inside a sandboxed iframe where a
 * top-level navigation is host-mediated (`useCivitaiNavigate`), so an `<a
 * href>` here would either be inert or would punch the viewer out of the app
 * mid-task. A card that navigates is a different component.
 *
 * @example
 * // Browse grid — the card IS the control. Note `selected` WITHOUT `disabled`:
 * // a picked card stays focusable and re-pressing it deselects, which is what
 * // `aria-pressed` promises. Disabling it instead drops every already-picked
 * // resource out of the tab order.
 * <ResourceCard
 *   variant="card"
 *   interactive
 *   resource={r}
 *   thumbnailUrl={catalog.get(r.versionId)?.thumbnailUrl}
 *   selected={picked.has(r.versionId)}
 *   onSelect={() => toggle(r)}
 *   // 🔴 aria-hidden, because `selected` already sets `aria-pressed`. The
 *   // overlay is a SIBLING of the button, so its text IS announced — an
 *   // un-hidden "Added" here states the selection a second time, which is the
 *   // duplication `SELECTED_MARK`'s own aria-hidden exists to prevent.
 *   overlay={picked.has(r.versionId) ? <span aria-hidden="true">Added</span> : null}
 *   data-testid={`browse-${r.versionId}`}
 * />
 *
 * @example
 * // Selected list — static, with the per-row controls in `actions`.
 * <ResourceCard variant="row" resource={lora} actions={<RemoveButton … />} />
 */
export const ResourceCard = forwardRef<HTMLDivElement, ResourceCardProps>(function ResourceCard(
  props,
  ref
): React.JSX.Element {
  const {
    resource,
    variant,
    thumbnailUrl,
    actions,
    className,
    style,
    'data-testid': testId,
  } = props;
  // `overlay` lives only on the `card` arm, so it is read through the
  // discriminant rather than destructured off the union.
  const overlay = props.variant === 'card' ? props.overlay : undefined;
  const interactive = props.interactive === true;
  const selected = interactive ? props.selected === true : false;
  const disabled = interactive ? props.disabled === true : false;
  // 🔴 Keyed by URL rather than a bare boolean, so it RESETS when the caller
  // supplies a different thumbnail. A `useState(false)` + `onError` pair would
  // latch: one dead URL and every later image for this card renders as the
  // placeholder, in a grid whose cards are recycled as the viewer pages.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useBlocksStyles();

  const id = testId ?? 'resource-card';
  const ids = {
    hit: `${id}-hit`,
    thumb: `${id}-thumb`,
    image: `${id}-image`,
    placeholder: `${id}-placeholder`,
    overlay: `${id}-overlay`,
    name: `${id}-name`,
    selected: `${id}-selected`,
    meta: `${id}-meta`,
    type: `${id}-type`,
    actions: `${id}-actions`,
  };

  const name = resourceDisplayName(resource);
  const typeLabel = typeLabelOf(resource);
  const versionName =
    typeof resource.versionName === 'string' ? resource.versionName.trim() : '';
  const baseModel = typeof resource.baseModel === 'string' ? resource.baseModel.trim() : '';
  const showImage = thumbnailUrl != null && failedUrl !== thumbnailUrl;
  const hasFrame = variant === 'card' || thumbnailUrl != null;

  // 🔴 The frame is rendered in BOTH states, with the SAME wrapper element and
  // the same CSS box. Only its CONTENT differs. Rendering nothing when there is
  // no image collapses the tile — and since `BlockResourceInfo` has no image
  // field, "no image" is the common case, not the edge one.
  const thumb = hasFrame ? (
    <span data-civitai-ui-resource-thumb="" data-testid={ids.thumb}>
      {showImage ? (
        // `alt=""` + aria-hidden: DECORATIVE. The name is carried by the
        // visible text and, when interactive, by the button's own label — an
        // alt here would make a screen reader read the resource twice.
        <img
          src={thumbnailUrl}
          alt=""
          aria-hidden="true"
          // 🔴 Load-bearing, not hygiene: the `card` variant exists for grids
          // of dozens of tiles, and eager-loading a full page of thumbnails is
          // the class of regression this package already keeps
          // `pickerOverlay.perf.browser.test.ts` for.
          loading="lazy"
          data-testid={ids.image}
          // 🔴 A dead URL must reach the SAME placeholder as a missing one. See
          // NO_THUMBNAIL_LABEL: without this a CDN 404 renders an empty grey
          // square with no copy and nothing for assistive tech.
          onError={() => setFailedUrl(thumbnailUrl)}
        />
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
        <span data-civitai-ui-resource-nameline="">
          {selected ? (
            <span
              data-civitai-ui-resource-selected=""
              data-testid={ids.selected}
              aria-hidden="true"
            >
              {SELECTED_MARK}
            </span>
          ) : null}
          <span data-civitai-ui-resource-name="" data-testid={ids.name}>
            {name}
          </span>
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
      ref={ref}

      className={className}
      style={style}
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
      {/* 🔴 A SIBLING of the hit area, exactly like `actions` and for exactly
          the same reason — see the `overlay` prop doc. It is positioned over the
          thumbnail corner from the ROOT, which is the positioned ancestor, so
          nothing about it has to live inside the button.
          🔴 The `variant === 'card'` half is KEPT even though the prop type now
          forbids `overlay` on a row: a type is not a runtime guard, and this
          package ships to JS consumers and to anyone who casts. */}
      {overlay != null && variant === 'card' ? (
        <span data-civitai-ui-resource-overlay="" data-testid={ids.overlay}>
          {overlay}
        </span>
      ) : null}
      {actions != null ? (
        <div data-civitai-ui-resource-actions="" data-testid={ids.actions}>
          {actions}
        </div>
      ) : null}
    </div>
  );
});
