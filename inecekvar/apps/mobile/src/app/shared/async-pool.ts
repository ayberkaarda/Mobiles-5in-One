/** Runs at most `concurrency` operations at once, retaining input order. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const iterator = items.entries();
  async function worker(): Promise<void> {
    for (const [index, item] of iterator) {
      results[index] = await work(item, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
