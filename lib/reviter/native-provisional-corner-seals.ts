/** Reversible human assumptions at independently measured native corners.
 * These are newly assumed finite opaque bodies, never source-axis continuations,
 * translated native walls, or source-verified construction. */
import * as DMath from "./deterministic-math.ts";
import pc from "polygon-clipping";
import {
  nativePositiveMaterialBandsAcrossLevels,
  nativePositiveMaterialBandOverlapsParts,
} from "./native-positive-material-bands.ts";
import {
  nativeDerivedFrameHash,
  nativeDerivedFramePlacementHash,
} from "./native-derived-frame-returns.ts";
import type { NativeMaterialSections } from "./native-material-sections.ts";
import type { NativeWallPositionRepairs } from "./native-wall-position-repairs.ts";
import { exactNativeDoorFloorDifference } from "./native-door-exact-overlay.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
type P2 = [number, number];
type P3 = [number, number, number];
type Parts = P2[][][];
/** Parts -> parts -> rings -> vertices: flattening to vertices removes two levels. */
const PARTS_VERTEX_DEPTH = 2;
export type NativeProvisionalCornerSeals = {
  version: 1;
  sourceModelSha256: string;
  sourceMaterialGeometrySha256: string;
  sourceWallPositionRepairsSha256: string;
  geometrySha256: string;
  completeOriginalPhysicalOwnerCensusSha256: string;
  nonPhysicalCurtainHostNativeElementIds?: number[];
  foreignBodies: {
    nativeElementId: number;
    boundsFeet: { min: P3; max: P3 };
    partsFeet?: Parts;
    evidenceSha256: string;
  }[];
  rows: {
    id: string;
    levelId: number;
    elevationFeet: number;
    baseElevationFeet: number;
    topElevationFeet: number;
    state: "proposed" | "applied" | "restored";
    carrierContactNativeElementIds: number[];
    targetNativeElementId: number;
    carrierContactFaceFeet: [P2, P2];
    nearestCarrierContactFeet: P2;
    nearestTargetContactFeet: P2;
    contactPaddingFeet: number;
    partsFeet: Parts;
    sourceFloorIds: number[];
    sourceFloorBindings: {
      nativeElementId: number;
      elevationFeet: number;
      partsFeet: Parts;
    }[];
    sourceFloorPartsSha256: string;
    materialRole?: "enclosure-context-only";
    reviewedConstructionShape?: {
      kind: "finite-face-fragment-bridge" | "native-corner-points-bridge";
      carrierFragmentFeet: [P2, P2];
      targetFragmentFeet: [P2, P2];
      paddingDirectionFeet: P2;
      evidenceSha256: string;
      sourceAxisCertified: false;
      sourceFullMemberWidthCertified: false;
    };
    sourceFloorOuterContext?: {
      kind: "original-native-floor-outer-edge";
      sourceFloorOuterPartsSha256: string;
      evidenceSha256: string;
      noWalkingMaterial: true;
    };
    /** Generic drawing-backed assumption family: a registered DWG plan is the
     * authority where the native model is missing or incomplete. Reversible,
     * tagged, never source-verified; never alters RVT/GLB/GIS bytes. */
    drawingBacked?: NativeDrawingBackedAssumption;
    assumption: {
      kind: "human-authorized-construction-assumption" | "drawing-backed";
      authorizationRecorded: boolean;
      authorizationEvidenceSha256: string;
      revisitRequired: true;
      sourceVerified: false;
      evidenceSha256: string;
    };
    evidenceSha256: string;
  }[];
};
export type NativeDrawingBackedKind =
  | "dwg-continuous-seal"
  | "dwg-assumed-wall"
  | "dwg-assumed-column"
  | "exact-contact-closure"
  /** Seal across a measured gap that the project owner explicitly decided (named decision, not the
   * standing policy) where no registered drawing line is continuous; same body and guards. */
  | "owner-authorized-seal"
  /** Evidence kind: the body is accepted because it lies inside material the registered drawing
   * draws (between a cited pair of parallel wall lines, or inside a cited closed outline), crosses
   * no drawn or native doorway, and keeps every native guard. Size follows the drawing (at most a
   * sane wall thickness), never a seal cap. */
  | "dwg-drawn-material";
export type NativeDrawingBackedConstruction =
  | {
      /** Bridge between two measured native contact points, extended by a
       * bounded overlap into both bodies. Point contacts declare a direction. */
      kind: "bridge";
      pointAFeet: P2;
      pointBFeet: P2;
      directionFeet: P2;
      halfWidthFeet: number;
      overlapFeet: number;
    }
  | {
      /** Body between two registered parallel DWG wall-face lines over a
       * declared interval along the first face. */
      kind: "dwg-face-pair";
      faceAFeet: [P2, P2];
      faceBFeet: [P2, P2];
      intervalFeet: [number, number];
    }
  | {
      /** A wall's own end face swept along the wall's own axis at the wall's own
       * thickness (dwg-drawn-material only); backOverlapFeet runs into the wall. */
      kind: "wall-end-extension";
      wallNativeElementId: number;
      endFaceFeet: [P2, P2];
      axisFeet: P2;
      lengthFeet: number;
      backOverlapFeet: number;
    }
  | {
      /** Exact native column outline from an existing prepared section. */
      kind: "native-column-outline";
      outlineFeet: P2[];
      sourceLevelId: number;
      sourceCutElevationFeet: number;
    };
export type NativeDrawingBackedAssumption = {
  version: 1;
  kind: NativeDrawingBackedKind;
  /** Owner authorization reference, e.g. "2026-10-09-gap-review#q1a". */
  decisionId: string;
  decisionsSha256: string;
  nativeOwnerIds: number[];
  measuredGapFeet: number;
  numericalBoundFeet?: number;
  construction: NativeDrawingBackedConstruction;
  dwg?: {
    sourceDwgSha256: string;
    /** sha256 of JSON.stringify([boundaryReference.sourceSha256, section]). */
    registrationSha256: string;
    sectionId: string;
    toleranceFeet: number;
    entities: {
      /** derivedOutlineSegments (dwg-drawn-material only): an edge of a closed outline derived
       * from a raw DWG entity (circle, closed polyline) in the receipt-bound DwgDerivedOutlines. */
      kind: "wallSegments" | "doorSegments" | "derivedOutlineSegments";
      index: number;
      segmentFeet: [P2, P2];
    }[];
    /** dwg-drawn-material only: which cited entities (positions in `entities`) draw the
     * material: pairs of parallel wall-face lines, and closed outlines in chain order. */
    drawnMaterial?: {
      faceLinePairs: [number, number][];
      closedOutlines: number[][];
      /** Two cited bands (positions in `faceLinePairs`) that the drawing joins at a mitred
       * corner: one face line of each ends at a shared outer corner and the other two at a
       * shared inner corner, so the block between the four lines is drawn wall too. */
      cornerJoins?: [number, number][];
    };
    /** dwg-drawn-material only: the cited section is registered to another native level and an
     * explicit owner decision applies it to this one. Never implicit: without this record the
     * cited section must be registered to the row's own level. The native material near the body
     * must line up vertically with the source level's within the tolerance. */
    /** sha256 of JSON.stringify([sourceDwgSha256, derived outline section]) when any
     * derivedOutlineSegments entity is cited. */
    derivedOutlinesSha256?: string;
    crossLevel?: {
      decisionId: string;
      sourceLevelId: number;
      alignmentToleranceFeet: number;
    };
  };
  /** Complete set of census bodies without exact parts whose 3D bounds meet the body. */
  acknowledgedUnverifiedBodyIds: number[];
  missingNativeCutEvidence?: {
    cutElevationsFeet: number[];
    evidenceSha256: string;
  };
};
export const DRAWING_BACKED_LIMITS = {
  /** 1.6 ft: the owner-approved 07-712/07-728 partition stop is 1.568 ft (round-2 f1-1). */
  sealGapFeet: 1.6,
  sealHalfWidthFeet: 0.05,
  sealOverlapFeet: 0.1,
  exactContactBoundFeet: 2e-5,
  exactContactPadFeet: 2e-4,
  dwgToleranceFeet: 0.25,
  wallThicknessFeet: 3,
  wallFaceParallelSine: 0.02,
  /** dwg-drawn-material: the body may lie at most this far outside the drawn material. */
  drawnMaterialToleranceFeet: 0.05,
  /** dwg-drawn-material: widest closed outline (a column casing) that counts as drawn material;
   * the outline must also enclose part of a declared native owner. */
  drawnOutlineWidthFeet: 4,
  /** dwg-drawn-material corner joins: the two bands meet at 30 degrees or more. */
  cornerJoinMinSine: 0.5,
  /** dwg-drawn-material solidity: a joint line's ends lie this close to the two cited faces. */
  jointEndToleranceFeet: 0.01,
} as const;
const unit = (v: P2): P2 => {
  const l = DMath.hypot(v[0], v[1]);
  if (!l) throw new Error("Invalid drawing-backed direction.");
  return [v[0] / l, v[1] / l];
};
/** Normalized-identical body of a drawing-backed construction. */
export function drawingBackedAssumptionFootprint(
  c: NativeDrawingBackedConstruction,
): Parts {
  if (c.kind === "bridge") {
    const u = c.directionFeet,
      n: P2 = [-u[1], u[0]],
      h = c.halfWidthFeet,
      e = c.overlapFeet;
    if (Math.abs(DMath.hypot(u[0], u[1]) - 1) > 1e-12 || !(h > 0) || !(e > 0))
      throw new Error("Invalid drawing-backed bridge construction.");
    const a: P2 = [c.pointAFeet[0] - e * u[0], c.pointAFeet[1] - e * u[1]],
      b: P2 = [c.pointBFeet[0] + e * u[0], c.pointBFeet[1] + e * u[1]];
    return [
      [
        [
          [a[0] - h * n[0], a[1] - h * n[1]],
          [b[0] - h * n[0], b[1] - h * n[1]],
          [b[0] + h * n[0], b[1] + h * n[1]],
          [a[0] + h * n[0], a[1] + h * n[1]],
        ],
      ],
    ];
  }
  if (c.kind === "dwg-face-pair") {
    const [a, b] = c.faceAFeet,
      [p, q] = c.faceBFeet,
      length = DMath.hypot(b[0] - a[0], b[1] - a[1]),
      u = unit([b[0] - a[0], b[1] - a[1]]),
      v = unit([q[0] - p[0], q[1] - p[1]]),
      [t0, t1] = c.intervalFeet;
    if (
      Math.abs(u[0] * v[1] - u[1] * v[0]) >
        DRAWING_BACKED_LIMITS.wallFaceParallelSine ||
      !(t0 >= 0) ||
      !(t1 > t0) ||
      t1 > length
    )
      throw new Error("Invalid drawing-backed face-pair construction.");
    const at = (t: number): P2 => [a[0] + t * u[0], a[1] + t * u[1]],
      foot = (x: P2): P2 => {
        const s = (x[0] - p[0]) * v[0] + (x[1] - p[1]) * v[1];
        return [p[0] + s * v[0], p[1] + s * v[1]];
      };
    const x0 = at(t0),
      x1 = at(t1),
      y0 = foot(x0),
      y1 = foot(x1),
      thickness = DMath.hypot(y0[0] - x0[0], y0[1] - x0[1]),
      lengthB = DMath.hypot(q[0] - p[0], q[1] - p[1]),
      along = (y: P2) => (y[0] - p[0]) * v[0] + (y[1] - p[1]) * v[1];
    if (
      !(thickness > 0) ||
      thickness > DRAWING_BACKED_LIMITS.wallThicknessFeet ||
      // A registered face line may stop short at a jamb/frame symbol; its foot
      // may extend at most the drawing tolerance beyond the cited segment.
      [y0, y1].some(
        (y) =>
          along(y) < -DRAWING_BACKED_LIMITS.dwgToleranceFeet ||
          along(y) > lengthB + DRAWING_BACKED_LIMITS.dwgToleranceFeet,
      )
    )
      throw new Error(
        "Drawing-backed face pair does not overlap over its interval.",
      );
    return [[[x0, x1, y1, y0]]];
  }
  if (c.kind === "wall-end-extension") {
    const u = c.axisFeet,
      [a, b] = c.endFaceFeet,
      L = c.lengthFeet,
      e = c.backOverlapFeet;
    if (
      Math.abs(DMath.hypot(u[0], u[1]) - 1) > 1e-12 ||
      !(L > 0) ||
      !(e >= 0) ||
      !(DMath.hypot(b[0] - a[0], b[1] - a[1]) > 0)
    )
      throw new Error(
        "Invalid drawing-backed wall-end extension construction.",
      );
    return [
      [
        [
          [a[0] - e * u[0], a[1] - e * u[1]],
          [b[0] - e * u[0], b[1] - e * u[1]],
          [b[0] + L * u[0], b[1] + L * u[1]],
          [a[0] + L * u[0], a[1] + L * u[1]],
        ],
      ],
    ];
  }
  if (c.outlineFeet.length < 3)
    throw new Error("Invalid drawing-backed column outline.");
  return [[c.outlineFeet.map((p) => [p[0], p[1]] as P2)]];
}
const segmentDistance = (p: P2, s: [P2, P2]) => {
  const [a, b] = s,
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    l = dx * dx + dy * dy,
    t = l
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l))
      : 0;
  return DMath.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
