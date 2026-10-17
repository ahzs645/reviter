/** Keep the caller's deterministic distance/tie order, but offer each current
 * component its nearest candidate before spending the bounded attempt budget
 * repeatedly on the same two components. This selects proposals only: every
 * pair still needs the ordinary exact geometry/material/access checks. */
export function nativeTerminalRepairPairs<T extends { a: { id: string }; b: { id: string } }>(
  ordered: readonly T[],
  component: (id: string) => string,
  maximum = 24,
): T[] {
  if (!Number.isInteger(maximum) || maximum < 0) throw new Error("Invalid native terminal proposal budget.");
  const selected = new Set<T>(), covered = new Set<string>();
  for (const pair of ordered) {
    if (selected.size >= maximum) break;
    const a = component(pair.a.id), b = component(pair.b.id);
    if (a === b || covered.has(a) && covered.has(b)) continue;
    selected.add(pair);
    covered.add(a); covered.add(b);
  }
  for (const pair of ordered) {
    if (selected.size >= maximum) break;
    if (component(pair.a.id) !== component(pair.b.id)) selected.add(pair);
  }
  // Preserve the exact existing deterministic order among offered pairs.
  return ordered.filter(pair => selected.has(pair));
}
