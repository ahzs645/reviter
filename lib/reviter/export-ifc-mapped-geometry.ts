/**
 * IFC-21 representation maps, following rvt-rs's step_writer.rs structure.
 * Sharing requires native triangle ownership, an explicit source type, identical
 * ordered topology/materials and identical positions in their persisted rigid instance frame. Bounds,
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
  /** Row-major rotation; columns are axes. Omitted for ordinary translation. */
  basis?: number[];
};

function origin(fragments: readonly MappableFragment[]): [number, number, number] {
  const positions = fragments[0]!.positions;
  return [positions[0]!, positions[1]!, positions[2]!];
}

/** A rigid frame is admitted only from the native placement decoder. Reflection
 * and scaling remain ordinary tessellations, preserving their winding. */
function rigidBasis(basis: readonly number[]): boolean {
  if (basis.length !== 9 || !basis.every(Number.isFinite)) return false;
  for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) {
    const dot = basis[a]! * basis[b]! + basis[a + 3]! * basis[b + 3]! + basis[a + 6]! * basis[b + 6]!;
    if (Math.abs(dot - (a === b ? 1 : 0)) > 1e-12) return false;
  }
  const determinant = basis[0]! * (basis[4]! * basis[8]! - basis[5]! * basis[7]!) -
    basis[1]! * (basis[3]! * basis[8]! - basis[5]! * basis[6]!) + basis[2]! * (basis[3]! * basis[7]! - basis[4]! * basis[6]!);
  return Math.abs(determinant - 1) <= 1e-12;
}

export function mappedLocalFragments(fragments: readonly MappableFragment[], plan: MappedGeometryPlan): MappableFragment[] {
  return fragments.map(fragment => {
    const positions: number[] = [];
    for (let i = 0; i < fragment.positions.length; i += 3) {
      const p = [0, 1, 2].map(axis => fragment.positions[i + axis]! - plan.translation[axis]!);
      for (let axis = 0; axis < 3; axis++) positions.push(plan.basis ?
        plan.basis[axis]! * p[0]! + plan.basis[axis + 3]! * p[1]! + plan.basis[axis + 6]! * p[2]! : p[axis]!);
    }
    return { ...fragment, positions };
  });
}

/** Complete ordered comparison, allowing arithmetic roundoff only. It does
 * not merge Float32 shapes that acquired different local rounding errors. */
function sameGeometry(a: readonly MappableFragment[], b: readonly MappableFragment[], magnitude: number): boolean {
  if (a.length !== b.length) return false;
  for (let f = 0; f < a.length; f += 1) {
    const left = a[f]!, right = b[f]!;
    if (left.materialIndex !== right.materialIndex || left.source !== right.source ||
      left.indices.length !== right.indices.length || left.positions.length !== right.positions.length) return false;
    for (let i = 0; i < left.indices.length; i += 1) if (left.indices[i] !== right.indices[i]) return false;
    for (let i = 0; i < left.positions.length; i += 1) {
      const l = left.positions[i]!, r = right.positions[i]!;
      const epsilon = 64 * Number.EPSILON * Math.max(1, Math.abs(l), Math.abs(r), magnitude);
      if (Math.abs(l - r) > epsilon) return false;
    }
  }
  return true;
}

/** A bucket selector only; a collision must still pass the complete comparison. */
function fingerprint(fragments: readonly MappableFragment[]): number {
  let hash = 2166136261;
  const add = (value: string) => {
    for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    hash = Math.imul(hash ^ 255, 16777619);
  };
  for (const fragment of fragments) {
    add(`${fragment.materialIndex}:${fragment.source}:${fragment.positions.length}:${fragment.indices.length}`);
    for (const value of fragment.positions) add(Math.abs(value) < 1e-12 ? "0" : value.toPrecision(10));
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
  const placements = new Map<number, NonNullable<ConvertResult["nativeInstancePlacements"]>[number] | null>();
  for (const placement of result.nativeInstancePlacements ?? []) {
    const previous = placements.get(placement.elementId);
    if (previous === undefined) placements.set(placement.elementId, placement);
    else if (previous && JSON.stringify(previous) !== JSON.stringify(placement)) placements.set(placement.elementId, null);
  }
  const buckets = new Map<string, Array<{ group: number; fragments: readonly MappableFragment[]; magnitude: number; elementIds: number[] }>>();
  const pending = new Map<number, MappedGeometryPlan>();
  let group = 0, vertices = 0;
  for (const [elementId, fragments] of byElement) {
    const type = typeByElement.get(elementId);
    if (!type || !fragments.length || fragments.some(fragment => fragment.source !== "native-brep" ||
      fragment.positions.length < 9 || fragment.positions.length % 3 || fragment.indices.length % 3 ||
      fragment.positions.some(position => !Number.isFinite(position)) || fragment.indices.some(index =>
        !Number.isInteger(index) || index < 1 || index > fragment.positions.length / 3))) continue;
    vertices += fragments.reduce((count, fragment) => count + fragment.positions.length / 3, 0);
    if (vertices > 4_000_000 || pending.size >= 200_000) break;
    const placement = placements.get(elementId);
    // Conflicting or nonrigid source placements cannot authorize a rotation.
    const rotational = placement && Number.isSafeInteger(placement.geometryId) && placement.geometryId > 0 &&
      placement.origin.length === 3 && placement.origin.every(Number.isFinite) && rigidBasis(placement.basis);
    const plan: MappedGeometryPlan = { group: -1, translation: origin(fragments), ...(rotational ? { basis: [...placement.basis] } : {}) };
    const local = mappedLocalFragments(fragments, plan);
    const magnitude = fragments.reduce((max, fragment) => fragment.positions.reduce((m, v) => Math.max(m, Math.abs(v)), max), 1);
    const key = `${type}:${rotational ? `source-${placement.geometryId}` : "translation"}:${fingerprint(local)}`;
    const candidates = buckets.get(key) ?? [];
    let match = candidates.find(candidate => sameGeometry(candidate.fragments, local, Math.max(candidate.magnitude, magnitude)));
    if (!match) {
      if (candidates.length >= 16) continue;
      match = { group: group++, fragments: local, magnitude, elementIds: [] };
      candidates.push(match); buckets.set(key, candidates);
    }
    match.elementIds.push(elementId);
    pending.set(elementId, { ...plan, group: match.group });
  }
  const shared = new Set([...buckets.values()].flatMap(bucket => bucket.filter(candidate => candidate.elementIds.length > 1).map(candidate => candidate.group)));
  return new Map([...pending].filter(([, plan]) => shared.has(plan.group)));
}