/** Structural validity of a dwg-drawn-material row (geometry evidence is checked by the index). */
function drawnMaterialShapeValid(
  r: NativeProvisionalCornerSeals["rows"][number],
) {
  const d = r.drawingBacked!,
    c = d.construction,
    L = DRAWING_BACKED_LIMITS,
    m = d.dwg?.drawnMaterial,
    n = d.dwg?.entities?.length ?? 0;
  const pos = (i: unknown) =>
    Number.isSafeInteger(i) &&
    (i as number) >= 0 &&
    (i as number) < n &&
    d.dwg!.entities[i as number]?.kind === "wallSegments";
  const outlinePos = (i: unknown) =>
    pos(i) ||
    (Number.isSafeInteger(i) &&
      (i as number) >= 0 &&
      (i as number) < n &&
      d.dwg!.entities[i as number]?.kind === "derivedOutlineSegments");
  const shape =
    c.kind === "bridge"
      ? point(c.pointAFeet) &&
        point(c.pointBFeet) &&
        point(c.directionFeet) &&
        Number.isFinite(c.halfWidthFeet) &&
        c.halfWidthFeet > 0 &&
        c.halfWidthFeet <= L.wallThicknessFeet / 2 &&
        Number.isFinite(c.overlapFeet) &&
        c.overlapFeet > 0 &&
        c.overlapFeet <= L.wallThicknessFeet
      : c.kind === "wall-end-extension"
        ? Number.isSafeInteger(c.wallNativeElementId) &&
          c.wallNativeElementId > 0 &&
          d.nativeOwnerIds.includes(c.wallNativeElementId) &&
          Array.isArray(c.endFaceFeet) &&
          c.endFaceFeet.length === 2 &&
          c.endFaceFeet.every((p) => point(p)) &&
          point(c.axisFeet) &&
          Number.isFinite(c.lengthFeet) &&
          c.lengthFeet > 0 &&
          Number.isFinite(c.backOverlapFeet) &&
          c.backOverlapFeet > 0 &&
          c.backOverlapFeet <= L.wallThicknessFeet &&
          d.measuredGapFeet <= c.lengthFeet
        : c.kind === "dwg-face-pair" &&
          [c.faceAFeet, c.faceBFeet].every(
            (f) =>
              Array.isArray(f) && f.length === 2 && f.every((p) => point(p)),
          ) &&
          Array.isArray(c.intervalFeet) &&
          c.intervalFeet.length === 2;
  return (
    shape &&
    r.materialRole === undefined &&
    d.missingNativeCutEvidence === undefined &&
    !!d.dwg &&
    Number.isFinite(d.dwg.toleranceFeet) &&
    d.dwg.toleranceFeet <= L.drawnMaterialToleranceFeet &&
    (d.dwg.crossLevel === undefined ||
      (typeof d.dwg.crossLevel.decisionId === "string" &&
        /#/.test(d.dwg.crossLevel.decisionId) &&
        d.dwg.crossLevel.decisionId.length <= 200 &&
        Number.isSafeInteger(d.dwg.crossLevel.sourceLevelId) &&
        d.dwg.crossLevel.sourceLevelId !== r.levelId &&
        Number.isFinite(d.dwg.crossLevel.alignmentToleranceFeet) &&
        d.dwg.crossLevel.alignmentToleranceFeet > 0 &&
        d.dwg.crossLevel.alignmentToleranceFeet <=
          L.drawnMaterialToleranceFeet)) &&
    !!m &&
    Array.isArray(m.faceLinePairs) &&
    Array.isArray(m.closedOutlines) &&
    m.faceLinePairs.length + m.closedOutlines.length > 0 &&
    m.faceLinePairs.length + m.closedOutlines.length <= 100 &&
    m.faceLinePairs.every(
      (q) =>
        Array.isArray(q) && q.length === 2 && q[0] !== q[1] && q.every(pos),
    ) &&
    m.closedOutlines.every(
      (o) =>
        Array.isArray(o) &&
        o.length >= 3 &&
        o.length <= 1000 &&
        new Set(o).size === o.length &&
        o.every(outlinePos),
    ) &&
    (m.cornerJoins === undefined ||
      (Array.isArray(m.cornerJoins) &&
        m.cornerJoins.length > 0 &&
        m.cornerJoins.length <= 100 &&
        m.cornerJoins.every(
          (q) =>
            Array.isArray(q) &&
            q.length === 2 &&
            q[0] !== q[1] &&
            q.every(
              (k) =>
                Number.isSafeInteger(k) && k >= 0 && k < m.faceLinePairs.length,
            ),
        ))) &&
    (!d.dwg.entities.some((e) => e.kind === "derivedOutlineSegments") ||
      digest(d.dwg.derivedOutlinesSha256)) &&
    !d.dwg.entities.some(
      (e, i) =>
        e.kind === "derivedOutlineSegments" &&
        !m.closedOutlines.some((o) => o.includes(i)),
    )
  );
}
const cross2 = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
const dot2 = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
const sub2 = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
/** Thin rectangle around a segment, grown by `t` along and across it. */
function segmentCapsule([a, b]: [P2, P2], t: number): Parts {
  const u = unit(sub2(b, a)),
    n: P2 = [-u[1], u[0]],
    p = (o: P2, s: number, q: number): P2 => [
      o[0] + s * u[0] + q * n[0],
      o[1] + s * u[1] + q * n[1],
    ];
  return [[[p(a, -t, -t), p(b, t, -t), p(b, t, t), p(a, -t, t)]]];
}
/** Minimum strip width of a ring (rotating calipers over its convex hull). */
function minimumWidth(ring: P2[]) {
  const pts = [...ring].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (ps: P2[]) => {
    const h: P2[] = [];
    for (const p of ps) {
      while (
        h.length >= 2 &&
        cross2(sub2(h.at(-1)!, h.at(-2)!), sub2(p, h.at(-2)!)) <= 0
      )
        h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  const hull = [...half(pts), ...half([...pts].reverse())];
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i],
      b = hull[(i + 1) % hull.length],
      l = DMath.hypot(b[0] - a[0], b[1] - a[1]);
    if (!l) continue;
    best = Math.min(
      best,
      Math.max(
        ...hull.map((p) => Math.abs(cross2(sub2(b, a), sub2(p, a))) / l),
      ),
    );
  }
  return best;
}
/** First segment of an outline chain, oriented so the chain continues from its second point. */
const orientedStart = (first: [P2, P2], next: [P2, P2]): P2[] => {
  const d = (p: P2) =>
    Math.min(
      DMath.hypot(p[0] - next[0][0], p[1] - next[0][1]),
      DMath.hypot(p[0] - next[1][0], p[1] - next[1][1]),
    );
  return d(first[0]) < d(first[1])
    ? [first[1], first[0]]
    : [first[0], first[1]];
};
/** The rings of a row's cited closed outlines, in chain order (validated by drawingBackedDrawnMaterial). */
function drawnOutlineRings(
  dwg: NonNullable<NativeDrawingBackedAssumption["dwg"]>,
): { ring: P2[]; label: string }[] {
  const seg = (i: number) => dwg.entities[i].segmentFeet;
  return dwg.drawnMaterial!.closedOutlines.map((o) => {
    const ring = orientedStart(seg(o[0]), seg(o[1]));
    for (const i of o.slice(1)) {
      const [p, q] = seg(i),
        end = ring.at(-1)!;
      ring.push(
        DMath.hypot(p[0] - end[0], p[1] - end[1]) <=
          DMath.hypot(q[0] - end[0], q[1] - end[1])
          ? q
          : p,
      );
    }
    ring.pop();
    return {
      ring,
      label: o
        .map((i) => `${dwg.entities[i].kind}#${dwg.entities[i].index}`)
        .join(","),
    };
  });
}
/** The corner block of a cited corner join, in ring order: the four intersections of the two
 * bands' face lines. The drawing must draw the corner: one face line of each band ends (within
 * the row's tolerance) at their shared outer corner, and the other two at the shared inner
 * corner. Lines that only cross (a T or an unrelated wall) do not join. Throws a stated reason. */
function drawnCornerJoinRing(
  dwg: NonNullable<NativeDrawingBackedAssumption["dwg"]>,
  join: [number, number],
): { ring: P2[]; lines: [P2, P2][]; label: string } {
  const L = DRAWING_BACKED_LIMITS,
    t = dwg.toleranceFeet,
    pairs = dwg.drawnMaterial!.faceLinePairs,
    seg = (i: number) => dwg.entities[i].segmentFeet,
    label = (i: number) => `${dwg.entities[i].kind}#${dwg.entities[i].index}`,
    [a1, a2] = pairs[join[0]].map(seg),
    [b1, b2] = pairs[join[1]].map(seg),
    name = [...pairs[join[0]], ...pairs[join[1]]].map(label).join(",");
  const ua = unit(sub2(a1[1], a1[0])),
    ub = unit(sub2(b1[1], b1[0]));
  if (Math.abs(cross2(ua, ub)) < L.cornerJoinMinSine)
    throw new Error(`cited corner join ${name} does not turn a corner`);
  const meet = (p: [P2, P2], q: [P2, P2]): P2 => {
    const d = sub2(p[1], p[0]),
      e = sub2(q[1], q[0]),
      s = cross2(sub2(q[0], p[0]), e) / cross2(d, e);
    return [p[0][0] + s * d[0], p[0][1] + s * d[1]];
  };
  const ends = (s: [P2, P2], x: P2) =>
    Math.min(
      DMath.hypot(s[0][0] - x[0], s[0][1] - x[1]),
      DMath.hypot(s[1][0] - x[0], s[1][1] - x[1]),
    ) <= t;
  const x11 = meet(a1, b1),
    x12 = meet(a1, b2),
    x21 = meet(a2, b1),
    x22 = meet(a2, b2),
    drawn =
      (ends(a1, x11) && ends(b1, x11) && ends(a2, x22) && ends(b2, x22)) ||
      (ends(a1, x12) && ends(b2, x12) && ends(a2, x21) && ends(b1, x21));
  if (!drawn)
    throw new Error(
      `cited bands ${name} do not meet at a drawn corner (their face lines do not end at shared corners)`,
    );
  const ring: P2[] = [x11, x12, x22, x21],
    width = minimumWidth(ring);
  if (!(width > 0) || width > L.wallThicknessFeet)
    throw new Error(
      `cited corner join ${name} is ${width.toFixed(3)} ft wide, not a wall corner`,
    );
  return { ring, lines: [a1, a2, b1, b2], label: name };
}
/** Material the registered drawing draws, as overlapping pieces, from the entities a dwg-drawn-material row cites:
 * the band between each cited pair of parallel wall-face lines (over their common span; the
 * separation is positive and at most a wall thickness), the corner block of each cited corner
 * join of two such bands, and the inside of each cited closed outline whose minimum width is
 * at most a wall thickness, every region grown by the row's drawing tolerance. Throws a stated
 * evidence reason. */
export function drawingBackedDrawnMaterial(
  dwg: NonNullable<NativeDrawingBackedAssumption["dwg"]>,
): Parts {
  const L = DRAWING_BACKED_LIMITS,
    t = dwg.toleranceFeet,
    m = dwg.drawnMaterial!,
    seg = (i: number) => dwg.entities[i].segmentFeet,
    label = (i: number) => `${dwg.entities[i].kind}#${dwg.entities[i].index}`,
    regions: Parts[] = [];
  for (const [i, j] of m.faceLinePairs) {
    const [a0, a1] = seg(i),
      [b0, b1] = seg(j),
      la = DMath.hypot(a1[0] - a0[0], a1[1] - a0[1]);
    if (!la || !DMath.hypot(b1[0] - b0[0], b1[1] - b0[1]))
      throw new Error(
        `cited drawn face line ${la ? label(j) : label(i)} has no length`,
      );
    const u = unit(sub2(a1, a0)),
      n: P2 = [-u[1], u[0]],
      v = unit(sub2(b1, b0));
    if (Math.abs(cross2(u, v)) > L.wallFaceParallelSine)
      throw new Error(
        `cited drawn face lines ${label(i)}/${label(j)} are not parallel`,
      );
    const sb = [dot2(sub2(b0, a0), u), dot2(sub2(b1, a0), u)],
      db = [dot2(sub2(b0, a0), n), dot2(sub2(b1, a0), n)],
      t0 = Math.max(0, Math.min(...sb)),
      t1 = Math.min(la, Math.max(...sb));
    if (!(t1 > t0))
      throw new Error(
        `cited drawn face lines ${label(i)}/${label(j)} have no common span`,
      );
    const off = (s: number) =>
      db[0] + ((s - sb[0]) * (db[1] - db[0])) / (sb[1] - sb[0]);
    const seps = [off(t0), off(t1)];
    if (
      !seps.every(
        (x) => Math.abs(x) > 1e-6 && Math.abs(x) <= L.wallThicknessFeet,
      ) ||
      Math.sign(seps[0]) !== Math.sign(seps[1])
    )
      throw new Error(
        `drawn band between ${label(i)}/${label(j)} is ${seps.map((x) => Math.abs(x).toFixed(3)).join("-")} ft wide, not a wall (0, ${L.wallThicknessFeet}] ft`,
      );
    const P = (s: number, q: number): P2 => [
      a0[0] + s * u[0] + q * n[0],
      a0[1] + s * u[1] + q * n[1],
    ];
    const s0 = t0 - t,
      s1 = t1 + t,
      lo = (s: number) => Math.min(0, off(s)) - t,
      hi = (s: number) => Math.max(0, off(s)) + t;
    regions.push([
      [[P(s0, lo(s0)), P(s1, lo(s1)), P(s1, hi(s1)), P(s0, hi(s0))]],
    ]);
  }
  for (const join of m.cornerJoins ?? []) {
    const { ring } = drawnCornerJoinRing(dwg, join);
    regions.push(
      [[ring]],
      ...ring.map((p, k) =>
        segmentCapsule([p, ring[(k + 1) % ring.length]], t),
      ),
    );
  }
  for (const o of m.closedOutlines) {
    const first = seg(o[0]);
    const ring: P2[] = orientedStart(first, seg(o[1]));
    for (const i of o.slice(1)) {
      const [p, q] = seg(i),
        end = ring.at(-1)!,
        dp = DMath.hypot(p[0] - end[0], p[1] - end[1]),
        dq = DMath.hypot(q[0] - end[0], q[1] - end[1]);
      if (Math.min(dp, dq) > t)
        throw new Error(
          `cited drawn outline is not a closed chain at ${label(i)}`,
        );
      ring.push(dp <= dq ? q : p);
    }
    const last = ring.pop()!;
    if (DMath.hypot(last[0] - ring[0][0], last[1] - ring[0][1]) > t)
      throw new Error(
        `cited drawn outline ${o.map(label).join(",")} does not close`,
      );
    const width = minimumWidth(ring);
    if (!(width > 0) || width > L.drawnOutlineWidthFeet)
      throw new Error(
        `cited drawn outline ${o.map(label).join(",")} is ${width.toFixed(3)} ft wide, not wall or column material`,
      );
    regions.push(
      [[ring]],
      ...ring.map((p, k) =>
        segmentCapsule([p, ring[(k + 1) % ring.length]], t),
      ),
    );
  }
  // Pieces, not a union: containment subtracts them all with the exact overlay.
  return regions.flat();
}
/** Drawn material is solid: no other registered wall line of the cited section runs through the
 * part of the body that a cited band or outline is meant to cover. Two parallel lines that bound
 * something else (a doorway, a gap, a room strip) have linework between them; a drawn wall or
 * casing is empty between its faces. A joint line drawn from one face of a band to the other
 * (where wall pieces or a frame meet) is not such linework. Returns the first stated reason, or
 * undefined. */
