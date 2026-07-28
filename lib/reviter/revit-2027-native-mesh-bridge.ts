import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import { scanFramedElementObjects } from "./element-objects.ts";
import type { InstancePlacement } from "./instanced-geometry.ts";
import {
  meshRevit2027CertifiedOwnerReplay,
  type Revit2027CertifiedOwnerFaceMesh,
} from "./revit-2027-certified-owner-mesh.ts";
import { isRevit2027DirectGeometryRoot } from "./revit-2027-direct-geometry-root.ts";
import {
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  type Revit2027FaceStatic,
} from "./revit-2027-face-static.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";

import type { Bounds3, MeshData, Vec3 } from "./types.ts";

const DEFAULT_MAX_STORED_TRIANGLES = 1_250_000;
const DEFAULT_MAX_OUTPUT_TRIANGLES = 1_250_000;
const DEFAULT_MAX_OWNERS = 25_000;
const OUTPUT_BATCH_TRIANGLES = 100_000;
const MAX_INCOMPLETE_SAMPLES = 100;

export type Revit2027NativeMeshLimits = {
  maxStoredTriangles?: number;
  maxOutputTriangles?: number;
  maxOwners?: number;
};

export type Revit2027IncompleteOwnerReason = {
  ownerElementId: number | null;
  code:
    | "unsafe-owner-id"
    | "no-drawable-faces"
    | "incomplete-drawable-faces"
    | "storage-limit";
  drawableFaces?: number;
  meshedDrawableFaces?: number;
  detail?: string;
};

export type Revit2027CompactOwnerMesh = {
  ownerElementId: number;
  faces: readonly {
    faceToken: number;
    mesh: NeutralFaceMesh;
  }[];
  triangles: number;
};

export type Revit2027NativeMeshCollection = {
  readonly enabled: boolean;
  readonly owners: ReadonlyMap<number, Revit2027CompactOwnerMesh>;
  readonly scannedFrames: number;
  readonly eligibleRoots: number;
  readonly replayedOwners: number;
  readonly completeOwners: number;
  readonly incompleteOwners: number;
  /** Surface-bearing Face records without a positive loop/region token. */
  readonly excludedNonTopologicalFaces: number;
  readonly failedOwners: number;
  readonly storedTriangles: number;
  readonly truncated: boolean;
  readonly incompleteSamples: readonly Revit2027IncompleteOwnerReason[];
};

type MutableCollection = {
  enabled: boolean;
  owners: Map<number, Revit2027CompactOwnerMesh>;
  scannedFrames: number;
  eligibleRoots: number;
  replayedOwners: number;
  completeOwners: number;
  incompleteOwners: number;
  excludedNonTopologicalFaces: number;
  failedOwners: number;
  storedTriangles: number;
  truncated: boolean;
  incompleteSamples: Revit2027IncompleteOwnerReason[];
};

export type Revit2027NativeMeshCollector = {
  readonly release: number | null;
  scanPage(data: Uint8Array): void;
  snapshot(): Revit2027NativeMeshCollection;
};

function safeLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : fallback;
}

