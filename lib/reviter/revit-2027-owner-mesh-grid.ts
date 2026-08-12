import type {
  BrepProvenance,
  NeutralFaceMesh,
  NeutralMeshFaceGroup,
} from "./brep-tessellator.ts";

/** Model-space point or vector in Revit's internal feet. */
export type Revit2027Point3 = readonly [number, number, number];

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

export function addPoints(
  left: Revit2027Point3,
  right: Revit2027Point3,
): Revit2027Point3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

export function subtractPoints(
  left: Revit2027Point3,
  right: Revit2027Point3,
): Revit2027Point3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

export function scalePoint(
  point: Revit2027Point3,
  scalar: number,
): Revit2027Point3 {
  return [point[0] * scalar, point[1] * scalar, point[2] * scalar];
}

export function mixPoints(
  left: Revit2027Point3,
  right: Revit2027Point3,
  fraction: number,
): Revit2027Point3 {
  return addPoints(scalePoint(left, 1 - fraction), scalePoint(right, fraction));
}

export function crossPoints(
  left: Revit2027Point3,
  right: Revit2027Point3,
): Revit2027Point3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

export function normalizedPoint(
  point: Revit2027Point3,
): Revit2027Point3 | null {
  const length = Math.hypot(...point);
  return Number.isFinite(length) && length > Number.EPSILON
    ? scalePoint(point, 1 / length)
    : null;
}

export function samePoint3(
  left: Revit2027Point3,
  right: Revit2027Point3,
  tolerance: number,
): boolean {
  return Math.abs(left[0] - right[0]) <= tolerance &&
    Math.abs(left[1] - right[1]) <= tolerance &&
    Math.abs(left[2] - right[2]) <= tolerance;
}

export type Revit2027OwnerFaceMeshRequest = {
  ownerElementId: bigint;
  faceToken: number;
  /** Provenance decoder identity of the certified path that built this mesh. */
  decoderId: string;
  /** Suffix naming the geometry family inside this owner's brep identity. */
  brepSuffix: string;
  materialId: string | number | null;
  positions: Float64Array;
  normals: Float32Array;
  indices: Uint32Array;
};

/**
 * Wrap one certified face tessellation as a single-group neutral mesh.
 *
 * Every certified owner path emits exactly one face group per persisted Face
 * and carries its own decoder identity into both provenance slots, so a face
 * in the viewer can always be traced back to the path that admitted it.
 */
export function revit2027OwnerFaceMesh(
  request: Revit2027OwnerFaceMeshRequest,
): NeutralFaceMesh {
  const elementId = Number(request.ownerElementId);
  const provenance: BrepProvenance = {
    decoderId: request.decoderId,
    elementId: Number.isSafeInteger(elementId) ? elementId : undefined,
  };
  const group: NeutralMeshFaceGroup = {
    faceId: `revit-2027-owner-${request.ownerElementId}-face-${request.faceToken}`,
    indexOffset: 0,
    indexCount: request.indices.length,
    vertexOffset: 0,
    vertexCount: request.positions.length / 3,
    materialId: request.materialId,
    sourceTransform: IDENTITY,
    brepProvenance: provenance,
    faceProvenance: provenance,
  };
  return {
    brepId: `revit-2027-owner-${request.ownerElementId}-${request.brepSuffix}`,
    positions: request.positions,
    normals: request.normals,
    indices: request.indices,
    groups: [group],
  };
}

/** One evaluated surface sample and the tangents that orient it. */
export type Revit2027SurfaceSample = {
  point: Revit2027Point3;
  tangentU: Revit2027Point3;
  tangentV: Revit2027Point3;
};

export type Revit2027TensorGridFaceMeshRequest =
  & Omit<Revit2027OwnerFaceMeshRequest, "positions" | "normals" | "indices">
  & {
    uSegments: number;
    vSegments: number;
    /** Persisted Surface.orientFlag, which fixes the emitted winding. */
    orientFlag: boolean;
    /**
     * Sample factory for one column of the grid. Returning a row evaluator
     * lets a surface hoist whatever it holds constant along v; returning null
     * from either level declines the whole face rather than emitting a
     * partial mesh.
     */
    row: (
      uIndex: number,
    ) => ((vIndex: number) => Revit2027SurfaceSample | null) | null;
  };

/**
 * Tessellate one rectangular surface patch over a persisted tensor grid.
 *
 * The grid is chosen by the persisted trim samples, not by a display LOD, so
 * every emitted vertex sits on a parameter Revit itself wrote. A degenerate
 * normal anywhere declines the face.
 */
export function revit2027TensorGridFaceMesh(
  request: Revit2027TensorGridFaceMeshRequest,
): NeutralFaceMesh | null {
  const { uSegments, vSegments, orientFlag } = request;
  if (uSegments < 1 || vSegments < 1) return null;
  const uCount = uSegments + 1;
  const vCount = vSegments + 1;
  const positions = new Float64Array(uCount * vCount * 3);
  const normals = new Float32Array(uCount * vCount * 3);
  for (let uIndex = 0; uIndex < uCount; uIndex += 1) {
    const row = request.row(uIndex);
    if (!row) return null;
    for (let vIndex = 0; vIndex < vCount; vIndex += 1) {
      const sample = row(vIndex);
      if (!sample) return null;
      let normal = normalizedPoint(
        crossPoints(sample.tangentU, sample.tangentV),
      );
      if (!normal) return null;
      if (!orientFlag) normal = scalePoint(normal, -1);
      const vertex = uIndex * vCount + vIndex;
      positions.set(sample.point, vertex * 3);
      normals.set(normal, vertex * 3);
    }
  }
  const indices = new Uint32Array(uSegments * vSegments * 6);
  let cursor = 0;
  for (let uIndex = 0; uIndex < uSegments; uIndex += 1) {
    for (let vIndex = 0; vIndex < vSegments; vIndex += 1) {
      const a = uIndex * vCount + vIndex;
      const b = (uIndex + 1) * vCount + vIndex;
      const c = b + 1;
      const d = a + 1;
      indices.set(
        orientFlag ? [a, b, d, b, c, d] : [a, d, b, b, d, c],
        cursor,
      );
      cursor += 6;
    }
  }
  return revit2027OwnerFaceMesh({ ...request, positions, normals, indices });
}