export function drawingBackedDrawnMaterialSolidity(
  dwg: NonNullable<NativeDrawingBackedAssumption["dwg"]>,
  sectionWallSegments: [P2, P2][],
  body: Parts,
): string | undefined {
  const t = dwg.toleranceFeet,
    m = dwg.drawnMaterial!,
    seg = (i: number) => dwg.entities[i].segmentFeet,
    label = (i: number) => `${dwg.entities[i].kind}#${dwg.entities[i].index}`;
  const ps = body.flat(PARTS_VERTEX_DEPTH),
    pad = DRAWING_BACKED_LIMITS.wallThicknessFeet,
    box = [
      Math.min(...ps.map((p) => p[0])) - pad,
      Math.min(...ps.map((p) => p[1])) - pad,
      Math.max(...ps.map((p) => p[0])) + pad,
      Math.max(...ps.map((p) => p[1])) + pad,
    ];
  const nearby = sectionWallSegments
    .map((g, index) => ({ g, index }))
    .filter(
      ({ g }) =>
        Math.max(g[0][0], g[1][0]) >= box[0] &&
        Math.min(g[0][0], g[1][0]) <= box[2] &&
        Math.max(g[0][1], g[1][1]) >= box[1] &&
        Math.min(g[0][1], g[1][1]) <= box[3],
    );
  /** A joint line runs from one cited face line to the other (one end on each, within
   * jointEndToleranceFeet): it marks where wall pieces meet (a joint, a frame end), not linework
   * that two parallel lines bound. It does not make a band unsolid. */
  const j = DRAWING_BACKED_LIMITS.jointEndToleranceFeet;
  const joint = (g: [P2, P2], faces?: [[P2, P2], [P2, P2]]) =>
    !!faces &&
    ((segmentDistance(g[0], faces[0]) <= j &&
      segmentDistance(g[1], faces[1]) <= j) ||
      (segmentDistance(g[0], faces[1]) <= j &&
        segmentDistance(g[1], faces[0]) <= j));
  const check = (
    inside: Parts,
    own: [P2, P2][],
    what: string,
    faces?: [[P2, P2], [P2, P2]],
  ) => {
    let region: Parts;
    try {
      region = pc.intersection(inside, body) as Parts;
    } catch {
      region = inside;
    }
    if (region.length === 0) return;
    for (const { g, index } of nearby)
      if (
        !own.some((o) => same(o, g) || same([o[1], o[0]], g)) &&
        !joint(g, faces) &&
        segmentLengthInside(g, region, t) > t
      )
        return `${what} is not solid drawn material: registered line wallSegments#${index} runs inside it`;
  };
  for (const [i, j] of m.faceLinePairs) {
    const [a0, a1] = seg(i),
      [b0, b1] = seg(j),
      la = DMath.hypot(a1[0] - a0[0], a1[1] - a0[1]),
      u = unit(sub2(a1, a0)),
      n: P2 = [-u[1], u[0]],
      sb = [dot2(sub2(b0, a0), u), dot2(sub2(b1, a0), u)],
      db = [dot2(sub2(b0, a0), n), dot2(sub2(b1, a0), n)],
      t0 = Math.max(0, Math.min(...sb)),
      t1 = Math.min(la, Math.max(...sb)),
      off = (q: number) =>
        db[0] + ((q - sb[0]) * (db[1] - db[0])) / (sb[1] - sb[0]),
      lo = (q: number) => Math.min(0, off(q)) + t,
      hi = (q: number) => Math.max(0, off(q)) - t,
      P = (q: number, w: number): P2 => [
        a0[0] + q * u[0] + w * n[0],
        a0[1] + q * u[1] + w * n[1],
      ];
    if (!(t1 > t0) || hi(t0) <= lo(t0) || hi(t1) <= lo(t1)) continue;
    const why = check(
      [[[P(t0, lo(t0)), P(t1, lo(t1)), P(t1, hi(t1)), P(t0, hi(t0))]]],
      [seg(i), seg(j)],
      `drawn band ${label(i)}/${label(j)}`,
      [seg(i), seg(j)],
    );
    if (why) return why;
  }
  for (const join of m.cornerJoins ?? []) {
    const { ring, lines, label: name } = drawnCornerJoinRing(dwg, join);
    const why = check([[ring]], lines, `drawn corner ${name}`);
    if (why) return why;
  }
  for (const o of m.closedOutlines) {
    const ring: P2[] = orientedStart(seg(o[0]), seg(o[1]));
    for (const i of o.slice(1)) {
      const [p, q] = seg(i),
        end = ring.at(-1)!;
      ring.push(
        DMath.hypot(p[0] - end[0], p[1] - end[1]) <=
          DMath.hypot(q[0] - end[0], q[1] - end[1])
          ? q
          : p,
      );
    }
    ring.pop();
    const why = check(
      [[ring]],
      o.map(seg),
      `drawn outline ${o.map(label).join(",")}`,
    );
    if (why) return why;
  }
  return undefined;
}
/** Length of a segment strictly inside a body (any parts). */
/** Length of a segment strictly inside a body (any parts); with a clearance, only the parts
 * farther than it from every body edge count (a line drawn on the boundary is not inside). */
