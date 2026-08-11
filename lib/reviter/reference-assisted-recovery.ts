/**
 * Explicit paired-IFC repair of viewer geometry.
 *
 * This stays separate from RVT decoding. The paired export does not redefine
 * any RVT bytes; it replaces only tagged elements that fail a geometric or
 * topology gate, and records that external provenance.
 */
import type {
  Bounds3,
  ConvertResult,
  MeshData,
  ReferenceMeshData,
} from "./types.ts";

const FEET_PER_METRE = 3.280839895;
const RAMP_CATEGORY_ID = -2_000_180;
const ROOF_CATEGORY_ID = -2_000_035;
const STAIRS_RUN_CATEGORY_ID = -2_000_919;
const RAMP_AGGREGATE_EXTENT_TOLERANCE_FEET = 0.05;
const ROOF_EXTENT_TOLERANCE_FEET = 0.05;
const STAIR_FLIGHT_EXTENT_TOLERANCE_FEET = 0.05;
const MIN_COMPLETE_REFERENCE_SPAN_FEET = 0.1;

function isRampAggregate(
  record: ConvertResult["elementBounds"][number] | undefined,
): boolean {
  return record?.categoryId === RAMP_CATEGORY_ID || record?.categoryName === "Ramps";
}

function isRoof(
  record: ConvertResult["elementBounds"][number] | undefined,
): boolean {
  return record?.categoryId === ROOF_CATEGORY_ID || record?.categoryName === "Roofs";
}

function isStairsRun(
  record: ConvertResult["elementBounds"][number] | undefined,
): boolean {
  return record?.categoryId === STAIRS_RUN_CATEGORY_ID ||
    record?.categoryName === "Stairs Runs";
}

type ElementGeometrySummary = {
  bounds: Bounds3;
  triangles: number;
};

export type IfcReferenceRepairOptions = {
  /**
   * Ramp ids whose tagged IFC product owns a direct body and is not an
   * IfcRelAggregates parent. Geometry parity is checked again before admission.
   */
  completeRampAggregateElementIds?: ArrayLike<number>;
  /** Numeric Revit ids proved to own a direct, non-aggregate IfcRoof body. */
  directRoofGeometryElementIds?: ArrayLike<number>;
  /** Numeric Revit ids whose IFC Tag resolves to a direct IfcStairFlight body. */
  directStairFlightGeometryElementIds?: ArrayLike<number>;
  /** Bounds-aligned ids whose rendered surface or expected topology differs. */
  shapeDifferentElementIds?: ArrayLike<number>;
};

function addPoint(bounds: Bounds3, x: number, y: number, z: number): void {
  bounds.min.x = Math.min(bounds.min.x, x);
  bounds.min.y = Math.min(bounds.min.y, y);
  bounds.min.z = Math.min(bounds.min.z, z);
  bounds.max.x = Math.max(bounds.max.x, x);
  bounds.max.y = Math.max(bounds.max.y, y);
  bounds.max.z = Math.max(bounds.max.z, z);
}

function summarizeRecoveredGeometry(
  result: ConvertResult,
  includedElementIds: ReadonlySet<number>,
): Map<number, ElementGeometrySummary> {
  const summaries = new Map<number, ElementGeometrySummary>();
  for (const mesh of result.meshes) {
    if (!mesh.elementIds?.length) continue;
    const triangleCount = Math.min(mesh.elementIds.length, Math.floor(mesh.indices.length / 3));
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const elementId = mesh.elementIds[triangle]!;
      if (!includedElementIds.has(elementId)) continue;
      const summary = summaries.get(elementId) ?? { bounds: emptyBounds(), triangles: 0 };
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = mesh.indices[triangle * 3 + corner]! * 3;
        const x = mesh.positions[vertex];
        const y = mesh.positions[vertex + 1];
        const z = mesh.positions[vertex + 2];
        if (x == null || y == null || z == null) continue;
        addPoint(
          summary.bounds,
          x + result.origin.x,
          y + result.origin.y,
          z + result.origin.z,
        );
      }
      summary.triangles += 1;
      summaries.set(elementId, summary);
    }
  }
  return summaries;
}

