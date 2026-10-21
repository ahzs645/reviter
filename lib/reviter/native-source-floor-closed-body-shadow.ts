/** UNUSED pure boundary-family mathematics. A positive result is conditional
 * on independent qualification of the original placed CLOSED material body.
 * This module supplies no source capability, floor support or route approval. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  walkRevit2027DirectedLoopEdges,
  revit2027DirectedEdgeUvs,
  type Revit2027DirectedEdge,
} from "./revit-2027-owner-mesh-trim.ts";
import type {
  Revit2027PlaneSurface,
  Revit2027CylinderSurface,
} from "./revit-2027-surfaces.ts";
import {
  Rational,
  rational,
  type NativeRationalParts,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
import {
  originalCylinderTrigEnclosure,
  validateOriginalNamedCapReference,
} from "./native-source-floor-local-support.ts";
import { inspectOriginalCylinderDomainEnclosure } from "./native-source-cylinder-domain-enclosure.ts";
import { exactClosedSourcePlanarContact } from "./native-source-planar-slab-envelope.ts";

type Q = Rational;
type P = NativeRationalPoint;
type P3 = [Q, Q, Q];
type Surface = Revit2027PlaneSurface | Revit2027CylinderSurface;
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
  sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
  mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d),
  cmp = (a: Q, b: Q) =>
    a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const min = (q: Q[]) => q.reduce((a, b) => (cmp(a, b) < 0 ? a : b)),
  max = (q: Q[]) => q.reduce((a, b) => (cmp(a, b) > 0 ? a : b)),
  key = (p: P) => p.map((q) => `${q.n}/${q.d}`).join(":"),
  xy = (p: P3): P => [p[0], p[1]];
function hull(points: P[]): P[] {
  const a = [...new Map(points.map((p) => [key(p), p])).values()].sort(
      (a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]),
    ),
    cross = (a: P, b: P, c: P) =>
      sub(
        mul(sub(b[0], a[0]), sub(c[1], a[1])),
        mul(sub(b[1], a[1]), sub(c[0], a[0])),
      ),
    half = (values: P[]) => {
      const r: P[] = [];
      for (const p of values) {
        while (r.length > 1 && cross(r.at(-2)!, r.at(-1)!, p).n <= 0n) r.pop();
        r.push(p);
      }
      return r;
    };
  return a.length < 3
    ? a
    : [...half(a).slice(0, -1), ...half(a.toReversed()).slice(0, -1)];
}
type ShadowCell = {
  kind: string;
  originalFaceTokens: number[];
  originalEdgeToken?: number;
  partsFeet: NativeRationalParts;
  closedSegmentsFeet: P[][];
};
function cell(
  kind: string,
  faces: number[],
  points: P[],
  edge?: number,
): ShadowCell {
  const h = hull(points);
  if (!h.length) throw Error("Unknown/empty boundary enclosure");
  return {
    kind,
    originalFaceTokens: faces,
    ...(edge === undefined ? {} : { originalEdgeToken: edge }),
    partsFeet: h.length >= 3 ? [[h]] : [],
    closedSegmentsFeet: h.length < 3 ? [h] : [],
  };
}
function planePoint(s: Revit2027PlaneSurface, uv: readonly number[]): P3 {
  return [0, 1, 2].map((i) =>
    add(
      add(
        rational(s.origin[i]!),
        mul(rational(s.xVector[i]!), rational(uv[0]!)),
      ),
      mul(rational(s.yVector[i]!), rational(uv[1]!)),
    ),
  ) as P3;
}
function surfacePoints(
  s: Surface,
  uv: readonly number[],
  trigCache: Map<number, ReturnType<typeof originalCylinderTrigEnclosure>>,
): P3[] {
  if (uv.length !== 2 || uv.some((v) => !Number.isFinite(v)))
    throw Error("Nonfinite original coedge UV");
  if (s.kind === "plane") return [planePoint(s, uv)];
  let t = trigCache.get(uv[0]!);
  if (!t) {
    t = originalCylinderTrigEnclosure(uv[0]!);
    trigCache.set(uv[0]!, t);
  }
  const r = rational(s.radius),
    z = add(
      rational(s.center[2]),
      mul(rational(s.zVector[2]), rational(uv[1]!)),
    );
  return t.cosine.flatMap((c) =>
    t.sine.map(
      (v) =>
        [
          add(
            rational(s.center[0]),
            mul(
              r,
              add(
                mul(rational(s.xVector[0]), c),
                mul(rational(s.yVector[0]), v),
              ),
            ),
          ),
          add(
            rational(s.center[1]),
            mul(
              r,
              add(
                mul(rational(s.xVector[1]), c),
                mul(rational(s.yVector[1]), v),
              ),
            ),
          ),
          z,
        ] as P3,
    ),
  );
}
function winding(p: P, ring: P[]) {
  let w = 0;
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length]!,
      o = sub(
        mul(sub(b[0], a[0]), sub(p[1], a[1])),
        mul(sub(b[1], a[1]), sub(p[0], a[0])),
      ).n;
    if (cmp(a[1], p[1]) <= 0) {
      if (cmp(b[1], p[1]) > 0 && o > 0n) w++;
    } else if (cmp(b[1], p[1]) <= 0 && o < 0n) w--;
  }
  return w;
}
/** Exact native UV loop roles. This reference check supplies no body authority.
 * Require one filled contour and strictly contained, mutually disjoint holes;
 * ambiguous multiple-filled/nested-hole families remain coarse. */