function segmentLengthInside(s: [P2, P2], body: Parts, clearance = 0) {
  const [a, b] = s,
    d = sub2(b, a),
    l = DMath.hypot(d[0], d[1]);
  if (!l) return 0;
  const ts = [0, 1];
  for (const [p, q] of segments(body)) {
    const e = sub2(q, p),
      den = cross2(d, e);
    if (!den) continue;
    const w = sub2(p, a),
      x = cross2(w, e) / den,
      y = cross2(w, d) / den;
    if (x > 0 && x < 1 && y >= 0 && y <= 1) ts.push(x);
  }
  ts.sort((x, y) => x - y);
  const inside = (p: P2) =>
    body.some((part) => {
      const wind = (r: P2[]) => {
        let c = false;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++)
          if (
            r[i][1] > p[1] !== r[j][1] > p[1] &&
            p[0] <
              ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) +
                r[i][0]
          )
            c = !c;
        return c;
      };
      return wind(part[0]) && !part.slice(1).some(wind);
    });
  const edges = clearance > 0 ? segments(body) : [];
  const deep = (p: P2) =>
    inside(p) && edges.every((e) => distance(p, ...e).distance > clearance);
  const samples = clearance > 0 ? 9 : 1;
  let total = 0;
  for (let k = 1; k < ts.length; k++) {
    if (!(ts[k] > ts[k - 1])) continue;
    let hit = 0;
    for (let j = 0; j < samples; j++) {
      const m = ts[k - 1] + ((j + 0.5) / samples) * (ts[k] - ts[k - 1]);
      if (deep([a[0] + m * d[0], a[1] + m * d[1]])) hit++;
    }
    total += (hit / samples) * (ts[k] - ts[k - 1]) * l;
  }
  return total;
}
function validateDrawingBackedShape(
  r: NativeProvisionalCornerSeals["rows"][number],
) {
  const d = r.drawingBacked!,
    c = d?.construction,
    L = DRAWING_BACKED_LIMITS;
  const pt = (v: unknown) => point(v);
  const bad =
    !d ||
    d.version !== 1 ||
    ![
      "dwg-continuous-seal",
      "dwg-assumed-wall",
      "dwg-assumed-column",
      "exact-contact-closure",
      "owner-authorized-seal",
      "dwg-drawn-material",
    ].includes(d.kind) ||
    (d.kind === "owner-authorized-seal" &&
      d.decisionId.endsWith("#standingPolicy")) ||
    typeof d.decisionId !== "string" ||
    !d.decisionId ||
    d.decisionId.length > 200 ||
    !digest(d.decisionsSha256) ||
    !ids(d.nativeOwnerIds) ||
    !Number.isFinite(d.measuredGapFeet) ||
    d.measuredGapFeet < 0 ||
    !Array.isArray(d.acknowledgedUnverifiedBodyIds) ||
    (d.acknowledgedUnverifiedBodyIds.length > 0 &&
      !ids(d.acknowledgedUnverifiedBodyIds)) ||
    d.acknowledgedUnverifiedBodyIds.some((id) =>
      d.nativeOwnerIds.includes(id),
    ) ||
    r.reviewedConstructionShape !== undefined ||
    r.sourceFloorOuterContext !== undefined ||
    r.assumption?.kind !== "drawing-backed" ||
    !c ||
    (d.kind === "dwg-continuous-seal" ||
    d.kind === "exact-contact-closure" ||
    d.kind === "owner-authorized-seal"
      ? c.kind !== "bridge" ||
        !pt(c.pointAFeet) ||
        !pt(c.pointBFeet) ||
        !pt(c.directionFeet) ||
        !Number.isFinite(c.halfWidthFeet) ||
        !Number.isFinite(c.overlapFeet)
      : d.kind === "dwg-assumed-wall"
        ? c.kind !== "dwg-face-pair" ||
          ![c.faceAFeet, c.faceBFeet].every(
            (f) => Array.isArray(f) && f.length === 2 && f.every(pt),
          ) ||
          !Array.isArray(c.intervalFeet) ||
          c.intervalFeet.length !== 2
        : d.kind === "dwg-drawn-material"
          ? !drawnMaterialShapeValid(r)
          : c.kind !== "native-column-outline" ||
            !Array.isArray(c.outlineFeet) ||
            c.outlineFeet.length < 3 ||
            c.outlineFeet.length > 1000 ||
            !c.outlineFeet.every(pt) ||
            !Number.isSafeInteger(c.sourceLevelId) ||
            !Number.isFinite(c.sourceCutElevationFeet)) ||
    (d.kind === "exact-contact-closure"
      ? !Number.isFinite(d.numericalBoundFeet) ||
        d.numericalBoundFeet! <= 0 ||
        d.numericalBoundFeet! > L.exactContactBoundFeet ||
        d.measuredGapFeet > d.numericalBoundFeet! ||
        (c.kind === "bridge" &&
          (c.halfWidthFeet > L.exactContactPadFeet ||
            c.overlapFeet > L.exactContactPadFeet))
      : d.numericalBoundFeet !== undefined) ||
    ((d.kind === "dwg-continuous-seal" || d.kind === "owner-authorized-seal") &&
      (d.measuredGapFeet > L.sealGapFeet ||
        (c.kind === "bridge" &&
          (c.halfWidthFeet > L.sealHalfWidthFeet ||
            c.overlapFeet > L.sealOverlapFeet)))) ||
    (((d.kind !== "exact-contact-closure" &&
      d.kind !== "owner-authorized-seal") ||
      d.dwg !== undefined) &&
      (!d.dwg ||
        !digest(d.dwg.sourceDwgSha256) ||
        !digest(d.dwg.registrationSha256) ||
        typeof d.dwg.sectionId !== "string" ||
        !d.dwg.sectionId ||
        !Number.isFinite(d.dwg.toleranceFeet) ||
        d.dwg.toleranceFeet < 0 ||
        d.dwg.toleranceFeet > L.dwgToleranceFeet ||
        !Array.isArray(d.dwg.entities) ||
        d.dwg.entities.length === 0 ||
        d.dwg.entities.length > 1000 ||
        d.dwg.entities.some(
          (e) =>
            !e ||
            ![
              "wallSegments",
              "doorSegments",
              ...(d.kind === "dwg-drawn-material"
                ? ["derivedOutlineSegments"]
                : []),
            ].includes(e.kind) ||
            !Number.isSafeInteger(e.index) ||
            e.index < 0 ||
            !Array.isArray(e.segmentFeet) ||
            e.segmentFeet.length !== 2 ||
            !e.segmentFeet.every(pt),
        ))) ||
    (d.missingNativeCutEvidence !== undefined &&
      (!Array.isArray(d.missingNativeCutEvidence.cutElevationsFeet) ||
        !d.missingNativeCutEvidence.cutElevationsFeet.every(Number.isFinite) ||
        !digest(d.missingNativeCutEvidence.evidenceSha256)));
  if (bad)
    throw new Error(
      "Invalid drawing-backed native assumption: " + (r?.id ?? ""),
    );
}
/** Assumption-based enclosures are counted separately from source-verified repairs. */
export function nativeProvisionalAssumptionCounts(
  v: NativeProvisionalCornerSeals | undefined,
) {
  const applied = (v?.rows ?? []).filter((r) => r.state === "applied");
  const drawing = applied.filter((r) => r.drawingBacked);
  return {
    humanAuthorizedCornerSeals: applied.length - drawing.length,
    drawingBacked: drawing.length,
    drawingBackedByKind: Object.fromEntries(
      [
        "dwg-continuous-seal",
        "dwg-assumed-wall",
        "dwg-assumed-column",
        "exact-contact-closure",
        "owner-authorized-seal",
        "dwg-drawn-material",
      ].map((k) => [
        k,
        drawing.filter((r) => r.drawingBacked!.kind === k).length,
      ]),
    ) as Record<NativeDrawingBackedKind, number>,
    sourceVerified: 0,
  };
}
type Data = {
  source?: { modelSha256: string };
  nativeMaterialSections?: NativeMaterialSections;
  nativeWallPositionRepairs?: NativeWallPositionRepairs;
  nativeProvisionalCornerSeals?: NativeProvisionalCornerSeals;
  walkingSupport?: {
    sourceModelSha256: string;
    floors: {
      nativeElementId: number;
      elevationFeet: number;
      ringsFeet: P2[][];
      partsFeet?: Parts;
    }[];
  };
  nativeIndoorEnvelopes?: {
    levels: {
      levelId: number;
      elevationFeet: number;
      cutElevationsFeet?: number[];
      provisionalCornerGeometrySha256?: string;
      provisionalCornerIds?: string[];
    }[];
  };
  doors?: { nativeElementId: number; footprintFeet?: P2[]; id: string }[];
  edges?: { id: string; kind: string; enabled: boolean; pointsFeet: P3[] }[];
};
const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const ids = (v: unknown): v is number[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length <= 100_000 &&
  new Set(v).size === v.length &&
  v.every((n) => Number.isSafeInteger(n) && n > 0);
const point = (v: unknown, n = 2): boolean =>
  Array.isArray(v) &&
  v.length === n &&
  v.every(
    (x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 1e7,
  );
const parts = (v: unknown): v is Parts =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length <= 10_000 &&
  v.every(
    (p) =>
      Array.isArray(p) &&
      p.length > 0 &&
      p.every(
        (r) =>
          Array.isArray(r) &&
          r.length >= 3 &&
          r.length <= 100_000 &&
          r.every((p) => point(p)),
      ),
  );
const area = (ps: Parts) =>
  ps.reduce(
    (sum, p) =>
      sum +
      p.reduce(
        (s, r, i) =>
          s +
          ((i ? -1 : 1) *
            Math.abs(
              r.reduce((s, a, j) => {
                const b = r[(j + 1) % r.length];
                // A common ring origin avoids losing tiny true contact area at
                // large native model coordinates; no coordinate is changed.
                const o = r[0];
                return (
                  s +
                  (a[0] - o[0]) * (b[1] - o[1]) -
                  (b[0] - o[0]) * (a[1] - o[1])
                );
              }, 0),
            )) /
            2,
        0,
      ),
    0,
  );
export const nativeProvisionalCornerSealsHash = (
  v:
    | NativeProvisionalCornerSeals
    | Omit<NativeProvisionalCornerSeals, "geometrySha256">,
) =>
  nativeDerivedFrameHash(
    Object.fromEntries(
      Object.entries(v).filter(([k]) => k !== "geometrySha256"),
    ),
  );
export function provisionalCornerFootprint(
  face: [P2, P2],
  carrier: P2,
  target: P2,
  padding: number,
): Parts {
  const [a, b] = face,
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = DMath.hypot(dx, dy),
    gx = target[0] - carrier[0],
    gy = target[1] - carrier[1],
    gap = DMath.hypot(gx, gy);
  if (
    !length ||
    !gap ||
    gap > 0.1 ||
    padding <= 0 ||
    padding > 0.0002 ||
    Math.abs(dx * gy - dy * gx) <= 0
  )
    throw new Error("Invalid finite measured provisional corner span.");
  const u: [number, number] = [dx / length, dy / length],
    g: [number, number] = [gx / gap, gy / gap];
  const atA = JSON.stringify(carrier) === JSON.stringify(a),
    atB = JSON.stringify(carrier) === JSON.stringify(b);
  if (!atA && !atB)
    throw new Error(
      "Provisional corner contact must be the original finite face endpoint.",
    );
  // Only the independently measured contact endpoint receives tangent padding.
  // The opposite original endpoint stays exact, preserving adjacent members.
  const ap = atA ? padding : 0,
    bp = atB ? padding : 0;
  return [
    [
      [
        [a[0] - ap * u[0] - padding * g[0], a[1] - ap * u[1] - padding * g[1]],
        [b[0] + bp * u[0] - padding * g[0], b[1] + bp * u[1] - padding * g[1]],
        [
          b[0] + gx + bp * u[0] + padding * g[0],
          b[1] + gy + bp * u[1] + padding * g[1],
        ],
        [
          a[0] + gx - ap * u[0] + padding * g[0],
          a[1] + gy - ap * u[1] + padding * g[1],
        ],
      ],
    ],
  ];
}
/** Explicit construction assumptions from finite original contacts. This helper
 * does not reuse, enlarge or certify the existing source-axis corner contract. */
export function reviewedFiniteContactFootprint(
  shape: NonNullable<
    NativeProvisionalCornerSeals["rows"][number]["reviewedConstructionShape"]
  >,
  padding: number,
): Parts {
  const [a, b] = shape.carrierFragmentFeet,
    [c, d] = shape.targetFragmentFeet;
  if (
    padding <= 0 ||
    padding > 0.0002 ||
    Math.max(
      DMath.hypot(c[0] - a[0], c[1] - a[1]),
      DMath.hypot(d[0] - b[0], d[1] - b[1]),
    ) >
      1 / 3
  )
    throw new Error(
      "Reviewed finite construction span exceeds its separate bounded contract.",
    );
  if (shape.kind === "native-corner-points-bridge") {
    if (!same(a, b) || !same(c, d) || a[0] === c[0] || a[1] === c[1])
      throw new Error(
        "Reviewed corner bridge must retain two distinct exact original corner contacts.",
      );
    return [
      [
        [
          [Math.min(a[0], c[0]) - padding, Math.min(a[1], c[1]) - padding],
          [Math.max(a[0], c[0]) + padding, Math.min(a[1], c[1]) - padding],
          [Math.max(a[0], c[0]) + padding, Math.max(a[1], c[1]) + padding],
          [Math.min(a[0], c[0]) - padding, Math.max(a[1], c[1]) + padding],
        ],
      ],
    ];
  }
  const u = shape.paddingDirectionFeet;
  if (
    Math.abs(DMath.hypot(...u) - 1) > Number.EPSILON * 16 ||
    same(a, b) ||
    same(c, d) ||
    [
      [a, c],
      [b, d],
    ].some(
      ([x, y]) =>
        Math.abs((y[0] - x[0]) * u[1] - (y[1] - x[1]) * u[0]) >
        64 *
          Number.EPSILON *
          Math.max(1, ...x.map(Math.abs), ...y.map(Math.abs)),
    )
  )
    throw new Error(
      "Reviewed finite contact endpoints are not on their declared construction direction.",
    );
  return [
    [
      [
        [a[0] - padding * u[0], a[1] - padding * u[1]],
        [b[0] - padding * u[0], b[1] - padding * u[1]],
        [d[0] + padding * u[0], d[1] + padding * u[1]],
        [c[0] + padding * u[0], c[1] + padding * u[1]],
      ],
    ],
  ];
}
export function validateNativeProvisionalCornerSeals(
  v: NativeProvisionalCornerSeals | undefined,
  model?: string,
) {
  if (v === undefined) return;
  if (
    !v ||
    v.version !== 1 ||
    !digest(v.sourceModelSha256) ||
    (model && model !== v.sourceModelSha256) ||
    !digest(v.sourceMaterialGeometrySha256) ||
    !digest(v.sourceWallPositionRepairsSha256) ||
    !digest(v.geometrySha256) ||
    !digest(v.completeOriginalPhysicalOwnerCensusSha256) ||
    !Array.isArray(v.rows) ||
    v.rows.length > 5000 ||
    new Set(v.rows.map((r) => r.id)).size !== v.rows.length ||
    !Array.isArray(v.foreignBodies) ||
    v.foreignBodies.length > 100_000 ||
    new Set(v.foreignBodies.map((b) => b.nativeElementId)).size !==
      v.foreignBodies.length
  )
    throw new Error("Invalid provisional native corner source binding.");
  if (
    v.nonPhysicalCurtainHostNativeElementIds !== undefined &&
    v.nonPhysicalCurtainHostNativeElementIds.length > 0 &&
    !ids(v.nonPhysicalCurtainHostNativeElementIds)
  )
    throw new Error("Invalid provisional corner original host census.");
  for (const b of v.foreignBodies)
    if (
      !Number.isSafeInteger(b.nativeElementId) ||
      b.nativeElementId <= 0 ||
      !point(b.boundsFeet?.min, 3) ||
      !point(b.boundsFeet?.max, 3) ||
      b.boundsFeet.min.some((x, i) => x > b.boundsFeet.max[i]) ||
      !digest(b.evidenceSha256) ||
      (b.partsFeet !== undefined && !parts(b.partsFeet))
    )
      throw new Error(
        "Invalid original provisional-corner foreign-body evidence.",
      );
  for (const r of v.rows)
    if (
      !r ||
      typeof r.id !== "string" ||
      !r.id ||
      !Number.isSafeInteger(r.levelId) ||
      !Number.isFinite(r.elevationFeet) ||
      !Number.isFinite(r.baseElevationFeet) ||
      !Number.isFinite(r.topElevationFeet) ||
      r.topElevationFeet <= r.baseElevationFeet ||
      r.baseElevationFeet < r.elevationFeet ||
      !["proposed", "applied", "restored"].includes(r.state) ||
      !ids(r.carrierContactNativeElementIds) ||
      !Number.isSafeInteger(r.targetNativeElementId) ||
      r.carrierContactNativeElementIds.includes(r.targetNativeElementId) ||
      !Array.isArray(r.carrierContactFaceFeet) ||
      r.carrierContactFaceFeet.length !== 2 ||
      !r.carrierContactFaceFeet.every((p) => point(p)) ||
      !point(r.nearestCarrierContactFeet) ||
      !point(r.nearestTargetContactFeet) ||
      !parts(r.partsFeet) ||
      !ids(r.sourceFloorIds) ||
      !Array.isArray(r.sourceFloorBindings) ||
      !digest(r.sourceFloorPartsSha256) ||
      (r.materialRole !== undefined &&
        r.materialRole !== "enclosure-context-only") ||
      (r.reviewedConstructionShape !== undefined &&
        (r.materialRole !== "enclosure-context-only" ||
          ![
            "finite-face-fragment-bridge",
            "native-corner-points-bridge",
          ].includes(r.reviewedConstructionShape.kind) ||
          !digest(r.reviewedConstructionShape.evidenceSha256) ||
          r.reviewedConstructionShape.sourceAxisCertified !== false ||
          r.reviewedConstructionShape.sourceFullMemberWidthCertified !==
            false ||
          ![
            r.reviewedConstructionShape.carrierFragmentFeet,
            r.reviewedConstructionShape.targetFragmentFeet,
          ].every(
            (f) =>
              Array.isArray(f) && f.length === 2 && f.every((p) => point(p)),
          ) ||
          !point(r.reviewedConstructionShape.paddingDirectionFeet))) ||
      (r.sourceFloorOuterContext !== undefined &&
        (r.sourceFloorOuterContext.kind !==
          "original-native-floor-outer-edge" ||
          !digest(r.sourceFloorOuterContext.sourceFloorOuterPartsSha256) ||
          !digest(r.sourceFloorOuterContext.evidenceSha256) ||
          r.sourceFloorOuterContext.noWalkingMaterial !== true)) ||
      !digest(r.evidenceSha256) ||
      "literalAuthorization" in (r.assumption ?? {}) ||
      "statement" in (r.assumption ?? {}) ||
      (r.drawingBacked
        ? r.assumption?.kind !== "drawing-backed"
        : r.assumption?.kind !== "human-authorized-construction-assumption") ||
      r.assumption.revisitRequired !== true ||
      r.assumption.sourceVerified !== false ||
      !digest(r.assumption.evidenceSha256) ||
      !digest(r.assumption.authorizationEvidenceSha256) ||
      typeof r.assumption.authorizationRecorded !== "boolean" ||
      (r.state === "applied" && r.assumption.authorizationRecorded !== true)
    )
      throw new Error("Invalid explicit provisional native corner assumption.");
  for (const r of v.rows)
    if (r.drawingBacked !== undefined) validateDrawingBackedShape(r);
}
export function validateNativeProvisionalEnclosureBinding(data: Data) {
  const v = data.nativeProvisionalCornerSeals;
  for (const level of data.nativeIndoorEnvelopes?.levels ?? []) {
    if (
      level.provisionalCornerGeometrySha256 === undefined &&
      level.provisionalCornerIds === undefined
    )
      continue;
    const cuts = level.cutElevationsFeet ?? [];
    const bound = Array.isArray(level.provisionalCornerIds)
      ? level.provisionalCornerIds.map((id) => v?.rows.find((r) => r.id === id))
      : [];
    if (
      !v ||
      level.provisionalCornerGeometrySha256 !== v.geometrySha256 ||
      !Array.isArray(level.provisionalCornerIds) ||
      level.provisionalCornerIds.length === 0 ||
      new Set(level.provisionalCornerIds).size !==
        level.provisionalCornerIds.length ||
      cuts.length === 0 ||
      bound.some(
        (r) =>
          !r ||
          r.state !== "applied" ||
          !cuts.some((z) => z >= r.baseElevationFeet && z < r.topElevationFeet),
      )
    )
      throw new Error(
        "Provisional native enclosure assumption is missing or stale.",
      );
  }
}
const distance = (p: P2, a: P2, b: P2) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l = dx * dx + dy * dy,
    t = l
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l))
      : 0;
  return {
    point: [a[0] + t * dx, a[1] + t * dy] as P2,
    distance: DMath.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy),
  };
};
const segments = (ps: Parts) =>
  ps.flatMap((p) =>
    p.flatMap((r) => r.map((a, i) => [a, r[(i + 1) % r.length]] as [P2, P2])),
  );
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
/**
 * In-process memo of passed drawing-backed row checks, so repeated material-query builds in
 * one run do not re-validate unchanged rows. The key is a content digest of the row and of
 * every input checkDrawingBackedRow reads: the seal descriptor (rows, foreign-body census,
 * nonphysical curtain hosts), the original material levels, the wall placement shifts, the
 * walking floors the row binds, and every door footprint with its edge. The descriptor and
 * material enter as the digests this same call has just recomputed and verified against their
 * content (an exact digest replaces each where its JSON form would hide -0, a non-finite number
 * or an undefined entry); floors and doors are digested here. Object identity never enters a
 * key, so an edited or in-place mutated input is a new key and is checked again. Only passes
 * are remembered: a failing row is always re-checked and throws its own error. The memo lives
 * in this module only: never serialised, never shared with another process or worker, and gone
 * with the process. A run may clear it with resetDrawingBackedRowMemo().
 */