function summarizeReferenceGeometry(
  references: readonly ReferenceMeshData[],
  includedElementIds: ReadonlySet<number>,
): Map<number, ElementGeometrySummary> {
  const summaries = new Map<number, ElementGeometrySummary>();
  for (const reference of references) {
    if (reference.diffStatus === "context" || !reference.elementIds?.length) continue;
    const triangleCount = Math.min(
      reference.elementIds.length,
      Math.floor(reference.indices.length / 3),
    );
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const elementId = reference.elementIds[triangle]!;
      if (!includedElementIds.has(elementId)) continue;
      const summary = summaries.get(elementId) ?? { bounds: emptyBounds(), triangles: 0 };
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = reference.indices[triangle * 3 + corner]! * 3;
        const x = reference.positions[vertex];
        const y = reference.positions[vertex + 1];
        const z = reference.positions[vertex + 2];
        if (x == null || y == null || z == null) continue;
        addPoint(
          summary.bounds,
          x * FEET_PER_METRE,
          y * FEET_PER_METRE,
          z * FEET_PER_METRE,
        );
      }
      summary.triangles += 1;
      summaries.set(elementId, summary);
    }
  }
  return summaries;
}

/**
 * Admit a decomposable ramp only when two independent facts agree:
 *
 * 1. IFC says the tagged product owns a direct body and is not an aggregate
 *    parent; and
 * 2. that body reaches the same six aggregate extents as the rendered RVT.
 *
 * The second clause is intentionally much tighter than the ordinary 0.5 ft
 * comparison gate. It admits UNBC 2375155 (all faces agree within 0.00001 ft)
 * while rejecting 1622190, whose tagged IfcSlab is only the landing and misses
 * its untagged flights by roughly 20 ft in plan.
 */