export function inspectOriginalFloorCapTrimRoles(
  rings: P[][],
  normalFlipped: boolean,
  surfaceOrientFlag: boolean,
) {
  if (!rings.length) throw Error("Missing original cap trim rings");
  const signedTwiceAreas = rings.map((ring) => {
    validateOriginalNamedCapReference([[ring]]);
    const area = ring.reduce((a, p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      return add(a, sub(mul(p[0], q[1]), mul(q[0], p[1])));
    }, new Rational(0n));
    if (!area.n) throw Error("Degenerate original cap signed UV area");
    return normalFlipped === surfaceOrientFlag
      ? new Rational(-area.n, area.d)
      : area;
  });
  const roles = signedTwiceAreas.map((a) =>
    a.n > 0n ? ("outer" as const) : ("hole" as const),
  );
  const outerIndices = roles.flatMap((r, i) => (r === "outer" ? [i] : []));
  if (outerIndices.length !== 1)
    throw Error("Ambiguous original cap filled contour roles");
  const outerIndex = outerIndices[0]!;
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i]!;
    for (let j = 0; j < i; j++) {
      const other = rings[j]!;
      if (
        i !== outerIndex &&
        j !== outerIndex &&
        (winding(ring[0]!, other) !== 0 || winding(other[0]!, ring) !== 0)
      )
        throw Error("Overlapping/nested original cap holes");
      if (boundariesMeet(ring, other))
        throw Error("Touching/intersecting original cap trim boundaries");
    }
    if (
      i !== outerIndex &&
      Math.abs(winding(ring[0]!, rings[outerIndex]!)) !== 1
    )
      throw Error("Original cap hole leaves its filled contour");
  }
  return { roles, outerIndex, signedCorrectedTwiceUvAreas: signedTwiceAreas };
}
function boundariesMeet(a: P[], b: P[]) {
  const orient = (p: P, q: P, r: P) =>
    sub(
      mul(sub(q[0], p[0]), sub(r[1], p[1])),
      mul(sub(q[1], p[1]), sub(r[0], p[0])),
    ).n;
  const on = (p: P, q: P, r: P) =>
    !orient(p, q, r) &&
    [0, 1].every(
      (i) =>
        cmp(r[i]!, min([p[i]!, q[i]!])) >= 0 &&
        cmp(r[i]!, max([p[i]!, q[i]!])) <= 0,
    );
  return a.some((p, i) =>
    b.some((r, j) => {
      const q = a[(i + 1) % a.length]!,
        t = b[(j + 1) % b.length]!;
      const x = orient(p, q, r),
        y = orient(p, q, t),
        z = orient(r, t, p),
        w = orient(r, t, q);
      return (
        on(p, q, r) ||
        on(p, q, t) ||
        on(r, t, p) ||
        on(r, t, q) ||
        (((x < 0n && y > 0n) || (x > 0n && y < 0n)) &&
          ((z < 0n && w > 0n) || (z > 0n && w < 0n)))
      );
    }),
  );
}
export function originalFloorClosedBodyShadowReplayFingerprint(
  replay: Revit2027GRepReplay,
) {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify(replay, (_k, v) =>
          typeof v === "bigint" ? { $bigint: v.toString() } : v,
        ),
      ),
    ),
  );
}