export const DRAWING_BACKED_ROW_MEMO_RULE =
  "drawing-backed-row-check-memo-v1" as const;
const DRAWING_BACKED_ROW_MEMO_MAX_ENTRIES = 100_000;
const drawingBackedRowMemo = new Set<string>();
const drawingBackedRowMemoState = { enabled: true, hits: 0, misses: 0 };
/** Turns the memo on or off for this process (off also clears it). */
export function setDrawingBackedRowMemoEnabled(enabled: boolean) {
  drawingBackedRowMemoState.enabled = enabled;
  if (!enabled) resetDrawingBackedRowMemo();
}
/** Forgets every remembered pass and resets the counters. */
export function resetDrawingBackedRowMemo() {
  drawingBackedRowMemo.clear();
  drawingBackedRowMemoState.hits = 0;
  drawingBackedRowMemoState.misses = 0;
}
export const drawingBackedRowMemoStats = () => ({
  enabled: drawingBackedRowMemoState.enabled,
  entries: drawingBackedRowMemo.size,
  hits: drawingBackedRowMemoState.hits,
  misses: drawingBackedRowMemoState.misses,
});
const notJsonExact = (x: unknown) =>
  x === undefined ||
  (typeof x === "number" && (!Number.isFinite(x) || (x === 0 && 1 / x < 0)));
/** JSON that keeps the sign of zero, non-finite numbers and undefined entries. */
const exactContentDigest = (value: unknown) =>
  bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify(value, (_key, x) =>
          notJsonExact(x) ? `\u0000${Object.is(x, -0) ? "-0" : String(x)}` : x,
        ),
      ),
    ),
  );
/** A digest just verified as nativeDerivedFrameHash(value) names value exactly unless its JSON
 * form hides a value; then the exact digest is used instead. */