function drawableFaceTokens(
  spans: readonly {
    propertyToken: number;
    propertySourceClassSlot: number;
    value?: unknown;
  }[],
): Set<number> {
  const tokens = new Set<number>();
  for (const span of spans) {
    if (
      span.propertyToken <= 0 ||
      span.propertySourceClassSlot !== REVIT_2027_FACE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const face = span.value as Partial<Revit2027FaceStatic> | undefined;
    if (!face || typeof face !== "object") continue;
    const hasLoop =
      (face.firstLoop?.token ?? 0) > 0 ||
      (face.faceRegions?.entries ?? []).some((entry) => entry.token > 0);
    if ((face.surface?.token ?? 0) > 0 && hasLoop) {
      tokens.add(span.propertyToken);
    }
  }
  return tokens;
}

export type Revit2027DrawableFaceCoverage = {
  complete: boolean;
  drawableFaces: number;
  meshedDrawableFaces: number;
  missingFaceTokens: readonly number[];
  code: "complete" | "no-drawable-faces" | "incomplete-drawable-faces";
};

function countExcludedNonTopologicalFaces(
  spans: readonly {
    propertyToken: number;
    propertySourceClassSlot: number;
    value?: unknown;
  }[],
): number {
  let count = 0;
  for (const span of spans) {
    if (
      span.propertyToken <= 0 ||
      span.propertySourceClassSlot !== REVIT_2027_FACE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const face = span.value as Partial<Revit2027FaceStatic> | undefined;
    if (!face || (face.surface?.token ?? 0) <= 0) continue;
    const hasLoop =
      (face.firstLoop?.token ?? 0) > 0 ||
      (face.faceRegions?.entries ?? []).some((entry) => entry.token > 0);
    if (!hasLoop) count += 1;
  }
  return count;
}

/**
 * Certify that every topological Face (a surface plus at least one loop/region)
 * has a mesh. Reference faces with no loop are deliberately excluded.
 */
export function certifyRevit2027DrawableFaceCoverage(
  spans: readonly {
    propertyToken: number;
    propertySourceClassSlot: number;
    value?: unknown;
  }[],
  faceMeshes: readonly { faceToken: number }[],
  issues: readonly {
    issue: { code: string; faceToken?: number };
  }[] = [],
): Revit2027DrawableFaceCoverage {
  const expected = drawableFaceTokens(spans);
  const meshed = new Set(faceMeshes.map((face) => face.faceToken));
  const blocked = new Set(
    issues
      .filter(
        ({ issue }) =>
          issue.code !== "material-unresolved" &&
          issue.faceToken != null &&
          expected.has(issue.faceToken),
      )
      .map(({ issue }) => issue.faceToken!),
  );
  const missingFaceTokens = [...expected].filter(
    (token) => !meshed.has(token) || blocked.has(token),
  );
  if (expected.size === 0) {
    return {
      complete: false,
      drawableFaces: 0,
      meshedDrawableFaces: 0,
      missingFaceTokens,
      code: "no-drawable-faces",
    };
  }
  return {
    complete: missingFaceTokens.length === 0,
    drawableFaces: expected.size,
    meshedDrawableFaces: expected.size - missingFaceTokens.length,
    missingFaceTokens,
    code:
      missingFaceTokens.length === 0
        ? "complete"
        : "incomplete-drawable-faces",
  };
}

function compactFaces(
  faces: readonly Revit2027CertifiedOwnerFaceMesh[],
): Revit2027CompactOwnerMesh["faces"] {
  return faces.map(({ faceToken, mesh }) => ({ faceToken, mesh }));
}

function rawFaceStyleId(
  _faceToken: number,
  face: Revit2027FaceStatic,
): number | null {
  const id = Number(face.renderStyleElementId);
  return id > 0 && Number.isSafeInteger(id) ? id : null;
}

/**
 * Create a bounded, browser-safe collector for the exact Revit 2027
 * GRep/BRep subset. Other releases are inert by construction.
 */
export function createRevit2027NativeMeshCollector(
  release: number | null | undefined,
  limits: Revit2027NativeMeshLimits = {},
): Revit2027NativeMeshCollector {
  const maxStoredTriangles = safeLimit(
    limits.maxStoredTriangles,
    DEFAULT_MAX_STORED_TRIANGLES,
  );
  const maxOwners = safeLimit(limits.maxOwners, DEFAULT_MAX_OWNERS);
  const state: MutableCollection = {
    enabled: release === 2027,
    owners: new Map(),
    scannedFrames: 0,
    eligibleRoots: 0,
    replayedOwners: 0,
    completeOwners: 0,
    incompleteOwners: 0,
    excludedNonTopologicalFaces: 0,
    failedOwners: 0,
    storedTriangles: 0,
    truncated: false,
    incompleteSamples: [],
  };

  const rememberIncomplete = (
    reason: Revit2027IncompleteOwnerReason,
  ): void => {
    state.incompleteOwners += 1;
    if (state.incompleteSamples.length < MAX_INCOMPLETE_SAMPLES) {
      state.incompleteSamples.push(reason);
    }
  };

  return {
    release: release ?? null,
    scanPage(data: Uint8Array): void {
      if (!state.enabled || state.truncated) return;
      for (const frame of scanFramedElementObjects(data)) {
        state.scannedFrames += 1;
        if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
        const root = decodeRevit2027FramedGRepRoot(data, frame, 2027);
        if (!root.ok || !isRevit2027DirectGeometryRoot(root.value)) continue;
        state.eligibleRoots += 1;

        const ownerElementId = Number(root.value.ownerElementId);
        if (
          !Number.isSafeInteger(ownerElementId) ||
          ownerElementId <= 0 ||
          ownerElementId > 0xffff_ffff
        ) {
          rememberIncomplete({
            ownerElementId: null,
            code: "unsafe-owner-id",
          });
          continue;
        }
        if (state.owners.has(ownerElementId)) continue;

        const replayed = replayRevit2027GRepFifo(data, root.value);
        if (!replayed.ok) {
          state.failedOwners += 1;
          continue;
        }
        state.replayedOwners += 1;
        const meshed = meshRevit2027CertifiedOwnerReplay(replayed.value, {
          materialForFace: rawFaceStyleId,
        });
        if (!meshed.ok) {
          state.failedOwners += 1;
          continue;
        }

        const coverage = certifyRevit2027DrawableFaceCoverage(
          replayed.value.spans,
          meshed.value.faceMeshes,
          meshed.value.issues,
        );
        state.excludedNonTopologicalFaces +=
          countExcludedNonTopologicalFaces(replayed.value.spans);
        if (coverage.code === "no-drawable-faces") {
          rememberIncomplete({
            ownerElementId,
            code: "no-drawable-faces",
            drawableFaces: 0,
            meshedDrawableFaces: 0,
          });
          continue;
        }
        if (!coverage.complete) {
          rememberIncomplete({
            ownerElementId,
            code: "incomplete-drawable-faces",
            drawableFaces: coverage.drawableFaces,
            meshedDrawableFaces: coverage.meshedDrawableFaces,
            detail: `${coverage.missingFaceTokens.length} drawable Face token(s) have no certified mesh`,
          });
          continue;
        }

        const expected = drawableFaceTokens(replayed.value.spans);
        const faces = compactFaces(
          meshed.value.faceMeshes.filter((face) =>
            expected.has(face.faceToken),
          ),
        );
        const triangles = faces.reduce(
          (total, face) => total + face.mesh.indices.length / 3,
          0,
        );
        if (
          state.owners.size >= maxOwners ||
          state.storedTriangles + triangles > maxStoredTriangles
        ) {
          state.truncated = true;
          rememberIncomplete({
            ownerElementId,
            code: "storage-limit",
            drawableFaces: coverage.drawableFaces,
            meshedDrawableFaces: coverage.meshedDrawableFaces,
            detail:
              `native mesh storage cap reached at ${state.storedTriangles} triangles`,
          });
          break;
        }
        state.owners.set(ownerElementId, {
          ownerElementId,
          faces,
          triangles,
        });
        state.completeOwners += 1;
        state.storedTriangles += triangles;
      }
    },
    snapshot(): Revit2027NativeMeshCollection {
      return {
        ...state,
        owners: state.owners,
        incompleteSamples: state.incompleteSamples,
      };
    },
  };
}

export type Revit2027NativeMeshBuildOptions = {
  maxOutputTriangles?: number;
  /** Only ids proven to be native MaterialElem definitions are exposed. */
  materialElementIds?: ReadonlySet<number>;
  /** Geometry ids already classified as reusable local shapes by the caller. */
  sharedOwnerIds?: ReadonlySet<number>;
  /** Independent element envelopes used to validate native coordinates. */
  expectedBoundsByElement?: ReadonlyMap<number, Bounds3>;
  boundsToleranceFeet?: number;
};

export type Revit2027NativeMeshScene = {
  meshes: MeshData[];
  /** Elements replaced only after all of their native triangles were admitted. */
  coveredElementIds: ReadonlySet<number>;
  ownerElements: number;
  placedElements: number;
  faceMeshes: number;
  triangles: number;
  truncated: boolean;
  boundsMismatches: number;
  missingBounds: number;
  boundsMismatchSamples: readonly {
    elementId: number;
    ownerElementId: number;
    placed: boolean;
    code: "bounds-mismatch" | "missing-bounds";
  }[];
};

type RenderItem = {
  elementId: number;
  owner: Revit2027CompactOwnerMesh;
  placement?: InstancePlacement;
};

function materialId(
  mesh: NeutralFaceMesh,
  definitions: ReadonlySet<number> | undefined,
): number | null {
  if (!definitions || mesh.groups.length === 0) return null;
  const ids = new Set(
    mesh.groups.map((group) =>
      typeof group.materialId === "number" &&
      definitions.has(group.materialId)
        ? group.materialId
        : null,
    ),
  );
  return ids.size === 1 ? [...ids][0]! : null;
}

function transformPoint(
  x: number,
  y: number,
  z: number,
  origin: Vec3,
  placement?: InstancePlacement,
): [number, number, number] {
  if (!placement) return [x - origin.x, y - origin.y, z - origin.z];
  const m = placement.basis;
  const [ox, oy, oz] = placement.origin;
  return [
    m[0]! * x + m[1]! * y + m[2]! * z + ox - origin.x,
    m[3]! * x + m[4]! * y + m[5]! * z + oy - origin.y,
    m[6]! * x + m[7]! * y + m[8]! * z + oz - origin.z,
  ];
}

function itemBounds(item: RenderItem): Bounds3 {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const face of item.owner.faces) {
    for (let index = 0; index < face.mesh.positions.length; index += 3) {
      const [x, y, z] = transformPoint(
        face.mesh.positions[index]!,
        face.mesh.positions[index + 1]!,
        face.mesh.positions[index + 2]!,
        { x: 0, y: 0, z: 0 },
        item.placement,
      );
      min.x = Math.min(min.x, x);
      min.y = Math.min(min.y, y);
      min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x);
      max.y = Math.max(max.y, y);
      max.z = Math.max(max.z, z);
    }
  }
  return { min, max };
}

