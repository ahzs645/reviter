import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import { scanFramedElementObjects } from "./element-objects.ts";
import type { InstancePlacement } from "./instanced-geometry.ts";
import {
  meshRevit2027CertifiedOwnerReplay,
  type Revit2027CertifiedOwnerFaceMesh,
} from "./revit-2027-certified-owner-mesh.ts";
import {
  isRevit2027BoundedTessellatorRoot,
  isRevit2027ConditionedGeometryRoot,
  isRevit2027DirectGeometryRoot,
  isRevit2027EmbeddedGeometryRoot,
} from "./revit-2027-direct-geometry-root.ts";
import {
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  type Revit2027FaceStatic,
} from "./revit-2027-face-static.ts";
import {
  REVIT_2027_GCONDITION_INT_SOURCE_CLASS_SLOT,
  type Revit2027GConditionInt,
} from "./revit-2027-gcondition-int.ts";
import {
  REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
} from "./revit-2027-gfilter.ts";
import {
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
  type Revit2027GLine,
} from "./revit-2027-gline.ts";
import {
  REVIT_2027_GPOINT_SOURCE_CLASS_SLOT,
  type Revit2027GPoint,
} from "./revit-2027-gpoint.ts";
import {
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "./revit-2027-geometry.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "./revit-2027-grep-replay.ts";
import { meshRevit2027SpiralStairReplay } from "./revit-2027-spiral-stair-mesh.ts";
import type { Revit2027StairsRunAndLandingAggregate } from "./revit-2027-stairs-aggregate.ts";
import {
  collectRevit2027GInstanceBindings,
  collectRevit2027NestedInstances,
  composeRevit2027EmbeddedPathTransform,
  composeRevit2027NestedMesh,
  type Revit2027GInstanceBinding,
  type Revit2027NestedInstance,
} from "./revit-2027-nested-instance.ts";
import type { RevitTransform3d } from "./dynamic-geometry-queue.ts";

import type { Bounds3, MeshData, Vec3 } from "./types.ts";

const DEFAULT_MAX_STORED_TRIANGLES = 1_250_000;
const DEFAULT_MAX_OUTPUT_TRIANGLES = 1_250_000;
// The exact UNBC corpus has one framed GRep owner for most persisted elements,
// including non-scene definitions encountered before a later symbol reference.
// Keep the cap above that corpus while remaining finite and independently
// enforced from mesh/link/byte limits.
const DEFAULT_MAX_OWNERS = 100_000;
const DEFAULT_MAX_NESTED_LINKS = 100_000;
// The exact UNBC corpus with schema-complete conditioned-geometry readers uses
// 270,036,692 estimated bytes. Keep finite headroom without making the browser
// collector unbounded.
const DEFAULT_MAX_STORED_BYTES = 320 * 1024 * 1024;
const OUTPUT_BATCH_TRIANGLES = 100_000;
const MAX_INCOMPLETE_SAMPLES = 100;

export type Revit2027NativeMeshLimits = {
  maxStoredTriangles?: number;
  maxOutputTriangles?: number;
  maxOwners?: number;
  maxNestedLinks?: number;
  maxStoredBytes?: number;
  /** Diagnostic sample cap; production defaults to a bounded 100 records. */
  maxFailureSamples?: number;
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
    /** Exact column-major root-local transform for a nested occurrence. */
    nestedTransform?: RevitTransform3d["matrix"];
  }[];
  triangles: number;
};

export type Revit2027NativeMeshCollection = {
  readonly enabled: boolean;
  readonly owners: ReadonlyMap<number, Revit2027CompactOwnerMesh>;
  /** Owner ids produced by an exact reconstruction rather than face replay. */
  readonly reconstructedOwnerIds: ReadonlySet<number>;
  /**
   * Direct owners composed from a complete sibling and an exact persisted
   * GFilter state displacement. Their helper-only root extents do not enclose
   * the selected state and therefore are not a valid independent mesh gate.
   */
  readonly carrierComposedOwnerIds?: ReadonlySet<number>;
  readonly scannedFrames: number;
  readonly eligibleRoots: number;
  /** Exact non-legacy syntactic roots entering bounded tessellator replay. */
  readonly boundedTessellatorCandidateRoots: number;
  /** Candidate roots retained only after complete local/nested coverage. */
  readonly completeBoundedTessellatorRoots: number;
  /** Complete candidate owner ids used to prove actual scene admission. */
  readonly boundedTessellatorOwnerIds: ReadonlySet<number>;
  /** GFilter-led conditioned roots entering exact FIFO replay. */
  readonly conditionedGeometryCandidateRoots: number;
  /** Conditioned roots retained only after complete local/nested coverage. */
  readonly completeConditionedGeometryRoots: number;
  /** Complete conditioned owner ids used to prove actual scene admission. */
  readonly conditionedGeometryOwnerIds: ReadonlySet<number>;
  /** Exact embedded-column roots entering FIFO replay. */
  readonly embeddedGeometryCandidateRoots: number;
  /** Embedded roots retained only after complete transformed face coverage. */
  readonly completeEmbeddedGeometryRoots: number;
  /** Complete embedded owner ids used to prove actual scene admission. */
  readonly embeddedGeometryOwnerIds: ReadonlySet<number>;
  readonly replayedOwners: number;
  readonly completeOwners: number;
  readonly incompleteOwners: number;
  /** Surface-bearing Face records without a positive loop/region token. */
  readonly excludedNonTopologicalFaces: number;
  readonly failedOwners: number;
  readonly storedTriangles: number;
  readonly storedBytes: number;
  readonly truncated: boolean;
  readonly incompleteSamples: readonly Revit2027IncompleteOwnerReason[];
  readonly nestedDefinitions: number;
  readonly nestedLinks: number;
  readonly nestedRootOwners: number;
  readonly completeNestedRoots: number;
  readonly partialNestedRoots: number;
  readonly nestedTriangles: number;
  readonly nestedFailures: number;
  readonly nestedFailureSamples: readonly {
    ownerElementId: number | null;
    detail: string;
  }[];
  /** Exact geometry owners requested by persisted instance placements. */
  readonly requestedOwnerDefinitions: number;
  readonly completeRequestedOwners: number;
  readonly partialRequestedOwners: number;
  readonly requestedOwnerTriangles: number;
  readonly requestedOwnerFailures: number;
  readonly requestedOwnerFailureSamples: readonly {
    ownerElementId: number | null;
    detail: string;
  }[];
};