const verifiedContentDigest = (value: unknown, verified: string) => {
  let hidden = false;
  JSON.stringify(value, (_key, x) => {
    if (!hidden && notJsonExact(x)) hidden = true;
    return x;
  });
  return hidden ? `exact:${exactContentDigest(value)}` : `json:${verified}`;
};
function drawingBackedRowMemoKeys(
  data: Data,
  v: NativeProvisionalCornerSeals,
  hostSkip: Set<number>,
  shifts: Map<number, P2>,
) {
  const material = data.nativeMaterialSections!;
  const edges = new Map<string, NonNullable<Data["edges"]>[number]>();
  for (const e of data.edges ?? []) if (!edges.has(e.id)) edges.set(e.id, e);
  const floors =
    data.walkingSupport?.sourceModelSha256 === v.sourceModelSha256
      ? data.walkingSupport.floors
      : [];
  const floorDigests = floors.map((f) =>
    exactContentDigest([
      f.nativeElementId,
      f.elevationFeet,
      f.partsFeet ?? [f.ringsFeet],
    ]),
  );
  const floorsById = new Map<number, number[]>();
  floors.forEach((f, i) =>
    floorsById.set(f.nativeElementId, [
      ...(floorsById.get(f.nativeElementId) ?? []),
      i,
    ]),
  );
  const inputs = exactContentDigest([
    DRAWING_BACKED_ROW_MEMO_RULE,
    // Verified by createNativeProvisionalCornerSealIndex before any row is checked.
    verifiedContentDigest(
      Object.fromEntries(
        Object.entries(v).filter(([k]) => k !== "geometrySha256"),
      ),
      v.geometrySha256,
    ),
    verifiedContentDigest(
      [material.version, material.sourceModelSha256, material.levels],
      material.geometrySha256,
    ),
    [...hostSkip].sort((a, b) => a - b),
    [...shifts.entries()].sort((a, b) => a[0] - b[0]),
    data.walkingSupport?.sourceModelSha256 === v.sourceModelSha256,
    exactContentDigest(
      (data.doors ?? []).map((d) => {
        const e = edges.get(d.id);
        return [
          d.id,
          d.nativeElementId,
          d.footprintFeet ?? null,
          e ? [e.kind, e.enabled, e.pointsFeet] : null,
        ];
      }),
    ),
  ]);
  return (r: NativeProvisionalCornerSeals["rows"][number]) => {
    const bound = [...new Set(r.sourceFloorIds)]
      .flatMap((id) => floorsById.get(id) ?? [])
      .sort((a, b) => a - b)
      .map((i) => floorDigests[i]);
    // Row ids are unique in a valid descriptor, and the descriptor digest covers the row.
    return exactContentDigest([inputs, r.id, bound]);
  };
}
export function createNativeProvisionalCornerSealIndex(
  data: Data,
  options?: { reviewProposed?: boolean },
) {
  const v = data.nativeProvisionalCornerSeals;
  validateNativeProvisionalCornerSeals(v, data.source?.modelSha256);
  validateNativeProvisionalEnclosureBinding(data);
  if (!v)
    return {
      rows: [] as NativeProvisionalCornerSeals["rows"],
      partsAt: (_cut: number) => [] as { outer: P2[]; holes: P2[][] }[],
    };
  const material = data.nativeMaterialSections;
  if (
    v.geometrySha256 !== nativeProvisionalCornerSealsHash(v) ||
    !material ||
    material.sourceModelSha256 !== v.sourceModelSha256 ||
    v.sourceMaterialGeometrySha256 !== material.geometrySha256 ||
    material.geometrySha256 !==
      nativeDerivedFrameHash([
        material.version,
        material.sourceModelSha256,
        material.levels,
      ]) ||
    v.sourceWallPositionRepairsSha256 !==
      nativeDerivedFramePlacementHash(data.nativeWallPositionRepairs) ||
    v.completeOriginalPhysicalOwnerCensusSha256 !==
      nativeDerivedFrameHash(v.foreignBodies)
  )
    throw new Error("Provisional native corner physical evidence changed.");
  const positiveBands = nativePositiveMaterialBandsAcrossLevels(
    material.levels,
  );
  const shifts = new Map(
    data.nativeWallPositionRepairs?.walls.map((r) => [
      r.nativeElementId,
      [
        r.ringsFeet[0][0][0] - r.originalRingsFeet[0][0][0],
        r.ringsFeet[0][0][1] - r.originalRingsFeet[0][0][1],
      ] as P2,
    ]) ?? [],
  );
  const census = new Map(v.foreignBodies.map((b) => [b.nativeElementId, b]));
  if (
    material.levels.some((l) =>
      l.sourceElementIds.some((id) => !census.has(id)),
    )
  )
    throw new Error(
      "Provisional corner foreign physical-owner census is incomplete.",
    );
  const hostSkip = new Set<number>();
  for (const id of v.nonPhysicalCurtainHostNativeElementIds ?? []) {
    const hosts = material.levels
        .flatMap((l) => l.originalNativeHostRelations ?? [])
        .filter((h) => h.hostNativeElementId === id),
      assemblies = material.levels
        .flatMap((l) => l.sections)
        .filter(
          (s) =>
            s.nativeElementId === id &&
            s.sourceNativeHostRelationsVerified === true,
        );
    if (
      !census.has(id) ||
      hosts.length === 0 ||
      assemblies.length === 0 ||
      hosts.some(
        (h) =>
          h.memberNativeElementIds.some((x) => !census.has(x)) ||
          h.physicalDoorNativeElementIds.some((x) => !census.has(x)),
      ) ||
      assemblies.some((s) =>
        s.sourceAssemblyChildIds?.some((x) => !census.has(x)),
      )
    )
      throw new Error(
        "Provisional corner nonphysical host lacks complete original physical children.",
      );
    hostSkip.add(id);
  }
  const finite = material.levels.flatMap(
    (l) => l.originalFiniteMaterialSections ?? [],
  );
  const rows = v.rows.filter(
    (r) =>
      r.state === "applied" ||
      (options?.reviewProposed && r.state === "proposed"),
  );
  const memoKey =
    drawingBackedRowMemoState.enabled && rows.some((r) => r.drawingBacked)
      ? drawingBackedRowMemoKeys(data, v, hostSkip, shifts)
      : undefined;
  for (const r of rows) {
    if (r.drawingBacked) {
      const key = memoKey?.(r);
      if (key !== undefined && drawingBackedRowMemo.has(key)) {
        drawingBackedRowMemoState.hits++;
        continue;
      }
      checkDrawingBackedRow(
        data,
        v,
        r,
        positiveBands,
        shifts,
        census,
        hostSkip,
      );
      if (key !== undefined) {
        drawingBackedRowMemoState.misses++;
        if (drawingBackedRowMemo.size >= DRAWING_BACKED_ROW_MEMO_MAX_ENTRIES)
          drawingBackedRowMemo.clear();
        drawingBackedRowMemo.add(key);
      }
      continue;
    }
    const contacts = [
        ...r.carrierContactNativeElementIds,
        r.targetNativeElementId,
      ],
      profiles = new Map<number, typeof finite>();
    for (const id of contacts) {
      const ps = finite.filter(
        (p) =>
          p.nativeElementId === id &&
          p.baseElevationFeet < r.topElevationFeet &&
          p.topElevationFeet > r.baseElevationFeet,
      );
      if (ps.length === 0 || !census.has(id))
        throw new Error(
          "Provisional corner has no independently original finite contact body.",
        );
      profiles.set(id, ps);
    }
    const carrierProfiles = r.carrierContactNativeElementIds.flatMap(
        (id) => profiles.get(id)!,
      ),
      targetProfiles = profiles.get(r.targetNativeElementId)!;
    const planes = [
      r.baseElevationFeet,
      r.topElevationFeet,
      ...carrierProfiles.flatMap((p) => [
        p.baseElevationFeet,
        p.topElevationFeet,
      ]),
      ...targetProfiles.flatMap((p) => [
        p.baseElevationFeet,
        p.topElevationFeet,
      ]),
    ]
      .filter((z) => z >= r.baseElevationFeet && z <= r.topElevationFeet)
      .sort((a, b) => a - b);
    const originalContactBands: Parts[] = [];
    for (let i = 1; i < planes.length; i++) {
      if (planes[i] === planes[i - 1]) continue;
      const z = (planes[i] + planes[i - 1]) / 2,
        cp = carrierProfiles.filter(
          (p) => p.baseElevationFeet <= z && p.topElevationFeet >= z,
        ),
        tp = targetProfiles.filter(
          (p) => p.baseElevationFeet <= z && p.topElevationFeet >= z,
        );
      if (r.reviewedConstructionShape) {
        const ownedContactParts = [...cp, ...tp].map((p) => p.partsFeet);
        if (ownedContactParts.length === 0)
          throw new Error(
            "Reviewed construction has no finite original contact band.",
          );
        originalContactBands.push(
          pc.union(
            ownedContactParts[0],
            ...ownedContactParts.slice(1),
          ) as Parts,
        );
        const shape = r.reviewedConstructionShape;
        const fragments = [shape.carrierFragmentFeet, shape.targetFragmentFeet];
        const bind = (profile: (typeof finite)[number], fragment: [P2, P2]) => {
          const on = (p: P2) =>
            segments(profile.partsFeet).some(
              (e) =>
                distance(p, ...e).distance <=
                32 *
                  Number.EPSILON *
                  Math.max(1, ...p.map(Math.abs), ...e.flat().map(Math.abs)),
            );
          return (
            fragment.every(on) &&
            on([
              (fragment[0][0] + fragment[1][0]) / 2,
              (fragment[0][1] + fragment[1][1]) / 2,
            ])
          );
        };
        if (
          cp.length === 0 ||
          tp.length === 0 ||
          !cp.every((p) => bind(p, fragments[0])) ||
          !tp.every((p) => bind(p, fragments[1])) ||
          cp.some(
            (p) =>
              area(pc.intersection(r.partsFeet, p.partsFeet) as Parts) <= 0,
          ) ||
          tp.some(
            (p) =>
              area(pc.intersection(r.partsFeet, p.partsFeet) as Parts) <= 0,
          )
        )
          throw new Error(
            "Reviewed construction does not retain positive complete finite original contact fragments: " +
              r.id +
              " " +
              JSON.stringify({
                z,
                carrierBindings: cp.map((p) => bind(p, fragments[0])),
                targetBindings: tp.map((p) => bind(p, fragments[1])),
                carrierContacts: cp.map((p) =>
                  area(pc.intersection(r.partsFeet, p.partsFeet) as Parts),
                ),
                targetContacts: tp.map((p) =>
                  area(pc.intersection(r.partsFeet, p.partsFeet) as Parts),
                ),
              }),
          );
        if (
          shape.kind === "native-corner-points-bridge" &&
          (!cp.every((p) =>
            p.partsFeet
              .flat(PARTS_VERTEX_DEPTH)
              .some((q) => same(q, fragments[0][0])),
          ) ||
            !tp.every((p) =>
              p.partsFeet
                .flat(PARTS_VERTEX_DEPTH)
                .some((q) => same(q, fragments[1][0])),
            ))
        )
          throw new Error(
            "Reviewed point bridge is not bound to exact original finite corner vertices.",
          );
        if (shape.kind === "finite-face-fragment-bridge") {
          const u = shape.paddingDirectionFeet;
          for (let k = 0; k < 2; k++) {
            const a = fragments[0][k],
              wanted = fragments[1][k];
            for (const profile of tp) {
              const hits = segments(profile.partsFeet)
                .flatMap(([c, d]) => {
                  const vx = d[0] - c[0],
                    vy = d[1] - c[1],
                    den = u[0] * vy - u[1] * vx;
                  if (!den) return [];
                  const cx = c[0] - a[0],
                    cy = c[1] - a[1];
                  const t = (cx * vy - cy * vx) / den,
                    q = (cx * u[1] - cy * u[0]) / den;
                  const round =
                    (64 *
                      Number.EPSILON *
                      Math.max(
                        1,
                        ...a.map(Math.abs),
                        ...c.map(Math.abs),
                        ...d.map(Math.abs),
                      )) /
                    DMath.hypot(vx, vy);
                  return t >= 0 && q >= -round && q <= 1 + round
                    ? [
                        [
                          c[0] + Math.max(0, Math.min(1, q)) * vx,
                          c[1] + Math.max(0, Math.min(1, q)) * vy,
                        ] as P2,
                      ]
                    : [];
                })
                .sort(
                  (c, d) =>
                    DMath.hypot(c[0] - a[0], c[1] - a[1]) -
                    DMath.hypot(d[0] - a[0], d[1] - a[1]),
                );
              const first = hits[0];
              if (
                !first ||
                first.some(
                  (x, j) =>
                    Math.abs(x - wanted[j]) >
                    64 *
                      Number.EPSILON *
                      Math.max(1, Math.abs(x), Math.abs(wanted[j])),
                )
              )
                throw new Error(
                  "Reviewed partial bridge does not end at the first actual finite target face.",
                );
            }
          }
        } else {
          for (const c of cp)
            for (const t of tp) {
              const gaps = segments(c.partsFeet)
                .flatMap((e) =>
                  segments(t.partsFeet).flatMap((f) => [
                    ...e.map((a) => ({
                      a,
                      b: distance(a, ...f).point,
                      d: distance(a, ...f).distance,
                    })),
                    ...f.map((b) => ({
                      a: distance(b, ...e).point,
                      b,
                      d: distance(b, ...e).distance,
                    })),
                  ]),
                )
                .sort((a, b) => a.d - b.d);
              const nearest = gaps[0];
              if (
                !nearest ||
                !same(nearest.a, fragments[0][0]) ||
                !same(nearest.b, fragments[1][0])
              )
                throw new Error(
                  "Reviewed point bridge is not the nearest actual original finite corner contact.",
                );
            }
        }
        continue;
      }
      if (
        cp.length === 0 ||
        tp.length === 0 ||
        !cp.every((p) =>
          segments(p.partsFeet).some(
            (e) =>
              same(e, r.carrierContactFaceFeet) ||
              same([...e].reverse(), r.carrierContactFaceFeet),
          ),
        )
      )
        throw new Error(
          "Provisional seal is not bound to the complete finite original contact faces.",
        );
      const targetEdges = tp.flatMap((p) => segments(p.partsFeet));
      const candidates = targetEdges
          .flatMap((e) => {
            const aa = distance(r.carrierContactFaceFeet[0], ...e),
              bb = distance(r.carrierContactFaceFeet[1], ...e);
            const cc = distance(e[0], ...r.carrierContactFaceFeet),
              dd = distance(e[1], ...r.carrierContactFaceFeet);
            return [
              { a: r.carrierContactFaceFeet[0], b: aa.point, d: aa.distance },
              { a: r.carrierContactFaceFeet[1], b: bb.point, d: bb.distance },
              { a: cc.point, b: e[0], d: cc.distance },
              { a: dd.point, b: e[1], d: dd.distance },
            ];
          })
          .sort((a, b) => a.d - b.d),
        nearest = candidates[0];
      if (
        !nearest ||
        !same(nearest.a, r.nearestCarrierContactFeet) ||
        !same(nearest.b, r.nearestTargetContactFeet)
      )
        throw new Error(
          "Provisional native corner is not the current first measured original contact.",
        );
      if (
        cp.some(
          (p) => area(pc.intersection(r.partsFeet, p.partsFeet) as Parts) <= 0,
        ) ||
        tp.some(
          (p) => area(pc.intersection(r.partsFeet, p.partsFeet) as Parts) <= 0,
        )
      )
        throw new Error(
          "Provisional native corner lacks positive finite source contacts.",
        );
    }
    const expected = r.reviewedConstructionShape
      ? reviewedFiniteContactFootprint(
          r.reviewedConstructionShape,
          r.contactPaddingFeet,
        )
      : provisionalCornerFootprint(
          r.carrierContactFaceFeet,
          r.nearestCarrierContactFeet,
          r.nearestTargetContactFeet,
          r.contactPaddingFeet,
        );
    if (area(pc.xor(expected, r.partsFeet) as Parts) > 0)
      throw new Error(
        "Provisional corner geometry changed from its declared measured native faces.",
      );
    const floors =
      data.walkingSupport?.sourceModelSha256 === v.sourceModelSha256
        ? data.walkingSupport.floors
            .filter((f) => r.sourceFloorIds.includes(f.nativeElementId))
            .map((f) => ({
              nativeElementId: f.nativeElementId,
              elevationFeet: f.elevationFeet,
              partsFeet: f.partsFeet ?? [f.ringsFeet],
            }))
        : [];
    if (
      floors.length !== r.sourceFloorIds.length ||
      !same(floors, r.sourceFloorBindings) ||
      nativeDerivedFrameHash(floors) !== r.sourceFloorPartsSha256 ||
      floors.some((f) => Math.abs(f.elevationFeet - r.elevationFeet) > 0.05) ||
      (!r.sourceFloorOuterContext &&
        r.partsFeet.some(
          (p) =>
            exactNativeDoorFloorDifference(
              p,
              floors.flatMap((f) => f.partsFeet),
            ).length,
        ))
    )
      throw new Error(
        "Provisional corner crosses unsupported native floor or an original opening.",
      );
    if (r.sourceFloorOuterContext) {
      const full = floors.flatMap((f) => f.partsFeet);
      const outer = full.map((p) => [p[0]]) as Parts;
      const holes = pc.difference(outer, full) as Parts;
      const unsupported = r.partsFeet.flatMap((p) =>
        exactNativeDoorFloorDifference(p, full),
      ) as Parts;
      if (
        nativeDerivedFrameHash(outer) !==
          r.sourceFloorOuterContext.sourceFloorOuterPartsSha256 ||
        unsupported.length === 0 ||
        area(pc.intersection(unsupported, outer) as Parts) > 0 ||
        area(pc.intersection(r.partsFeet, holes) as Parts) > 0
      )
        throw new Error(
          "Provisional context must lie only beyond original floor outer edges, never an inner aperture.",
        );
    }
    const ps = r.partsFeet.flat(PARTS_VERTEX_DEPTH),
      box = {
        min: [
          Math.min(...ps.map((p) => p[0])),
          Math.min(...ps.map((p) => p[1])),
          r.baseElevationFeet,
        ],
        max: [
          Math.max(...ps.map((p) => p[0])),
          Math.max(...ps.map((p) => p[1])),
          r.topElevationFeet,
        ],
      };
    // Only the new explicitly reviewed construction contract may subtract
    // material already occupied by independently original contact bodies at
    // EVERY finite-height band. Physical foreign members are never exempted
    // by common host alone. The approved older corner behavior stays unchanged.
    const commonOriginalContacts =
      originalContactBands.length > 0
        ? originalContactBands
            .slice(1)
            .reduce(
              (common, p) => pc.intersection(common, p) as Parts,
              originalContactBands[0],
            )
        : [];
    const foreignFoot = r.reviewedConstructionShape
      ? (pc.difference(r.partsFeet, commonOriginalContacts) as Parts)
      : r.partsFeet;
    for (const band of positiveBands) {
      if (
        !contacts.includes(band.nativeElementId) &&
        !hostSkip.has(band.nativeElementId) &&
        band.baseElevationFeet < r.topElevationFeet &&
        band.topElevationFeet > r.baseElevationFeet &&
        nativePositiveMaterialBandOverlapsParts(
          band,
          foreignFoot,
          shifts.get(band.nativeElementId) ?? [0, 0],
        )
      )
        throw new Error(
          "Provisional corner intersects exact positive original foreign material: " +
            r.id +
            " owner " +
            band.nativeElementId,
        );
    }
    for (const b of v.foreignBodies) {
      if (
        contacts.includes(b.nativeElementId) ||
        hostSkip.has(b.nativeElementId) ||
        (r.reviewedConstructionShape &&
          (b.boundsFeet.max[2] <= r.baseElevationFeet ||
            b.boundsFeet.min[2] >= r.topElevationFeet)) ||
        b.boundsFeet.max.some((x, i) => x < box.min[i]) ||
        b.boundsFeet.min.some((x, i) => x > box.max[i])
      )
        continue;
      if (
        !b.partsFeet ||
        area(pc.intersection(foreignFoot, b.partsFeet) as Parts) > 0
      )
        throw new Error(
          "Provisional corner intersects unknown or actual original foreign material: " +
            r.id +
            " owner " +
            b.nativeElementId,
        );
    }
    for (const door of data.doors ?? []) {
      const e = data.edges?.find((e) => e.id === door.id);
      if (
        e?.enabled &&
        e.kind === "door" &&
        door.footprintFeet &&
        e.pointsFeet.some(
          (p) => p[2] >= r.baseElevationFeet && p[2] <= r.topElevationFeet,
        ) &&
        area(pc.intersection(r.partsFeet, [door.footprintFeet]) as Parts) > 0
      )
        throw new Error(
          "Provisional corner intersects a preserved physical doorway.",
        );
    }
  }
  return {
    rows,
    partsAt: (cut: number) =>
      rows
        .filter(
          (r) =>
            r.state === "applied" &&
            !r.sourceFloorOuterContext &&
            !r.materialRole &&
            r.baseElevationFeet <= cut &&
            r.topElevationFeet > cut,
        )
        .flatMap((r) =>
          r.partsFeet.map((p) => ({ outer: p[0], holes: p.slice(1) })),
        ),
  };
}
/** Physical guards of the drawing-backed family. Every original guard is kept:
 * normalized-identical body, owner contacts, exact foreign material, complete
 * unverified-body acknowledgement, floor support/openings and physical doors. */