function containedWithin(
  actual: Bounds3,
  expected: Bounds3,
  tolerance: number,
): boolean {
  return (
    actual.min.x >= expected.min.x - tolerance &&
    actual.min.y >= expected.min.y - tolerance &&
    actual.min.z >= expected.min.z - tolerance &&
    actual.max.x <= expected.max.x + tolerance &&
    actual.max.y <= expected.max.y + tolerance &&
    actual.max.z <= expected.max.z + tolerance
  );
}

/**
 * Expand compact owner-local meshes only after the scene origin and all exact
 * instance placements are known. A proxy is replaceable only when every one
 * of its admitted native triangles made it into an output batch.
 */
export function buildRevit2027NativeMeshScene(
  collection: Revit2027NativeMeshCollection,
  placements: Iterable<InstancePlacement>,
  origin: Vec3,
  options: Revit2027NativeMeshBuildOptions = {},
): Revit2027NativeMeshScene {
  if (!collection.enabled || collection.owners.size === 0) {
    return {
      meshes: [],
      coveredElementIds: new Set(),
      ownerElements: 0,
      placedElements: 0,
      faceMeshes: 0,
      triangles: 0,
      truncated: collection.truncated,
      boundsMismatches: 0,
      missingBounds: 0,
      boundsMismatchSamples: [],
    };
  }
  const maxOutputTriangles = safeLimit(
    options.maxOutputTriangles,
    DEFAULT_MAX_OUTPUT_TRIANGLES,
  );
  const placementList = [...placements];
  const referencedOwners =
    options.sharedOwnerIds ??
    new Set(placementList.map((placement) => placement.geometryId));
  const items: RenderItem[] = [];
  for (const owner of collection.owners.values()) {
    if (!referencedOwners.has(owner.ownerElementId)) {
      items.push({ elementId: owner.ownerElementId, owner });
    }
  }
  for (const placement of placementList) {
    if (
      options.sharedOwnerIds &&
      !options.sharedOwnerIds.has(placement.geometryId)
    ) {
      continue;
    }
    const owner = collection.owners.get(placement.geometryId);
    if (owner) items.push({ elementId: placement.elementId, owner, placement });
  }

  const meshes: MeshData[] = [];
  const coveredElementIds = new Set<number>();
  let triangles = 0;
  let faceMeshes = 0;
  let ownerElements = 0;
  let placedElements = 0;
  let truncated = collection.truncated;
  let boundsMismatches = 0;
  let missingBounds = 0;
  const boundsMismatchSamples: Revit2027NativeMeshScene["boundsMismatchSamples"][number][] = [];
  const boundsToleranceFeet =
    Number.isFinite(options.boundsToleranceFeet) &&
    options.boundsToleranceFeet! >= 0
      ? options.boundsToleranceFeet!
      : 0.5;

  type Batch = {
    materialId: number | null;
    positions: number[];
    indices: number[];
    colors: number[];
    elementIds: number[];
    triangles: number;
  };
  const admittedItems: RenderItem[] = [];

  const flush = (batch: Batch): void => {
    if (batch.triangles === 0) return;
    meshes.push({
      name: batch.materialId == null
        ? `Certified native BRep ${meshes.length + 1}`
        : `Certified native BRep · Material ${batch.materialId} · ${meshes.length + 1}`,
      positions: Float32Array.from(batch.positions),
      indices: Uint32Array.from(batch.indices),
      // Neutral white preserves the display material without inventing a
      // category or a native appearance colour that has not been decoded.
      colors: Float32Array.from(batch.colors),
      materialIndex: 0,
      elementIds: Uint32Array.from(batch.elementIds),
      ...(batch.materialId == null
        ? {}
        : { nativeMaterialElementId: batch.materialId }),
    });
  };

  for (const item of items) {
    if (options.expectedBoundsByElement) {
      const expected = options.expectedBoundsByElement.get(item.elementId);
      if (!expected) {
        missingBounds += 1;
        if (boundsMismatchSamples.length < MAX_INCOMPLETE_SAMPLES) {
          boundsMismatchSamples.push({
            elementId: item.elementId,
            ownerElementId: item.owner.ownerElementId,
            placed: item.placement != null,
            code: "missing-bounds",
          });
        }
        continue;
      }
      if (!containedWithin(itemBounds(item), expected, boundsToleranceFeet)) {
        boundsMismatches += 1;
        if (boundsMismatchSamples.length < MAX_INCOMPLETE_SAMPLES) {
          boundsMismatchSamples.push({
            elementId: item.elementId,
            ownerElementId: item.owner.ownerElementId,
            placed: item.placement != null,
            code: "bounds-mismatch",
          });
        }
        continue;
      }
    }
    if (triangles + item.owner.triangles > maxOutputTriangles) {
      truncated = true;
      continue;
    }
    admittedItems.push(item);
    triangles += item.owner.triangles;
    faceMeshes += item.owner.faces.length;
    coveredElementIds.add(item.elementId);
    if (item.placement) placedElements += 1;
    else ownerElements += 1;
  }

  // Keep only compact face/item references while grouping. Numeric JS arrays
  // are then built for one bounded material batch at a time, avoiding a large
  // transient array for every material in the model.
  const fragmentsByMaterial = new Map<
    string,
    {
      materialId: number | null;
      fragments: { item: RenderItem; face: Revit2027CompactOwnerMesh["faces"][number] }[];
    }
  >();
  for (const item of admittedItems) {
    for (const face of item.owner.faces) {
      const faceMaterialId = materialId(face.mesh, options.materialElementIds);
      const key =
        faceMaterialId == null ? "unresolved" : `material:${faceMaterialId}`;
      const group = fragmentsByMaterial.get(key) ?? {
        materialId: faceMaterialId,
        fragments: [],
      };
      group.fragments.push({ item, face });
      fragmentsByMaterial.set(key, group);
    }
  }
  for (const group of fragmentsByMaterial.values()) {
    let batch: Batch = {
      materialId: group.materialId,
      positions: [],
      indices: [],
      colors: [],
      elementIds: [],
      triangles: 0,
    };
    for (const { item, face } of group.fragments) {
      const faceTriangles = face.mesh.indices.length / 3;
      if (batch.triangles + faceTriangles > OUTPUT_BATCH_TRIANGLES) {
        flush(batch);
        batch = {
          materialId: group.materialId,
          positions: [],
          indices: [],
          colors: [],
          elementIds: [],
          triangles: 0,
        };
      }
      const vertexOffset = batch.positions.length / 3;
      for (let index = 0; index < face.mesh.positions.length; index += 3) {
        batch.positions.push(
          ...transformPoint(
            face.mesh.positions[index]!,
            face.mesh.positions[index + 1]!,
            face.mesh.positions[index + 2]!,
            origin,
            item.placement,
          ),
        );
        batch.colors.push(1, 1, 1);
      }
      for (const index of face.mesh.indices) {
        batch.indices.push(index + vertexOffset);
      }
      for (let index = 0; index < faceTriangles; index += 1) {
        batch.elementIds.push(item.elementId);
      }
      batch.triangles += faceTriangles;
    }
    flush(batch);
  }

  return {
    meshes,
    coveredElementIds,
    ownerElements,
    placedElements,
    faceMeshes,
    triangles,
    truncated,
    boundsMismatches,
    missingBounds,
    boundsMismatchSamples,
  };
}
