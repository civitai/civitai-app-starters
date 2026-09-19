import { css } from 'lit';

/**
 * The legacy `[data-civitai-ui]` rule, and no more than it: adding a
 * `line-height` here silently relaid out every element whose legacy
 * counterpart inherited one.
 */
export const hostBaseline = css`
  :host {
    box-sizing: border-box;
    font-family: var(--civitai-font);
  }
  :host *,
  :host *::before,
  :host *::after {
    box-sizing: inherit;
  }
  :host([hidden]) {
    display: none;
  }
`;

/** The `[data-civitai-ui='loader']` ring, scoped to a `.spinner` element. */
export const spinner = css`
  .spinner {
    display: inline-block;
    border-radius: 50%;
    border-style: solid;
    border-color: color-mix(in srgb, currentColor 25%, transparent);
    border-top-color: currentColor;
    color: var(--civitai-color-primary);
    animation: civitai-ui-spin 0.7s linear infinite;
    width: 22px;
    height: 22px;
    border-width: 3px;
  }
  .spinner[data-size='sm'] {
    width: 16px;
    height: 16px;
    border-width: 2px;
  }
  .spinner[data-size='lg'] {
    width: 32px;
    height: 32px;
    border-width: 4px;
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 2.4s;
    }
  }
  @keyframes civitai-ui-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;