function checkDrawingBackedRow(
  data: Data,
  v: NativeProvisionalCornerSeals,
  r: NativeProvisionalCornerSeals["rows"][number],
  positiveBands: ReturnType<typeof nativePositiveMaterialBandsAcrossLevels>,
  shifts: Map<number, P2>,
  census: Map<number, NativeProvisionalCornerSeals["foreignBodies"][number]>,
  hostSkip: Set<number>,
) {
  const d = r.drawingBacked!,
    c = d.construction,
    fail = (why: string): never => {
      throw new Error(`Drawing-backed assumption ${r.id}: ${why}`);
    };
  const material = data.nativeMaterialSections!;
  const expected = drawingBackedAssumptionFootprint(c);
  if (area(pc.xor(expected, r.partsFeet) as Parts) > 0)
    fail("body differs from its declared construction");
  const scale = (p: P2) =>
    64 * Number.EPSILON * Math.max(1, Math.abs(p[0]), Math.abs(p[1]));
  if (c.kind === "bridge") {
    const gap = DMath.hypot(
      c.pointBFeet[0] - c.pointAFeet[0],
      c.pointBFeet[1] - c.pointAFeet[1],
    );
    if (Math.abs(gap - d.measuredGapFeet) > scale(c.pointAFeet))
      fail("measured gap does not equal its declared contact points");
    if (
      (gap > 0 &&
        Math.abs(
          (c.pointBFeet[0] - c.pointAFeet[0]) * c.directionFeet[1] -
            (c.pointBFeet[1] - c.pointAFeet[1]) * c.directionFeet[0],
        ) >
          scale(c.pointAFeet) * Math.max(1, gap)) ||
      (gap > 0 &&
        (c.pointBFeet[0] - c.pointAFeet[0]) * c.directionFeet[0] +
          (c.pointBFeet[1] - c.pointAFeet[1]) * c.directionFeet[1] <=
          0)
    )
      fail("bridge direction is not the measured gap direction");
  }
  // Registered drawing evidence: the plan must be continuous across the gap,
  // draw both faces of an assumed wall, or draw the assumed column outline.
  const dwg = d.dwg;
  if (d.kind === "dwg-drawn-material") {
    // Evidence replaces the seal caps: cited face lines must be cited segments; the drawn-material
    // containment, opening and floor rules run below once the band and floors are known.
    if (
      c.kind === "dwg-face-pair" &&
      ![c.faceAFeet, c.faceBFeet].every((f) =>
        dwg!.entities.some(
          (e) =>
            e.kind === "wallSegments" &&
            (same(e.segmentFeet, f) ||
              same([e.segmentFeet[1], e.segmentFeet[0]], f)),
        ),
      )
    )
      fail(
        "DWG face-pair wall faces are not cited registered drawing segments",
      );
  } else if (dwg) {
    const segs = dwg.entities.map((e) => e.segmentFeet),
      near = (p: P2) =>
        segs.some((s) => segmentDistance(p, s) <= dwg.toleranceFeet);
    switch (c.kind) {
      case "bridge": {
        const m: P2 = [
          (c.pointAFeet[0] + c.pointBFeet[0]) / 2,
          (c.pointAFeet[1] + c.pointBFeet[1]) / 2,
        ];
        if (![c.pointAFeet, c.pointBFeet, m].every(near))
          fail("registered drawing is not continuous across the measured gap");

        break;
      }
      case "dwg-face-pair": {
        const cited = (f: [P2, P2]) =>
          segs.some((s) => same(s, f) || same([s[1], s[0]], f));
        if (!cited(c.faceAFeet) || !cited(c.faceBFeet))
          fail("assumed wall faces are not cited registered drawing segments");

        break;
      }
      case "native-column-outline": {
        // Columns embedded in a wall have faces hidden in plan drawings; at least
        // half of the native outline corners must lie on cited drawing lines.
        const ring = c.outlineFeet;
        if (ring.filter(near).length * 2 < ring.length)
          fail("registered drawing does not outline the assumed column");

        break;
      }
      // No default
    }
  } else if (
    d.kind !== "exact-contact-closure" &&
    d.kind !== "owner-authorized-seal"
  )
    fail("registered drawing evidence is required");
  // Material rows on this level whose cut lies in the body band.
  const bandRows = material.levels.filter(
    (l) =>
      l.levelId === r.levelId &&
      l.cutElevationFeet >= r.baseElevationFeet &&
      l.cutElevationFeet < r.topElevationFeet,
  );
  const ownerParts = (id: number, rows = bandRows) =>
    rows.flatMap((l) =>
      l.sections
        .filter((s) => s.nativeElementId === id)
        .flatMap((s) => s.partsFeet),
    ) as Parts;
  const ps = r.partsFeet.flat(PARTS_VERTEX_DEPTH),
    box = {
      min: [
        Math.min(...ps.map((p) => p[0])),
        Math.min(...ps.map((p) => p[1])),
        r.baseElevationFeet,
      ],
      max: [
        Math.max(...ps.map((p) => p[0])),
        Math.max(...ps.map((p) => p[1])),
        r.topElevationFeet,
      ],
    };
  const boxMeets = (b: { min: number[]; max: number[] }) =>
    !(
      b.max.some((x, i) => x < box.min[i]) ||
      b.min.some((x, i) => x > box.max[i])
    );
  if (d.kind === "dwg-drawn-material")
    checkDrawnMaterialEvidence(data, v, r, bandRows, fail);
  for (const id of d.nativeOwnerIds) {
    const own = ownerParts(id);
    if (own.length > 0) {
      if (c.kind === "native-column-outline") continue;
      if (area(pc.intersection(r.partsFeet, own) as Parts) <= 0)
        fail(`no positive contact with sectioned native owner ${id}`);
    } else {
      const body = census.get(id);
      if (!body || !boxMeets(body.boundsFeet))
        fail(`unsectioned native owner ${id} is not a meeting census body`);
    }
  }
  if (d.kind === "dwg-assumed-wall") {
    const host = d.nativeOwnerIds[0];
    if (ownerParts(host).length > 0)
      fail(
        "assumed wall host already has a certified native body at this band",
      );
    if (!census.has(host))
      fail("assumed wall host is not an original physical owner");
  }
  if (c.kind === "native-column-outline") {
    const column = d.nativeOwnerIds[0];
    const source = material.levels.filter(
      (l) =>
        l.levelId === c.sourceLevelId &&
        l.cutElevationFeet === c.sourceCutElevationFeet,
    );
    const outlines = source.flatMap((l) =>
      l.sections
        .filter((s) => s.nativeElementId === column && s.kind === "column")
        .flatMap((s) => s.partsFeet.map((p) => p[0])),
    );
    const norm = (ring: P2[]) =>
      JSON.stringify(same(ring[0], ring.at(-1)) ? ring.slice(0, -1) : ring);
    if (!outlines.some((o) => norm(o as P2[]) === norm(c.outlineFeet)))
      fail("assumed column outline is not the exact native column section");
  }
  // Exact original foreign material (non-owners) may never be covered.
  for (const band of positiveBands)
    if (
      !d.nativeOwnerIds.includes(band.nativeElementId) &&
      !hostSkip.has(band.nativeElementId) &&
      band.baseElevationFeet < r.topElevationFeet &&
      band.topElevationFeet > r.baseElevationFeet &&
      nativePositiveMaterialBandOverlapsParts(
        band,
        r.partsFeet,
        shifts.get(band.nativeElementId) ?? [0, 0],
      )
    )
      fail(`covers exact original foreign material ${band.nativeElementId}`);
  for (const l of bandRows)
    for (const sct of l.sections)
      if (
        !d.nativeOwnerIds.includes(sct.nativeElementId) &&
        !hostSkip.has(sct.nativeElementId) &&
        area(pc.intersection(r.partsFeet, sct.partsFeet as Parts) as Parts) > 0
      )
        fail(`covers sectioned foreign native material ${sct.nativeElementId}`);
  const unverified = v.foreignBodies
    .filter(
      (b) =>
        !d.nativeOwnerIds.includes(b.nativeElementId) &&
        !hostSkip.has(b.nativeElementId) &&
        boxMeets({ min: b.boundsFeet.min, max: b.boundsFeet.max }),
    )
    .filter((b) => {
      if (b.partsFeet) {
        if (area(pc.intersection(r.partsFeet, b.partsFeet) as Parts) > 0)
          fail(`covers original foreign body ${b.nativeElementId}`);
        return false;
      }
      return true;
    })
    .map((b) => b.nativeElementId)
    .sort((a, b) => a - b);
  if (
    !same(
      unverified,
      [...d.acknowledgedUnverifiedBodyIds].sort((a, b) => a - b),
    )
  )
    fail(
      "unverified original bodies meeting the body are not completely acknowledged: " +
        JSON.stringify(unverified),
    );
  const floors =
    data.walkingSupport?.sourceModelSha256 === v.sourceModelSha256
      ? data.walkingSupport.floors
          .filter((f) => r.sourceFloorIds.includes(f.nativeElementId))
          .map((f) => ({
            nativeElementId: f.nativeElementId,
            elevationFeet: f.elevationFeet,
            partsFeet: f.partsFeet ?? [f.ringsFeet],
          }))
      : [];
  const full = floors.flatMap((f) => f.partsFeet);
  const unsupported = r.partsFeet.flatMap((p) =>
    exactNativeDoorFloorDifference(p, full),
  ) as Parts;
  // Interior seals/contacts must be wholly floor-supported. An assumed facade
  // wall or column may stand on the slab edge: any unsupported part must lie
  // beyond the original floor OUTER edge, never inside a slab hole or aperture.
  const facade =
    d.kind === "dwg-assumed-wall" ||
    d.kind === "dwg-assumed-column" ||
    r.materialRole === "enclosure-context-only";
  // Floating clipping of the original slab edge leaves zero-width slivers;
  // any real aperture or outside-edge overlap is far larger than this bound.
  const slivers = 1e-9;
  const outer = full.map((p) => [p[0]]) as Parts;
  // Unsupported area inside the floors' outer rings (slab holes/apertures) =
  // |body - floors| - |body - outer rings|, both by the exact overlay (floating
  // clipping of near-collinear slab-edge slivers is not robust).
  const beyondOuter = () =>
    r.partsFeet.flatMap((p) =>
      exactNativeDoorFloorDifference(p, outer),
    ) as Parts;
  if (
    floors.length !== r.sourceFloorIds.length ||
    floors.length === 0 ||
    !same(floors, r.sourceFloorBindings) ||
    nativeDerivedFrameHash(floors) !== r.sourceFloorPartsSha256 ||
    floors.some((f) => Math.abs(f.elevationFeet - r.elevationFeet) > 0.05) ||
    (unsupported.length > 0 &&
      d.kind !== "dwg-drawn-material" &&
      (!facade || area(unsupported) - area(beyondOuter()) > slivers))
  )
    fail("crosses unsupported native floor or an original opening");
  for (const door of data.doors ?? []) {
    const e = data.edges?.find((e) => e.id === door.id);
    if (
      r.materialRole !== "enclosure-context-only" &&
      e?.enabled &&
      e.kind === "door" &&
      door.footprintFeet &&
      e.pointsFeet.some(
        (p) => p[2] >= r.baseElevationFeet - 0.05 && p[2] <= r.topElevationFeet,
      ) &&
      area(pc.intersection(r.partsFeet, [door.footprintFeet]) as Parts) > 0
    )
      fail(
        "intersects a preserved physical doorway; only enclosure-context-only rows may close it",
      );
  }
}
/** Evidence rules of a dwg-drawn-material row: (1) the body lies inside the material the cited
 * registered entities draw, within the row's drawing tolerance; (2) it crosses no native door
 * footprint at its band and no cited drawn door segment (all registered door segments are
 * checked at compile time); (3) any part over a native floor opening, void or beyond the slab
 * edge lies inside that drawn material and the body still stands on its bound floor. A
 * wall-end extension must sweep its wall's own end face along the wall's own side faces at
 * every cut of the band. */
