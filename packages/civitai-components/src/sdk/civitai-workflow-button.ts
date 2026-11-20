import {
  initialize,
  isTerminal,
  isTerminalStatus,
  SCOPES,
  type AppClient,
  type Scope,
  type Workflow,
  type WorkflowTemplate,
} from '@civitai/sdk';
import { CivitaiElement, defineElement } from '../elements/internals.js';
import '../elements/civitai-button.define.js';
import '../elements/civitai-confirm-dialog.define.js';
import '../elements/civitai-loader.define.js';
import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';

const TAG = 'civitai-workflow-button';

/** Words a viewer can act on, for the statuses a workflow passes through. */
const RUNNING_TEXT: Record<string, string> = {
  unassigned: 'queued…',
  preparing: 'getting ready…',
  scheduled: 'starting…',
  processing: 'working…',
};

/** Where a run has got to. Exported so a consumer can name `phase`. */
export type WorkflowButtonPhase = 'idle' | 'pricing' | 'running' | 'canceling' | 'settled';

/** What a finished workflow says before the button offers its price again. */
const SETTLED_TEXT: Record<string, string> = {
  succeeded: 'Done!',
  failed: 'Failed',
  canceled: 'Canceled',
  expired: 'Expired',
};

/** Long enough to read, short enough that nobody waits for it. */
const SETTLED_MS = 1600;

function queueText(ahead: number): string {
  return ahead === 0 ? 'queued… next up' : `queued… ${ahead} ahead`;
}

/**
 * Prices a workflow, runs it on the viewer's Buzz and reports it, so an app
 * does not rebuild submit-watch-cancel around every generate button.
 */
