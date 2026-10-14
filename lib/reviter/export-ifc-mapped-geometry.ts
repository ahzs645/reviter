/**
 * IFC-21 representation maps, following rvt-rs's step_writer.rs structure.
 * Sharing requires native triangle ownership, an explicit source type, identical
 * ordered topology/materials and identical positions up to translation. Bounds,
 * names and IFC reference exports do not establish a shared body.
 */
import type { ConvertResult, MeshGeometrySource } from "./types.ts";

export type MappableFragment = {
  positions: number[];
  indices: number[];
  materialIndex: number;
  source: MeshGeometrySource | undefined;
};
export type MappedGeometryPlan = {
  group: number;
  translation: [number, number, number];
};

function origin(fragments: readonly MappableFragment[]): [number, number, number] {
  const positions = fragments[0]!.positions;
  return [positions[0]!, positions[1]!, positions[2]!];
}

/** Unit conversion introduces only floating multiplication/subtraction noise. */
function sameGeometry(a: readonly MappableFragment[], b: readonly MappableFragment[]): boolean {
  if (a.length !== b.length) return false;
  const ao = origin(a), bo = origin(b);
  for (let f = 0; f < a.length; f += 1) {
    const left = a[f]!, right = b[f]!;
    if (left.materialIndex !== right.materialIndex || left.source !== right.source ||
      left.indices.length !== right.indices.length || left.positions.length !== right.positions.length) return false;
    for (let i = 0; i < left.indices.length; i += 1) if (left.indices[i] !== right.indices[i]) return false;
    for (let i = 0; i < left.positions.length; i += 1) {
      const l = left.positions[i]!, r = right.positions[i]!;
      const epsilon = 16 * Number.EPSILON * Math.max(1, Math.abs(l), Math.abs(r), Math.abs(ao[i % 3]!), Math.abs(bo[i % 3]!));
      if (Math.abs((l - ao[i % 3]!) - (r - bo[i % 3]!)) > epsilon) return false;
    }
  }
  return true;
}

/** A bucket selector only; a collision must still pass the complete comparison. */
function fingerprint(fragments: readonly MappableFragment[]): number {
  const offset = origin(fragments);
  let hash = 2166136261;
  const add = (value: string) => {
    for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    hash = Math.imul(hash ^ 255, 16777619);
  };
  for (const fragment of fragments) {
    add(`${fragment.materialIndex}:${fragment.source}:${fragment.positions.length}:${fragment.indices.length}`);
    for (let i = 0; i < fragment.positions.length; i += 1) add((fragment.positions[i]! - offset[i % 3]!).toPrecision(10));
    for (const index of fragment.indices) add(String(index));
  }
  return hash >>> 0;
}

export function planMappedGeometry(
  result: ConvertResult,
  byElement: ReadonlyMap<number, readonly MappableFragment[]>,
): Map<number, MappedGeometryPlan> {
  const typeByElement = new Map<number, number | null>();
  for (const source of result.elementBounds) {
    if (!Number.isSafeInteger(source.typeId) || source.typeId! <= 0) continue;
    const previous = typeByElement.get(source.elementId);
    typeByElement.set(source.elementId, previous === undefined || previous === source.typeId ? source.typeId! : null);
  }
  const buckets = new Map<string, Array<{ group: number; fragments: readonly MappableFragment[]; elementIds: number[] }>>();
  const pending = new Map<number, MappedGeometryPlan>();
  let group = 0, vertices = 0;
  for (const [elementId, fragments] of byElement) {
    const type = typeByElement.get(elementId);
    if (!type || !fragments.length || fragments.some(fragment => fragment.source !== "native-brep" ||
      fragment.positions.length < 9 || fragment.positions.length % 3 || fragment.indices.length % 3 ||
      fragment.positions.some(position => !Number.isFinite(position)) || fragment.indices.some(index =>
        !Number.isInteger(index) || index < 1 || index > fragment.positions.length / 3))) continue;
    vertices += fragments.reduce((count, fragment) => count + fragment.positions.length / 3, 0);
    // Optional compression has a fixed comparison budget; geometry outside it
    // follows the ordinary exporter without being omitted or approximated.
    if (vertices > 4_000_000 || pending.size >= 200_000) break;
    const key = `${type}:${fingerprint(fragments)}`;
    const candidates = buckets.get(key) ?? [];
    let match = candidates.find(candidate => sameGeometry(candidate.fragments, fragments));
    if (!match) {
      // Deliberately colliding or disparate meshes must not cause quadratic
      // comparisons. A crowded hash bucket falls back to ordinary geometry.
      if (candidates.length >= 16) continue;
      match = { group: group++, fragments, elementIds: [] };
      candidates.push(match);
      buckets.set(key, candidates);
    }
    match.elementIds.push(elementId);
    pending.set(elementId, { group: match.group, translation: origin(fragments) });
  }
  const shared = new Set([...buckets.values()].flatMap(bucket => bucket.filter(candidate => candidate.elementIds.length > 1).map(candidate => candidate.group)));
  return new Map([...pending].filter(([, plan]) => shared.has(plan.group)));
}
