/** Pure obstruction mathematics for complete original placed planar bodies.
 * No source, floor, operational-door, arrival or route capability is issued. */
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import {
  Rational,
  rational,
  type NativeRationalParts as Parts,
  type NativeRationalPoint as P,
} from "./native-rational-overlay.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  walkRevit2027DirectedLoopEdges,
  revit2027DirectedEdgeUvs,
} from "./revit-2027-owner-mesh-trim.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import { inspectPlacedTrimObstacleBranches } from "./native-source-placed-trim-obstacles.ts";
import { inspectOriginalWallTrimObstacleBranches } from "./native-source-wall-trim-obstacles.ts";
import { exactClosedSourcePlanarContact } from "./native-source-planar-slab-envelope.ts";
import { validateOriginalNamedCapReference } from "./native-source-floor-local-support.ts";

type Q = Rational;
type P3 = [Q, Q, Q];
type Axis = 0 | 1 | 2;
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q) => new Rational(a.n * b.d, a.d * b.n);
const cmp = (a: Q, b: Q) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const key = (p: P) => p.map((q) => `${q.n}/${q.d}`).join(":");
const orient = (a: P, b: P, p: P) =>
  sub(
    mul(sub(b[0], a[0]), sub(p[1], a[1])),
    mul(sub(b[1], a[1]), sub(p[0], a[0])),
  ).n;
function hull(points: P[]) {
  const a = [...new Map(points.map((p) => [key(p), p])).values()].sort(
    (p, q) => cmp(p[0], q[0]) || cmp(p[1], q[1]),
  );
  const half = (v: P[]) => {
    const h: P[] = [];
    for (const p of v) {
      while (h.length > 1 && orient(h.at(-2)!, h.at(-1)!, p) <= 0n) h.pop();
      h.push(p);
    }
    return h;
  };
  return a.length < 3
    ? a
    : [...half(a).slice(0, -1), ...half([...a].reverse()).slice(0, -1)];
}
function winding(p: P, ring: P[]) {
  let w = 0;
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length]!;
    if (cmp(a[1], p[1]) <= 0) {
      if (cmp(b[1], p[1]) > 0 && orient(a, b, p) > 0n) w++;
    } else if (cmp(b[1], p[1]) <= 0 && orient(a, b, p) < 0n) w--;
  }
  return w;
}
const affine = (s: Revit2027PlaneSurface, uv: readonly number[]): P3 =>
  [0, 1, 2].map((i) =>
    add(
      add(
        rational(s.origin[i]!),
        mul(rational(s.xVector[i]!), rational(uv[0]!)),
      ),
      mul(rational(s.yVector[i]!), rational(uv[1]!)),
    ),
  ) as P3;
const q = (v: unknown): v is Q => v instanceof Rational && v.d > 0n;
const authority = {
  originalSourceAuthorityGranted: false as const,
  physicalBodyRepresentationAdmitted: false as const,
  operationalDoorRoleApproved: false as const,
  arrivalApproved: false as const,
  routeApproved: false as const,
};

/** A bounded body's orthogonal projection is covered by its complete boundary
 * projection: a ray parallel to the omitted coordinate exits through a face.
 * Thus a FULL projected connected volume avoiding every possible boundary face
 * proves body disjointness. No prism, convexity or operable-leaf assumption is
 * needed. The caller must still obtain original source membership separately.
 *
 * Each original face retains its trim winding, every raw/twin endpoint and all
 * adjacent joins. The entire demand must avoid their closed uncertainty before
 * zero winding can prove disjointness. Distant self-crossings remain unrepaired.
 * Projection-degenerate faces retain their closed segments. Initial support is
 * deliberately limited to the observed ordinary Geometry6/version0 branch and
 * one closed straight planar loop per Face4; holes/unknown branches refuse. */