export class CivitaiWorkflowButton extends CivitaiElement {
  static override styles = [
    css`
      :host {
        display: inline-block;
      }
      :host([hidden]) {
        display: none;
      }
      :host([full-width]) {
        display: block;
        width: 100%;
      }
      :host([full-width]) civitai-button {
        width: 100%;
      }
      /* The progress IS the button: a band of its own text colour over the part
         already done, which reads on every variant without naming its palette. */
      /* The loader paints itself with the primary token, which is invisible on a
         primary button; the button's own text colour always contrasts with it. */
      civitai-loader::part(spinner) {
        color: currentColor;
      }
      /* The spinner sits INSIDE the centred content, and every label that can
         appear beside one reserves its box, so nothing shifts when it arrives. */
      .live {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .ghost[data-spun] {
        padding-left: 24px;
      }
      /* Baseline, not centre: a monospace id and a button's label have
         different metrics, so centred boxes still read as misaligned text. */
      .id {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-top: 4px;
        font-size: 12px;
        color: var(--civitai-color-text-dimmed);
      }
      .id code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow-wrap: anywhere;
      }
      /* Every label this button can show, stacked in one cell: the widest sets
         the width, so a status change cannot resize it mid-run. */
      .labels {
        display: inline-grid;
        align-items: center;
        justify-items: center;
      }
      .labels > * {
        grid-area: 1 / 1;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .labels > .ghost {
        visibility: hidden;
        pointer-events: none;
      }
      civitai-button[data-progress]::part(button) {
        background-image: linear-gradient(
          to right,
          color-mix(in srgb, currentColor 22%, transparent) var(--civitai-workflow-progress),
          transparent var(--civitai-workflow-progress)
        );
        transition: background-image 200ms linear;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    label: { reflect: true },
    variant: { reflect: true },
    size: { reflect: true },
    scopes: { reflect: true },
    cancelable: { type: Boolean, reflect: true },
    fullWidth: { type: Boolean, reflect: true, attribute: 'full-width' },
    disabled: { type: Boolean, reflect: true },
    cancelMessage: { reflect: true, attribute: 'cancel-message' },
    template: { attribute: false },
    app: { attribute: false },
    cost: { state: true },
    phase: { state: true },
    status: { state: true },
    copied: { state: true },
    progress: { state: true },
    queued: { state: true },
    stepsDone: { state: true },
    stepsTotal: { state: true },
  };

  /** What the button says before the price lands, and before the Buzz amount after it. */
  declare label: string;
  declare variant: string;
  declare size: string;
  /** Space-separated; empty asks for nothing and leaves consent to the app. */
  declare scopes: string;
  declare cancelable: boolean;
  /** Both pass through to the button this wraps. */
  declare fullWidth: boolean;
  declare disabled: boolean;
  /** What the cancel dialog says under its heading. */
  declare cancelMessage: string;
  declare template?: WorkflowTemplate;
  /** Defaults to `initialize()`, which only resolves inside a civitai.com page. */
  declare app?: AppClient;
  declare cost: number | null;
  declare phase: WorkflowButtonPhase;
  declare status: string;
  declare copied: boolean;
  declare progress: number | null;
  /** Jobs ahead of this workflow in the queue, while it is in one. */
  declare queued: number | null;
  declare stepsDone: number;
  declare stepsTotal: number;

  #run?: AbortController;
  #settledTimer?: ReturnType<typeof setTimeout>;
  #workflowId?: string;
  #priced?: WorkflowTemplate;
  #queuedWidest = 0;

  constructor() {
    super();
    this.label = 'Run';
    this.variant = 'filled';
    this.size = 'md';
    this.scopes = 'ai:write:budgeted';
    this.cancelable = true;
    this.fullWidth = false;
    this.disabled = false;
    this.cancelMessage =
      'Work already under way may finish anyway — not every step can be interrupted.';
    this.cost = null;
    this.phase = 'idle';
    this.status = '';
    this.copied = false;
    this.progress = null;
    this.queued = null;
    this.stepsDone = 0;
    this.stepsTotal = 0;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#run?.abort();
    clearTimeout(this.#settledTimer);
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('template') && this.template !== this.#priced) void this.#price();
  }

  /** The workflow this button is running, if it is running one. */
  get workflowId(): string | undefined {
    return this.#workflowId;
  }

  #scopes(): Scope[] {
    const asked = this.scopes.split(/\s+/).filter(Boolean);
    const unknown = asked.filter((scope) => !(SCOPES as readonly string[]).includes(scope));
    if (unknown.length > 0) throw new Error(`not a Civitai scope: ${unknown.join(', ')}`);
    return asked as Scope[];
  }

  async #client(): Promise<AppClient> {
    return (this.app ??= await initialize());
  }

  #fail(error: unknown): void {
    this.phase = 'idle';
    this.progress = null;
    this.queued = null;
    this.status = '';
    this.dispatchEvent(
      new CustomEvent('error', {
        bubbles: true,
        composed: true,
        detail: { error, message: (error as Error)?.message ?? String(error) },
      })
    );
  }

  async #price(): Promise<void> {
    const template = this.template;
    if (!template || this.phase === 'running') return;
    this.#priced = template;
    this.cost = null;
    this.phase = 'pricing';
    try {
      const app = await this.#client();
      const estimate = await app.orchestration.estimateWorkflow(template);
      // A later template wins: pricing is slow enough for a second edit to land.
      if (this.#priced !== template) return;
      // A metered workflow is billed as it runs, so its estimate is no price at all.
      const variable = estimate.cost?.variable === true;
      this.cost = variable ? null : (estimate.cost?.total ?? 0);
      this.phase = 'idle';
      this.dispatchEvent(
        new CustomEvent('priced', {
          bubbles: true,
          composed: true,
          detail: { cost: this.cost, variable },
        })
      );
    } catch (error) {
      if (this.#priced === template) this.#fail(error);
    }
  }

  async #start(): Promise<void> {
    const template = this.template;
    if (!template || (this.phase !== 'idle' && this.phase !== 'settled')) return;
    clearTimeout(this.#settledTimer);
    const run = new AbortController();
    this.#run = run;
    this.phase = 'running';
    this.status = 'submitting…';
    this.progress = null;
    this.queued = null;
    this.#queuedWidest = 0;

    try {
      const app = await this.#client();
      const scopes = this.#scopes();
      if (scopes.length > 0 && !(await app.requestGrants(scopes, { signal: run.signal }))) {
        throw new Error('permission to spend Buzz was refused');
      }

      const submitted = await app.orchestration.submitWorkflow(template, { signal: run.signal });
      this.#workflowId = submitted.id ?? undefined;
      this.dispatchEvent(
        new CustomEvent('submitted', {
          bubbles: true,
          composed: true,
          detail: { workflowId: this.#workflowId },
        })
      );

      for await (const workflow of app.orchestration.watchWorkflow(this.#workflowId!, {
        signal: run.signal,
      })) {
        this.#read(workflow);
        if (!isTerminal(workflow)) continue;
        this.#settle(workflow);
        return;
      }
    } catch (error) {
      if (!run.signal.aborted) this.#fail(error);
      this.#workflowId = undefined;
    }
  }

  #read(workflow: Workflow): void {
    this.status = RUNNING_TEXT[workflow.status] ?? workflow.status;
    this.stepsTotal = workflow.steps.length;
    this.stepsDone = workflow.steps.filter((step) => isTerminalStatus(step.status)).length;
    // The slowest step is what the workflow is waiting on, whether the steps run
    // one after another or together. A zero is a step that has not begun.
    const rates = workflow.steps
      .map((step) => step.estimatedProgressRate)
      .filter((rate): rate is number => typeof rate === 'number' && rate > 0);
    this.progress = rates.length > 0 ? Math.min(...rates) : null;
    // The orchestrator drops a step's position once it runs, so any position
    // left is a step still waiting, and the longest wait is the workflow's.
    const waits = workflow.steps
      .map((step) => step.queuePosition?.precedingJobs)
      .filter((ahead): ahead is number => typeof ahead === 'number');
    this.queued = waits.length > 0 ? Math.max(...waits) : null;
    this.#queuedWidest = Math.max(this.#queuedWidest, this.queued ?? 0);
    this.dispatchEvent(
      new CustomEvent('progress', {
        bubbles: true,
        composed: true,
        detail: {
          workflow,
          status: workflow.status,
          progress: this.progress,
          queued: this.queued,
          stepsDone: this.stepsDone,
          steps: this.stepsTotal,
        },
      })
    );
  }

  #settle(workflow: Workflow): void {
    this.#rest(workflow.status);
    this.dispatchEvent(
      new CustomEvent('finished', { bubbles: true, composed: true, detail: { workflow } })
    );
  }

  /** Holds the outcome briefly, then goes back to offering the price. */
  #rest(status: string): void {
    // Nothing left to cancel, so an open cancel dialog is asking about nothing.
    const dialog = this.renderRoot.querySelector('civitai-confirm-dialog');
    if (dialog?.open) dialog.open = false;
    this.phase = 'settled';
    this.status = SETTLED_TEXT[status] ?? status;
    // A succeeded run leaves the button full rather than snapping empty.
    this.progress = status === 'succeeded' ? 1 : null;
    this.queued = null;
    this.stepsTotal = 0;
    this.stepsDone = 0;
    this.#workflowId = undefined;
    clearTimeout(this.#settledTimer);
    this.#settledTimer = setTimeout(() => {
      if (this.phase !== 'settled') return;
      this.phase = 'idle';
      this.status = '';
      this.progress = null;
    }, SETTLED_MS);
  }

  /** One control: press it to start, press it again to ask about cancelling. */
  async #press(): Promise<void> {
    if (this.phase === 'idle' || this.phase === 'settled') return this.#start();
    if (this.phase !== 'running' || !this.cancelable) return;
    this.copied = false;
    const dialog = this.renderRoot.querySelector('civitai-confirm-dialog');
    if (await dialog?.ask()) await this.#cancel();
  }

  async #cancel(): Promise<void> {
    const id = this.#workflowId;
    if (this.phase !== 'running' || !id) return;
    this.phase = 'canceling';
    this.status = 'canceling…';
    try {
      const app = await this.#client();
      await app.orchestration.cancelWorkflow(id);
    } catch (error) {
      this.#fail(error);
      return;
    }
    // Settle on the accepted cancel rather than on the watch loop noticing it:
    // whether the orchestrator reports it before the read is dropped is a race.
    this.#run?.abort();
    this.#rest('canceled');
    this.dispatchEvent(new CustomEvent('canceled', { bubbles: true, composed: true }));
  }

  /** What this button may yet say, so the widest of them can fix its width. */
  #labels(): { text: string; spun: boolean }[] {
    const running = [
      ...Object.values(RUNNING_TEXT),
      'canceling…',
      'submitting…',
      queueText(0),
      queueText(this.#queuedWidest),
    ];
    return [
      { text: this.#idleText(), spun: false },
      ...Object.values(SETTLED_TEXT).map((text) => ({ text, spun: false })),
      ...running.map((text) => ({ text: `${text}${this.#steps()}`, spun: true })),
    ];
  }

