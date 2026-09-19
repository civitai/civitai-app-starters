import { css } from 'lit';

/** The `-choice` row plus the themed native box, scoped to a shadow root. */
export const choiceStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  label {
    font-weight: 500;
    cursor: pointer;
    user-select: none;
    color: var(--civitai-color-text);
    font-size: 14px;
  }
  .required {
    color: var(--civitai-color-error);
    margin-left: 2px;
  }
  .description {
    font-size: 12px;
    color: var(--civitai-color-text-dimmed);
  }
  .error {
    font-size: 12px;
    color: var(--civitai-color-error);
  }
  input {
    accent-color: var(--civitai-color-primary);
    width: 16px;
    height: 16px;
    margin: 0;
    flex: none;
    cursor: pointer;
  }
  input:focus-visible {
    outline: 2px solid var(--civitai-color-primary);
    outline-offset: 2px;
  }
  input:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  input:disabled ~ label {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;
