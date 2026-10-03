import { css } from 'lit';

/** The chat's own shadow-root styles. */
export const chatStyles = css`
/* The region positions itself with a rule it adds to the document head, which does not reach into this shadow root. */
civitai-toast-region {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(92vw, 380px);
  pointer-events: none;
  box-sizing: border-box;
}

:host {
  display: block;
  height: 100%;
  min-height: 0;
  container: civitai-chat / inline-size;
  background: var(--civitai-color-body);
  color: var(--civitai-color-text);
  font-family: var(--civitai-font, system-ui, sans-serif);
  font-size: 15px;
  line-height: 1.5;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.cvt-starting {
  display: grid;
  place-items: center;
  height: 100%;
}

.cvt-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.cvt-icon-button {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--civitai-radius, 8px);
  background: none;
  color: var(--civitai-color-text-dimmed);
  cursor: pointer;
}

.cvt-icon-button:hover:not(:disabled) {
  background: var(--civitai-color-surface-2);
  color: var(--civitai-color-text);
}

.cvt-icon-button:focus-visible,
.cvt-chat-open:focus-visible,
.cvt-example:focus-visible,
.cvt-choice-option:focus-visible {
  outline: 2px solid var(--civitai-color-primary);
  outline-offset: 2px;
}

.cvt-icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.cvt-icon-button svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.cvt-brand {
  font-weight: 700;
  letter-spacing: -0.01em;
}

/* ── shell ── */

.cvt-shell {
  position: relative;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
}

.cvt-main-host {
  min-width: 0;
  height: 100%;
}

.cvt-main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  height: 100%;
}

.cvt-main::part(overlay) {
  inset: 10px;
  z-index: 20;
  border: 2px dashed color-mix(in srgb, var(--civitai-color-primary) 70%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--civitai-color-body) 72%, transparent);
  backdrop-filter: blur(6px);
  animation: cvt-drop-in 140ms ease-out;
}

.cvt-drop-card {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 28px 36px;
  border-radius: 14px;
  background: var(--civitai-color-surface);
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
  text-align: center;
  animation: cvt-drop-lift 180ms ease-out;
}

.cvt-drop-card svg {
  width: 44px;
  height: 44px;
  margin-bottom: 4px;
  padding: 10px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--civitai-color-primary) 16%, transparent);
  fill: none;
  stroke: var(--civitai-color-primary);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.cvt-drop-card strong {
  font-size: 16px;
}

.cvt-drop-card span {
  font-size: 13px;
  font-weight: 400;
  color: var(--civitai-color-text-dimmed);
}

@keyframes cvt-drop-in {
  from {
    opacity: 0;
  }
}

@keyframes cvt-drop-lift {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
}

.cvt-topbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  padding-top: max(8px, env(safe-area-inset-top));
  border-bottom: 1px solid var(--civitai-color-border);
}

.cvt-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.cvt-title {
  display: flex;
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Where there is room the chat list is a column; the title opens it as a dropdown otherwise. */
.cvt-history-toggle,
.cvt-history {
  display: none;
}

.cvt-history-toggle {
  align-items: center;
  gap: 4px;
  max-width: 100%;
  margin: 0 0 0 -8px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--civitai-radius, 8px);
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.cvt-history-toggle:hover,
.cvt-history-toggle[aria-expanded='true'] {
  background: var(--civitai-color-surface-2);
}

.cvt-history-toggle:focus-visible {
  outline: 2px solid var(--civitai-color-primary);
  outline-offset: 2px;
}

.cvt-history-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cvt-history-toggle svg {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 150ms ease;
}

.cvt-history-toggle[aria-expanded='true'] svg {
  transform: rotate(180deg);
}

.cvt-history {
  position: absolute;
  top: calc(100% + 4px);
  left: 8px;
  z-index: 30;
  width: min(340px, calc(100% - 16px));
  overflow: hidden;
  border: 1px solid var(--civitai-color-border);
  border-radius: 12px;
  background: var(--civitai-color-surface);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.22);
  animation: cvt-history-in 120ms ease-out;
}

.cvt-history civitai-chat-sidebar {
  border: none;
}

.cvt-history .cvt-sidebar-inner {
  display: flex;
  flex-direction: column;
  height: auto;
  max-height: min(480px, 70vh);
}

.cvt-history .cvt-sidebar-top {
  display: none;
}

.cvt-history .cvt-chat-list {
  flex: 1 1 auto;
  min-height: 0;
  padding-top: 4px;
}

/* No hover on touch screens, so the row actions stay visible here. */
.cvt-history .cvt-chat-actions {
  visibility: visible;
}

.cvt-history .cvt-sidebar-footer {
  padding-bottom: 12px;
}

@keyframes cvt-history-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}

.cvt-loading {
  display: grid;
  place-items: center;
}

.cvt-signed-out-chats {
  display: grid;
  align-content: start;
  justify-items: start;
  gap: 8px;
  padding: 16px;
  border-right: 1px solid var(--civitai-color-border);
  background: var(--civitai-color-surface);
}

.cvt-signed-out-chats h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.cvt-signed-out-chats p {
  margin: 0 0 4px;
  font-size: 13px;
  color: var(--civitai-color-text-dimmed);
}

.cvt-signed-out-badge {
  padding: 2px 8px;
  border: 1px solid var(--civitai-color-border);
  border-radius: 999px;
  font-size: 12px;
  color: var(--civitai-color-text-dimmed);
  white-space: nowrap;
}

.cvt-sign-in-status {
  max-width: 760px;
  margin: 0 auto;
  padding: 0 16px 4px;
  font-size: 13px;
  color: var(--civitai-color-text-dimmed);
  text-align: center;
}

.cvt-sign-in-status button {
  margin-left: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--civitai-color-primary);
  font: inherit;
  cursor: pointer;
}

/* ── sidebar ── */

civitai-chat-sidebar {
  display: block;
  min-height: 0;
  border-right: 1px solid var(--civitai-color-border);
  background: var(--civitai-color-surface);
}

.cvt-sidebar-inner {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
}

.cvt-sidebar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px;
  padding-top: max(12px, env(safe-area-inset-top));
}

.cvt-chat-list {
  overflow-y: auto;
  padding: 0 8px 12px;
}

.cvt-chat-list section h2 {
  margin: 12px 8px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--civitai-color-text-dimmed);
}

.cvt-chat-list ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.cvt-chat-row {
  display: flex;
  align-items: center;
  border-radius: var(--civitai-radius, 8px);
}

.cvt-chat-row:hover,
.cvt-chat-row[data-current] {
  background: var(--civitai-color-surface-2);
}

.cvt-chat-open {
  flex: 1;
  min-width: 0;
  padding: 8px;
  overflow: hidden;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 14px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.cvt-chat-actions {
  display: flex;
  visibility: hidden;
}

.cvt-chat-row:hover .cvt-chat-actions,
.cvt-chat-row:focus-within .cvt-chat-actions {
  visibility: visible;
}

.cvt-rename {
  width: 100%;
  margin: 2px 0;
  padding: 6px 8px;
  border: 1px solid var(--civitai-color-primary);
  border-radius: var(--civitai-radius, 8px);
  background: var(--civitai-color-body);
  color: inherit;
  font: inherit;
  font-size: 14px;
}

.cvt-empty {
  margin: 16px 8px;
  font-size: 14px;
  color: var(--civitai-color-text-dimmed);
}

.cvt-sidebar-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--civitai-color-border);
}

.cvt-user-name {
  flex: 1;
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── thread ── */

civitai-chat-thread {
  position: relative;
  display: block;
  min-height: 0;
}

.cvt-thread-scroll {
  height: 100%;
  overflow-y: auto;
  scroll-padding-bottom: 24px;
}

.cvt-thread-list {
  display: grid;
  gap: 28px;
  max-width: 800px;
  margin: 0 auto;
  padding: 24px 16px 32px;
}

.cvt-jump {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
}

civitai-chat-turn {
  display: grid;
  gap: 14px;
}

.cvt-user {
  display: grid;
  justify-items: end;
  gap: 6px;
}

.cvt-bubble {
  max-width: min(85%, 600px);
  padding: 10px 14px;
  border-radius: 18px 18px 4px 18px;
  background: var(--civitai-color-primary-light);
  color: var(--civitai-color-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.cvt-assistant {
  display: grid;
  gap: 12px;
  justify-items: start;
}

.cvt-assistant > * {
  max-width: 100%;
}

.cvt-activity,
.cvt-error-details {
  margin-top: 6px;
  font-size: 12px;
}

.cvt-error-details summary {
  cursor: pointer;
  color: var(--civitai-color-text-dimmed);
}

.cvt-error-details code {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
  font-family: var(--civitai-font-mono, ui-monospace, monospace);
}

.cvt-note {
  font-size: 14px;
  color: var(--civitai-color-text-dimmed);
}

.cvt-activity::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 8px;
  border-radius: 50%;
  background: var(--civitai-color-primary);
  animation: cvt-pulse 1.2s ease-in-out infinite;
}

.cvt-typing {
  display: flex;
  gap: 4px;
  padding: 8px 0;
}

.cvt-typing span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--civitai-color-text-dimmed);
  animation: cvt-pulse 1.2s ease-in-out infinite;
}

.cvt-typing span:nth-child(2) {
  animation-delay: 0.15s;
}

.cvt-typing span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes cvt-pulse {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}

.cvt-models {
  display: flex;
  gap: 10px;
  max-width: 100%;
  overflow-x: auto;
  padding-bottom: 4px;
}

civitai-chat-model-card {
  flex: none;
}

/* ── assistant text ── */

.cvt-md {
  overflow-wrap: anywhere;
}

.cvt-md > :first-child {
  margin-top: 0;
}

.cvt-md > :last-child {
  margin-bottom: 0;
}

.cvt-md p,
.cvt-md ul,
.cvt-md ol,
.cvt-md blockquote,
.cvt-md pre {
  margin: 0 0 10px;
}

.cvt-md ul,
.cvt-md ol {
  padding-left: 22px;
}

.cvt-md a {
  color: var(--civitai-color-primary);
}

.cvt-md code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--civitai-color-surface-2);
  font-family: var(--civitai-font-mono, ui-monospace, monospace);
  font-size: 0.9em;
}

.cvt-md pre {
  padding: 10px 12px;
  overflow-x: auto;
  border-radius: var(--civitai-radius, 8px);
  background: var(--civitai-color-surface-2);
}

.cvt-md pre code {
  padding: 0;
  background: none;
}

.cvt-md blockquote {
  padding-left: 12px;
  border-left: 3px solid var(--civitai-color-border);
  color: var(--civitai-color-text-dimmed);
}

.cvt-md table {
  border-collapse: collapse;
  margin-bottom: 10px;
  font-size: 14px;
}

.cvt-md th,
.cvt-md td {
  padding: 4px 10px;
  border: 1px solid var(--civitai-color-border);
}

/* ── choices ── */

.cvt-choice {
  margin: 0;
  padding: 0;
  border: none;
}

.cvt-choice legend {
  margin-bottom: 8px;
  font-weight: 600;
}

.cvt-choice-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cvt-choice-option {
  display: grid;
  gap: 4px;
  width: 160px;
  padding: 8px;
  border: 1px solid var(--civitai-color-border);
  border-radius: var(--civitai-radius, 8px);
  background: var(--civitai-color-surface);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.cvt-choice-option:hover:not(:disabled) {
  border-color: var(--civitai-color-primary);
}

.cvt-choice-option img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: calc(var(--civitai-radius, 8px) - 2px);
}

.cvt-choice-label {
  font-weight: 600;
  font-size: 14px;
}

.cvt-choice-description {
  font-size: 13px;
  color: var(--civitai-color-text-dimmed);
}

.cvt-choice:disabled .cvt-choice-option {
  opacity: 0.55;
  cursor: default;
}

.cvt-panel {
  display: grid;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--civitai-color-border);
  border-radius: calc(var(--civitai-radius, 8px) * 1.5);
  background: var(--civitai-color-surface);
}

.cvt-panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.cvt-panel-head h3 {
  margin: 0;
  font-size: 16px;
}

.cvt-panel-share {
  margin-left: auto;
}

.cvt-panel-head p {
  flex-basis: 100%;
  margin: 0;
  font-size: 14px;
  color: var(--civitai-color-text-dimmed);
}

.cvt-step-failed {
  font-size: 13px;
  color: var(--civitai-color-text-dimmed);
}

.cvt-step-failed summary {
  cursor: pointer;
  width: fit-content;
}

.cvt-step-failed summary::before {
  content: '⚠ ';
  color: var(--civitai-color-warning, var(--civitai-color-error));
}

.cvt-step-failed code {
  display: block;
  margin-top: 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.cvt-panel-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid var(--civitai-color-border);
  border-radius: 999px;
  background: var(--civitai-color-surface);
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.cvt-panel-chip:hover {
  border-color: var(--civitai-color-primary);
}

.cvt-panel-chip svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.cvt-panel-runs {
  display: grid;
  gap: 10px;
  justify-items: start;
}

.cvt-panel-runs > civitai-chat-generation-card {
  justify-self: stretch;
}

/* ── composer ── */

civitai-chat-composer {
  display: block;
  padding: 8px 16px 16px;
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}

.cvt-composer-box {
  display: grid;
  gap: 8px;
  max-width: 800px;
  margin: 0 auto;
  padding: 10px 12px 8px;
  border: 1px solid var(--civitai-color-border);
  border-radius: 16px;
  background: var(--civitai-color-surface);
}

.cvt-composer-box:focus-within {
  border-color: var(--civitai-color-primary);
}

.cvt-composer-box textarea {
  width: 100%;
  max-height: 240px;
  field-sizing: content;
  min-height: 1.5em;
  padding: 0;
  border: none;
  outline: none;
  resize: none;
  background: none;
  color: inherit;
  font: inherit;
}

.cvt-composer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cvt-hint {
  flex: 1;
  font-size: 12px;
  color: var(--civitai-color-text-dimmed);
  opacity: 0;
  transition: opacity 0.15s;
}

.cvt-composer-box:focus-within .cvt-hint {
  opacity: 1;
}

.cvt-send {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--civitai-color-primary);
  color: var(--civitai-color-primary-fg, #fff);
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s, transform 0.1s;
}

.cvt-send:hover:not(:disabled) {
  background: var(--civitai-color-primary-hover);
}

.cvt-send:active:not(:disabled) {
  transform: scale(0.94);
}

.cvt-send:focus-visible {
  outline: 2px solid var(--civitai-color-primary);
  outline-offset: 2px;
}

.cvt-send:disabled {
  background: var(--civitai-color-surface-2);
  color: var(--civitai-color-text-dimmed);
  cursor: default;
}

.cvt-send svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.cvt-send rect {
  fill: currentColor;
  stroke: none;
}

.cvt-spend {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  padding: 3px 9px 3px 7px;
  border-radius: 999px;
  background: var(--civitai-color-surface-2);
  color: var(--civitai-color-text-dimmed);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: default;
}

.cvt-spend svg {
  width: 13px;
  height: 13px;
  fill: var(--civitai-color-warning, #f59f00);
}

/* ── welcome ── */

civitai-chat-welcome {
  display: block;
  overflow-y: auto;
}

.cvt-welcome-inner {
  max-width: 760px;
  margin: 0 auto;
  padding: 48px 16px 24px;
  text-align: center;
}

.cvt-welcome-inner h1 {
  margin: 0 0 8px;
  font-size: 28px;
}

.cvt-welcome-inner > p {
  margin: 0 auto 24px;
  max-width: 560px;
  color: var(--civitai-color-text-dimmed);
}

.cvt-examples {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
  text-align: left;
}

.cvt-example {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--civitai-color-border);
  border-radius: 12px;
  background: var(--civitai-color-surface);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.cvt-example:hover {
  border-color: var(--civitai-color-primary);
}

.cvt-example span {
  font-size: 13px;
  color: var(--civitai-color-text-dimmed);
}

.cvt-welcome-inner .cvt-fineprint {
  margin-top: 24px;
  font-size: 12px;
}

/* ── settings ── */

.cvt-settings {
  display: grid;
  gap: 20px;
}

.cvt-settings section h3 {
  margin: 0 0 4px;
  font-size: 14px;
}

.cvt-settings section p {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--civitai-color-text-dimmed);
}

/* ── compact: the chat list as a dropdown ── */

/* Sized by the space the chat is given, so a sidebar gets the phone layout. */
@container civitai-chat (max-width: 900px) {
  :host([layout='auto']) .cvt-shell {
    grid-template-columns: minmax(0, 1fr);
  }

  :host([layout='auto']) .cvt-shell > civitai-chat-sidebar,
  :host([layout='auto']) .cvt-shell > .cvt-signed-out-chats,
  :host([layout='auto']) .cvt-title-text {
    display: none;
  }

  :host([layout='auto']) .cvt-history-toggle {
    display: inline-flex;
  }

  :host([layout='auto']) .cvt-history {
    display: block;
  }

  :host([layout='auto']) .cvt-hint {
    visibility: hidden;
  }

  :host([layout='auto']) .cvt-welcome-inner {
    padding-top: 24px;
  }
}

:host([layout='compact']) .cvt-shell {
  grid-template-columns: minmax(0, 1fr);
}

:host([layout='compact']) .cvt-shell > civitai-chat-sidebar,
:host([layout='compact']) .cvt-shell > .cvt-signed-out-chats,
:host([layout='compact']) .cvt-title-text {
  display: none;
}

:host([layout='compact']) .cvt-history-toggle {
  display: inline-flex;
}

:host([layout='compact']) .cvt-history {
  display: block;
}

:host([layout='compact']) .cvt-hint {
  visibility: hidden;
}

:host([layout='compact']) .cvt-welcome-inner {
  padding-top: 24px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}

/* ── generation details (viewer) ── */

.cvt-details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px 32px;
  align-items: start;
  font-size: 13px;
}

.cvt-details-text,
.cvt-details-meta {
  grid-column: 1 / -1;
}

.cvt-details-prompt {
  max-width: 80ch;
}

.cvt-details h3 {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--civitai-color-text-dimmed);
}

.cvt-details-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.cvt-details-copy {
  padding: 2px 8px;
  border: 1px solid var(--civitai-color-border);
  border-radius: 999px;
  background: none;
  color: var(--civitai-color-text-dimmed);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.cvt-details-copy:hover {
  color: var(--civitai-color-text);
}

.cvt-details-prompt {
  max-height: 220px;
  margin: 0;
  overflow-y: auto;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--civitai-color-surface-2);
  line-height: 1.5;
  white-space: pre-wrap;
  user-select: text;
}

.cvt-details-resources {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.cvt-details-resources li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.cvt-details-resources a {
  overflow: hidden;
  color: var(--civitai-color-anchor, var(--civitai-color-primary));
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cvt-details-kind,
.cvt-details-service,
.cvt-details-meta {
  color: var(--civitai-color-text-dimmed);
}

.cvt-details-service,
.cvt-details-meta {
  margin: 0;
}

.cvt-details-resources + .cvt-details-service {
  margin-top: 6px;
  font-size: 12px;
}

.cvt-details-settings {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
}

.cvt-details-settings dt {
  color: var(--civitai-color-text-dimmed);
}

.cvt-details-settings dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.cvt-details-meta {
  font-size: 12px;
  line-height: 1.6;
}

.cvt-details-meta code {
  font-family: var(--civitai-font-mono, ui-monospace, monospace);
  overflow-wrap: anywhere;
}
`;