function inspectCompleteComponent(
  replay: Revit2027GRepReplay,
  projectedDemand: Parts,
  axes: readonly [Axis, Axis],
) {
  const guarded = inspectOriginalWallTrimObstacleBranches(replay);
  if (
    !guarded.ok ||
    guarded.auxiliaryNullLoopFaceTokens.length ||
    guarded.finiteOpenReferenceEdgeTokens.length ||
    guarded.unlinkedGraphicEdgeTokens.length
  )
    throw Error("Incomplete original closed planar component");
  const geometry = replay.spans[0]!,
    g = geometry.value as {
      flags: number;
      tessEpsCntrl: { type: number; version: number };
      sharedSurfaceInfo: { count: number };
    };
  if (
    geometry.readerId !== "Revit2027Geometry" ||
    replay.spans.filter((s) => s.readerId === "Revit2027Geometry").length !==
      1 ||
    g.flags !== 6 ||
    g.tessEpsCntrl.type !== 0 ||
    g.tessEpsCntrl.version !== 0 ||
    g.sharedSurfaceInfo.count !== 0
  )
    throw Error("Unsupported original ordinary Geometry branch");
  const index = revit2027OwnerMeshIndex(replay),
    planes = new Map<number, Revit2027PlaneSurface>(),
    projected = (p: P3): P => [p[axes[0]], p[axes[1]]];
  for (const [token, face] of index.faces) {
    const s = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, token);
    if (
      face.faceFlags !== 4 ||
      face.cutType !== 0 ||
      face.faceRegions.count !== 0 ||
      !s ||
      s.kind !== "plane" ||
      s.surface.orientFlag !== true ||
      s.queuedProperties.length ||
      [
        ...s.origin,
        ...s.xVector,
        ...s.yVector,
        ...s.surface.envelope.firstCorner,
        ...s.surface.envelope.secondCorner,
      ].some((n) => !Number.isFinite(n))
    )
      throw Error("Unsupported original finite Face/Plane orientation");
    const x = s.xVector.map(rational),
      y = s.yVector.map(rational);
    if (
      [
        sub(mul(x[1]!, y[2]!), mul(x[2]!, y[1]!)),
        sub(mul(x[2]!, y[0]!), mul(x[0]!, y[2]!)),
        sub(mul(x[0]!, y[1]!), mul(x[1]!, y[0]!)),
      ].every((n) => n.n === 0n)
    )
      throw Error("Degenerate original plane basis");
    planes.set(token, s);
  }
  const faces = [],
    usedEdges = new Set<number>(),
    usedLoops = new Set<number>();
  for (const [token, face] of index.faces) {
    const loop = index.loops.get(face.firstLoop.token),
      plane = planes.get(token)!;
    if (
      !loop ||
      loop.loop.open ||
      loop.loop.nextLoop.token !== 0 ||
      usedLoops.has(loop.token)
    )
      throw Error("Unsupported original hole/open/repeated face loop");
    usedLoops.add(loop.token);
    const walked = walkRevit2027DirectedLoopEdges({
      faceToken: token,
      loop,
      edges: index.edges,
      loopArity: "open",
    });
    if (!walked.ok || walked.edges.length < 3)
      throw Error("Incomplete original directed face boundary");
    const ring: P[] = [],
      embeddings: { points: P[]; start: P[]; end: P[] }[] = [];
    for (const e of walked.edges) {
      if (
        e.edge.queuedPropertyCount !== 0 ||
        e.edge.interiorEdgePoints.length ||
        e.edge.faceReferences[0] === e.edge.faceReferences[1] ||
        e.edge.faceReferences.some((t) => !planes.has(t))
      )
        throw Error("Unknown/curved/foreign original boundary branch");
      usedEdges.add(e.token);
      const uv = revit2027DirectedEdgeUvs(e);
      if (uv.length !== 2 || uv.some((p) => p.some((v) => !Number.isFinite(v))))
        throw Error("Unsupported original finite straight coedge");
      const own = uv.map((p) => projected(affine(plane, p))),
        points = [...own],
        start = [own[0]!],
        end = [own[1]!];
      for (const p of own)
        if (!ring.length || key(ring.at(-1)!) !== key(p)) ring.push(p);
      for (const [j, endpoint] of e.edge.firstAndLastEdgePoints.entries())
        for (const [side, otherFace] of e.edge.faceReferences.entries()) {
          const uv = side === 0 ? endpoint.firstFaceUv : endpoint.secondFaceUv;
          if (uv.some((v) => !Number.isFinite(v)))
            throw Error("Nonfinite original twin embedding");
          const p = projected(affine(planes.get(otherFace)!, uv));
          points.push(p);
          ((j === 0) === (e.direction === 1) ? start : end).push(p);
        }
      embeddings.push({ points, start, end });
    }
    if (ring.length > 1 && key(ring[0]!) === key(ring.at(-1)!)) ring.pop();
    const parts: Parts = [],
      segments: P[][] = [];
    for (const [i, e] of embeddings.entries()) {
      const bound = hull([
        ...e.points,
        ...embeddings[(i + 1) % embeddings.length]!.start,
        ...embeddings[(i + embeddings.length - 1) % embeddings.length]!.end,
      ]);
      if (bound.length >= 3) parts.push([bound]);
      else if (bound.length) segments.push(bound);
      else throw Error("Unknown empty original boundary enclosure");
    }
    const contact = exactClosedSourcePlanarContact(
        projectedDemand,
        parts,
        segments,
      ),
      w = winding(projectedDemand[0]![0]![0]!, ring);
    faces.push({
      originalFaceToken: token,
      originalLoopToken: loop.token,
      originalEdgeTokens: walked.edges.map((e) => e.token),
      originalFinitePlaneEnvelope: plane.surface.envelope,
      originalProjectedReferenceRingFeet: ring,
      retainedTwinAndJoinBoundaryPartsFeet: parts,
      retainedZeroAreaClosedBoundarySegmentsFeet: segments,
      completeProjectedDemandBoundaryContact: contact,
      originalProjectedReferenceWinding: w,
      completeProjectedFaceDisjoint: !contact && w === 0,
    });
  }
  if (
    usedEdges.size !== index.edges.size ||
    usedLoops.size !== index.loops.size ||
    faces.length !== index.faces.size
  )
    throw Error("Projection omitted an original face/loop/edge");
  return {
    originalGeometryToken: geometry.propertyToken,
    completeOriginalFaceCount: faces.length,
    completeOriginalClosedEdgeCount: index.edges.size,
    completeOriginalLoopCount: usedLoops.size,
    faces,
    allOriginalProjectedBoundaryFacesDisjoint: faces.every(
      (f) => f.completeProjectedFaceDisjoint,
    ),
  };
}