  /** Only worth saying for a workflow that has more than one step. */
  #steps(): string {
    // The template already says how many steps there are, so the label can
    // reserve their room before the first reading arrives.
    const total = this.stepsTotal || (this.template?.steps?.length ?? 0);
    return total > 1 ? ` ${this.stepsDone}/${total}` : '';
  }

  #idleText(): string {
    return this.cost === null ? this.label : `${this.label} for ${this.cost} Buzz`;
  }

  /** Support asks for the workflow id first, and a running one is hard to retype. */
  async #copyId(): Promise<void> {
    const id = this.#workflowId;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      this.copied = true;
    } catch {
      this.copied = false;
    }
  }

  #text(): string {
    if (this.phase === 'settled') return this.status;
    if (this.phase === 'canceling') return `${this.status}${this.#steps()}`;
    if (this.phase === 'running') {
      const status = this.queued === null ? this.status : queueText(this.queued);
      return `${status}${this.#steps()}`;
    }
    return this.#idleText();
  }

  override render(): TemplateResult {
    const busy = this.phase === 'running' || this.phase === 'canceling';
    const spinning = busy || this.phase === 'pricing';
    const percent = this.progress === null ? null : `${Math.round(this.progress * 100)}%`;
    return html`
      <civitai-button
        part="run"
        exportparts="button"
        .variant=${this.variant}
        .size=${this.size}
        .fullWidth=${this.fullWidth}
        .disabled=${this.disabled ||
        this.phase === 'pricing' ||
        (this.template === undefined && !busy)}
        data-progress=${percent === null ? nothing : ''}
        style=${styleMap(percent === null ? {} : { '--civitai-workflow-progress': percent })}
        aria-label=${busy && this.cancelable ? `${this.status} — press to cancel` : nothing}
        @click=${this.#press}
      >
        <span class="labels">
          ${this.#labels().map(
            ({ text, spun }) => html`<span class="ghost" data-spun=${spun ? '' : nothing}>${text}</span>`
          )}
          <span class="live">
            ${spinning ? html`<civitai-loader size="sm" part="spinner"></civitai-loader>` : nothing}
            <span part="label">${this.#text()}</span>
          </span>
        </span>
      </civitai-button>
      <civitai-confirm-dialog
        part="confirm"
        heading="Cancel this run?"
        .message=${this.cancelMessage}
        confirm-label="Cancel it"
        cancel-label="Keep going"
        destructive
      >
        ${this.#workflowId === undefined
          ? nothing
          : html`<div class="id">
              <code part="workflow-id">${this.#workflowId}</code>
              <civitai-button size="sm" variant="subtle" @click=${this.#copyId}>
                ${this.copied ? 'Copied' : 'Copy'}
              </civitai-button>
            </div>`}
      </civitai-confirm-dialog>
    `;
  }
}

export function defineCivitaiWorkflowButton(): void {
  defineElement(TAG, CivitaiWorkflowButton);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-workflow-button': CivitaiWorkflowButton;
  }
}
