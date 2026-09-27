/**
 * Meshes from a replay's `GPolyMesh` nodes.
 *
 * A face of a solid has to be tessellated from its surface and trim; a
 * `GPolyMesh` is already triangles, so the only work is pairing each node with
 * the one faceted topology it queued and carrying its normals and material.
 * A stored normal per point is kept, so a lens stays smooth; a stored normal
 * per triangle becomes a flat triangle of its own. Triangles with no area are
 * left out.
 */
import type { NeutralFaceMesh, NeutralMeshFaceGroup } from "./brep-tessellator.ts";
import type { Revit2027FacetedTopology } from "./revit-2027-faceted-topology.ts";
import type { Revit2027GPolyMesh } from "./revit-2027-gpolymesh.ts";
import type {
  Revit2027GRepReplay,
  Revit2027GRepReplaySpan,
} from "./revit-2027-grep-replay.ts";

const POLYMESH_READER_ID = "Revit2027GPolyMesh";
const TOPOLOGY_READER_PREFIX = "Revit2027FacetedTopology";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as NeutralMeshFaceGroup["sourceTransform"];

export type Revit2027PolyMeshFace = {
  /** The node's own span, whose path places it under any embedded instance. */
  span: Revit2027GRepReplaySpan;
  /** A token for the mesh, unique among the owner's faces. */
  faceToken: number;
  mesh: NeutralFaceMesh;
};

export type Revit2027PolyMeshReplayResult =
  | { ok: true; value: Revit2027PolyMeshFace[] }
  | { ok: false; error: string };

/** Face tokens are positive; polymeshes are numbered well clear of them. */
const POLYMESH_TOKEN_BASE = 0x4000_0000;

function flatNormal(positions: Float64Array, a: number, b: number, c: number): [number, number, number] | null {
  const ax = positions[b * 3]! - positions[a * 3]!;
  const ay = positions[b * 3 + 1]! - positions[a * 3 + 1]!;
  const az = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
  const bx = positions[c * 3]! - positions[a * 3]!;
  const by = positions[c * 3 + 1]! - positions[a * 3 + 1]!;
  const bz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const length = Math.hypot(nx, ny, nz);
  return length > 1e-12 ? [nx / length, ny / length, nz / length] : null;
}

function meshTopology(
  topology: Revit2027FacetedTopology,
  polyMesh: Revit2027GPolyMesh,
  faceToken: number,
  ownerElementId: bigint,
): NeutralFaceMesh | null {
  const { positions: points, indices: facets, normals: stored } = topology;
  const pointCount = points.length / 3;
  const perPoint = stored.length === points.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const remap = perPoint ? new Int32Array(pointCount).fill(-1) : null;
  for (let triangle = 0; triangle < facets.length / 3; triangle += 1) {
    const corners = [facets[triangle * 3]!, facets[triangle * 3 + 1]!, facets[triangle * 3 + 2]!] as const;
    const flat = flatNormal(points, corners[0], corners[1], corners[2]);
    if (!flat) continue;
    for (const corner of corners) {
      if (remap) {
        if (remap[corner] === -1) {
          const normal = [stored[corner * 3]!, stored[corner * 3 + 1]!, stored[corner * 3 + 2]!];
          const length = Math.hypot(...normal);
          remap[corner] = positions.length / 3;
          positions.push(points[corner * 3]!, points[corner * 3 + 1]!, points[corner * 3 + 2]!);
          normals.push(...(length > 1e-6 ? normal.map((value) => value / length) : flat));
        }
        indices.push(remap[corner]!);
      } else {
        indices.push(positions.length / 3);
        positions.push(points[corner * 3]!, points[corner * 3 + 1]!, points[corner * 3 + 2]!);
        normals.push(...flat);
      }
    }
  }
  if (indices.length === 0) return null;
  const material = Number(polyMesh.materialElementId);
  const provenance = {
    decoderId: "revit-2027-gpolymesh",
    elementId: Number(ownerElementId),
    byteOffset: polyMesh.byteOffset,
  };
  return {
    brepId: `revit-2027-polymesh-${ownerElementId}-${faceToken}`,
    positions: Float64Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    groups: [{
      faceId: `revit-2027-polymesh-${faceToken}`,
      indexOffset: 0,
      indexCount: indices.length,
      vertexOffset: 0,
      vertexCount: positions.length / 3,
      materialId: material > 0 && Number.isSafeInteger(material) ? material : null,
      sourceTransform: IDENTITY,
      brepProvenance: provenance,
      faceProvenance: { ...provenance, byteOffset: topology.byteOffset },
    }],
  };
}

/**
 * Every polymesh in a completed replay, each with exactly the one faceted
 * topology it queued. A polymesh without one, or with more, fails the owner.
 */
export function meshRevit2027PolyMeshReplay(
  replay: Revit2027GRepReplay,
): Revit2027PolyMeshReplayResult {
  const topologyByParent = new Map<number, Revit2027GRepReplaySpan[]>();
  for (const span of replay.spans) {
    if (span.parentReplayIndex == null || !span.readerId.startsWith(TOPOLOGY_READER_PREFIX)) continue;
    const siblings = topologyByParent.get(span.parentReplayIndex) ?? [];
    siblings.push(span);
    topologyByParent.set(span.parentReplayIndex, siblings);
  }
  const faces: Revit2027PolyMeshFace[] = [];
  for (const span of replay.spans) {
    if (span.readerId !== POLYMESH_READER_ID) continue;
    const topologies = topologyByParent.get(span.replayIndex) ?? [];
    if (topologies.length !== 1) {
      return {
        ok: false,
        error: `GPolyMesh replay ${span.replayIndex} has ${topologies.length} faceted topologies instead of exactly one`,
      };
    }
    const faceToken = POLYMESH_TOKEN_BASE + span.replayIndex;
    const mesh = meshTopology(
      topologies[0]!.value as Revit2027FacetedTopology,
      span.value as Revit2027GPolyMesh,
      faceToken,
      replay.ownerElementId,
    );
    if (!mesh) {
      return { ok: false, error: `GPolyMesh replay ${span.replayIndex} has no triangle with area` };
    }
    faces.push({ span, faceToken, mesh });
  }
  return { ok: true, value: faces };
}
