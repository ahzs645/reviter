import {
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
  type Revit2027EdgeLoopStatic,
  type Revit2027EdgeLoopWithChainEnvelopesStatic,
} from "./revit-2027-edge-loop-static.ts";
import {
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
  type Revit2027GEdgeStatic,
} from "./revit-2027-edge-1423.ts";
import {
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  type Revit2027FaceStatic,
} from "./revit-2027-face-static.ts";
import { REVIT_2027_GARC_SOURCE_CLASS_SLOT } from "./revit-2027-garc.ts";
import { REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT } from "./revit-2027-gcylindrical-helix.ts";
import { REVIT_2027_GLINE_SOURCE_CLASS_SLOT } from "./revit-2027-gline.ts";
import { REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT } from "./revit-2027-hermite-surface.ts";
import type {
  Revit2027GRepReplay,
  Revit2027GRepReplaySpan,
} from "./revit-2027-grep-replay.ts";
import {
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
} from "./revit-2027-surfaces.ts";

export type Revit2027OwnerLoopRecord = {
  token: number;
  loop: Revit2027EdgeLoopStatic;
};

export type Revit2027OwnerSurfaceRecord = {
  /** Property token of the surface span, which may be the retained `-1`. */
  token: number;
  replayIndex: number;
  value: unknown;
};

export type Revit2027OwnerCurveRecord = {
  sourceClassSlot: number;
  token: number;
  value: unknown;
};

export type Revit2027OwnerMeshIndex = {
  /** Persisted Faces in replay order; every certified path iterates this. */
  faces: ReadonlyMap<number, Revit2027FaceStatic>;
  edges: ReadonlyMap<number, Revit2027GEdgeStatic>;
  loops: ReadonlyMap<number, Revit2027OwnerLoopRecord>;
  /** Surface source slot to owning Face token to the last persisted surface. */
  surfaces: ReadonlyMap<number, ReadonlyMap<number, Revit2027OwnerSurfaceRecord>>;
  /** Owning Face token to that surface's persisted profile curves, in order. */
  curves: ReadonlyMap<number, readonly Revit2027OwnerCurveRecord[]>;
};

type Revit2027OwnerCurveRegistration = {
  sourceClassSlot: number;
  /**
   * Whether a curve span must carry a positive property token to be indexed.
   * See the surface registration note: the two families disagree here too.
   */
  requirePositiveToken: boolean;
};

type Revit2027OwnerSurfaceRegistration = {
  id: string;
  /**
   * Whether a surface span must carry a positive property token to be indexed.
   *
   * This is not cosmetic and must stay per slot. Token -1 is a real queued
   * property that does not advance the pointer-index namespace, and Revit uses
   * it for surfaces: the cone, cylinder and SurfRev fixtures persist their
   * surface at token -1, while a Plane surface arrives at a positive token.
   * The planar path has always skipped every non-positive span outright and
   * the curved paths have always accepted them, so one shared index can only
   * reproduce both by remembering which slot wants which.
   */
  requirePositiveToken: boolean;
  /** Profile curves persisted beneath this surface, indexed per owning Face. */
  curves?: readonly Revit2027OwnerCurveRegistration[];
};

/**
 * Slot-keyed surface readers for the owner mesh index.
 *
 * This mirrors `BUILTIN_READERS` in the replay engine: a later certified
 * surface is added by source slot without touching the indexing pass, and an
 * unregistered slot is simply not indexed.
 */
const BUILTIN_SURFACES: readonly [
  number,
  Revit2027OwnerSurfaceRegistration,
][] = [
  [
    REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
    { id: "Revit2027PlaneSurface", requirePositiveToken: true },
  ],
  [
    REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
    { id: "Revit2027ConeSurface", requirePositiveToken: false },
  ],
  [
    REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
    { id: "Revit2027CylinderSurface", requirePositiveToken: false },
  ],
  [
    REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027SurfaceOfRevolution",
      requirePositiveToken: false,
      curves: [
        {
          sourceClassSlot: REVIT_2027_GARC_SOURCE_CLASS_SLOT,
          requirePositiveToken: false,
        },
      ],
    },
  ],
  [
    REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027RuledSurface",
      requirePositiveToken: false,
      curves: [
        {
          sourceClassSlot: REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT,
          requirePositiveToken: true,
        },
        {
          sourceClassSlot: REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
          requirePositiveToken: true,
        },
      ],
    },
  ],
  [
    REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT,
    { id: "Revit2027HermiteSurface", requirePositiveToken: false },
  ],
];

const SURFACE_REGISTRATIONS = new Map(BUILTIN_SURFACES);

/** Curve slot to the surface slot it may hang from, and its token policy. */
const CURVE_REGISTRATIONS = new Map<
  number,
  Revit2027OwnerCurveRegistration & { surfaceSourceClassSlot: number }
>(
  BUILTIN_SURFACES.flatMap(([surfaceSourceClassSlot, registration]) =>
    (registration.curves ?? []).map((curve) => [
      curve.sourceClassSlot,
      { ...curve, surfaceSourceClassSlot },
    ] as const)
  ),
);