/** Exact refusal-oriented mathematics on a checksum-bound ORIGINAL replay.
 * Every trimmed face, hole, finite side domain, paired source embedding and
 * entire abstract vertex cluster remains represented. Cylinder intervals stay
 * separate: their global hull would fill the center of a curved void.
 *
 * For a bounded closed material S, XY(S)=XY(boundary(S)). Extruding the full
 * boundary shadow through the full source Z band therefore encloses S. An
 * abstract closed edge census is NOT proof that the native material has those
 * semantics or is exactly sewn: that remains a separate mandatory qualifier.
 * Unknown branches retain the old coarse obstruction even after pure success. */
export function inspectOriginalFloorClosedBodyShadow(
  replay: Revit2027GRepReplay,
  request: {
    expectedNativeFloorElementId: number;
    expectedReplaySha256: string;
    footprintFeet: NativeRationalParts;
    minimumElevationFeet: Q;
    maximumElevationFeet: Q;
  },
) {
  const authority = {
    sourceBodyQualificationRequired: true as const,
    sourceAuthorityGranted: false as const,
    exactSewnSolidApproved: false as const,
    positiveFloorSupportApproved: false as const,
    coarseBodyMustRemainUntilSourceQualification: true as const,
    routeApproved: false as const,
  };
  try {
    if (
      !Number.isSafeInteger(request.expectedNativeFloorElementId) ||
      request.expectedNativeFloorElementId <= 0 ||
      replay.ownerElementId !== BigInt(request.expectedNativeFloorElementId)
    )
      throw Error("Foreign original floor owner");
    if (
      originalFloorClosedBodyShadowReplayFingerprint(replay) !==
      request.expectedReplaySha256
    )
      throw Error("Stale original floor replay/topology binding");
    if (
      request.footprintFeet.length !== 1 ||
      request.footprintFeet[0]!.length !== 1 ||
      !(request.minimumElevationFeet instanceof Rational) ||
      !(request.maximumElevationFeet instanceof Rational) ||
      cmp(request.minimumElevationFeet, request.maximumElevationFeet) > 0
    )
      throw Error("Invalid complete connected footprint/Z demand");
    validateOriginalNamedCapReference(request.footprintFeet);
    const demandPoints = request.footprintFeet.flat(2),
      demandBounds = [0, 1].map((i) => [
        min(demandPoints.map((p) => p[i]!)),
        max(demandPoints.map((p) => p[i]!)),
      ]);
    // Exact strict separation only. Tangent boxes continue to the closed kernel.
    const contact = (c: ShadowCell) => {
      const points = [...c.partsFeet.flat(2), ...c.closedSegmentsFeet.flat()];
      if (!points.length) throw Error("Unknown empty source shadow cell");
      for (const axis of [0, 1])
        if (
          cmp(max(points.map((p) => p[axis]!)), demandBounds[axis]![0]!) < 0 ||
          cmp(min(points.map((p) => p[axis]!)), demandBounds[axis]![1]!) > 0
        )
          return false;
      return exactClosedSourcePlanarContact(
        request.footprintFeet,
        c.partsFeet,
        c.closedSegmentsFeet,
      );
    };
    const trigCache = new Map<
        number,
        ReturnType<typeof originalCylinderTrigEnclosure>
      >(),
      domainCache = new Map<
        Revit2027CylinderSurface,
        ReturnType<typeof inspectOriginalCylinderDomainEnclosure>
      >(),
      cylinderDomain = (s: Revit2027CylinderSurface) => {
        let d = domainCache.get(s);
        if (!d) {
          d = inspectOriginalCylinderDomainEnclosure(s);
          domainCache.set(s, d);
        }
        return d;
      };
    const allowed = new Set([
      "Revit2027Geometry",
      "Revit2027Face",
      "Revit2027GEdge",
      "Revit2027EdgeLoop",
      "Revit2027GFilling",
      "Revit2027AnalyticSurface:634",
      "Revit2027AnalyticSurface:1144",
    ]);
    if (
      !replay.spans.length ||
      replay.spans.length > 100000 ||
      replay.spans.some(
        (s, i) =>
          s.replayIndex !== i ||
          s.ownerElementId !== replay.ownerElementId ||
          !allowed.has(s.readerId),
      )
    )
      throw Error("Unsupported original floor branch/chain/owner");
    const queued = replay.descriptors.filter((d) => d.state === "queued");
    if (
      queued.length !== replay.spans.length ||
      replay.descriptors.some((d) => d.state === "reused")
    )
      throw Error("Unconsumed/reused original floor FIFO");
    for (const s of replay.spans) {
      const d = queued.filter((d) => d.queueSequence === s.queueSequence);
      if (
        d.length !== 1 ||
        d[0]!.ownerElementId !== s.ownerElementId ||
        d[0]!.token !== s.propertyToken ||
        d[0]!.sourceClassSlot !== s.propertySourceClassSlot ||
        d[0]!.parentReplayIndex !== s.parentReplayIndex ||
        d[0]!.descriptorOffset !== s.descriptorOffset ||
        d[0]!.descriptorEndOffset !== s.descriptorEndOffset ||
        JSON.stringify(d[0]!.path) !== JSON.stringify(s.path)
      )
        throw Error("Original floor FIFO source identity differs");
    }
    const positive = replay.spans.filter((s) => s.propertyToken > 0);
    if (new Set(positive.map((s) => s.propertyToken)).size !== positive.length)
      throw Error("Duplicate original floor token");
    const index = revit2027OwnerMeshIndex(replay),
      gs = replay.spans.filter((s) => s.readerId === "Revit2027Geometry");
    if (
      gs.length !== 1 ||
      gs[0]!.parentReplayIndex !== null ||
      gs[0]!.propertySourceClassSlot !== 2343
    )
      throw Error("Unsupported original Geometry placement");
    const geometry = gs[0]!,
      g = geometry.value as {
        flags: number;
        gInfo: unknown;
        tessEpsCntrl: { type: number; version: number };
        faces: {
          count: number;
          entries: { token: number; sourceClassSlot: number }[];
        };
        edges: {
          count: number;
          entries: { token: number; sourceClassSlot: number }[];
        };
        sharedSurfaceInfo: { count: number; entries: unknown[] };
      };
    const declared = (
      d: typeof g.faces,
      map: ReadonlyMap<number, unknown>,
      slot: number,
      id: string,
    ) =>
      d.count === map.size &&
      d.entries.length === map.size &&
      new Set(d.entries.map((e) => e.token)).size === map.size &&
      d.entries.every(
        (e) =>
          e.sourceClassSlot === slot &&
          map.has(e.token) &&
          replay.spans.some(
            (s) =>
              s.readerId === id &&
              s.propertyToken === e.token &&
              s.parentReplayIndex === geometry.replayIndex,
          ),
      );
    if (
      g.flags !== 7 ||
      g.tessEpsCntrl.type !== 0 ||
      g.tessEpsCntrl.version !== 1 ||
      g.sharedSurfaceInfo.count ||
      g.sharedSurfaceInfo.entries.length ||
      !declared(g.faces, index.faces, 1825, "Revit2027Face") ||
      !declared(g.edges, index.edges, 1423, "Revit2027GEdge")
    )
      throw Error("Original floor declared body census differs");
    const accounted = new Set<number>([geometry.replayIndex]),
      surfaces = new Map<number, Surface>(),
      faceLoops = new Map<
        number,
        {
          token: number;
          uses: Revit2027DirectedEdge[];
        }[]
      >(),
      usedLoops = new Set<number>(),
      edgeUses = new Map<
        number,
        { face: number; side: 0 | 1; direction: 1 | -1 }[]
      >(),
      parent = new Map<string, string>(),
      vertexEmbeddings = new Map<string, P3[]>(),
      cells: ShadowCell[] = [],
      allWorldPoints: P3[] = [];
    const find = (a: string): string => {
        if (!parent.has(a)) parent.set(a, a);
        const p = parent.get(a)!;
        if (p !== a) parent.set(a, find(p));
        return parent.get(a)!;
      },
      join = (a: string, b: string) => parent.set(find(a), find(b));
    for (const [token, f] of index.faces) {
      const fs = replay.spans.find(
        (s) => s.readerId === "Revit2027Face" && s.propertyToken === token,
      )!;
      if (
        ![4, 6, 516].includes(f.faceFlags) ||
        f.cutType !== 0 ||
        f.faceRegions.count ||
        f.firstLoop.token <= 0 ||
        ![634, 1144].includes(f.surface.sourceClassSlot!)
      )
        throw Error("Unsupported original physical face/trim role");
      const s = revit2027OwnerSurface<Surface>(
        index,
        f.surface.sourceClassSlot!,
        token,
      );
      if (!s || !s.surface.orientFlag || s.queuedProperties.length)
        throw Error("Unsupported original face orientation/surface child");
      const ss = replay.spans.filter(
        (p) =>
          p.parentReplayIndex === fs.replayIndex &&
          p.readerId.startsWith("Revit2027AnalyticSurface:"),
      );
      if (ss.length !== 1 || ss[0]!.propertyToken !== f.surface.token)
        throw Error("Ambiguous original analytic surface");
      accounted.add(fs.replayIndex);
      accounted.add(ss[0]!.replayIndex);
      surfaces.set(token, s);
      if (s.kind === "plane") {
        if (
          [
            ...s.origin,
            ...s.xVector,
            ...s.yVector,
            ...s.surface.envelope.firstCorner,
            ...s.surface.envelope.secondCorner,
          ].some((v) => !Number.isFinite(v))
        )
          throw Error("Nonfinite original plane");
        const x = s.xVector.map(rational),
          y = s.yVector.map(rational);
        if (
          [
            sub(mul(x[1]!, y[2]!), mul(x[2]!, y[1]!)),
            sub(mul(x[2]!, y[0]!), mul(x[0]!, y[2]!)),
            sub(mul(x[0]!, y[1]!), mul(x[1]!, y[0]!)),
          ].every((q) => !q.n)
        )
          throw Error("Degenerate original plane");
        if (f.faceFlags === 6) throw Error("Unsupported flipped plane role");
      } else if (s.kind !== "cylinder") throw Error("Unknown original surface");
      for (const p of [f.foregroundFilling, f.backgroundFilling])
        if (p.token) {
          const fill = replay.spans.find((v) => v.propertyToken === p.token),
            v = fill?.value as
              | {
                  faceIdReference: number;
                  flags: number;
                  data: { token: number; sourceClassSlot: number | null };
                  queuedProperties: unknown[];
                }
              | undefined;
          if (
            !fill ||
            fill.readerId !== "Revit2027GFilling" ||
            fill.propertySourceClassSlot !== 2253 ||
            fill.parentReplayIndex !== fs.replayIndex ||
            v?.faceIdReference !== token ||
            v.flags !== 18 ||
            v.data.token !== 0 ||
            v.data.sourceClassSlot !== null ||
            v.queuedProperties.length ||
            accounted.has(fill.replayIndex)
          )
            throw Error("Unknown original face-bound filling material");
          accounted.add(fill.replayIndex);
        }
      const loops: NonNullable<ReturnType<typeof faceLoops.get>> = [];
      let next = f.firstLoop.token,
        previousParent = fs.replayIndex;
      while (next) {
        const l = index.loops.get(next),
          ls = replay.spans.find((s) => s.propertyToken === next);
        if (
          !l ||
          !ls ||
          ls.readerId !== "Revit2027EdgeLoop" ||
          ls.propertySourceClassSlot !== 1434 ||
          ls.parentReplayIndex !== previousParent ||
          usedLoops.has(next) ||
          l.loop.open ||
          l.loop.faceReference !== token ||
          JSON.stringify(l.loop.staticReferences) !==
            JSON.stringify([
              l.loop.faceReference,
              l.loop.nextEdgeReference,
              l.loop.previousEdgeReference,
            ]) ||
          JSON.stringify(l.loop.queuedProperties) !==
            JSON.stringify(l.loop.nextLoop.token ? [l.loop.nextLoop] : []) ||
          [...l.loop.envelope.minimum, ...l.loop.envelope.maximum].some(
            (v) => !Number.isFinite(v),
          ) ||
          l.loop.envelope.minimum.some(
            (v, i) => v > l.loop.envelope.maximum[i]!,
          )
        )
          throw Error("Open/repeated/foreign original loop");
        usedLoops.add(next);
        accounted.add(ls.replayIndex);
        const walk = walkRevit2027DirectedLoopEdges({
          faceToken: token,
          loop: l,
          edges: index.edges,
          loopArity: "open",
        });
        if (!walk.ok || walk.edges.length < 3)
          throw Error("Unclosed original directed face loop");
        for (const [i, e] of walk.edges.entries()) {
          const after = walk.edges[(i + 1) % walk.edges.length]!;
          if (
            e.edge.previousReferences[e.side] !==
              (!i ? next : walk.edges[i - 1]!.token) ||
            e.edge.nextReferences[e.side] !==
              (i === walk.edges.length - 1 ? next : after.token) ||
            ![6, 7, 14, 15].includes(e.edge.flags) ||
            e.edge.queuedPropertyCount
          )
            throw Error("Unsupported/nonreciprocal source coedge");
          edgeUses.set(e.token, [
            ...(edgeUses.get(e.token) ?? []),
            { face: token, side: e.side, direction: e.direction },
          ]);
          join(
            e.token + ":" + (e.direction === 1 ? 1 : 0),
            after.token + ":" + (after.direction === 1 ? 0 : 1),
          );
        }
        loops.push({ token: next, uses: walk.edges });
        previousParent = ls.replayIndex;
        next = l.loop.nextLoop.token;
      }
      faceLoops.set(token, loops);
    }
    if (usedLoops.size !== index.loops.size)
      throw Error("Unconsumed original face/hole loop");
    for (const [token, e] of index.edges) {
      const u = edgeUses.get(token) ?? [];
      if (
        u.length !== 2 ||
        e.faceReferences[0] === e.faceReferences[1] ||
        e.faceReferences.some((f) => !surfaces.has(f)) ||
        !u.some((r) => r.face === e.faceReferences[0]) ||
        !u.some((r) => r.face === e.faceReferences[1]) ||
        u[0]!.direction !== -u[1]!.direction
      )
        throw Error("Original boundary is not a complete opposite-twin family");
      const es = replay.spans.find(
        (s) => s.readerId === "Revit2027GEdge" && s.propertyToken === token,
      );
      if (!es || es.parentReplayIndex !== geometry.replayIndex)
        throw Error("Unowned original edge");
      accounted.add(es.replayIndex);
    }
    if (accounted.size !== replay.spans.length)
      throw Error("Unconsumed original body/control branch");
    const domainByFace = new Map<number, ShadowCell[]>(),
      caps: number[] = [];
    for (const [token, s] of surfaces) {
      if (
        s.surface.envelope.firstCorner.some(
          (v, i) =>
            !Number.isFinite(v) ||
            !Number.isFinite(s.surface.envelope.secondCorner[i]) ||
            v > s.surface.envelope.secondCorner[i]!,
        )
      )
        throw Error("Unordered/nonfinite original surface UV domain");
      const uv = [
        s.surface.envelope.firstCorner,
        s.surface.envelope.secondCorner,
        ...faceLoops
          .get(token)!
          .flatMap((l) => l.uses.flatMap((e) => revit2027DirectedEdgeUvs(e))),
      ];
      for (const l of faceLoops.get(token)!) {
        const env = index.loops.get(l.token)!.loop.envelope;
        uv.push(env.minimum, env.maximum);
      }
      if (uv.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n))))
        throw Error("Invalid original complete UV domain");
      const lo = [0, 1].map((i) => Math.min(...uv.map((p) => p[i]!))),
        hi = [0, 1].map((i) => Math.max(...uv.map((p) => p[i]!)));
      let domains: ShadowCell[] = [];
      if (s.kind === "plane") {
        const corners = [lo[0], hi[0]].flatMap((u) =>
          [lo[1], hi[1]].map((v) => planePoint(s, [u!, v!])),
        );
        allWorldPoints.push(...corners);
        if (s.xVector[2] === 0 && s.yVector[2] === 0) {
          caps.push(token);
        } else
          domains = [
            cell("complete-original-plane-UV-domain", [token], corners.map(xy)),
          ];
      } else {
        const expanded = {
            ...s,
            surface: {
              ...s.surface,
              envelope: {
                ...s.surface.envelope,
                firstCorner: lo as [number, number],
                secondCorner: hi as [number, number],
              },
            },
          },
          enclosure = cylinderDomain(
            lo.every((v, i) => v === s.surface.envelope.firstCorner[i]) &&
              hi.every((v, i) => v === s.surface.envelope.secondCorner[i])
              ? s
              : expanded,
          );
        if (!enclosure.ok) throw Error(enclosure.blockers.join("; "));
        domains = enclosure.intervalProjectionBoundsFeet.map((b) =>
          cell(
            "complete-original-cylinder-angular-subinterval",
            [token],
            [
              b.minimumFeet,
              [b.maximumFeet[0], b.minimumFeet[1]],
              b.maximumFeet,
              [b.minimumFeet[0], b.maximumFeet[1]],
            ],
          ),
        );
        for (const v of [lo[1]!, hi[1]!])
          allWorldPoints.push(...surfacePoints(s, [lo[0]!, v], trigCache));
      }
      domainByFace.set(token, domains);
      cells.push(...domains);
    }
    if (caps.length !== 2)
      throw Error("Requires both original horizontal trimmed caps");
    for (const [token, e] of index.edges) {
      const samples = [
          ...e.firstAndLastEdgePoints.slice(0, 1),
          ...e.interiorEdgePoints,
          ...e.firstAndLastEdgePoints.slice(1),
        ],
        a = surfaces.get(e.faceReferences[0])!,
        b = surfaces.get(e.faceReferences[1])!;
      if (
        (e.flags & 8) !== 0 &&
        !(
          (a.kind === "cylinder" && caps.includes(e.faceReferences[1])) ||
          (b.kind === "cylinder" && caps.includes(e.faceReferences[0]))
        )
      )
        throw Error("Unsupported original curved-edge role");
      const all: P3[] = [];
      for (const [i, p] of samples.entries()) {
        const mapped = [
          ...surfacePoints(a, p.firstFaceUv, trigCache),
          ...surfacePoints(b, p.secondFaceUv, trigCache),
        ];
        all.push(...mapped);
        allWorldPoints.push(...mapped);
        cells.push(
          cell(
            "original-paired-source-sample",
            [...e.faceReferences],
            mapped.map(xy),
            token,
          ),
        );
        if (i === 0 || i === samples.length - 1) {
          const k = token + ":" + (i === 0 ? 0 : 1);
          vertexEmbeddings.set(k, [
            ...(vertexEmbeddings.get(k) ?? []),
            ...mapped,
          ]);
        }
      }
      if ((e.flags & 8) === 0) {
        if (e.interiorEdgePoints.length)
          throw Error("Unsupported nonlinear original straight edge");
        cells.push(
          cell(
            "complete-original-paired-straight-edge-ribbon",
            [...e.faceReferences],
            all.map(xy),
            token,
          ),
        );
      }
    }
    const clusters = new Map<string, P3[]>();
    for (const [k, p] of vertexEmbeddings) {
      const root = find(k);
      clusters.set(root, [...(clusters.get(root) ?? []), ...p]);
    }
    for (const points of clusters.values())
      cells.push(
        cell(
          "complete-original-abstract-vertex-embedding-cluster",
          [],
          points.map(xy),
        ),
      );
    const capResults = caps.map((token) => {
      const s = surfaces.get(token)! as Revit2027PlaneSurface,
        rings: P[][] = [],
        uvRings: P[][] = [],
        uncertainty: ShadowCell[] = [];
      for (const l of faceLoops.get(token)!) {
        const ring: P[] = [],
          uvRing: P[] = [];
        for (const e of l.uses) {
          const uv = revit2027DirectedEdgeUvs(e),
            points = uv.map((p) => xy(planePoint(s, p)));
          // Native sampled-ring reference keeps the previous coedge endpoint.
          // ALL alternate join embeddings remain in paired/vertex uncertainty.
          const referenceUv = ring.length ? uv.slice(1) : uv;
          const referencePoints = ring.length ? points.slice(1) : points;
          uncertainty.push(
            cell(
              "complete-original-cap-reference-coedge-connector-ribbon",
              [token],
              [...(ring.length ? [ring.at(-1)!] : []), ...points],
              e.token,
            ),
          );
          for (const p of referenceUv) {
            const q: P = [rational(p[0]), rational(p[1])];
            if (!uvRing.length || key(uvRing.at(-1)!) !== key(q))
              uvRing.push(q);
          }
          for (const p of referencePoints)
            if (!ring.length || key(ring.at(-1)!) !== key(p)) ring.push(p);
          const other = e.edge.faceReferences[1 - e.side]!,
            os = surfaces.get(other)!;
          if (os.kind === "cylinder") {
            const d = cylinderDomain(os);
            if (!d.ok) throw Error(d.blockers.join("; "));
            uncertainty.push(
              cell(
                "conservative-original-cap-arc-reference-uncertainty",
                [token, other],
                [...d.partsFeet.flat(2), ...points],
                e.token,
              ),
            );
          }
        }
        if (ring.length > 1 && key(ring[0]!) === key(ring.at(-1)!)) ring.pop();
        if (ring.length < 3) throw Error("Degenerate original cap loop");
        if (uvRing.length > 1 && key(uvRing[0]!) === key(uvRing.at(-1)!))
          uvRing.pop();
        rings.push(ring);
        uvRings.push(uvRing);
      }
      // Every paired/vertex residual is kept, including positive raw UV gaps.
      uncertainty.push(
        ...cells.filter(
          (c) => c.kind.includes("paired") || c.kind.includes("vertex"),
        ),
      );
      const roles = inspectOriginalFloorCapTrimRoles(
        uvRings,
        (index.faces.get(token)!.faceFlags & 2) !== 0,
        s.surface.orientFlag,
      );
      const boundaryContact = uncertainty.some(contact),
        windings = rings.map((r) =>
          winding(request.footprintFeet[0]![0]![0]!, r),
        ),
        outside = windings.every((w) => w === 0),
        hole =
          Math.abs(windings[roles.outerIndex] ?? 0) === 1 &&
          windings.filter(
            (w, i) => roles.roles[i] === "hole" && Math.abs(w) === 1,
          ).length === 1 &&
          windings.every((w) => Math.abs(w) <= 1);
      return {
        originalFaceToken: token,
        originalPlaneOrientationRetained: s.surface.orientFlag,
        originalPlaneBasisRetained: { xVector: s.xVector, yVector: s.yVector },
        retainedOriginalHoleCount: roles.roles.filter((r) => r === "hole")
          .length,
        originalNativeLoopRoles: roles.roles,
        originalCorrectedTwiceUvAreas: roles.signedCorrectedTwiceUvAreas,
        originalFilledLoopIndex: roles.outerIndex,
        windings,
        completeBoundaryUncertaintyContact: boundaryContact,
        completeTrimmedCapShadowDisjoint: !boundaryContact && (outside || hole),
        referenceRingsFeet: rings,
        uncertaintyCells: uncertainty,
      };
    });
    const sideContacts = cells.filter(contact),
      zmin = min(allWorldPoints.map((p) => p[2])),
      zmax = max(allWorldPoints.map((p) => p[2])),
      zDisjoint =
        cmp(zmax, request.minimumElevationFeet) < 0 ||
        cmp(zmin, request.maximumElevationFeet) > 0,
      disjoint =
        zDisjoint ||
        (sideContacts.length === 0 &&
          capResults.every((c) => c.completeTrimmedCapShadowDisjoint));
    return {
      ok: true as const,
      completeOriginalAbstractOppositeTwinBoundaryFamily: true as const,
      completeBoundaryFamilyMathematicalEnclosure: true as const,
      completeBoundaryShadowDisjoint: disjoint,
      originalOwnerId: request.expectedNativeFloorElementId,
      originalReplaySha256: request.expectedReplaySha256,
      originalRootGeometryGInfo: g.gInfo,
      originalRootGeometryFlags: g.flags,
      originalGInfoCommandsAndSelectionSemanticsQualified: false as const,
      originalFaceCount: index.faces.size,
      originalEdgeCount: index.edges.size,
      originalLoopCount: index.loops.size,
      abstractVertexClusterCount: clusters.size,
      sourceCaps: capResults,
      sourceBoundaryShadowCells: cells,
      closedSideOrResidualContactCells: sideContacts,
      completeComponentMinimumElevationFeet: zmin,
      completeComponentMaximumElevationFeet: zmax,
      allBoundaryShadowsExtrudedThroughFullComponentZBand: true as const,
      ...authority,
    };
  } catch (error) {
    return {
      ok: false as const,
      completeBoundaryShadowDisjoint: false as const,
      blockers: [error instanceof Error ? error.message : String(error)],
      oldCoarseBodyRetained: true as const,
      ...authority,
    };
  }
}
