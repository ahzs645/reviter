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
    this.capacity = Math.max(1, Math.floor(capacity));
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

    // Evict before constructing the replacement. A source root can contain a
    // million triangles, so briefly holding capacity + 1 roots is a material
    // memory spike even though the Map would be trimmed a line later.
    while (this.entries.size >= this.capacity) this.evictOldest();
    const value = create();
    this.entries.set(key, { owners: [...owners], value });
    return { value, hit: false };
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  clear(): void {
    for (const entry of this.entries.values()) this.dispose(entry.value);
    this.entries.clear();
  }

  private evictOldest(): void {
    const oldestKey = this.entries.keys().next().value as string | undefined;
    if (oldestKey == null) return;
    const oldest = this.entries.get(oldestKey);
    this.entries.delete(oldestKey);
    if (oldest) this.dispose(oldest.value);
  }
}

function sameOwners(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((owner, index) => Object.is(owner, b[index]));
}