function spanValue<T>(span: Revit2027GRepReplaySpan): T {
  return span.value as T;
}

function buildIndex(replay: Revit2027GRepReplay): Revit2027OwnerMeshIndex {
  const faces = new Map<number, Revit2027FaceStatic>();
  const edges = new Map<number, Revit2027GEdgeStatic>();
  const loops = new Map<number, Revit2027OwnerLoopRecord>();
  const surfaces = new Map<
    number,
    Map<number, Revit2027OwnerSurfaceRecord>
  >();
  const curves = new Map<number, Revit2027OwnerCurveRecord[]>();
  const faceTokenByReplayIndex = new Map<number, number>();
  // A surface span's replay index, so its own queued curves resolve to the
  // Face that owns them. A parent is always replayed before the properties it
  // appends, so one pass is enough to link Face, Surface and profile curve.
  const faceTokenBySurfaceReplayIndex = new Map<
    number,
    { faceToken: number; sourceClassSlot: number }
  >();

  for (const span of replay.spans) {
    const slot = span.propertySourceClassSlot;
    if (slot === REVIT_2027_FACE_SOURCE_CLASS_SLOT) {
      if (span.propertyToken <= 0) continue;
      faces.set(span.propertyToken, spanValue<Revit2027FaceStatic>(span));
      faceTokenByReplayIndex.set(span.replayIndex, span.propertyToken);
      continue;
    }
    if (slot === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT) {
      if (span.propertyToken <= 0) continue;
      edges.set(span.propertyToken, spanValue<Revit2027GEdgeStatic>(span));
      continue;
    }
    if (slot === REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT) {
      if (span.propertyToken <= 0) continue;
      loops.set(span.propertyToken, {
        token: span.propertyToken,
        loop: spanValue<Revit2027EdgeLoopStatic>(span),
      });
      continue;
    }
    if (slot === REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT) {
      if (span.propertyToken <= 0) continue;
      loops.set(span.propertyToken, {
        token: span.propertyToken,
        loop: spanValue<Revit2027EdgeLoopWithChainEnvelopesStatic>(span).loop,
      });
      continue;
    }
    if (span.parentReplayIndex == null) continue;
    const surface = SURFACE_REGISTRATIONS.get(slot);
    if (surface) {
      if (surface.requirePositiveToken && span.propertyToken <= 0) continue;
      const faceToken = faceTokenByReplayIndex.get(span.parentReplayIndex);
      if (faceToken == null) continue;
      const bySlot = surfaces.get(slot) ??
        new Map<number, Revit2027OwnerSurfaceRecord>();
      bySlot.set(faceToken, {
        token: span.propertyToken,
        replayIndex: span.replayIndex,
        value: span.value,
      });
      surfaces.set(slot, bySlot);
      faceTokenBySurfaceReplayIndex.set(span.replayIndex, {
        faceToken,
        sourceClassSlot: slot,
      });
      continue;
    }
    const curve = CURVE_REGISTRATIONS.get(slot);
    if (!curve) continue;
    if (curve.requirePositiveToken && span.propertyToken <= 0) continue;
    const owner = faceTokenBySurfaceReplayIndex.get(span.parentReplayIndex);
    if (!owner || owner.sourceClassSlot !== curve.surfaceSourceClassSlot) {
      continue;
    }
    const forFace = curves.get(owner.faceToken) ?? [];
    forFace.push({
      sourceClassSlot: slot,
      token: span.propertyToken,
      value: span.value,
    });
    curves.set(owner.faceToken, forFace);
  }

  return { faces, edges, loops, surfaces, curves };
}

const INDEX_CACHE = new WeakMap<
  Revit2027GRepReplay,
  Revit2027OwnerMeshIndex
>();

/**
 * Index one completed replay's Faces, GEdges, EdgeLoops, surfaces and profile
 * curves once for every certified owner mesh path.
 *
 * Each path used to walk `replay.spans` itself, so a single owner was scanned
 * once per path. The result is memoized on the replay, which is immutable
 * once produced, so the combined owner API pays for one pass.
 */
export function revit2027OwnerMeshIndex(
  replay: Revit2027GRepReplay,
): Revit2027OwnerMeshIndex {
  const cached = INDEX_CACHE.get(replay);
  if (cached) return cached;
  const built = buildIndex(replay);
  INDEX_CACHE.set(replay, built);
  return built;
}

/** The surface persisted for one Face at one certified surface slot. */
export function revit2027OwnerSurface<S>(
  index: Revit2027OwnerMeshIndex,
  sourceClassSlot: number,
  faceToken: number,
): S | undefined {
  return index.surfaces.get(sourceClassSlot)?.get(faceToken)?.value as
    | S
    | undefined;
}

/** Profile curves persisted beneath one Face's surface, in replay order. */
export function revit2027OwnerCurves(
  index: Revit2027OwnerMeshIndex,
  faceToken: number,
): readonly Revit2027OwnerCurveRecord[] {
  return index.curves.get(faceToken) ?? [];
}
