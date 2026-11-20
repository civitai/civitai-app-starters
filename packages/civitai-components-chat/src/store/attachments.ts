import type { Attachment } from '../types.js';

export const ATTACHMENT_ID = /^(up\d+-\d+|gen\d+-\d+-\d+|p\d+-\d+-\d+)$/;

export const uploadId = (seq: number, n: number): string => `up${seq}-${n}`;
export const jobId = (seq: number, call: number): string => `gen${seq}-${call}`;
export const panelRunId = (panel: string, run: number): string => `${panel}-${run}`;
export const resultId = (job: string, n: number): string => `${job}-${n}`;

export class MissingAttachmentError extends Error {
  constructor(id: string) {
    super(`There is no file called ${id} in this conversation.`);
    this.name = 'MissingAttachmentError';
  }
}

export type UrlRefresher = (attachment: Attachment) => Promise<string | undefined>;

/** Tool arguments name files by attachment id, at any depth; the orchestrator needs URLs. */
export async function resolveAttachmentArgs(
  args: Record<string, unknown>,
  lookup: (id: string) => Attachment | undefined,
  refresh: UrlRefresher,
): Promise<Record<string, unknown>> {
  const urlFor = async (id: string): Promise<string> => {
    const attachment = lookup(id);
    if (!attachment) throw new MissingAttachmentError(id);
    const url = attachment.url ?? (await refresh(attachment));
    if (!url) throw new Error(`${id} is not ready yet.`);
    return url;
  };
  const resolve = async (value: unknown): Promise<unknown> => {
    if (typeof value === 'string') return ATTACHMENT_ID.test(value) ? urlFor(value) : value;
    if (Array.isArray(value)) return Promise.all(value.map(resolve));
    if (value && typeof value === 'object') {
      const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await resolve(item)] as const));
      return Object.fromEntries(entries);
    }
    return value;
  };
  return (await resolve(args)) as Record<string, unknown>;
}
