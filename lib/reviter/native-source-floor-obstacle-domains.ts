import { originalTwoFootStandingSquare } from "./native-source-standing-footprint.ts";
/** Unwired conservative FLOOR OBSTRUCTION domains. No planar/chord domain
 * becomes positive floor support; real holes and source bytes are untouched. */
import {
  Rational,
  rational,
  type NativeRationalPoint,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import {
  readOriginalForeignEnvelopeScopedFloor,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "./revit-2027-grep-replay.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import type {
  Revit2027PlaneSurface,
  Revit2027CylinderSurface,
} from "./revit-2027-surfaces.ts";
import {
  exactClosedSourcePlanarContact,
  type OriginalPlanarMaterialCell,
} from "./native-source-planar-slab-envelope.ts";
import {
  projectStatedTwoFootWalkingVolume,
  type SourceWalkingPoint3,
} from "./native-source-walking-volume.ts";
type Q = Rational;
type P3 = [Q, Q, Q];
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
  mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d),
  sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
  cmp = (a: Q, b: Q) =>
    a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0,
  abs = (a: Q) => new Rational(a.n < 0n ? -a.n : a.n, a.d);
const min = (a: Q[]) => a.reduce((x, y) => (cmp(x, y) < 0 ? x : y)),
  max = (a: Q[]) => a.reduce((x, y) => (cmp(x, y) > 0 ? x : y));
const planePoint = (s: Revit2027PlaneSurface, uv: readonly number[]): P3 =>
  [0, 1, 2].map((i) =>
    add(
      add(
        rational(s.origin[i]!),
        mul(rational(s.xVector[i]!), rational(uv[0]!)),
      ),
      mul(rational(s.yVector[i]!), rational(uv[1]!)),
    ),
  ) as P3;
const box = (xs: Q[], ys: Q[]) => {
  const a = min(xs),
    b = max(xs),
    c = min(ys),
    d = max(ys);
  return cmp(a, b) < 0 && cmp(c, d) < 0
    ? {
        parts: [
          [
            [
              [a, c],
              [b, c],
              [b, d],
              [a, d],
            ],
          ],
        ] as NativeRationalParts,
        segments: [] as NativeRationalPoint[][],
      }
    : {
        parts: [] as NativeRationalParts,
        segments: [
          [
            [a, c],
            [b, d],
          ],
        ] as NativeRationalPoint[][],
      };
};
type Cell = OriginalPlanarMaterialCell & {
  sourceKind:
    | "plane-domain"
    | "full-vertical-cylinder-domain"
    | "cap-bounded-outer-volume";
};
/** Mathematical complete source-domain enclosure only. Both trimmed and
 * auxiliary finite planes remain enclosed, and every cylinder uses a full
 * original circle XY enclosure plus its complete original vertical parameter
 * domain. No trigonometric approximation or saved polyline is an exact arc.
 * Original control points are excluded only after complete source ownership
 * proves each is a free GGTag child with no physical/profile consumer. */
