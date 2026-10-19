import type { Workflow, WorkflowTemplate } from '@civitai/sdk';

type Stored = { id: string; status: string; tags: string[]; metadata: Record<string, unknown>; externalId?: string };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The orchestrator as the conversation store uses it, in memory and shared by every "tab" built on it:
 * submitted heads, tag queries, metadata writes (each kept, in order, as written) and tag removal.
 * `hold()` keeps every metadata write waiting until the returned release is called.
 */
export function fakeHeads() {
  const workflows = new Map<string, Stored>();
  const writes: { workflowId: string; metadata: Record<string, unknown> }[] = [];
  let next = 0;
  let held: Promise<void> | undefined;
  /** Metadata writes that reached the orchestrator (built and sent), held or not. */
  const started = { count: 0 };
  return {
    workflows,
    writes,
    started,
    hold(): () => void {
      let release!: () => void;
      held = new Promise<void>((resolve) => (release = resolve));
      return () => {
        held = undefined;
        release();
      };
    },
    orchestration: {
      async submitWorkflow(template: WorkflowTemplate): Promise<Workflow> {
        const existing = [...workflows.values()].find((wf) => template.externalId && wf.externalId === template.externalId);
        const id = existing?.id ?? `head-${++next}`;
        if (!existing) workflows.set(id, { id, status: 'succeeded', tags: [...(template.tags ?? [])], metadata: clone(template.metadata ?? {}), ...(template.externalId ? { externalId: template.externalId } : {}) });
        return { id, cost: { total: 0 } } as unknown as Workflow;
      },
      async queryWorkflows(query: { tags?: string[] }) {
        const items = [...workflows.values()].filter((wf) => (query.tags ?? []).every((tag) => wf.tags.includes(tag))).map((wf) => clone(wf) as unknown as Workflow);
        return { items, next: '' };
      },
    },
    api: {
      async updateWorkflow(workflowId: string, patch: { metadata?: unknown }): Promise<void> {
        started.count++;
        if (held) await held;
        const wf = workflows.get(workflowId);
        if (!wf || patch.metadata === undefined) return;
        writes.push({ workflowId, metadata: clone(patch.metadata as Record<string, unknown>) });
        wf.metadata = clone(patch.metadata as Record<string, unknown>);
      },
      async removeTag(workflowId: string, tag: string): Promise<void> {
        const wf = workflows.get(workflowId);
        if (wf) wf.tags = wf.tags.filter((t) => t !== tag);
      },
      async deleteWorkflow(workflowId: string): Promise<void> {
        workflows.delete(workflowId);
      },
    },
  };
}

/** A tab's `sessionStorage`, in memory: each tab gets its own. */
export function tabStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, String(value)),
    removeItem: (key) => void entries.delete(key),
  };
}
