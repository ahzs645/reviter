/**
 * Small LRU used by the viewer for expensive, source-specific scene assets.
 *
 * The cache deliberately compares owner values by identity. Conversion results,
 * paired comparisons, visibility sets, and object URLs are immutable inputs in
 * the Studio, so an identity change is the precise point at which geometry can
 * no longer be reused.
 */
export class SourceAssetCache<T> {
  private readonly entries = new Map<string, { owners: readonly unknown[]; value: T }>();
  private readonly capacity: number;
  private readonly dispose: (value: T) => void;

  constructor(
    capacity: number,
    dispose: (value: T) => void,
  ) {
    this.capacity = capacity;
    this.dispose = dispose;
  }

  acquire(
    key: string,
    owners: readonly unknown[],
    create: () => T,
  ): { value: T; hit: boolean } {
    const cached = this.entries.get(key);
    if (cached && sameOwners(cached.owners, owners)) {
      // Map insertion order doubles as the LRU list.
      this.entries.delete(key);
      this.entries.set(key, cached);
      return { value: cached.value, hit: true };
    }
    if (cached) {
      this.entries.delete(key);
      this.dispose(cached.value);
    }

    const value = create();
    this.entries.set(key, { owners: [...owners], value });
    while (this.entries.size > Math.max(1, this.capacity)) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey == null) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) this.dispose(oldest.value);
    }
    return { value, hit: false };
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  clear(): void {
    for (const entry of this.entries.values()) this.dispose(entry.value);
    this.entries.clear();
  }
}

function sameOwners(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((owner, index) => Object.is(owner, b[index]));
}