type CompactOwnerDefinition = {
  ownerElementId: number;
  directRoot: boolean;
  boundedTessellatorRoot: boolean;
  conditionedGeometryRoot: boolean;
  embeddedGeometryRoot: boolean;
  geometry: Revit2027CompactOwnerMesh | null;
  localComplete: boolean;
  localFailureDetail: string | null;
  nestedInstances: readonly Revit2027NestedInstance[];
  /** Retained only for a no-face root that may be an exact spiral flight. */
  spiralReplay: Revit2027GRepReplay | null;
  /** Minimal exact metadata for a two-state conditioned geometry carrier. */
  conditionalStateCarrier: Revit2027ConditionalStateCarrier | null;
};

export type Revit2027ConditionalStateCarrier = {
  displacement: readonly [number, number, number];
  lineOrigin: readonly [number, number, number];
  lineDirection: readonly [number, number, number];
};

type MutableCollection = {
  enabled: boolean;
  definitions: Map<number, CompactOwnerDefinition>;
  /** Exact pre-definition decode/replay failures keyed by framed owner id. */
  definitionFailures: Map<number, string>;
  conflictingOwnerIds: Set<number>;
  scannedFrames: number;
  eligibleRoots: number;
  boundedTessellatorCandidateRoots: number;
  conditionedGeometryCandidateRoots: number;
  embeddedGeometryCandidateRoots: number;
  replayedOwners: number;
  completeOwners: number;
  incompleteOwners: number;
  excludedNonTopologicalFaces: number;
  failedOwners: number;
  storedTriangles: number;
  storedBytes: number;
  nestedLinks: number;
  truncated: boolean;
  incompleteSamples: Revit2027IncompleteOwnerReason[];
  nestedFailureSamples: {
    ownerElementId: number | null;
    detail: string;
  }[];
  maxFailureSamples: number;
};

export type Revit2027NativeMeshCollector = {
  readonly release: number | null;
  scanPage(data: Uint8Array): void;
  /**
   * Finalize direct scene roots plus only the non-direct definitions proven to
   * be referenced by persisted instance placements.
   */
  snapshot(
    requestedOwnerIds?: Iterable<number>,
    stairsRuns?: ReadonlyMap<number, Revit2027StairsRunAndLandingAggregate>,
    owningElementByElement?: ReadonlyMap<number, number>,
  ): Revit2027NativeMeshCollection;
};

function safeLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : fallback;
}

function isNonNullCondInt16Token(token: number | undefined): boolean {
  return token === -1 || (token != null && token > 0);
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
      isNonNullCondInt16Token(face.firstLoop?.token) ||
      (face.faceRegions?.entries ?? []).some((entry) =>
        isNonNullCondInt16Token(entry.token)
      );
    if (isNonNullCondInt16Token(face.surface?.token) && hasLoop) {
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
    if (!face || !isNonNullCondInt16Token(face.surface?.token)) continue;
    const hasLoop =
      isNonNullCondInt16Token(face.firstLoop?.token) ||
      (face.faceRegions?.entries ?? []).some((entry) =>
        isNonNullCondInt16Token(entry.token)
      );
    if (!hasLoop) count += 1;
  }
  return count;
}

/**
 * Recognize the schema-complete conditioned carrier used by Revit for two
 * mutually exclusive geometry states.
 *
 * The carrier is deliberately exact: one top-level GFilter, helper GLine and
 * Geometry; two point subnodes; and the paired integer conditions
 * `(mode=3,param=3,value=1|2)`. No id, adjacency, category, or model-specific
 * coordinate participates.
 */
