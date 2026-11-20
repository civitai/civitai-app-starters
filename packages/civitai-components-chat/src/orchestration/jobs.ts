import { GenerationJob, type JobDeps, type JobInit } from './job.js';

/** Every job in the open conversation, so cards and the assistant see the same objects. */
export class JobManager extends EventTarget {
  #jobs = new Map<string, GenerationJob>();
  readonly deps: JobDeps;

  constructor(deps: JobDeps) {
    super();
    this.deps = deps;
  }

  create(init: JobInit): GenerationJob {
    this.#jobs.get(init.id)?.dispose();
    const job = new GenerationJob(this.deps, init);
    job.addEventListener('change', () => this.dispatchEvent(new CustomEvent('job-change', { detail: job })));
    job.addEventListener('settled', () => this.dispatchEvent(new CustomEvent('job-settled', { detail: job })));
    this.#jobs.set(job.id, job);
    return job;
  }

  get(id: string): GenerationJob | undefined {
    return this.#jobs.get(id);
  }

  /** Forgets a job that never ran, so it leaves no card behind. */
  discard(id: string): void {
    const job = this.#jobs.get(id);
    if (!job) return;
    job.dispose();
    this.#jobs.delete(id);
    this.dispatchEvent(new CustomEvent('job-change', { detail: job }));
  }

  byToolCall(toolCallId: string): GenerationJob | undefined {
    for (const job of this.#jobs.values()) if (job.toolCallId === toolCallId) return job;
    return undefined;
  }

  all(): GenerationJob[] {
    return [...this.#jobs.values()];
  }

  /** Called when the open conversation changes; watches of the old one stop. */
  clear(): void {
    for (const job of this.#jobs.values()) job.dispose();
    this.#jobs.clear();
  }
}
