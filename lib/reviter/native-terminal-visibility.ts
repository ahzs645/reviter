import * as DMath from "./deterministic-math.ts";
import { nativeExactPartsForProposals, nativeRationalPathSupported, nativeRationalPointInParts } from "./native-exact-planar-topology.ts";
import type { NativeRationalParts } from "./native-rational-overlay.ts";
import type { RoomPoint } from "./room-directory.ts";

/** Bounded visibility proposal on the ORIGINAL exact free face. This avoids a
 * million-cell fine grid for ordinary bent doorway/landing approaches. Rounded
 * proposal vertices must pass exact containment, and EVERY used segment passes
 * exact support. No endpoint, doorway half, hole or foreign obstacle is moved.
 * A budget refusal is inconclusive: the caller can retain its grid fallback.
 */
export function nativeTerminalVisibilityPath(parts: NativeRationalParts, from: RoomPoint, to: RoomPoint,
  options: { maximumVertices?: number; maximumChecks?: number } = {}): RoomPoint[] | undefined {
  const maximumVertices = options.maximumVertices ?? 192, maximumChecks = options.maximumChecks ?? 4096;
  if (!Number.isInteger(maximumVertices) || maximumVertices < 2 || !Number.isInteger(maximumChecks) || maximumChecks < 0)
    throw Error("Invalid terminal visibility budget");
  if (![...from, ...to].every(Number.isFinite) || !nativeRationalPointInParts(from, parts) || !nativeRationalPointInParts(to, parts)) return undefined;
  const vertices: RoomPoint[] = [from, to], seen = new Set(vertices.map(p => JSON.stringify(p)));
  for (const point of nativeExactPartsForProposals(parts).flat(2)) {
    const key = JSON.stringify(point);
    if (seen.has(key) || !nativeRationalPointInParts(point, parts)) continue;
    if (vertices.length >= maximumVertices) return undefined;
    vertices.push(point); seen.add(key);
  }
  const distances = vertices.map(() => Infinity), previous = vertices.map(() => -1), closed = new Set<number>();
  const distance = (a: RoomPoint, b: RoomPoint) => DMath.hypot(a[0]-b[0], a[1]-b[1]);
  const checked = new Map<string, boolean>();
  distances[0] = 0;
  for (let round = 0; round < vertices.length; round++) {
    let at = -1, score = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const rank = distances[i]! + distance(vertices[i]!, to);
      if (!closed.has(i) && rank < score) { at = i; score = rank; }
    }
    if (at < 0) return undefined;
    if (at === 1) {
      const path: RoomPoint[] = [];
      for (let n = 1; n >= 0; n = previous[n]!) path.push(vertices[n]!);
      path.reverse();
      return nativeRationalPathSupported(path, parts) ? path : undefined;
    }
    closed.add(at);
    for (let next = 0; next < vertices.length; next++) {
      if (closed.has(next) || next === at) continue;
      const cost = distances[at]! + distance(vertices[at]!, vertices[next]!);
      if (cost >= distances[next]!) continue;
      const key = at < next ? `${at}:${next}` : `${next}:${at}`;
      let supported = checked.get(key);
      if (supported === undefined) {
        if (checked.size >= maximumChecks) return undefined;
        supported = nativeRationalPathSupported([vertices[at]!, vertices[next]!], parts);
        checked.set(key, supported);
      }
      if (supported) { distances[next] = cost; previous[next] = at; }
    }
  }
  return undefined;
}