export function inspectOriginalFloorObstacleDomains(
  replay: Revit2027GRepReplay,
) {
  const cells: Cell[] = [],
    blockers: string[] = [];
  let pointControls = 0,
    referencePlanes = 0,
    curvedFaces = 0;
  try {
    const allowed = new Set([
      "Revit2027Geometry",
      "Revit2027Face",
      "Revit2027GEdge",
      "Revit2027EdgeLoop",
      "Revit2027AnalyticSurface:634",
      "Revit2027AnalyticSurface:1144",
      "Revit2027GFilling",
      "Revit2027GGTag",
      "Revit2027GPoint",
    ]);
    if (
      !replay.spans.length ||
      replay.spans.some(
        (s, i) =>
          !allowed.has(s.readerId) ||
          s.ownerElementId !== replay.ownerElementId ||
          s.replayIndex !== i,
      )
    )
      throw Error("Unsupported original floor source branch/owner");
    const index = revit2027OwnerMeshIndex(replay),
      geometries = replay.spans.filter(
        (s) => s.readerId === "Revit2027Geometry",
      );
    if (geometries.length !== 1)
      throw Error("Original floor has multiple body branches");
    const g = geometries[0]!.value as {
        flags: number;
        faces: {
          count: number;
          entries: { token: number; sourceClassSlot: number }[];
        };
        edges: {
          count: number;
          entries: { token: number; sourceClassSlot: number }[];
        };
        sharedSurfaceInfo: { count: number };
      },
      declared = (
        field: typeof g.faces,
        actual: ReadonlyMap<number, unknown>,
        slot: number,
      ) =>
        field.count === actual.size &&
        field.count === field.entries.length &&
        new Set(field.entries.map((e) => e.token)).size === actual.size &&
        field.entries.every(
          (e) => e.sourceClassSlot === slot && actual.has(e.token),
        );
    if (
      g.flags !== 7 ||
      g.sharedSurfaceInfo.count !== 0 ||
      !declared(g.faces, index.faces, 1825) ||
      !declared(g.edges, index.edges, 1423)
    )
      throw Error("Original floor Geometry omits an operand");
    const accounted = new Set<number>([geometries[0]!.replayIndex]),
      surfaces = new Map<
        number,
        Revit2027PlaneSurface | Revit2027CylinderSurface
      >(),
      uvs = new Map<number, number[][]>(),
      usedLoops = new Set<number>(),
      fills = new Set<number>();
    for (const s of replay.spans)
      if (s.readerId === "Revit2027GGTag") {
        const v = s.value as {
          group: { children: { token: number; sourceClassSlot: number }[] };
          modelTestPoint: number[];
          useModelTestPoint: boolean;
          selectByModelTestPoint: boolean;
        };
        if (
          s.parentReplayIndex !== null ||
          v.useModelTestPoint ||
          v.selectByModelTestPoint ||
          v.modelTestPoint.some((n) => !Number.isFinite(n)) ||
          v.group.children.length !== 1 ||
          v.group.children[0]!.sourceClassSlot !== 2271
        )
          throw Error("Unsupported original floor control group");
        const child = replay.spans.filter(
          (p) => p.parentReplayIndex === s.replayIndex,
        );
        if (
          child.length !== 1 ||
          child[0]!.readerId !== "Revit2027GPoint" ||
          child[0]!.propertyToken !== v.group.children[0]!.token
        )
          throw Error("Original control hides physical children");
        const p = child[0]!,
          consumers = replay.descriptors.filter(
            (d) => d.token === p.propertyToken,
          ),
          pv = p.value as {
            coordinate: number[];
            size: number;
            borderSize: number;
          };
        if (
          consumers.length !== 1 ||
          consumers[0]!.state === "reused" ||
          consumers[0]!.parentReplayIndex !== s.replayIndex ||
          pv.coordinate.some((n) => !Number.isFinite(n)) ||
          !Number.isInteger(pv.size) ||
          !Number.isInteger(pv.borderSize) ||
          pv.size < 0 ||
          pv.borderSize < 0
        )
          throw Error(
            "Original floor point has body/profile/unknown consumers",
          );
        accounted.add(s.replayIndex);
        accounted.add(p.replayIndex);
        pointControls++;
      }
    for (const [token, face] of index.faces) {
      if (
        face.faceFlags === null ||
        ![4, 6, 516].includes(face.faceFlags) ||
        face.cutType !== 0 ||
        face.faceRegions.count !== 0
      )
        throw Error("Unsupported original floor face/cut semantics");
      if (
        face.surface.sourceClassSlot !== 634 &&
        face.surface.sourceClassSlot !== 1144
      )
        throw Error("Unsupported original floor surface class");
      const surface = revit2027OwnerSurface<
        Revit2027PlaneSurface | Revit2027CylinderSurface
      >(index, face.surface.sourceClassSlot, token);
      if (!surface) throw Error("Original floor face surface missing");
      surfaces.set(token, surface);
      const values = [
        surface.surface.envelope.firstCorner[0],
        surface.surface.envelope.secondCorner[0],
      ].flatMap((u) =>
        [
          surface.surface.envelope.firstCorner[1],
          surface.surface.envelope.secondCorner[1],
        ].map((v) => [u, v]),
      );
      if (values.flat().some((n) => !Number.isFinite(n)))
        throw Error("Nonfinite original floor parameter domain");
      uvs.set(token, values);
      const span = replay.spans.find(
          (s) => s.readerId === "Revit2027Face" && s.propertyToken === token,
        )!,
        surfaceSpans = replay.spans.filter(
          (s) =>
            s.parentReplayIndex === span.replayIndex &&
            (s.readerId === "Revit2027AnalyticSurface:634" ||
              s.readerId === "Revit2027AnalyticSurface:1144"),
        );
      if (surfaceSpans.length !== 1)
        throw Error("Original face has duplicate/unowned analytic surface");
      accounted.add(span.replayIndex);
      accounted.add(surfaceSpans[0]!.replayIndex);
      let loopToken = face.firstLoop.token;
      if (!loopToken) {
        if (face.faceFlags !== 516)
          throw Error("Unsupported nonreference null-loop source face");
        referencePlanes++;
      }
      while (loopToken) {
        if (usedLoops.has(loopToken))
          throw Error("Original floor loop reused/cyclic");
        const loop = index.loops.get(loopToken);
        if (!loop) throw Error("Original floor loop missing");
        usedLoops.add(loopToken);
        const ls = replay.spans.find(
          (s) =>
            s.readerId === "Revit2027EdgeLoop" && s.propertyToken === loopToken,
        )!;
        accounted.add(ls.replayIndex);
        loopToken = loop.loop.nextLoop.token;
      }
      for (const pointer of [face.foregroundFilling, face.backgroundFilling])
        if (pointer.token) {
          const fill = replay.spans.find(
              (s) =>
                s.readerId === "Revit2027GFilling" &&
                s.propertyToken === pointer.token,
            ),
            v = fill?.value as
              | {
                  faceIdReference: number;
                  data: { token: number };
                  queuedProperties: unknown[];
                }
              | undefined;
          if (
            !fill ||
            fill.parentReplayIndex !== span.replayIndex ||
            fills.has(pointer.token) ||
            v?.faceIdReference !== token ||
            v.data.token !== 0 ||
            v.queuedProperties.length
          )
            throw Error("Unknown original floor hatch material/body child");
          fills.add(pointer.token);
          accounted.add(fill.replayIndex);
        }
    }
    if (usedLoops.size !== index.loops.size)
      throw Error("Original floor has unowned loops");
    for (const [token, edge] of index.edges) {
      if (
        edge.faceReferences.every((t) => t === 0) ||
        edge.faceReferences.some((t) => t !== 0 && !surfaces.has(t))
      )
        throw Error("Original floor edge references unknown material face");
      for (const [side, face] of edge.faceReferences.entries())
        if (face)
          for (const sample of [
            ...edge.firstAndLastEdgePoints,
            ...edge.interiorEdgePoints,
          ]) {
            const uv = side === 0 ? sample.firstFaceUv : sample.secondFaceUv;
            if (!uv.every(Number.isFinite))
              throw Error("Nonfinite original floor edge parameter");
            uvs.get(face)!.push([...uv]);
          }
      accounted.add(
        replay.spans.find(
          (s) => s.readerId === "Revit2027GEdge" && s.propertyToken === token,
        )!.replayIndex,
      );
    }
    const trimmedCaps: P3[][] = [];
    for (const [token, s] of surfaces) {
      let xs: Q[] = [],
        ys: Q[] = [],
        zs: Q[] = [];
      const uv = uvs.get(token)!;
      if (s.kind === "plane") {
        if (
          [...s.origin, ...s.xVector, ...s.yVector].some(
            (n) => !Number.isFinite(n),
          )
        )
          throw Error("Nonfinite original floor plane");
        const cross = [
          sub(
            mul(rational(s.xVector[1]), rational(s.yVector[2])),
            mul(rational(s.xVector[2]), rational(s.yVector[1])),
          ),
          sub(
            mul(rational(s.xVector[2]), rational(s.yVector[0])),
            mul(rational(s.xVector[0]), rational(s.yVector[2])),
          ),
          sub(
            mul(rational(s.xVector[0]), rational(s.yVector[1])),
            mul(rational(s.xVector[1]), rational(s.yVector[0])),
          ),
        ];
        if (cross.every((q) => q.n === 0n))
          throw Error("Degenerate original floor plane basis");
        const points = uv.map((p) => planePoint(s, p));
        xs = points.map((p) => p[0]);
        ys = points.map((p) => p[1]);
        zs = points.map((p) => p[2]);
        if (
          s.xVector[2] === 0 &&
          s.yVector[2] === 0 &&
          index.faces.get(token)!.firstLoop.token
        )
          trimmedCaps.push(points);
      } else if (s.kind === "cylinder") {
        if (
          [
            ...s.center,
            ...s.xVector,
            ...s.yVector,
            ...s.zVector,
            s.radius,
          ].some((n) => !Number.isFinite(n)) ||
          s.radius <= 0 ||
          s.xVector[2] !== 0 ||
          s.yVector[2] !== 0 ||
          s.zVector[0] !== 0 ||
          s.zVector[1] !== 0 ||
          s.zVector[2] === 0
        )
          throw Error("Unsupported original floor cylinder basis");
        const det = sub(
          mul(rational(s.xVector[0]), rational(s.yVector[1])),
          mul(rational(s.xVector[1]), rational(s.yVector[0])),
        );
        if (det.n === 0n)
          throw Error("Degenerate original cylinder radial basis");
        const rx = mul(
            rational(s.radius),
            add(abs(rational(s.xVector[0])), abs(rational(s.yVector[0]))),
          ),
          ry = mul(
            rational(s.radius),
            add(abs(rational(s.xVector[1])), abs(rational(s.yVector[1]))),
          );
        xs = [sub(rational(s.center[0]), rx), add(rational(s.center[0]), rx)];
        ys = [sub(rational(s.center[1]), ry), add(rational(s.center[1]), ry)];
        zs = uv.map((p) =>
          add(
            rational(s.center[2]),
            mul(rational(s.zVector[2]), rational(p[1]!)),
          ),
        );
        curvedFaces++;
      } else throw Error("Unknown original floor analytic surface");
      const bounds = box(xs, ys);
      cells.push({
        role: "original-boundary-domain",
        sourceKind:
          s.kind === "plane" ? "plane-domain" : "full-vertical-cylinder-domain",
        originalFaceTokens: [token],
        partsFeet: bounds.parts,
        closedSegmentsFeet: bounds.segments,
        minimumElevationFeet: min(zs),
        maximumElevationFeet: max(zs),
      });
    }
    if (accounted.size !== replay.spans.length)
      throw Error("Unconsumed original floor graphics/material branch");
    if (trimmedCaps.length !== 2)
      throw Error("Original floor lacks two trimmed horizontal cap planes");
    const capPoints = trimmedCaps.flat(),
      // A conservative core may fill holes but must also enclose every
      // curved/planar boundary projection. These domains are obstruction
      // supersets only; this box cannot create floor or remove a real cut.
      boundaryPoints = cells.flatMap((c) => [
        ...c.partsFeet.flat(2),
        ...c.closedSegmentsFeet.flat(),
      ]),
      bounds = box(
        boundaryPoints.map((p) => p[0]),
        boundaryPoints.map((p) => p[1]),
      );
    if (
      cmp(min(capPoints.map((p) => p[2])), max(capPoints.map((p) => p[2]))) >= 0
    )
      throw Error("Original trimmed caps have no positive height band");
    cells.push({
      role: "cap-bounded-core",
      sourceKind: "cap-bounded-outer-volume",
      originalFaceTokens: [...surfaces]
        .filter(
          ([token, s]) =>
            s.kind === "plane" &&
            s.xVector[2] === 0 &&
            s.yVector[2] === 0 &&
            index.faces.get(token)!.firstLoop.token,
        )
        .map(([token]) => token),
      partsFeet: bounds.parts,
      closedSegmentsFeet: bounds.segments,
      minimumElevationFeet: min(capPoints.map((p) => p[2])),
      maximumElevationFeet: max(capPoints.map((p) => p[2])),
    });
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  return {
    cells,
    blockers,
    originalFaces: cells.filter(
      (c) => c.sourceKind !== "cap-bounded-outer-volume",
    ).length,
    pointControls,
    referencePlanes,
    curvedFaces,
    completeOriginalSourceDomainEnclosure: blockers.length === 0,
    positiveFloorSupportApproved: false as const,
    exactClosedPhysicalBodyApproved: false as const,
    routeApproved: false as const,
  };
}

const brand: unique symbol = Symbol("OriginalNativeFloorObstacleDomains");
export type OriginalNativeFloorObstacleDomains = {
  readonly [brand]: true;
  readonly sourceModelSha256: string;
  readonly nativeFloorElementId: number;
};
const stored = new WeakMap<OriginalNativeFloorObstacleDomains, Cell[]>();
const sourceMetadata = new WeakMap<
  OriginalNativeFloorObstacleDomains,
  {
    sourceSchemaSha256: string;
    originalFloorFrameSha256: string;
    originalGElementFrameSha256: string;
    originalFaces: number;
    curvedFaces: number;
    referencePlanes: number;
    pointControls: number;
  }
>();
export function certifyOriginalNativeFloorObstacleDomains(
  context: OriginalNativeForeignEnvelopeCensus,
  nativeFloorElementId: number,
) {
  const source = readOriginalForeignEnvelopeScopedFloor(
      context,
      nativeFloorElementId,
    ),
    raw = source.originalGElementFrameBytes,
    view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength),
    root = decodeRevit2027FramedGRepRoot(
      raw,
      {
        offset: 0,
        elementId: nativeFloorElementId,
        marker: 2246,
        objectLength: raw.length - 20,
        typeCode: view.getUint32(18, true),
      },
      2027,
    );
  if (
    !root.ok ||
    root.value.flags !== 0 ||
    root.value.objectType !== 3 ||
    !root.value.worldExtents.valid ||
    JSON.stringify(root.value.worldExtents) !==
      JSON.stringify(root.value.localExtents)
  )
    throw Error("Unsupported original placed Floor GElement");
  const replay = replayRevit2027GRepFifo(raw, root.value, undefined, {
    maxReplayEntries: 100000,
    maxDescriptors: 400000,
  });
  if (!replay.ok) throw Error(replay.error);
  const result = inspectOriginalFloorObstacleDomains(replay.value);
  if (!result.completeOriginalSourceDomainEnclosure)
    return { ok: false as const, blockers: result.blockers };
  const certificate = Object.freeze({
    [brand]: true as const,
    sourceModelSha256: source.sourceModelSha256,
    nativeFloorElementId,
  });
  stored.set(certificate, result.cells);
  sourceMetadata.set(certificate, {
    sourceSchemaSha256: source.sourceSchemaSha256,
    originalFloorFrameSha256: source.originalFloorFrameSha256,
    originalGElementFrameSha256: source.originalGElementFrameSha256,
    originalFaces: result.originalFaces,
    curvedFaces: result.curvedFaces,
    referencePlanes: result.referencePlanes,
    pointControls: result.pointControls,
  });
  return {
    ok: true as const,
    certificate,
    summary: {
      sourceModelSha256: source.sourceModelSha256,
      sourceSchemaSha256: source.sourceSchemaSha256,
      nativeFloorElementId,
      originalFloorFrameSha256: source.originalFloorFrameSha256,
      originalGElementFrameSha256: source.originalGElementFrameSha256,
      originalFaces: result.originalFaces,
      curvedFaces: result.curvedFaces,
      referencePlanes: result.referencePlanes,
      pointControls: result.pointControls,
      originalMaterialCells: result.cells.length,
      completeOriginalSourceDomainEnclosure: true as const,
      positiveFloorSupportApproved: false as const,
      routeApproved: false as const,
    },
  };
}
export function auditOriginalFloorDomainsVertical(
  certificate: OriginalNativeFloorObstacleDomains,
  lateralEndpointsFeet: NativeRationalPoint[],
  lowerFootFeet: Q,
  upperFootFeet: Q,
  headroomFeet: number,
) {
  const cells = stored.get(certificate);
  if (!cells) throw Error("Untrusted original Floor domain certificate");
  if (
    !Number.isFinite(headroomFeet) ||
    headroomFeet <= 0 ||
    headroomFeet > 30 ||
    cmp(lowerFootFeet, upperFootFeet) > 0 ||
    !lateralEndpointsFeet.length
  )
    throw Error("Invalid vertical Floor domain demand");
  const high = add(upperFootFeet, rational(headroomFeet)),
    contacts = cells
      .filter(
        (c) =>
          cmp(c.maximumElevationFeet, lowerFootFeet) > 0 &&
          cmp(c.minimumElevationFeet, high) <= 0 &&
          exactClosedSourcePlanarContact(
            [],
            c.partsFeet,
            c.closedSegmentsFeet,
            [lateralEndpointsFeet],
          ),
      )
      .map((c) => ({
        sourceKind: c.sourceKind,
        originalFaceTokens: c.originalFaceTokens,
      }));
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    nativeFloorElementId: certificate.nativeFloorElementId,
    contacts,
    sourceCellsChecked: cells.length,
    positiveFloorSupportApproved: false as const,
    routeApproved: false as const,
  };
}
export function auditOriginalFloorDomainsHorizontal(
  certificate: OriginalNativeFloorObstacleDomains,
  start: SourceWalkingPoint3,
  end: SourceWalkingPoint3,
  headroomFeet: number,
) {
  const cells = stored.get(certificate);
  if (!cells) throw Error("Untrusted original Floor domain certificate");
  const low =
      cmp(rational(start[2]), rational(end[2])) < 0
        ? rational(start[2])
        : rational(end[2]),
    contacts = cells
      .filter((c) => {
        if (cmp(c.maximumElevationFeet, low) <= 0) return false;
        const demand = projectStatedTwoFootWalkingVolume(
            start,
            end,
            c.minimumElevationFeet,
            c.maximumElevationFeet,
            headroomFeet,
          ),
          ring = demand.possibleClosedProjectionFeet;
        return demand.positiveProjectionArea
          ? exactClosedSourcePlanarContact(
              [[ring]],
              c.partsFeet,
              c.closedSegmentsFeet,
            )
          : ring.length > 0 &&
              exactClosedSourcePlanarContact(
                [],
                c.partsFeet,
                c.closedSegmentsFeet,
                [ring],
              );
      })
      .map((c) => ({
        sourceKind: c.sourceKind,
        originalFaceTokens: c.originalFaceTokens,
      }));
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    nativeFloorElementId: certificate.nativeFloorElementId,
    contacts,
    sourceCellsChecked: cells.length,
    positiveFloorSupportApproved: false as const,
    routeApproved: false as const,
  };
}

