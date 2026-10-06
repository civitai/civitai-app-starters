import { css } from 'lit';

/** The panel controls' layout, for each shadow root that shows them. */
export const panelStyles = css`
.cvt-panel-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}

.cvt-panel-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
}

/* Side by side when each control gets about 14rem, stacked otherwise. */
.cvt-panel-row > * {
  flex: 1 1 14rem;
  min-width: 0;
}

.cvt-panel-images {
  margin: 0;
  padding: 0;
  border: none;
}

.cvt-panel-images legend {
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 500;
}

.cvt-panel-image-list,
.cvt-panel-run-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cvt-panel-image,
.cvt-panel-run {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  padding: 0;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: var(--civitai-radius, 8px);
  background: var(--civitai-color-media-placeholder, var(--civitai-color-border));
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.cvt-panel-image[aria-pressed='true'],
.cvt-panel-run[aria-pressed='true'] {
  border-color: var(--civitai-color-primary);
}

.cvt-panel-image:focus-visible,
.cvt-panel-run:focus-visible {
  outline: 2px solid var(--civitai-color-primary);
  outline-offset: 2px;
}

.cvt-panel-image img,
.cvt-panel-run img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cvt-panel-run-mark {
  font-size: 18px;
  font-weight: 600;
  color: var(--civitai-color-text-dimmed);
}

.cvt-panel-run:is([data-state='failed'], [data-state='expired'], [data-state='rejected']) .cvt-panel-run-mark {
  color: var(--civitai-color-error);
}

.cvt-panel-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.cvt-panel-hint {
  margin: 0;
  font-size: 13px;
  color: var(--civitai-color-text-dimmed);
}

.cvt-panel-hint-error {
  color: var(--civitai-color-error);
}

`;
