/**
 * How much a list yields before the caller has to ask for more. A generator
 * that walks to the end by default makes reading all of someone's history the
 * easy mistake; opting out is `limit: Infinity`.
 */
export const DEFAULT_LIST_LIMIT = 100;

/**
 * Drives a cursor-paged read. `pageSize` is what the host will serve at once;
 * the caller's `limit` is a total, so the last request asks only for what is
 * still wanted.
 */
export async function* paginate<T>(
  limit: number | undefined,
  pageSize: number,
  page: (take: number, cursor?: string) => Promise<{ items: T[]; cursor?: string }>,
  start?: string,
): AsyncGenerator<T> {
  let remaining = limit ?? DEFAULT_LIST_LIMIT;
  let cursor = start;

  while (remaining > 0) {
    const result = await page(Math.min(remaining, pageSize), cursor);
    for (const item of result.items) {
      yield item;
      remaining -= 1;
      if (remaining <= 0) return;
    }
    if (!result.cursor) return;
    cursor = result.cursor;
  }
}