function checkDrawnMaterialEvidence(
  data: Data,
  v: NativeProvisionalCornerSeals,
  r: NativeProvisionalCornerSeals["rows"][number],
  bandRows: NativeMaterialSections["levels"],
  fail: (why: string) => never,
) {
  const d = r.drawingBacked!,
    c = d.construction,
    dwg = d.dwg!,
    L = DRAWING_BACKED_LIMITS,
    tiny = 1e-9;
  let drawn: Parts;
  try {
    drawn = drawingBackedDrawnMaterial(dwg);
  } catch (error) {
    return fail(String((error as Error).message));
  }
  // A closed outline is wall or column material only where it draws a declared native owner
  // (a casing round its column, a wall polygon round its wall), never an empty room or closet.
  const ownMaterial = bandRows.flatMap((l) =>
    l.sections
      .filter((x) => d.nativeOwnerIds.includes(x.nativeElementId))
      .flatMap((x) => x.partsFeet),
  ) as Parts;
  for (const { ring, label } of drawnOutlineRings(dwg)) {
    let encloses = false;
    for (const part of ownMaterial) {
      try {
        encloses = area(pc.intersection([[ring]], [part]) as Parts) > tiny;
      } catch {
        encloses = false;
      }
      if (encloses) break;
    }
    if (!encloses)
      fail(
        `cited drawn outline ${label} encloses no declared native owner material`,
      );
  }
  const floors =
    data.walkingSupport?.sourceModelSha256 === v.sourceModelSha256
      ? data.walkingSupport.floors
          .filter((f) => r.sourceFloorIds.includes(f.nativeElementId))
          .flatMap((f) => f.partsFeet ?? [f.ringsFeet])
      : [];
  const unsupported = r.partsFeet.flatMap((p) =>
    exactNativeDoorFloorDifference(p, floors),
  ) as Parts;
  // Only new material needs drawing evidence: the parts of the body already inside its declared
  // owners' native sections at a cut (the overlap into the wall and its target) are native.
  const uncoveredAt = (l?: NativeMaterialSections["levels"][number]) => {
    const own = l
      ? (l.sections
          .filter((x) => d.nativeOwnerIds.includes(x.nativeElementId))
          .flatMap((x) => x.partsFeet) as Parts)
      : [];
    return r.partsFeet.flatMap((p) =>
      exactNativeDoorFloorDifference(p, [...own, ...drawn]),
    ) as Parts;
  };
  const uncovered = (bandRows.length > 0 ? bandRows : [undefined])
    .map(uncoveredAt)
    .reduce((worst, u) => (area(u) > area(worst) ? u : worst));
  const outside = area(uncovered);
  if (outside > tiny) {
    // the uncovered part that is not over the bound floor (an opening, void or beyond the slab)
    const overVoid =
      unsupported.length > 0
        ? area(
            uncovered.flatMap((p) =>
              exactNativeDoorFloorDifference(p, floors),
            ) as Parts,
          )
        : 0;
    fail(
      overVoid > tiny
        ? `lies over a native floor opening, void or slab edge outside drawn DWG material (${overVoid.toFixed(4)} sq ft)`
        : `lies outside drawn DWG material (${outside.toFixed(4)} sq ft beyond the cited drawn bands/outlines)`,
    );
  }
  if (
    !(
      area(r.partsFeet) - (unsupported.length > 0 ? area(unsupported) : 0) >
      tiny
    )
  )
    fail(
      "does not stand on its bound native floor (wholly over an opening or beyond the slab)",
    );
  if (c.kind === "wall-end-extension") {
    const u = c.axisFeet,
      [a, b] = c.endFaceFeet,
      face = sub2(b, a),
      width = DMath.hypot(face[0], face[1]),
      eps = 1e-6;
    if (
      width > L.wallThicknessFeet ||
      Math.abs(dot2(face, u)) / width > L.wallFaceParallelSine
    )
      fail("extension axis is not normal to the wall's own end face");
    if (bandRows.length === 0)
      fail("extended wall has no native cut in the row band");
    const body = censusBounds(v, c.wallNativeElementId);
    if (
      body &&
      (r.baseElevationFeet < body.min[2] - eps ||
        r.topElevationFeet > body.max[2] + eps)
    )
      fail("extension band exceeds the extended wall's own height");
    for (const l of bandRows) {
      const own = l.sections
        .filter((s) => s.nativeElementId === c.wallNativeElementId)
        .flatMap((s) => s.partsFeet) as Parts;
      const edges = segments(own);
      const on = (p: P2) =>
        edges.some((e) => distance(p, ...e).distance <= eps);
      const side = (p: P2) =>
        edges.some(([x, y]) =>
          [
            [x, y],
            [y, x],
          ].some(([s0, s1]) => {
            const w = sub2(s1, s0),
              lw = DMath.hypot(w[0], w[1]);
            return (
              DMath.hypot(s0[0] - p[0], s0[1] - p[1]) <= eps &&
              lw > eps &&
              dot2(w, u) < 0 &&
              Math.abs(cross2(w, u)) / lw <= L.wallFaceParallelSine
            );
          }),
        );
      if (
        own.length === 0 ||
        !on(a) ||
        !on(b) ||
        !on([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
      )
        fail(
          `extension end face is not the extended wall's own end face at cut ${l.cutElevationFeet}`,
        );
      if (!side(a) || !side(b))
        fail(
          `extension does not run along the extended wall's own side faces at cut ${l.cutElevationFeet}`,
        );
    }
  }
  if (dwg.crossLevel) {
    const why = crossLevelMisalignment(
      data.nativeMaterialSections!,
      r,
      bandRows,
      dwg.crossLevel,
    );
    if (why) fail(why);
  }
  for (const e of dwg.entities)
    if (
      e.kind === "doorSegments" &&
      segmentLengthInside(e.segmentFeet, r.partsFeet) > 1e-6
    )
      fail(`crosses registered DWG door segment doorSegments#${e.index}`);
  for (const door of data.doors ?? []) {
    const e = data.edges?.find((x) => x.id === door.id);
    if (
      door.footprintFeet &&
      e?.kind === "door" &&
      e.pointsFeet.some(
        (p) => p[2] >= r.baseElevationFeet - 0.05 && p[2] <= r.topElevationFeet,
      ) &&
      area(pc.intersection(r.partsFeet, [door.footprintFeet]) as Parts) > tiny
    )
      fail(`crosses native door footprint ${door.nativeElementId}`);
  }
}
/** A cross-level drawing applies only where the floors stack: within 1.5 ft of the body, every
 * vertex of native material at each band cut lies within the tolerance of native material
 * boundaries at the source level's cut of the same height above its level, and vice versa. */
function crossLevelMisalignment(
  material: NativeMaterialSections,
  r: NativeProvisionalCornerSeals["rows"][number],
  bandRows: NativeMaterialSections["levels"],
  x: NonNullable<
    NonNullable<NativeDrawingBackedAssumption["dwg"]>["crossLevel"]
  >,
): string | undefined {
  const ps = r.partsFeet.flat(PARTS_VERTEX_DEPTH),
    w = 1.5,
    box = [
      Math.min(...ps.map((p) => p[0])) - w,
      Math.min(...ps.map((p) => p[1])) - w,
      Math.max(...ps.map((p) => p[0])) + w,
      Math.max(...ps.map((p) => p[1])) + w,
    ];
  const inBox = (p: P2) =>
    p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3];
  const local = (l: NativeMaterialSections["levels"][number]) => {
    const parts = l.sections.flatMap((s) => s.partsFeet) as Parts;
    return {
      vertices: parts.flat(PARTS_VERTEX_DEPTH).filter(inBox),
      edges: segments(parts).filter(([a, b]) => inBox(a) || inBox(b)),
    };
  };
  if (bandRows.length === 0)
    return "cross-level drawing has no native cut in the row band to align";
  for (const l of bandRows) {
    const offset = l.cutElevationFeet - l.elevationFeet;
    const source = material.levels.find(
      (m) =>
        m.levelId === x.sourceLevelId &&
        Math.abs(m.cutElevationFeet - m.elevationFeet - offset) <= 1e-6,
    );
    if (!source)
      return `cross-level source level ${x.sourceLevelId} has no cut ${offset.toFixed(2)} ft above its floor`;
    const a = local(l),
      b = local(source);
    const off = (vs: P2[], es: [P2, P2][]) =>
      vs.reduce(
        (worst, v) =>
          Math.max(
            worst,
            es.reduce(
              (d, e) => Math.min(d, distance(v, ...e).distance),
              Infinity,
            ),
          ),
        0,
      );
    const worst = Math.max(off(a.vertices, b.edges), off(b.vertices, a.edges));
    if (
      a.vertices.length === 0 ||
      b.vertices.length === 0 ||
      worst > x.alignmentToleranceFeet
    )
      return `cross-level drawing from level ${x.sourceLevelId} does not line up vertically here (native material differs by ${Number.isFinite(worst) ? worst.toFixed(3) : "all"} ft at cut ${offset.toFixed(2)} ft)`;
  }
  return undefined;
}
const censusBounds = (v: NativeProvisionalCornerSeals, id: number) =>
  v.foreignBodies.find((b) => b.nativeElementId === id)?.boundsFeet;
export async function verifyNativeProvisionalCornerSeals(data: Data) {
  createNativeProvisionalCornerSealIndex(data);
}
/** Closed outlines derived from raw DWG entities that the registered boundary reference does not
 * carry (circles, closed polylines, casings closed by a raw line), transformed by each section's
 * verified registration and tessellated deterministically. Separate, receipt-bound evidence: every
 * outline keeps its raw entity handle; the source drawing and ZIP are never edited. */
export type DwgDerivedOutlines = {
  format: "reviter-dwg-derived-outlines";
  version: 1;
  sourceDwgSha256: string;
  derivation: {
    rawExtract: { file: string; sha256: string }[];
    layers: string[];
    circleSegments: number;
    arcSegmentsPerQuarterTurn: number;
    maxOutlineWidthFeet: number;
    registrationToleranceFeet: number;
    math: "reviter-deterministic-math";
  };
  sections: {
    sectionId: string;
    levelId: number;
    /** sha256 of JSON.stringify([sourceDwgSha256, registered boundary section]). */
    boundarySectionSha256: string;
    registration: { re: number; im: number; t: [number, number] };
    registrationCheck: {
      matchedSegments: number;
      maxEndpointErrorFeet: number;
    };
    outlines: {
      handle: string;
      entityType: string;
      layer: string;
      closure: "circle" | "closed-polyline" | "closing-edge-on-raw-line";
      closingLineHandle?: string;
      ringFeet: P2[];
      firstSegment: number;
    }[];
    outlineSegments: [P2, P2][];
  }[];
  geometrySha256: string;
};
export const dwgDerivedOutlinesHash = (
  v: DwgDerivedOutlines | Omit<DwgDerivedOutlines, "geometrySha256">,
) =>
  nativeDerivedFrameHash(
    Object.fromEntries(
      Object.entries(v).filter(([k]) => k !== "geometrySha256"),
    ),
  );
/** Structure, receipts and internal consistency of derived DWG outlines. */
export function validateDwgDerivedOutlines(
  v: DwgDerivedOutlines,
  boundaryReference:
    | { sourceSha256: string; sections: { sectionId: string }[] }
    | undefined,
) {
  const bad =
    !v ||
    v.format !== "reviter-dwg-derived-outlines" ||
    v.version !== 1 ||
    !digest(v.sourceDwgSha256) ||
    !digest(v.geometrySha256) ||
    v.geometrySha256 !== dwgDerivedOutlinesHash(v) ||
    !v.derivation ||
    !Array.isArray(v.derivation.rawExtract) ||
    v.derivation.rawExtract.length === 0 ||
    v.derivation.rawExtract.some((f) => !f || !digest(f.sha256)) ||
    !(v.derivation.registrationToleranceFeet > 0) ||
    v.derivation.registrationToleranceFeet > 1e-6 ||
    !(v.derivation.maxOutlineWidthFeet > 0) ||
    v.derivation.maxOutlineWidthFeet >
      DRAWING_BACKED_LIMITS.drawnOutlineWidthFeet ||
    !Array.isArray(v.sections) ||
    (boundaryReference !== undefined &&
      v.sourceDwgSha256 !== boundaryReference.sourceSha256) ||
    v.sections.some(
      (s) =>
        !s ||
        !digest(s.boundarySectionSha256) ||
        (boundaryReference !== undefined &&
          !boundaryReference.sections.some(
            (b) =>
              b.sectionId === s.sectionId &&
              nativeDerivedFrameHash([boundaryReference.sourceSha256, b]) ===
                s.boundarySectionSha256,
          )) ||
        !(s.registrationCheck?.matchedSegments > 0) ||
        !(
          s.registrationCheck.maxEndpointErrorFeet <=
          v.derivation.registrationToleranceFeet
        ) ||
        !Array.isArray(s.outlines) ||
        !Array.isArray(s.outlineSegments) ||
        s.outlines.some(
          (o) =>
            !o ||
            typeof o.handle !== "string" ||
            !o.handle ||
            !["circle", "closed-polyline", "closing-edge-on-raw-line"].includes(
              o.closure,
            ) ||
            (o.closure === "closing-edge-on-raw-line") !==
              (typeof o.closingLineHandle === "string") ||
            !Array.isArray(o.ringFeet) ||
            o.ringFeet.length < 3 ||
            !o.ringFeet.every((p) => point(p)) ||
            o.ringFeet.some(
              (p, k) =>
                !same(s.outlineSegments[o.firstSegment + k], [
                  p,
                  o.ringFeet[(k + 1) % o.ringFeet.length],
                ]),
            ),
        ) ||
        s.outlineSegments.length !==
          s.outlines.reduce((n, o) => n + o.ringFeet.length, 0),
    );
  if (bad) throw new Error("Invalid derived DWG outline evidence.");
}
/** Compile-time binding of drawing-backed rows to the registered drawing they cite: the project's
 * boundary reference must be the same DWG (sourceDwgSha256), the cited section must hash to the
 * row's registrationSha256, and every cited segment must be that section's segment byte for byte.
 * Runtime consumers (no boundary reference) rely on the compiler having run this. */
export function verifyDrawingBackedDrawingEvidence(
  seals: NativeProvisionalCornerSeals | undefined,
  boundaryReference:
    | {
        sourceSha256: string;
        sections: {
          sectionId: string;
          levelId?: number;
          wallSegments: unknown[];
          doorSegments?: unknown[];
        }[];
      }
    | undefined,
  derivedOutlines?: DwgDerivedOutlines,
) {
  if (derivedOutlines !== undefined)
    validateDwgDerivedOutlines(derivedOutlines, boundaryReference);
  for (const r of seals?.rows ?? []) {
    const dwg = r.drawingBacked?.dwg;
    if (!dwg) continue;
    const section = boundaryReference?.sections.find(
      (s) => s.sectionId === dwg.sectionId,
    );
    if (
      !boundaryReference ||
      !section ||
      boundaryReference.sourceSha256 !== dwg.sourceDwgSha256 ||
      nativeDerivedFrameHash([boundaryReference.sourceSha256, section]) !==
        dwg.registrationSha256 ||
      dwg.entities.some(
        (e) =>
          e.kind !== "derivedOutlineSegments" &&
          !same(
            (e.kind === "wallSegments"
              ? section.wallSegments
              : e.kind === "doorSegments"
                ? (section.doorSegments ?? [])
                : [])[e.index],
            e.segmentFeet,
          ),
      )
    )
      throw new Error(
        `Drawing-backed assumption ${r.id} does not cite this project's registered drawing.`,
      );
    // dwg-drawn-material: the cited section is registered to the row's level unless an explicit
    // cross-level decision names its level; no registered DWG door segment of the cited section or
    // of any section registered to the row's level may cross the body.
    if (dwg.entities.some((e) => e.kind === "derivedOutlineSegments")) {
      const derived = derivedOutlines?.sections.find(
        (x) => x.sectionId === dwg.sectionId,
      );
      if (
        !derivedOutlines ||
        !derived ||
        derivedOutlines.sourceDwgSha256 !== boundaryReference.sourceSha256 ||
        derived.boundarySectionSha256 !== dwg.registrationSha256 ||
        nativeDerivedFrameHash([derivedOutlines.sourceDwgSha256, derived]) !==
          dwg.derivedOutlinesSha256 ||
        dwg.entities.some(
          (e) =>
            e.kind === "derivedOutlineSegments" &&
            !same(derived.outlineSegments[e.index], e.segmentFeet),
        )
      )
        throw new Error(
          `Drawing-backed assumption ${r.id} does not cite this project's derived DWG outlines.`,
        );
    }
    if (r.drawingBacked!.kind === "dwg-drawn-material") {
      const sourceLevel = dwg.crossLevel?.sourceLevelId ?? r.levelId;
      if (section.levelId !== undefined && section.levelId !== sourceLevel)
        throw new Error(
          `Drawing-backed assumption ${r.id}: cites section ${section.sectionId} registered to level ${section.levelId}${dwg.crossLevel ? ` (cross-level record names ${sourceLevel})` : " without a cross-level owner decision"}`,
        );
      const why = drawingBackedDrawnMaterialSolidity(
        dwg,
        section.wallSegments as [P2, P2][],
        r.partsFeet,
      );
      if (why) throw new Error(`Drawing-backed assumption ${r.id}: ${why}`);
    }
    if (r.drawingBacked!.kind === "dwg-drawn-material")
      for (const s of boundaryReference.sections)
        if (s === section || s.levelId === r.levelId)
          (s.doorSegments ?? []).forEach((g, i) => {
            if (segmentLengthInside(g as [P2, P2], r.partsFeet) > 1e-6)
              throw new Error(
                `Drawing-backed assumption ${r.id}: crosses registered DWG door segment ${s.sectionId} doorSegments#${i}`,
              );
          });
  }
}