export function readRevit2027ConditionalStateCarrier(
  replay: Revit2027GRepReplay,
): Revit2027ConditionalStateCarrier | null {
  const roots = replay.spans.filter((span) => span.parentReplayIndex == null);
  if (
    roots.length !== 3 ||
    roots[0]?.propertySourceClassSlot !==
      REVIT_2027_GFILTER_SOURCE_CLASS_SLOT ||
    roots[1]?.propertySourceClassSlot !==
      REVIT_2027_GLINE_SOURCE_CLASS_SLOT ||
    roots[2]?.propertySourceClassSlot !==
      REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
  ) {
    return null;
  }
  const filterIndex = roots[0]!.replayIndex;
  const children = replay.spans.filter(
    (span) => span.parentReplayIndex === filterIndex,
  );
  const points = children.filter(
    (span) => span.propertySourceClassSlot ===
      REVIT_2027_GPOINT_SOURCE_CLASS_SLOT,
  );
  const conditions = children.filter(
    (span) => span.propertySourceClassSlot ===
      REVIT_2027_GCONDITION_INT_SOURCE_CLASS_SLOT,
  );
  if (
    children.length !== 4 ||
    points.length !== 2 ||
    conditions.length !== 2
  ) {
    return null;
  }
  const pointValues = points.map(
    (span) => span.value as Revit2027GPoint | undefined,
  );
  const conditionValues = conditions.map(
    (span) => span.value as Revit2027GConditionInt | undefined,
  );
  const line = roots[1]!.value as Revit2027GLine | undefined;
  if (
    pointValues.some((point) => point == null) ||
    conditionValues.some((condition) => condition == null) ||
    !line
  ) {
    return null;
  }
  const [firstCondition, secondCondition] =
    conditionValues as [Revit2027GConditionInt, Revit2027GConditionInt];
  if (
    firstCondition.compareMode !== 3 ||
    firstCondition.parameter !== 3 ||
    firstCondition.value !== 1 ||
    secondCondition.compareMode !== 3 ||
    secondCondition.parameter !== 3 ||
    secondCondition.value !== 2
  ) {
    return null;
  }
  const [firstPoint, secondPoint] =
    pointValues as [Revit2027GPoint, Revit2027GPoint];
  const displacement = firstPoint.coordinate.map(
    (coordinate, index) => coordinate - secondPoint.coordinate[index]!,
  ) as unknown as [number, number, number];
  const magnitude = Math.hypot(...displacement);
  if (
    !displacement.every(Number.isFinite) ||
    magnitude <= 1e-9 ||
    magnitude > 10_000
  ) {
    return null;
  }
  return {
    displacement,
    lineOrigin: line.origin,
    lineDirection: line.direction,
  };
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

type CompactFacesResult =
  | { ok: true; value: Revit2027CompactOwnerMesh["faces"] }
  | { ok: false; error: string };

function compactFaces(
  faces: readonly Revit2027CertifiedOwnerFaceMesh[],
  replay: Revit2027GRepReplay,
  bindings: readonly Revit2027GInstanceBinding[],
): CompactFacesResult {
  const faceSpans = new Map<number, Revit2027GRepReplay["spans"][number]>();
  for (const span of replay.spans) {
    if (
      span.propertyToken <= 0 ||
      span.propertySourceClassSlot !== REVIT_2027_FACE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    if (faceSpans.has(span.propertyToken)) {
      return {
        ok: false,
        error: `duplicate replay Face token ${span.propertyToken}`,
      };
    }
    faceSpans.set(span.propertyToken, span);
  }

  const compact: Revit2027CompactOwnerMesh["faces"][number][] = [];
  for (const { faceToken, mesh } of faces) {
    const span = faceSpans.get(faceToken);
    if (!span) {
      return {
        ok: false,
        error: `certified mesh Face token ${faceToken} has no replay span`,
      };
    }
    const embedded = composeRevit2027EmbeddedPathTransform(
      bindings,
      span.path,
    );
    if (!embedded.ok) return embedded;
    compact.push({
      faceToken,
      mesh,
      ...(embedded.value == null
        ? {}
        : { nestedTransform: embedded.value }),
    });
  }
  return { ok: true, value: compact };
}

function transformedExtents(
  bounds: {
    minimum: readonly [number, number, number];
    maximum: readonly [number, number, number];
  },
  matrix: RevitTransform3d["matrix"],
): Bounds3 | null {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const x of [bounds.minimum[0], bounds.maximum[0]]) {
    for (const y of [bounds.minimum[1], bounds.maximum[1]]) {
      for (const z of [bounds.minimum[2], bounds.maximum[2]]) {
        const point = [
          matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
          matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
          matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
        ];
        if (!point.every(Number.isFinite)) return null;
        min.x = Math.min(min.x, point[0]!);
        min.y = Math.min(min.y, point[1]!);
        min.z = Math.min(min.z, point[2]!);
        max.x = Math.max(max.x, point[0]!);
        max.y = Math.max(max.y, point[1]!);
        max.z = Math.max(max.z, point[2]!);
      }
    }
  }
  return { min, max };
}

function sameReplayPath(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validateEmbeddedBindings(
  replay: Revit2027GRepReplay,
  rootBounds: {
    minimum: readonly [number, number, number];
    maximum: readonly [number, number, number];
    valid: boolean;
  },
  bindings: readonly Revit2027GInstanceBinding[],
): string | null {
  const embedded = bindings.filter(
    (binding): binding is Extract<
      Revit2027GInstanceBinding,
      { kind: "embedded" }
    > => binding.kind === "embedded",
  );
  if (embedded.length === 0) return null;
  if (!rootBounds.valid) {
    return "embedded GInstance root has invalid persisted local extents";
  }
  const tolerance = 1e-6;
  for (const binding of embedded) {
    const { instance } = binding;
    if (
      instance.gRepId !== 0 ||
      instance.cda !== 1 ||
      instance.resolveSymbolInView ||
      instance.hasScale ||
      instance.tagElementId !== -1n ||
      instance.forbiddenTarget !== 0
    ) {
      return (
        `embedded GInstance replay ${instance.instanceReplayIndex} uses ` +
        "an unsupported selector, scale, view, tag, or target state"
      );
    }
    const span = replay.spans[binding.embeddedGElementReplayIndex];
    const value = span?.value as {
      localExtents?: {
        minimum?: readonly [number, number, number];
        maximum?: readonly [number, number, number];
        valid?: boolean;
      };
      objectType?: number;
      flags?: number;
    } | undefined;
    if (
      !span ||
      !sameReplayPath(span.path, binding.embeddedGElementPath) ||
      value?.localExtents?.valid !== true ||
      value.objectType !== 3 ||
      value.flags !== 2
    ) {
      return (
        `embedded GElement replay ${binding.embeddedGElementReplayIndex} ` +
        "does not match the certified column representation"
      );
    }
    const matrix = composeRevit2027EmbeddedPathTransform(
      bindings,
      [...binding.embeddedGElementPath, 0],
    );
    if (!matrix.ok) return matrix.error;
    if (matrix.value == null) {
      return "embedded GElement has no governing instance transform";
    }
    const actual = transformedExtents(
      {
        minimum: value.localExtents.minimum!,
        maximum: value.localExtents.maximum!,
      },
      matrix.value,
    );
    if (
      actual == null ||
      actual.min.x < rootBounds.minimum[0] - tolerance ||
      actual.min.y < rootBounds.minimum[1] - tolerance ||
      actual.min.z < rootBounds.minimum[2] - tolerance ||
      actual.max.x > rootBounds.maximum[0] + tolerance ||
      actual.max.y > rootBounds.maximum[1] + tolerance ||
      actual.max.z > rootBounds.maximum[2] + tolerance
    ) {
      return (
        `embedded GElement replay ${binding.embeddedGElementReplayIndex} ` +
        "falls outside its framed root local extents"
      );
    }
  }
  return null;
}

function rawFaceStyleId(
  _faceToken: number,
  face: Revit2027FaceStatic,
): number | null {
  const id = Number(face.renderStyleElementId);
  return id > 0 && Number.isSafeInteger(id) ? id : null;
}

function estimatedDefinitionBytes(
  geometry: Revit2027CompactOwnerMesh | null,
  nestedInstances: readonly Revit2027NestedInstance[],
): number {
  let bytes = 256 + nestedInstances.length * 384;
  for (const face of geometry?.faces ?? []) {
    bytes +=
      512 +
      face.mesh.positions.byteLength +
      face.mesh.normals.byteLength +
      face.mesh.indices.byteLength +
      face.mesh.groups.length * 512;
  }
  return bytes;
}

type NestedGeometryMarker = {
  mesh: Revit2027CompactOwnerMesh | null;
  localComplete: boolean;
};

function compactFacePoint(
  face: Revit2027CompactOwnerMesh["faces"][number],
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] {
  const matrix = face.nestedTransform;
  return matrix
    ? [
        matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
        matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
        matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
      ]
    : [x, y, z];
}

function compactOwnerProjectionRange(
  owner: Revit2027CompactOwnerMesh,
  axis: readonly [number, number, number],
): readonly [number, number] | null {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const face of owner.faces) {
    for (let index = 0; index < face.mesh.positions.length; index += 3) {
      const point = compactFacePoint(
        face,
        face.mesh.positions[index]!,
        face.mesh.positions[index + 1]!,
        face.mesh.positions[index + 2]!,
      );
      const projection =
        point[0] * axis[0] + point[1] * axis[1] + point[2] * axis[2];
      if (!Number.isFinite(projection)) return null;
      minimum = Math.min(minimum, projection);
      maximum = Math.max(maximum, projection);
    }
  }
  return Number.isFinite(minimum) && Number.isFinite(maximum)
    ? [minimum, maximum]
    : null;
}

function translatedCompactOwner(
  ownerElementId: number,
  source: Revit2027CompactOwnerMesh,
  displacement: readonly [number, number, number],
): Revit2027CompactOwnerMesh {
  const translation = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    displacement[0], displacement[1], displacement[2], 1,
  ] as const;
  return {
    ownerElementId,
    faces: source.faces.map((face) => {
      if (!face.nestedTransform) {
        return { ...face, nestedTransform: translation };
      }
      const matrix = [...face.nestedTransform] as number[];
      matrix[12] = matrix[12]! + displacement[0];
      matrix[13] = matrix[13]! + displacement[1];
      matrix[14] = matrix[14]! + displacement[2];
      return {
        ...face,
        nestedTransform:
          matrix as unknown as RevitTransform3d["matrix"],
      };
    }),
    triangles: source.triangles,
  };
}