export function inspectOriginalPlacedTrimProjectedVolume(
  occurrence: Revit2027GRepReplay,
  definition: Revit2027GRepReplay,
  demand: {
    footprintFeet: Parts;
    minimumElevationFeet: Q;
    maximumElevationFeet: Q;
  },
  projectionAxes: readonly [Axis, Axis] = [0, 2],
) {
  try {
    if (
      projectionAxes.length !== 2 ||
      projectionAxes[0] === projectionAxes[1] ||
      projectionAxes.some((n) => ![0, 1, 2].includes(n))
    )
      throw Error("Invalid original body projection axes");
    if (
      demand.footprintFeet.length !== 1 ||
      demand.footprintFeet[0]!.length !== 1 ||
      demand.footprintFeet[0]![0]!.length > 10000 ||
      demand.footprintFeet.flat(2).some((p) => p.length !== 2 || !p.every(q)) ||
      !q(demand.minimumElevationFeet) ||
      !q(demand.maximumElevationFeet) ||
      cmp(demand.minimumElevationFeet, demand.maximumElevationFeet) >= 0
    )
      throw Error(
        "Requires a complete connected finite footprint and positive closed Z band",
      );
    validateOriginalNamedCapReference(demand.footprintFeet);
    const guarded = inspectPlacedTrimObstacleBranches(occurrence, definition);
    if (!guarded.ok) throw Error(guarded.blockers.join("; "));
    const bindings = collectRevit2027GInstanceBindings(occurrence);
    if (
      !bindings.ok ||
      bindings.value.length !== 1 ||
      bindings.value[0]!.kind !== "external"
    )
      throw Error("Incomplete original placed source binding");
    const t = bindings.value[0]!.instance.transform,
      x = t.xAxis.map(rational),
      y = t.yAxis.map(rational),
      z = t.zAxis.map(rational),
      o = t.origin.map(rational),
      det = sub(mul(x[0]!, y[1]!), mul(x[1]!, y[0]!));
    if (!det.n || x[2]!.n || y[2]!.n || z[0]!.n || z[1]!.n || z[2]!.n <= 0n)
      throw Error("Unsupported original source affine");
    const inverse = (p: P3): P3 => {
      const px = sub(p[0], o[0]!),
        py = sub(p[1], o[1]!);
      return [
        div(sub(mul(px, y[1]!), mul(py, y[0]!)), det),
        div(sub(mul(x[0]!, py), mul(x[1]!, px)), det),
        div(sub(p[2], o[2]!), z[2]!),
      ];
    };
    const fullWorldCorners = demand.footprintFeet.flat(2).flatMap(
        ([x, y]) =>
          [
            [x, y, demand.minimumElevationFeet],
            [x, y, demand.maximumElevationFeet],
          ] as P3[],
      ),
      sourceLocalCorners = fullWorldCorners.map(inverse),
      projected = hull(
        sourceLocalCorners.map((p): P => [
          p[projectionAxes[0]],
          p[projectionAxes[1]],
        ]),
      );
    if (projected.length < 3) throw Error("Degenerate projected full volume");
    const projectedDemand: Parts = [[projected]],
      components = [];
    for (const component of guarded.components) {
      const geometry = definition.spans.find(
        (s) =>
          s.readerId === "Revit2027Geometry" &&
          s.propertyToken === component.originalGeometryToken,
      );
      if (!geometry) throw Error("Original component source owner absent");
      const owned = new Set([geometry.replayIndex]);
      for (const s of definition.spans)
        if (s.parentReplayIndex !== null && owned.has(s.parentReplayIndex))
          owned.add(s.replayIndex);
      const branch = definition.spans.filter((s) => owned.has(s.replayIndex)),
        positions = new Map(branch.map((s, i) => [s.replayIndex, i]));
      const result = inspectCompleteComponent(
        {
          ...definition,
          spans: branch.map((s, i) => ({
            ...s,
            replayIndex: i,
            parentReplayIndex:
              s.parentReplayIndex === null
                ? null
                : (positions.get(s.parentReplayIndex) ?? null),
          })),
        },
        projectedDemand,
        projectionAxes,
      );
      if (
        result.completeOriginalFaceCount !==
          component.physicalFaceTokens.length ||
        result.faces.some(
          (f) => !component.physicalFaceTokens.includes(f.originalFaceToken),
        )
      )
        throw Error(
          "Original component projection changed its physical face census",
        );
      components.push(result);
    }
    return {
      ok: true as const,
      nativeElementId: guarded.nativeElementId,
      nativeDefinitionId: guarded.nativeDefinitionId,
      originalFullWorldFootprintFeet: demand.footprintFeet,
      originalClosedWorldElevationBandFeet: [
        demand.minimumElevationFeet,
        demand.maximumElevationFeet,
      ] as [Q, Q],
      allFull3DWorldCornersFeet: fullWorldCorners,
      allInverseSourceLocalCornersFeet: sourceLocalCorners,
      sourceLocalProjectionAxes: projectionAxes,
      completeSourceLocalProjectedDemandFeet: projectedDemand,
      originalFreeGraphicsTokens: guarded.originalFreeGraphicsTokens,
      originalHatchTokens: guarded.originalHatchTokens,
      retainedOriginalFalseFilterCount: guarded.sourceFalseFilters,
      allOriginalPhysicalComponentsRetained:
        components.length === guarded.components.length,
      components,
      completeStatedFullVolumeDisjoint: components.every(
        (c) => c.allOriginalProjectedBoundaryFacesDisjoint,
      ),
      sourceCoordinatesChanged: false as const,
      sourceFlagsOrInstanceMetadataRewritten: false as const,
      originalMaterialOmitted: false as const,
      ...authority,
    };
  } catch (e) {
    return {
      ok: false as const,
      blockers: [e instanceof Error ? e.message : String(e)],
      ...authority,
    };
  }
}