export function hasCompleteRampAggregateReference(
  recovered: ElementGeometrySummary | undefined,
  reference: ElementGeometrySummary | undefined,
  semanticallyComplete: boolean,
  toleranceFeet = RAMP_AGGREGATE_EXTENT_TOLERANCE_FEET,
): boolean {
  if (!semanticallyComplete || !recovered || !reference) return false;
  if (recovered.triangles < 4 || reference.triangles < 4) return false;
  for (const axis of ["x", "y", "z"] as const) {
    const recoveredSpan = recovered.bounds.max[axis] - recovered.bounds.min[axis];
    const referenceSpan = reference.bounds.max[axis] - reference.bounds.min[axis];
    if (
      recoveredSpan < MIN_COMPLETE_REFERENCE_SPAN_FEET ||
      referenceSpan < MIN_COMPLETE_REFERENCE_SPAN_FEET ||
      Math.abs(recovered.bounds.min[axis] - reference.bounds.min[axis]) > toleranceFeet ||
      Math.abs(recovered.bounds.max[axis] - reference.bounds.max[axis]) > toleranceFeet
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Admit a roof replacement only when identity and geometry agree independently.
 *
 * A numeric tag alone is not enough: the IFC product must be a direct IfcRoof
 * body, the rendered RVT must be bounds-aligned but materially different in
 * surface orientation, and all six extents must agree within 0.05 ft. Rendered
 * mesh extents are preferred; when that mesh is known to be incomplete, the
 * independently persisted native element bounds may satisfy the same gate.
 * This is the strict path used by UNBC roofs 1420880 and 1718794; ordinary
 * RVT-only conversion remains untouched and keeps reconstructed provenance.
 */
export function hasCompleteRoofReference(
  recovered: ElementGeometrySummary | undefined,
  reference: ElementGeometrySummary | undefined,
  directIfcRoofBody: boolean,
  shapeDifferenceConfirmed: boolean,
  toleranceFeet = ROOF_EXTENT_TOLERANCE_FEET,
  nativeRecordBounds?: Bounds3,
): boolean {
  if (!directIfcRoofBody || !shapeDifferenceConfirmed || !reference) {
    return false;
  }
  if (reference.triangles < 4) return false;
  const extentsMatch = (candidate: Bounds3): boolean => {
    for (const axis of ["x", "y", "z"] as const) {
      const candidateSpan = candidate.max[axis] - candidate.min[axis];
      const referenceSpan = reference.bounds.max[axis] - reference.bounds.min[axis];
      if (
        !Number.isFinite(candidateSpan) ||
        !Number.isFinite(referenceSpan) ||
        candidateSpan < MIN_COMPLETE_REFERENCE_SPAN_FEET ||
        referenceSpan < MIN_COMPLETE_REFERENCE_SPAN_FEET ||
        Math.abs(candidate.min[axis] - reference.bounds.min[axis]) > toleranceFeet ||
        Math.abs(candidate.max[axis] - reference.bounds.max[axis]) > toleranceFeet
      ) {
        return false;
      }
    }
    return true;
  };
  // Prefer the independently rendered mesh. An incomplete recovered roof may
  // legitimately stop short of its persisted native record bounds, so accept
  // that record only after the identity and slope gates above already passed.
  if (recovered && recovered.triangles >= 4 && extentsMatch(recovered.bounds)) {
    return true;
  }
  return nativeRecordBounds ? extentsMatch(nativeRecordBounds) : false;
}

export function hasIncompleteExpectedStairTopology(
  record: ConvertResult["elementBounds"][number] | undefined,
): boolean {
  const expected = record?.stairExpectedRiserCount;
  if (!Number.isSafeInteger(expected) || expected == null || expected <= 0) return false;
  const treads = record?.stairTreads;
  // Native straight-flight readers accept N-1 horizontal surfaces when the
  // upper landing supplies the final step. Use the same conservative floor.
  if (!treads || treads.length < Math.max(1, expected - 1)) return true;
  const invalidSurface = treads.some((tread) => {
    if (tread.length !== 4) return true;
    if (tread.some((point) =>
      !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !Number.isFinite(point[2]))) {
      return true;
    }
    const twiceArea = Math.abs(tread.reduce((area, point, index) => {
      const next = tread[(index + 1) % tread.length]!;
      return area + point[0] * next[1] - next[0] * point[1];
    }, 0));
    const minZ = Math.min(...tread.map((point) => point[2]));
    const maxZ = Math.max(...tread.map((point) => point[2]));
    return twiceArea < 1e-4 || maxZ - minZ > 0.02;
  });
  if (invalidSurface) return true;
  const elevations = treads
    .map((tread) => tread.reduce((sum, point) => sum + point[2], 0) / tread.length)
    .sort((left, right) => left - right);
  let distinctElevations = 0;
  let previous = -Infinity;
  for (const elevation of elevations) {
    if (elevation - previous <= 0.02) continue;
    distinctElevations += 1;
    previous = elevation;
  }
  return distinctElevations < Math.max(1, expected - 1);
}

export function incompleteExpectedStairTopologyIds(
  result: ConvertResult,
): Uint32Array {
  return Uint32Array.from(
    result.elementBounds
      .filter((record) => hasIncompleteExpectedStairTopology(record))
      .map((record) => record.elementId),
  );
}

/**
 * Certify a paired stair-flight body only from three independent facts: the
 * RVT aggregate expects real risers but did not yield usable treads, the numeric
 * IFC Tag names an IfcStairFlight body, and every min/max face agrees tightly
 * with either the rendered flight or its independently persisted native record.
 * Equal AABBs alone cannot trigger this path.
 */
export function hasCompleteStairFlightReference(
  recovered: ElementGeometrySummary | undefined,
  reference: ElementGeometrySummary | undefined,
  directIfcStairFlightBody: boolean,
  topologyIncomplete: boolean,
  toleranceFeet = STAIR_FLIGHT_EXTENT_TOLERANCE_FEET,
  nativeRecordBounds?: Bounds3,
): boolean {
  if (!directIfcStairFlightBody || !topologyIncomplete || !reference) {
    return false;
  }
  if (reference.triangles < 4) return false;
  const extentsMatch = (candidate: Bounds3): boolean => {
    for (const axis of ["x", "y", "z"] as const) {
      const recoveredSpan = candidate.max[axis] - candidate.min[axis];
      const referenceSpan = reference.bounds.max[axis] - reference.bounds.min[axis];
      if (
        recoveredSpan < MIN_COMPLETE_REFERENCE_SPAN_FEET ||
        referenceSpan < MIN_COMPLETE_REFERENCE_SPAN_FEET ||
        Math.abs(candidate.min[axis] - reference.bounds.min[axis]) > toleranceFeet ||
        Math.abs(candidate.max[axis] - reference.bounds.max[axis]) > toleranceFeet
      ) {
        return false;
      }
    }
    return true;
  };
  if (
    recovered &&
    recovered.triangles >= 4 &&
    extentsMatch(recovered.bounds)
  ) {
    return true;
  }
  return nativeRecordBounds ? extentsMatch(nativeRecordBounds) : false;
}

function dominantMaterials(meshes: readonly MeshData[]): Map<number, number> {
  const counts = new Map<number, Map<number, number>>();
  for (const mesh of meshes) {
    if (!mesh.elementIds) continue;
    for (const elementId of mesh.elementIds) {
      const byMaterial = counts.get(elementId) ?? new Map<number, number>();
      byMaterial.set(mesh.materialIndex, (byMaterial.get(mesh.materialIndex) ?? 0) + 1);
      counts.set(elementId, byMaterial);
    }
  }
  return new Map([...counts].map(([elementId, byMaterial]) => [
    elementId,
    [...byMaterial].sort((left, right) =>
      right[1] - left[1] || left[0] - right[0])[0]![0],
  ]));
}

function withoutElements(
  mesh: MeshData,
  excluded: ReadonlySet<number>,
): MeshData | null {
  if (!mesh.elementIds?.length) return mesh;
  const indices: number[] = [];
  const elementIds: number[] = [];
  for (let triangle = 0; triangle < mesh.elementIds.length; triangle += 1) {
    const elementId = mesh.elementIds[triangle]!;
    if (excluded.has(elementId)) continue;
    const offset = triangle * 3;
    indices.push(mesh.indices[offset]!, mesh.indices[offset + 1]!, mesh.indices[offset + 2]!);
    elementIds.push(elementId);
  }
  if (!indices.length) return null;
  if (indices.length === mesh.indices.length) return mesh;
  return {
    ...mesh,
    indices: Uint32Array.from(indices),
    elementIds: Uint32Array.from(elementIds),
  };
}

type RepairBatch = {
  positions: number[];
  indices: number[];
  colors: number[];
  elementIds: number[];
};

function emptyBounds(): Bounds3 {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
}

/**
 * Replace gated tagged elements with their paired IFC body. Bounds-aligned
 * elements are copied only for a native stair run whose expected risers prove
 * that its recovered tread topology is incomplete.
 */
export function applyIfcReferenceRepairs(
  result: ConvertResult,
  references: readonly ReferenceMeshData[],
  options: IfcReferenceRepairOptions = {},
): ConvertResult {
  const recordById = new Map(result.elementBounds.map((record) => [record.elementId, record]));
  const rampAggregateIds = new Set(
    result.elementBounds.filter(isRampAggregate).map((record) => record.elementId),
  );
  const roofIds = new Set(
    result.elementBounds.filter(isRoof).map((record) => record.elementId),
  );
  const stairRunIds = new Set(
    result.elementBounds.filter(isStairsRun).map((record) => record.elementId),
  );
  const geometryGateIds = new Set([...rampAggregateIds, ...roofIds, ...stairRunIds]);
  const semanticallyCompleteRampIds = new Set<number>(
    options.completeRampAggregateElementIds
      ? Array.from(options.completeRampAggregateElementIds)
      : [],
  );
  const directRoofGeometryIds = new Set<number>(
    options.directRoofGeometryElementIds
      ? Array.from(options.directRoofGeometryElementIds)
      : [],
  );
  const directStairFlightGeometryIds = new Set<number>(
    options.directStairFlightGeometryElementIds
      ? Array.from(options.directStairFlightGeometryElementIds)
      : [],
  );
  const shapeDifferentIds = new Set<number>(
    options.shapeDifferentElementIds
      ? Array.from(options.shapeDifferentElementIds)
      : [],
  );
  const recoveredGeometry = summarizeRecoveredGeometry(result, geometryGateIds);
  const referenceGeometry = summarizeReferenceGeometry(references, geometryGateIds);
  const replacementIds = new Set<number>();
  const retainedAggregateIds = new Set<number>();
  const completeRampAggregateIds = new Set<number>();
  const retainedRoofIds = new Set<number>();
  const completeRoofIds = new Set<number>();
  const retainedStairRunIds = new Set<number>();
  const completeStairRunIds = new Set<number>();
  for (const reference of references) {
    if (reference.diffStatus === "context") continue;
    for (const elementId of reference.elementIds ?? []) {
      // The membership test used to run against a parallel `Set` of the same
      // ids, which left `record` optional for the rest of the loop even though
      // the two were built from one array. Gating on the lookup itself is the
      // same test and narrows the record for every gate below it.
      const record = recordById.get(elementId);
      if (!(elementId > 0) || !record) continue;
      if (isStairsRun(record) && hasIncompleteExpectedStairTopology(record)) {
        if (hasCompleteStairFlightReference(
          recoveredGeometry.get(elementId),
          referenceGeometry.get(elementId),
          directStairFlightGeometryIds.has(elementId),
          true,
          STAIR_FLIGHT_EXTENT_TOLERANCE_FEET,
          record.boundsFeet,
        )) {
          retainedStairRunIds.delete(elementId);
          completeStairRunIds.add(elementId);
          replacementIds.add(elementId);
        } else if (!replacementIds.has(elementId)) {
          retainedStairRunIds.add(elementId);
        }
        continue;
      }
      if (reference.diffStatus !== "different") continue;
      if (isRoof(record)) {
        if (hasCompleteRoofReference(
          recoveredGeometry.get(elementId),
          referenceGeometry.get(elementId),
          directRoofGeometryIds.has(elementId),
          shapeDifferentIds.has(elementId),
          ROOF_EXTENT_TOLERANCE_FEET,
          record.boundsFeet,
        )) {
          completeRoofIds.add(elementId);
          replacementIds.add(elementId);
        } else {
          retainedRoofIds.add(elementId);
        }
        continue;
      }
      if (isRampAggregate(record)) {
        if (hasCompleteRampAggregateReference(
          recoveredGeometry.get(elementId),
          referenceGeometry.get(elementId),
          semanticallyCompleteRampIds.has(elementId),
        )) {
          completeRampAggregateIds.add(elementId);
          replacementIds.add(elementId);
        } else {
          retainedAggregateIds.add(elementId);
        }
        continue;
      }
      replacementIds.add(elementId);
    }
  }
  if (!replacementIds.size) {
    if (!retainedAggregateIds.size && !retainedRoofIds.size && !retainedStairRunIds.size) {
      return result;
    }
    return {
      ...result,
      referenceAssistedRetainedRampAggregateIds: Uint32Array.from(
        [...retainedAggregateIds].sort((left, right) => left - right),
      ),
      referenceAssistedRetainedRoofIds: Uint32Array.from(
        [...retainedRoofIds].sort((left, right) => left - right),
      ),
      referenceAssistedRetainedStairRunIds: Uint32Array.from(
        [...retainedStairRunIds].sort((left, right) => left - right),
      ),
      warnings: [
        ...result.warnings,
        ...(retainedAggregateIds.size
          ? [`${retainedAggregateIds.size.toLocaleString()} ramp aggregate${retainedAggregateIds.size === 1 ? "" : "s"} retained from RVT because the tagged IFC body is decomposed, lacks a direct complete body, or does not match all six rendered aggregate extents within ${RAMP_AGGREGATE_EXTENT_TOLERANCE_FEET.toFixed(2)} ft.`]
          : []),
        ...(retainedRoofIds.size
          ? [`${retainedRoofIds.size.toLocaleString()} roof${retainedRoofIds.size === 1 ? "" : "s"} retained from RVT because direct IfcRoof identity, a material surface-orientation difference, or six-face rendered/native-record extent parity within ${ROOF_EXTENT_TOLERANCE_FEET.toFixed(2)} ft was not confirmed.`]
          : []),
        ...(retainedStairRunIds.size
          ? [`${retainedStairRunIds.size.toLocaleString()} topologically incomplete stair run${retainedStairRunIds.size === 1 ? " was" : "s were"} retained from RVT because direct tagged IfcStairFlight identity or six-face extent parity within ${STAIR_FLIGHT_EXTENT_TOLERANCE_FEET.toFixed(2)} ft was not confirmed.`]
          : []),
      ],
    };
  }

  const materialByElement = dominantMaterials(result.meshes);
  const batches = new Map<number, RepairBatch>();
  const boundsByElement = new Map<number, Bounds3>();
  for (const reference of references) {
    if (reference.diffStatus === "context" || !reference.elementIds) continue;
    const triangleCount = Math.min(
      reference.elementIds.length,
      Math.floor(reference.indices.length / 3),
    );
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const elementId = reference.elementIds[triangle]!;
      if (!replacementIds.has(elementId)) continue;
      const materialIndex = materialByElement.get(elementId) ?? 0;
      const batch = batches.get(materialIndex) ?? {
        positions: [], indices: [], colors: [], elementIds: [],
      };
      const vertexOffset = batch.positions.length / 3;
      const bounds = boundsByElement.get(elementId) ?? emptyBounds();
      for (let corner = 0; corner < 3; corner += 1) {
        const sourceVertex = reference.indices[triangle * 3 + corner]! * 3;
        const absoluteX = reference.positions[sourceVertex]! * FEET_PER_METRE;
        const absoluteY = reference.positions[sourceVertex + 1]! * FEET_PER_METRE;
        const absoluteZ = reference.positions[sourceVertex + 2]! * FEET_PER_METRE;
        batch.positions.push(
          absoluteX - result.origin.x,
          absoluteY - result.origin.y,
          absoluteZ - result.origin.z,
        );
        batch.colors.push(1, 1, 1);
        bounds.min.x = Math.min(bounds.min.x, absoluteX);
        bounds.min.y = Math.min(bounds.min.y, absoluteY);
        bounds.min.z = Math.min(bounds.min.z, absoluteZ);
        bounds.max.x = Math.max(bounds.max.x, absoluteX);
        bounds.max.y = Math.max(bounds.max.y, absoluteY);
        bounds.max.z = Math.max(bounds.max.z, absoluteZ);
      }
      batch.indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2);
      batch.elementIds.push(elementId);
      batches.set(materialIndex, batch);
      boundsByElement.set(elementId, bounds);
    }
  }

  const retained = result.meshes.flatMap((mesh) => {
    const filtered = withoutElements(mesh, replacementIds);
    return filtered ? [filtered] : [];
  });
  const repaired = [...batches].map(([materialIndex, batch], index): MeshData => ({
    name: `Paired IFC repair ${index + 1}`,
    positions: Float32Array.from(batch.positions),
    indices: Uint32Array.from(batch.indices),
    colors: Float32Array.from(batch.colors),
    materialIndex,
    elementIds: Uint32Array.from(batch.elementIds),
    source: "reference-ifc",
  }));
  const meshes = [...retained, ...repaired];
  const triangleCount = meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0);

  return {
    ...result,
    meshes,
    elementBounds: result.elementBounds.map((record) => {
      const boundsFeet = boundsByElement.get(record.elementId);
      return boundsFeet
        ? { ...record, boundsFeet, renderGeometryProvenance: "reference-assisted" as const }
        : record;
    }),
    referenceAssistedElementIds: Uint32Array.from(
      [...replacementIds].sort((left, right) => left - right),
    ),
    referenceAssistedCompleteRampAggregateIds: Uint32Array.from(
      [...completeRampAggregateIds].sort((left, right) => left - right),
    ),
    referenceAssistedRetainedRampAggregateIds: Uint32Array.from(
      [...retainedAggregateIds].sort((left, right) => left - right),
    ),
    referenceAssistedCompleteRoofIds: Uint32Array.from(
      [...completeRoofIds].sort((left, right) => left - right),
    ),
    referenceAssistedRetainedRoofIds: Uint32Array.from(
      [...retainedRoofIds].sort((left, right) => left - right),
    ),
    referenceAssistedCompleteStairRunIds: Uint32Array.from(
      [...completeStairRunIds].sort((left, right) => left - right),
    ),
    referenceAssistedRetainedStairRunIds: Uint32Array.from(
      [...retainedStairRunIds].sort((left, right) => left - right),
    ),
    stats: { ...result.stats, triangleCount },
    warnings: [
      ...result.warnings,
      `${replacementIds.size.toLocaleString()} geometrically different or topology-incomplete elements use tagged geometry from the paired IFC; Revit identity, semantics and native material assignments are retained.`,
      ...(completeRampAggregateIds.size
        ? [`${completeRampAggregateIds.size.toLocaleString()} ramp aggregate${completeRampAggregateIds.size === 1 ? " uses its" : "s use their"} tagged direct IFC body after semantic completeness and six-face extent parity were both confirmed.`]
        : []),
      ...(retainedAggregateIds.size
        ? [`${retainedAggregateIds.size.toLocaleString()} ramp aggregate${retainedAggregateIds.size === 1 ? "" : "s"} retained from RVT because the tagged IFC body is decomposed, lacks a direct complete body, or does not match all six rendered aggregate extents within ${RAMP_AGGREGATE_EXTENT_TOLERANCE_FEET.toFixed(2)} ft.`]
        : []),
      ...(completeRoofIds.size
        ? [`${completeRoofIds.size.toLocaleString()} roof${completeRoofIds.size === 1 ? " uses its" : "s use their"} direct tagged IfcRoof body after a material surface-orientation difference and six-face rendered/native-record extent parity were both confirmed.`]
        : []),
      ...(retainedRoofIds.size
        ? [`${retainedRoofIds.size.toLocaleString()} roof${retainedRoofIds.size === 1 ? "" : "s"} retained from RVT because direct IfcRoof identity, a material surface-orientation difference, or six-face rendered/native-record extent parity within ${ROOF_EXTENT_TOLERANCE_FEET.toFixed(2)} ft was not confirmed.`]
        : []),
      ...(completeStairRunIds.size
        ? [`${completeStairRunIds.size.toLocaleString()} topologically incomplete stair run${completeStairRunIds.size === 1 ? " uses its" : "s use their"} direct tagged IfcStairFlight body after native riser-count evidence and six-face extent parity were confirmed.`]
        : []),
      ...(retainedStairRunIds.size
        ? [`${retainedStairRunIds.size.toLocaleString()} topologically incomplete stair run${retainedStairRunIds.size === 1 ? " was" : "s were"} retained from RVT because direct tagged IfcStairFlight identity or six-face extent parity within ${STAIR_FLIGHT_EXTENT_TOLERANCE_FEET.toFixed(2)} ft was not confirmed.`]
        : []),
    ],
  };
}