function sameVector(
  left: readonly number[],
  right: readonly number[],
  tolerance = 1e-8,
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => Math.abs(value - right[index]!) <= tolerance)
  );
}

function finalizeRevit2027NativeMeshCollection(
  state: MutableCollection,
  requestedOwnerIds: Iterable<number> = [],
  stairsRuns: ReadonlyMap<
    number,
    Revit2027StairsRunAndLandingAggregate
  > = new Map(),
  owningElementByElement: ReadonlyMap<number, number> = new Map(),
): Revit2027NativeMeshCollection {
  const requestedOwners = state.enabled
    ? new Set(
        [...requestedOwnerIds].filter(
          (ownerElementId) =>
            Number.isSafeInteger(ownerElementId) &&
            ownerElementId > 0 &&
            ownerElementId <= 0xffff_ffff,
        ),
      )
    : new Set<number>();
  const owners = new Map<number, Revit2027CompactOwnerMesh>();
  const reconstructedOwnerIds = new Set<number>();
  const carrierComposedOwnerIds = new Set<number>();
  for (const definition of state.definitions.values()) {
    if (
      (definition.directRoot ||
        requestedOwners.has(definition.ownerElementId)) &&
      definition.nestedInstances.length === 0 &&
      definition.localComplete &&
      definition.geometry &&
      !state.conflictingOwnerIds.has(definition.ownerElementId)
    ) {
      owners.set(definition.ownerElementId, definition.geometry);
    }
  }
  for (const definition of state.definitions.values()) {
    if (
      owners.has(definition.ownerElementId) ||
      !definition.directRoot ||
      !definition.spiralReplay
    ) {
      continue;
    }
    const run = stairsRuns.get(definition.ownerElementId);
    if (!run) continue;
    const spiral = meshRevit2027SpiralStairReplay(
      definition.spiralReplay,
      run,
    );
    if (!spiral) continue;
    owners.set(definition.ownerElementId, {
      ownerElementId: definition.ownerElementId,
      faces: [{ faceToken: spiral.faceToken, mesh: spiral.mesh }],
      triangles: spiral.triangles,
    });
    reconstructedOwnerIds.add(definition.ownerElementId);
  }

  /*
   * Revit can persist two mutually exclusive stringer states as sibling
   * GElements: one owns the complete faces and the other owns only the same
   * state selector plus the exact state displacement. Resolve that relationship
   * only inside one decoded ownership scope and only when the helper plane
   * coincides with the complete sibling's leading face along the displacement.
   */
  for (const target of state.definitions.values()) {
    if (
      owners.has(target.ownerElementId) ||
      !target.directRoot ||
      target.geometry ||
      target.nestedInstances.length > 0 ||
      !target.conditionalStateCarrier
    ) {
      continue;
    }
    const parentId = owningElementByElement.get(target.ownerElementId);
    if (parentId == null) continue;
    const targetCarrier = target.conditionalStateCarrier;
    const magnitude = Math.hypot(...targetCarrier.displacement);
    const axis = targetCarrier.displacement.map(
      (value) => value / magnitude,
    ) as unknown as [number, number, number];
    const targetPlane =
      targetCarrier.lineOrigin[0] * axis[0] +
      targetCarrier.lineOrigin[1] * axis[1] +
      targetCarrier.lineOrigin[2] * axis[2];
    const lineAlongState =
      Math.abs(
        targetCarrier.lineDirection[0] * axis[0] +
          targetCarrier.lineDirection[1] * axis[1] +
          targetCarrier.lineDirection[2] * axis[2],
      );
    if (lineAlongState > 1e-8) continue;

    const candidates = [...state.definitions.values()].filter((source) => {
      if (
        source.ownerElementId === target.ownerElementId ||
        owningElementByElement.get(source.ownerElementId) !== parentId ||
        !source.geometry ||
        !source.localComplete ||
        !source.conditionalStateCarrier ||
        !sameVector(
          source.conditionalStateCarrier.displacement,
          targetCarrier.displacement,
        )
      ) {
        return false;
      }
      const range = compactOwnerProjectionRange(source.geometry, axis);
      if (!range) return false;
      const sourcePlane =
        source.conditionalStateCarrier.lineOrigin[0] * axis[0] +
        source.conditionalStateCarrier.lineOrigin[1] * axis[1] +
        source.conditionalStateCarrier.lineOrigin[2] * axis[2];
      return (
        Math.abs(sourcePlane - range[1]) <= 1e-6 &&
        Math.abs(targetPlane - sourcePlane) <= 1e-6
      );
    });
    if (candidates.length !== 1) continue;
    owners.set(
      target.ownerElementId,
      translatedCompactOwner(
        target.ownerElementId,
        candidates[0]!.geometry!,
        targetCarrier.displacement,
      ),
    );
    reconstructedOwnerIds.add(target.ownerElementId);
    carrierComposedOwnerIds.add(target.ownerElementId);
  }

  const nestedRoots = [...state.definitions.values()].filter(
    (definition) =>
      definition.directRoot && definition.nestedInstances.length > 0,
  );
  const selectedNestedRoots = [...state.definitions.values()].filter(
    (definition) =>
      definition.nestedInstances.length > 0 &&
      (definition.directRoot ||
        requestedOwners.has(definition.ownerElementId)),
  );
  let completeNestedRoots = 0;
  let partialNestedRoots = 0;
  let nestedTriangles = 0;
  let nestedFailures = 0;
  const nestedFailureSamples = [...state.nestedFailureSamples];
  let requestedOwnerFailures = 0;
  const requestedOwnerFailureSamples: {
    ownerElementId: number | null;
    detail: string;
  }[] = [];
  const rememberNestedFailure = (
    ownerElementId: number | null,
    detail: string,
  ): void => {
    nestedFailures += 1;
    if (nestedFailureSamples.length < state.maxFailureSamples) {
      nestedFailureSamples.push({ ownerElementId, detail });
    }
  };
  const rememberRequestedOwnerFailure = (
    ownerElementId: number | null,
    detail: string,
  ): void => {
    requestedOwnerFailures += 1;
    if (requestedOwnerFailureSamples.length < state.maxFailureSamples) {
      requestedOwnerFailureSamples.push({ ownerElementId, detail });
    }
  };

  const definitions = [...state.definitions.values()]
    .filter(
      (definition) =>
        !state.conflictingOwnerIds.has(definition.ownerElementId),
    )
    .map((definition) => ({
      ownerElementId: BigInt(definition.ownerElementId),
      // Every traversed definition contributes a marker, even when it only
      // contains grouping/instance nodes. This lets finalization enforce local
      // coverage for the entire recursive closure, not only mesh-bearing nodes.
      geometry: {
        mesh: definition.geometry,
        localComplete: definition.localComplete,
      } satisfies NestedGeometryMarker,
      nestedInstances: definition.nestedInstances,
    }));

  for (const root of selectedNestedRoots) {
    if (owners.has(root.ownerElementId)) continue;
    const directRoot = root.directRoot;
    const requestedRoot = requestedOwners.has(root.ownerElementId);
    const rememberFailure = (detail: string): void => {
      if (directRoot) {
        partialNestedRoots += 1;
        rememberNestedFailure(root.ownerElementId, detail);
      }
      if (requestedRoot) {
        rememberRequestedOwnerFailure(root.ownerElementId, detail);
      }
    };
    if (state.truncated) {
      rememberFailure("nested definition storage was truncated");
      continue;
    }
    if (state.conflictingOwnerIds.has(root.ownerElementId)) {
      rememberFailure(
        "nested root has a duplicate or conflicting owner definition",
      );
      continue;
    }
    const composed = composeRevit2027NestedMesh<NestedGeometryMarker>(
      BigInt(root.ownerElementId),
      definitions,
    );
    if (!composed.ok) {
      rememberFailure(composed.error);
      continue;
    }
    const incomplete = composed.value.occurrences.find(
      (occurrence) => !occurrence.geometry.localComplete,
    );
    if (incomplete) {
      rememberFailure(
        `nested source owner ${incomplete.geometryOwnerElementId} lacks complete local drawable-face coverage`,
      );
      continue;
    }
    const faces: Revit2027CompactOwnerMesh["faces"][number][] = [];
    let triangles = 0;
    for (const occurrence of composed.value.occurrences) {
      for (const face of occurrence.geometry.mesh?.faces ?? []) {
        faces.push({
          ...face,
          nestedTransform: occurrence.transform,
        });
        triangles += face.mesh.indices.length / 3;
      }
    }
    if (faces.length === 0) {
      rememberFailure("nested root resolves to no complete drawable faces");
      continue;
    }
    owners.set(root.ownerElementId, {
      ownerElementId: root.ownerElementId,
      faces,
      triangles,
    });
    if (directRoot) {
      completeNestedRoots += 1;
      nestedTriangles += triangles;
    }
  }

  for (const ownerElementId of requestedOwners) {
    if (owners.has(ownerElementId)) continue;
    const definition = state.definitions.get(ownerElementId);
    if (!definition) {
      rememberRequestedOwnerFailure(
        ownerElementId,
        state.definitionFailures.get(ownerElementId) ??
          "persisted placement geometry owner has no framed GRep definition",
      );
      continue;
    }
    if (definition.nestedInstances.length > 0) {
      // A selected nested root already recorded its exact composition failure.
      continue;
    }
    if (state.conflictingOwnerIds.has(ownerElementId)) {
      rememberRequestedOwnerFailure(
        ownerElementId,
        "persisted placement geometry owner has duplicate or conflicting definitions",
      );
      continue;
    }
    rememberRequestedOwnerFailure(
      ownerElementId,
      definition.localFailureDetail ??
        "persisted placement geometry owner lacks complete local drawable-face coverage",
    );
  }

  const completeRequestedOwners = [...requestedOwners].filter((ownerElementId) =>
    owners.has(ownerElementId)
  );
  const boundedTessellatorOwnerIds = new Set(
    [...state.definitions.values()]
      .filter(
        (definition) =>
          definition.boundedTessellatorRoot &&
          owners.has(definition.ownerElementId),
      )
      .map((definition) => definition.ownerElementId),
  );
  const conditionedGeometryOwnerIds = new Set(
    [...state.definitions.values()]
      .filter(
        (definition) =>
          definition.conditionedGeometryRoot &&
          owners.has(definition.ownerElementId),
      )
      .map((definition) => definition.ownerElementId),
  );
  const embeddedGeometryOwnerIds = new Set(
    [...state.definitions.values()]
      .filter(
        (definition) =>
          definition.embeddedGeometryRoot &&
          owners.has(definition.ownerElementId),
      )
      .map((definition) => definition.ownerElementId),
  );
  const requestedOwnerTriangles = completeRequestedOwners.reduce(
    (total, ownerElementId) =>
      total + (owners.get(ownerElementId)?.triangles ?? 0),
    0,
  );

  return {
    enabled: state.enabled,
    owners,
    reconstructedOwnerIds,
    carrierComposedOwnerIds,
    scannedFrames: state.scannedFrames,
    eligibleRoots: state.eligibleRoots,
    boundedTessellatorCandidateRoots:
      state.boundedTessellatorCandidateRoots,
    completeBoundedTessellatorRoots: boundedTessellatorOwnerIds.size,
    boundedTessellatorOwnerIds,
    conditionedGeometryCandidateRoots:
      state.conditionedGeometryCandidateRoots,
    completeConditionedGeometryRoots: conditionedGeometryOwnerIds.size,
    conditionedGeometryOwnerIds,
    embeddedGeometryCandidateRoots: state.embeddedGeometryCandidateRoots,
    completeEmbeddedGeometryRoots: embeddedGeometryOwnerIds.size,
    embeddedGeometryOwnerIds,
    replayedOwners: state.replayedOwners,
    completeOwners: state.completeOwners,
    incompleteOwners: state.incompleteOwners,
    excludedNonTopologicalFaces: state.excludedNonTopologicalFaces,
    failedOwners: state.failedOwners,
    storedTriangles: state.storedTriangles,
    storedBytes: state.storedBytes,
    truncated: state.truncated,
    incompleteSamples: state.incompleteSamples,
    nestedDefinitions: state.definitions.size,
    nestedLinks: state.nestedLinks,
    nestedRootOwners: nestedRoots.length,
    completeNestedRoots,
    partialNestedRoots,
    nestedTriangles,
    nestedFailures,
    nestedFailureSamples,
    requestedOwnerDefinitions: requestedOwners.size,
    completeRequestedOwners: completeRequestedOwners.length,
    partialRequestedOwners:
      requestedOwners.size - completeRequestedOwners.length,
    requestedOwnerTriangles,
    requestedOwnerFailures,
    requestedOwnerFailureSamples,
  };
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
  const maxNestedLinks = safeLimit(
    limits.maxNestedLinks,
    DEFAULT_MAX_NESTED_LINKS,
  );
  const maxStoredBytes = safeLimit(
    limits.maxStoredBytes,
    DEFAULT_MAX_STORED_BYTES,
  );
  const maxFailureSamples = safeLimit(
    limits.maxFailureSamples,
    MAX_INCOMPLETE_SAMPLES,
  );
  const state: MutableCollection = {
    enabled: release === 2027,
    definitions: new Map(),
    definitionFailures: new Map(),
    conflictingOwnerIds: new Set(),
    scannedFrames: 0,
    eligibleRoots: 0,
    boundedTessellatorCandidateRoots: 0,
    conditionedGeometryCandidateRoots: 0,
    embeddedGeometryCandidateRoots: 0,
    replayedOwners: 0,
    completeOwners: 0,
    incompleteOwners: 0,
    excludedNonTopologicalFaces: 0,
    failedOwners: 0,
    storedTriangles: 0,
    storedBytes: 0,
    nestedLinks: 0,
    truncated: false,
    incompleteSamples: [],
    nestedFailureSamples: [],
    maxFailureSamples,
  };

  const rememberIncomplete = (
    reason: Revit2027IncompleteOwnerReason,
  ): void => {
    state.incompleteOwners += 1;
    if (state.incompleteSamples.length < state.maxFailureSamples) {
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
        if (!root.ok) {
          state.definitionFailures.set(
            frame.elementId,
            `framed GRep root decode failed: ${root.error}`,
          );
          continue;
        }
        const boundedTessellatorRoot =
          isRevit2027BoundedTessellatorRoot(root.value);
        const conditionedGeometryRoot =
          isRevit2027ConditionedGeometryRoot(root.value);
        const embeddedGeometryRoot =
          isRevit2027EmbeddedGeometryRoot(root.value);
        const directRoot = isRevit2027DirectGeometryRoot(root.value);
        if (directRoot) state.eligibleRoots += 1;
        if (boundedTessellatorRoot) {
          state.boundedTessellatorCandidateRoots += 1;
        }
        if (conditionedGeometryRoot) {
          state.conditionedGeometryCandidateRoots += 1;
        }
        if (embeddedGeometryRoot) {
          state.embeddedGeometryCandidateRoots += 1;
        }

        const ownerElementId = Number(root.value.ownerElementId);
        if (
          !Number.isSafeInteger(ownerElementId) ||
          ownerElementId <= 0 ||
          ownerElementId > 0xffff_ffff ||
          ownerElementId !== frame.elementId
        ) {
          if (directRoot) {
            rememberIncomplete({
              ownerElementId: null,
              code: "unsafe-owner-id",
            });
          }
          continue;
        }
        if (
          state.definitions.has(ownerElementId) ||
          state.conflictingOwnerIds.has(ownerElementId)
        ) {
          state.conflictingOwnerIds.add(ownerElementId);
          continue;
        }

        const replayed = replayRevit2027GRepFifo(data, root.value);
        if (!replayed.ok) {
          state.definitionFailures.set(
            ownerElementId,
            `GRep FIFO replay failed: ${replayed.error}`,
          );
          if (directRoot) state.failedOwners += 1;
          continue;
        }
        if (directRoot) state.replayedOwners += 1;
        const bindings = collectRevit2027GInstanceBindings(replayed.value);
        if (!bindings.ok) {
          state.definitionFailures.set(
            ownerElementId,
            `instance binding replay failed: ${bindings.error}`,
          );
          if (directRoot) state.failedOwners += 1;
          continue;
        }
        const embeddedError = validateEmbeddedBindings(
          replayed.value,
          root.value.localExtents,
          bindings.value,
        );
        if (embeddedError) {
          state.definitionFailures.set(
            ownerElementId,
            `embedded-instance validation failed: ${embeddedError}`,
          );
          if (directRoot) state.failedOwners += 1;
          continue;
        }
        const nested = collectRevit2027NestedInstances(replayed.value);
        if (!nested.ok) {
          state.definitionFailures.set(
            ownerElementId,
            `nested-instance replay failed: ${nested.error}`,
          );
          if (directRoot) state.failedOwners += 1;
          continue;
        }
        const meshed = meshRevit2027CertifiedOwnerReplay(replayed.value, {
          materialForFace: rawFaceStyleId,
        });
        if (!meshed.ok) {
          state.definitionFailures.set(
            ownerElementId,
            `certified face meshing failed: ${meshed.error}`,
          );
          if (directRoot) state.failedOwners += 1;
          continue;
        }

        const coverage = certifyRevit2027DrawableFaceCoverage(
          replayed.value.spans,
          meshed.value.faceMeshes,
          meshed.value.issues,
        );
        if (directRoot) {
          state.excludedNonTopologicalFaces +=
            countExcludedNonTopologicalFaces(replayed.value.spans);
        }

        const expected = drawableFaceTokens(replayed.value.spans);
        const compacted = coverage.complete
          ? compactFaces(
              meshed.value.faceMeshes.filter((face) =>
                expected.has(face.faceToken),
              ),
              replayed.value,
              bindings.value,
            )
          : { ok: true as const, value: [] };
        if (!compacted.ok) {
          state.definitionFailures.set(
            ownerElementId,
            `embedded face association failed: ${compacted.error}`,
          );
          if (directRoot) state.failedOwners += 1;
          continue;
        }
        const faces = compacted.value;
        const triangles = coverage.complete
          ? faces.reduce(
              (total, face) => total + face.mesh.indices.length / 3,
              0,
            )
          : 0;
        const geometry =
          coverage.complete && faces.length > 0
            ? { ownerElementId, faces, triangles }
            : null;
        const localComplete =
          coverage.complete ||
          (coverage.code === "no-drawable-faces" &&
            nested.value.length > 0);
        const meshIssueDetails = [
          ...new Set(
            meshed.value.issues
              .filter(({ issue }) => issue.code !== "material-unresolved")
              .map(
                ({ path, issue }) =>
                  `${path}:${issue.code}` +
                  (issue.faceToken == null
                    ? ""
                    : `(face ${issue.faceToken})`),
              ),
          ),
        ];
        const localFailureDetail = localComplete
          ? null
          : coverage.code === "no-drawable-faces"
          ? "persisted geometry replay contains no drawable topological faces"
          : `${coverage.missingFaceTokens.length} drawable Face token(s) have no certified mesh` +
            (meshIssueDetails.length
              ? `; ${meshIssueDetails.join(", ")}`
              : "");
        if (directRoot && !localComplete) {
          rememberIncomplete(
            coverage.code === "no-drawable-faces"
              ? {
                  ownerElementId,
                  code: "no-drawable-faces",
                  drawableFaces: 0,
                  meshedDrawableFaces: 0,
                }
              : {
                  ownerElementId,
                  code: "incomplete-drawable-faces",
                  drawableFaces: coverage.drawableFaces,
                  meshedDrawableFaces: coverage.meshedDrawableFaces,
                  detail:
                    `${coverage.missingFaceTokens.length} drawable Face token(s) have no certified mesh`,
                },
          );
        }
        const definitionBytes = estimatedDefinitionBytes(
          geometry,
          nested.value,
        );
        if (
          state.definitions.size >= maxOwners ||
          state.storedTriangles + triangles > maxStoredTriangles ||
          state.nestedLinks + nested.value.length > maxNestedLinks ||
          state.storedBytes + definitionBytes > maxStoredBytes
        ) {
          state.truncated = true;
          if (directRoot) {
            rememberIncomplete({
              ownerElementId,
              code: "storage-limit",
              drawableFaces: coverage.drawableFaces,
              meshedDrawableFaces: coverage.meshedDrawableFaces,
              detail:
                `native definition storage cap reached at ${state.storedTriangles} triangles, ` +
                `${state.nestedLinks} links, and ${state.storedBytes} estimated bytes`,
            });
          }
          break;
        }
        state.definitions.set(ownerElementId, {
          ownerElementId,
          directRoot,
          boundedTessellatorRoot,
          conditionedGeometryRoot,
          embeddedGeometryRoot,
          geometry,
          localComplete,
          localFailureDetail,
          nestedInstances: nested.value,
          spiralReplay:
            coverage.code === "no-drawable-faces" &&
              nested.value.length > 0
              ? replayed.value
              : null,
          conditionalStateCarrier:
            readRevit2027ConditionalStateCarrier(replayed.value),
        });
        state.definitionFailures.delete(ownerElementId);
        if (directRoot && coverage.complete) state.completeOwners += 1;
        state.storedTriangles += triangles;
        state.storedBytes += definitionBytes;
        state.nestedLinks += nested.value.length;
      }
    },
    snapshot(
      requestedOwnerIds: Iterable<number> = [],
      stairsRuns: ReadonlyMap<
        number,
        Revit2027StairsRunAndLandingAggregate
      > = new Map(),
      owningElementByElement: ReadonlyMap<number, number> = new Map(),
    ): Revit2027NativeMeshCollection {
      return finalizeRevit2027NativeMeshCollection(
        state,
        requestedOwnerIds,
        stairsRuns,
        owningElementByElement,
      );
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
  /** Covered elements whose admitted owner used exact reconstruction. */
  reconstructedElementIds: ReadonlySet<number>;
  ownerElements: number;
  placedElements: number;
  /** Admitted direct/placed elements sourced from the bounded root route. */
  boundedTessellatorElements: number;
  /** Admitted direct/placed elements sourced from conditioned roots. */
  conditionedGeometryElements: number;
  /** Admitted direct/placed elements sourced from embedded roots. */
  embeddedGeometryElements: number;
  faceMeshes: number;
  triangles: number;
  truncated: boolean;
  boundsMismatches: number;
  missingBounds: number;
  /** Items admitted through the carrier-composition route, which skips the check. */
  carrierComposedItems: number;
  /** Of those, how many the envelope cross-check would have declined. */
  carrierComposedOutsideEnvelope: number;
  carrierComposedSamples: Revit2027NativeMeshScene["boundsMismatchSamples"];
  boundsMismatchSamples: readonly {
    elementId: number;
    ownerElementId: number;
    placed: boolean;
    code: "bounds-mismatch" | "missing-bounds" | "carrier-composed-outside-envelope";
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

function transformFacePoint(
  face: Revit2027CompactOwnerMesh["faces"][number],
  x: number,
  y: number,
  z: number,
  origin: Vec3,
  placement?: InstancePlacement,
): [number, number, number] {
  const nested = face.nestedTransform;
  if (nested) {
    const nestedX =
      nested[0]! * x + nested[4]! * y + nested[8]! * z + nested[12]!;
    const nestedY =
      nested[1]! * x + nested[5]! * y + nested[9]! * z + nested[13]!;
    const nestedZ =
      nested[2]! * x + nested[6]! * y + nested[10]! * z + nested[14]!;
    return transformPoint(nestedX, nestedY, nestedZ, origin, placement);
  }
  return transformPoint(x, y, z, origin, placement);
}

function itemBounds(item: RenderItem): Bounds3 {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const face of item.owner.faces) {
    for (let index = 0; index < face.mesh.positions.length; index += 3) {
      const [x, y, z] = transformFacePoint(
        face,
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
      reconstructedElementIds: new Set(),
      ownerElements: 0,
      placedElements: 0,
      boundedTessellatorElements: 0,
      conditionedGeometryElements: 0,
      embeddedGeometryElements: 0,
      faceMeshes: 0,
      triangles: 0,
      truncated: collection.truncated,
      boundsMismatches: 0,
      missingBounds: 0,
      carrierComposedItems: 0,
      carrierComposedOutsideEnvelope: 0,
      carrierComposedSamples: [],
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
  const reconstructedElementIds = new Set<number>();
  let triangles = 0;
  let faceMeshes = 0;
  let ownerElements = 0;
  let placedElements = 0;
  let boundedTessellatorElements = 0;
  let conditionedGeometryElements = 0;
  let embeddedGeometryElements = 0;
  let truncated = collection.truncated;
  let boundsMismatches = 0;
  let missingBounds = 0;
  let carrierComposedItems = 0;
  let carrierComposedOutsideEnvelope = 0;
  const boundsMismatchSamples: Revit2027NativeMeshScene["boundsMismatchSamples"][number][] = [];
  const carrierComposedSamples: Revit2027NativeMeshScene["boundsMismatchSamples"][number][] = [];
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
      source: "native-brep",
      ...(batch.materialId == null
        ? {}
        : { nativeMaterialElementId: batch.materialId }),
    });
  };

  for (const item of items) {
    const exactCarrierComposition =
      item.placement == null &&
      collection.carrierComposedOwnerIds?.has(item.owner.ownerElementId) ===
        true;
    // Carrier-composed geometry is another owner's mesh translated by a carrier
    // displacement, so it is the one route that can put a correct shape in the
    // wrong place — and it is the one route that skips the envelope check. Count
    // what the check would have said, so the bypass stops being unmeasured.
    if (exactCarrierComposition && options.expectedBoundsByElement) {
      carrierComposedItems += 1;
      const expected = options.expectedBoundsByElement.get(item.elementId);
      if (expected && !containedWithin(itemBounds(item), expected, boundsToleranceFeet)) {
        carrierComposedOutsideEnvelope += 1;
        if (carrierComposedSamples.length < MAX_INCOMPLETE_SAMPLES) {
          carrierComposedSamples.push({
            elementId: item.elementId,
            ownerElementId: item.owner.ownerElementId,
            placed: false,
            code: "carrier-composed-outside-envelope",
          });
        }
      }
    }
    if (options.expectedBoundsByElement && !exactCarrierComposition) {
      const expected = options.expectedBoundsByElement.get(item.elementId);
      if (!expected) {
        // No envelope to check against — which is a gap in the *envelope*
        // evidence, not evidence against the mesh. This used to `continue`, and
        // the cost was concrete: a stair baluster's bounds record is written
        // with zero height and the railing's plan extent (76.58 × 6.26 × 0.00
        // ft), so it fails the solid test, leaves no envelope behind, and the
        // baluster's own complete certified face mesh was discarded with it.
        // 76 of the model's 99 balusters disappeared that way, along with the
        // rest of the 3,048 elements in this bucket.
        //
        // A complete certified GRep/BRep face set is the stronger of the two
        // pieces of evidence, so it is admitted. It is still counted, and
        // `convert.ts` reports the count, because "drawn without an independent
        // cross-check" is a real qualification on the geometry and the reader
        // should be told rather than left to infer it from a silence.
        missingBounds += 1;
        if (boundsMismatchSamples.length < MAX_INCOMPLETE_SAMPLES) {
          boundsMismatchSamples.push({
            elementId: item.elementId,
            ownerElementId: item.owner.ownerElementId,
            placed: item.placement != null,
            code: "missing-bounds",
          });
        }
      } else if (!containedWithin(itemBounds(item), expected, boundsToleranceFeet)) {
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
    if (collection.reconstructedOwnerIds.has(item.owner.ownerElementId)) {
      reconstructedElementIds.add(item.elementId);
    }
    if (
      collection.boundedTessellatorOwnerIds.has(item.owner.ownerElementId)
    ) {
      boundedTessellatorElements += 1;
    }
    if (
      collection.conditionedGeometryOwnerIds.has(item.owner.ownerElementId)
    ) {
      conditionedGeometryElements += 1;
    }
    if (collection.embeddedGeometryOwnerIds.has(item.owner.ownerElementId)) {
      embeddedGeometryElements += 1;
    }
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
          ...transformFacePoint(
            face,
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
    reconstructedElementIds,
    ownerElements,
    placedElements,
    boundedTessellatorElements,
    conditionedGeometryElements,
    embeddedGeometryElements,
    faceMeshes,
    triangles,
    truncated,
    boundsMismatches,
    missingBounds,
    carrierComposedItems,
    carrierComposedOutsideEnvelope,
    carrierComposedSamples,
    boundsMismatchSamples,
  };
}