export function auditOriginalFloorDomainsStandingSquare(
  certificate: OriginalNativeFloorObstacleDomains,
  center: NativeRationalPoint,
  footHeightFeet: Q,
  headroomFeet: number,
) {
  const cells = stored.get(certificate);
  if (!cells) throw Error("Untrusted original Floor domain certificate");
  if (
    !(footHeightFeet instanceof Rational) ||
    !Number.isFinite(headroomFeet) ||
    headroomFeet <= 0 ||
    headroomFeet > 30
  )
    throw Error("Invalid original standing demand");
  const footprint = originalTwoFootStandingSquare(center),
    high = add(footHeightFeet, rational(headroomFeet)),
    contacts = cells
      .filter(
        (c) =>
          cmp(c.maximumElevationFeet, footHeightFeet) > 0 &&
          cmp(c.minimumElevationFeet, high) <= 0 &&
          exactClosedSourcePlanarContact(
            footprint,
            c.partsFeet,
            c.closedSegmentsFeet,
          ),
      )
      .map((c) => ({
        sourceKind: c.sourceKind,
        originalFaceTokens: c.originalFaceTokens,
      }));
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    nativeFloorElementId: certificate.nativeFloorElementId,
    contacts,
    sourceCellsChecked: cells.length,
    completeStatedStandingFootprintChecked: true as const,
    positiveFloorSupportApproved: false as const,
    routeApproved: false as const,
  };
}

export function originalNativeFloorObstacleDomainFacts(
  certificate: OriginalNativeFloorObstacleDomains,
) {
  const cells = stored.get(certificate),
    source = sourceMetadata.get(certificate);
  if (!cells || !source)
    throw Error("Untrusted original Floor domain certificate");
  const q = (a: Q) => new Rational(a.n, a.d);
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    nativeFloorElementId: certificate.nativeFloorElementId,
    ...source,
    cells: cells.map((c) => ({
      ...c,
      originalFaceTokens: [...c.originalFaceTokens],
      partsFeet: c.partsFeet.map((p) =>
        p.map((r) => r.map(([x, y]) => [q(x), q(y)] as NativeRationalPoint)),
      ),
      closedSegmentsFeet: c.closedSegmentsFeet.map((r) =>
        r.map(([x, y]) => [q(x), q(y)] as NativeRationalPoint),
      ),
      minimumElevationFeet: q(c.minimumElevationFeet),
      maximumElevationFeet: q(c.maximumElevationFeet),
    })),
    completeOriginalSourceDomainEnclosure: true as const,
    positiveFloorSupportApproved: false as const,
    routeApproved: false as const,
  };
}
