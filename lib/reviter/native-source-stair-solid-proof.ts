/** Complete original native run-body gate. Exact numerical closure and source
 * topology are reported separately: shared source edge identities alone do not
 * establish identical geometric endpoint embeddings. Nothing is snapped.
 * The prism predicate preserves the separately reviewed original-source
 * planar-prism checks; the added source-topology pass visits every component
 * even when numerical source parametrizations disagree. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  inspectOriginalNativeStairPhysicalInventory,
  readOriginalNativeStairPhysicalSource,
  type OriginalNativeStairPhysicalContext,
} from "./native-source-stair-physical-inventory.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  revit2027DirectedEdgeUvs,
  walkRevit2027DirectedLoopEdges,
} from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import { Rational, rational } from "./native-rational-overlay.ts";

type Q = Rational;
type P = [Q, Q, Q];
export type OriginalRational = [string, string];
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const same = (a: Q, b: Q) => a.n * b.d === b.n * a.d;
const less = (a: Q, b: Q) => a.n * b.d < b.n * a.d;
const pair = (a: Q): OriginalRational => [a.n.toString(), a.d.toString()];
const affine = (s: Revit2027PlaneSurface, uv: readonly number[]): P =>
  [0, 1, 2].map((i) =>
    add(
      add(
        rational(s.origin[i]!),
        mul(rational(s.xVector[i]!), rational(uv[0]!)),
      ),
      mul(rational(s.yVector[i]!), rational(uv[1]!)),
    ),
  ) as P;
const xyzSame = (a: P, b: P) => a.every((v, i) => same(v, b[i]!));
const xySame = (a: P, b: P) => same(a[0], b[0]) && same(a[1], b[1]);
const zero = () => new Rational(0n);
const cross2 = (a: P, b: P, c: P) =>
  sub(
    mul(sub(b[0], a[0]), sub(c[1], a[1])),
    mul(sub(b[1], a[1]), sub(c[0], a[0])),
  );
const area2 = (ring: P[]) =>
  ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return add(s, sub(mul(p[0], q[1]), mul(q[0], p[1])));
  }, zero());
function simple(ring: P[]): boolean {
  if (ring.length < 3 || ring.length > 4096 || area2(ring).n === 0n)
    return false;
  const on = (p: P, a: P, b: P) =>
    cross2(a, b, p).n === 0n &&
    !less(p[0], less(a[0], b[0]) ? a[0] : b[0]) &&
    !less(less(a[0], b[0]) ? b[0] : a[0], p[0]) &&
    !less(p[1], less(a[1], b[1]) ? a[1] : b[1]) &&
    !less(less(a[1], b[1]) ? b[1] : a[1], p[1]);
  for (let i = 0; i < ring.length; i++)
    for (let j = i + 1; j < ring.length; j++) {
      if (xySame(ring[i]!, ring[j]!)) return false;
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!,
        c = ring[j]!,
        d = ring[(j + 1) % ring.length]!;
      const ab1 = cross2(a, b, c).n,
        ab2 = cross2(a, b, d).n,
        cd1 = cross2(c, d, a).n,
        cd2 = cross2(c, d, b).n;
      if (
        ab1 < 0n !== ab2 < 0n &&
        cd1 < 0n !== cd2 < 0n &&
        ab1 &&
        ab2 &&
        cd1 &&
        cd2
      )
        return false;
      if (on(a, c, d) || on(b, c, d) || on(c, a, b) || on(d, a, b))
        return false;
    }
  return true;
}
export type OriginalPlanarPrism = {
  faceTokens: number[];
  footprint: [OriginalRational, OriginalRational][];
  minimumElevationFeet: OriginalRational;
  maximumElevationFeet: OriginalRational;
  volumeCubicFeet: OriginalRational;
};
export type OriginalPlanarPrismReport = {
  nativeElementId: number;
  completeExactPrismBody: boolean;
  originalFaceCount: number;
  originalEdgeCount: number;
  prisms: OriginalPlanarPrism[];
  blockers: string[];
  witnesses: unknown[];
};

/** Mathematical source-replay predicate only. Source membership is granted
 * separately by inspectOriginalNativePlanarPrisms and its opaque RVT context.
 * Every source face/loop/edge must be consumed, without tolerance or meshing. */
export function inspectPlanarPrismReplayGeometry(
  replay: Revit2027GRepReplay,
): OriginalPlanarPrismReport {
  const report: OriginalPlanarPrismReport = {
    nativeElementId: Number(replay.ownerElementId),
    completeExactPrismBody: false,
    originalFaceCount: replay.spans.filter(
      (s) => s.readerId === "Revit2027Face",
    ).length,
    originalEdgeCount: replay.spans.filter(
      (s) => s.readerId === "Revit2027GEdge",
    ).length,
    prisms: [],
    blockers: [],
    witnesses: [],
  };
  const fail = (s: string, w?: unknown) => {
    report.blockers.push(s);
    if (w !== undefined && report.witnesses.length < 32)
      report.witnesses.push(w);
  };
  try {
    const allowed = new Set([
      "Revit2027Geometry",
      "Revit2027Face",
      "Revit2027GEdge",
      "Revit2027EdgeLoop",
      "Revit2027AnalyticSurface:634",
    ]);
    if (
      replay.spans.some(
        (s) =>
          !allowed.has(s.readerId) ||
          s.ownerElementId !== replay.ownerElementId,
      )
    )
      throw Error(
        "Unsupported source primitive, condition, instance or foreign owner",
      );
    const tokens = replay.spans.map((s) => s.propertyToken);
    if (new Set(tokens).size !== tokens.length)
      throw Error("Duplicate original source property token");
    const index = revit2027OwnerMeshIndex(replay);
    report.originalFaceCount = index.faces.size;
    report.originalEdgeCount = index.edges.size;
    if (
      index.faces.size !==
        replay.spans.filter((s) => s.readerId === "Revit2027Face").length ||
      index.edges.size !==
        replay.spans.filter((s) => s.readerId === "Revit2027GEdge").length ||
      index.loops.size !==
        replay.spans.filter((s) => s.readerId === "Revit2027EdgeLoop").length ||
      replay.spans.filter((s) => s.readerId === "Revit2027AnalyticSurface:634")
        .length !== index.faces.size ||
      replay.spans.filter((s) => s.readerId === "Revit2027Geometry").length !==
        1
    )
      throw Error("Incomplete original declared primitive census");
    if (
      !index.faces.size ||
      index.faces.size > 8192 ||
      index.edges.size > 16384
    )
      throw Error("Empty or over-limit source face census");
    const surfaces = new Map<number, Revit2027PlaneSurface>(),
      rings = new Map<number, P[]>(),
      usedLoops = new Set<number>(),
      uses = new Map<number, number[]>(),
      directions = new Map<number, number[]>();
    for (const [ft, face] of index.faces) {
      if (
        face.faceFlags !== 4 ||
        face.cutType !== 0 ||
        face.faceRegions.count ||
        face.firstLoop.token <= 0 ||
        face.surface.sourceClassSlot !== 634
      )
        throw Error(
          "Unsupported original face semantics or region/loop census",
        );
      const sf = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, ft);
      if (
        !sf ||
        sf.kind !== "plane" ||
        sf.surface.orientFlag !== true ||
        [...sf.origin, ...sf.xVector, ...sf.yVector].some(
          (v) => !Number.isFinite(v),
        )
      )
        throw Error("Unsupported original finite plane/orientation");
      const cross = [
        sub(
          mul(rational(sf.xVector[1]), rational(sf.yVector[2])),
          mul(rational(sf.xVector[2]), rational(sf.yVector[1])),
        ),
        sub(
          mul(rational(sf.xVector[2]), rational(sf.yVector[0])),
          mul(rational(sf.xVector[0]), rational(sf.yVector[2])),
        ),
        sub(
          mul(rational(sf.xVector[0]), rational(sf.yVector[1])),
          mul(rational(sf.xVector[1]), rational(sf.yVector[0])),
        ),
      ];
      if (cross.every((v) => v.n === 0n))
        throw Error("Degenerate original plane");
      const loop = index.loops.get(face.firstLoop.token);
      if (
        !loop ||
        usedLoops.has(loop.token) ||
        loop.loop.faceReference !== ft ||
        loop.loop.open ||
        loop.loop.nextLoop.token !== 0
      )
        throw Error(
          "Unsupported hole, open, duplicated or unowned original loop",
        );
      usedLoops.add(loop.token);
      const walk = walkRevit2027DirectedLoopEdges({
        faceToken: ft,
        loop,
        edges: index.edges,
        loopArity: "open",
      });
      if (!walk.ok)
        throw Error("Original directed loop topology does not close");
      const points: P[] = [],
        uvs = walk.edges.map((e) => revit2027DirectedEdgeUvs(e));
      for (const [i, e] of walk.edges.entries()) {
        if (e.edge.interiorEdgePoints.length)
          throw Error(
            "Curved or sampled original edge cannot become a straight prism",
          );
        const next = walk.edges[(i + 1) % walk.edges.length]!,
          expectedNext = i === walk.edges.length - 1 ? loop.token : next.token,
          expectedPrev = i ? walk.edges[i - 1]!.token : loop.token;
        if (
          e.edge.nextReferences[e.side] !== expectedNext ||
          e.edge.previousReferences[e.side] !== expectedPrev
        )
          throw Error("Nonreciprocal original coedge linkage");
        const uv = uvs[i]!,
          other = uvs[(i + 1) % uvs.length]!;
        if (
          uv.length !== 2 ||
          uv.some((p) => p.some((v) => !Number.isFinite(v)))
        )
          throw Error("Unsupported original finite edge samples");
        if (uv[1]![0] !== other[0]![0] || uv[1]![1] !== other[0]![1])
          fail("Original raw UV coedges do not meet exactly", {
            faceToken: ft,
            edgeToken: e.token,
            nextEdgeToken: next.token,
            from: uv[1],
            to: other[0],
            exactDelta: other[0]!.map((v, k) =>
              pair(sub(rational(v), rational(uv[1]![k]!))),
            ),
          });
        points.push(affine(sf, uv[0]!));
        uses.set(e.token, [...(uses.get(e.token) ?? []), ft]);
        directions.set(e.token, [
          ...(directions.get(e.token) ?? []),
          e.direction,
        ]);
      }
      surfaces.set(ft, sf);
      rings.set(ft, points);
    }
    if (usedLoops.size !== index.loops.size)
      throw Error("Unconsumed original loop");
    for (const [et, e] of index.edges) {
      const fs = e.faceReferences,
        usage = uses.get(et);
      if (
        fs[0] === fs[1] ||
        !surfaces.has(fs[0]) ||
        !surfaces.has(fs[1]) ||
        !usage ||
        usage.length !== 2 ||
        new Set(usage).size !== 2 ||
        !usage.every((f) => fs.includes(f))
      )
        throw Error(
          "Original edge is open, multiply used or lacks both owning faces",
        );
      const directed = directions.get(et);
      if (!directed || directed.length !== 2 || directed[0] !== -directed[1]!)
        throw Error("Original twin coedges do not have opposite directions");
      for (const [i, p] of e.firstAndLastEdgePoints.entries()) {
        const a = affine(surfaces.get(fs[0])!, p.firstFaceUv),
          b = affine(surfaces.get(fs[1])!, p.secondFaceUv);
        if (!xyzSame(a, b))
          fail(
            "Original twin-face parametrizations do not identify one exact 3D endpoint",
            {
              edgeToken: et,
              endpoint: i,
              faceTokens: fs,
              firstXYZ: a.map(pair),
              secondXYZ: b.map(pair),
              exactDelta: b.map((v, k) => pair(sub(v, a[k]!))),
            },
          );
      }
    }
    if (report.blockers.length) return report;
    const visited = new Set<number>();
    for (const seed of index.faces.keys()) {
      if (visited.has(seed)) continue;
      const component: number[] = [],
        queue = [seed];
      visited.add(seed);
      for (let i = 0; i < queue.length; i++) {
        const ft = queue[i]!;
        component.push(ft);
        for (const [et, fs] of uses)
          if (fs.includes(ft)) {
            const other = index.edges
              .get(et)!
              .faceReferences.find((v) => v !== ft)!;
            if (!visited.has(other)) {
              visited.add(other);
              queue.push(other);
            }
          }
      }
      const caps = component.filter((ft) => {
        const s = surfaces.get(ft)!;
        return s.xVector[2] === 0 && s.yVector[2] === 0;
      });
      if (caps.length !== 2)
        throw Error(
          "Component is not one supported vertical prism with two horizontal caps",
        );
      const ordered = caps.toSorted((a, b) =>
          less(rings.get(a)![0]![2], rings.get(b)![0]![2]) ? -1 : 1,
        ),
        bottom = rings.get(ordered[0]!)!,
        top = rings.get(ordered[1]!)!;
      const lo = bottom[0]![2],
        hi = top[0]![2];
      if (
        !less(lo, hi) ||
        !simple(bottom) ||
        !simple(top) ||
        area2(top).n <= 0n ||
        area2(bottom).n >= 0n
      )
        throw Error(
          "Original prism caps are non-simple, inverted or zero-volume",
        );
      if (
        bottom.length !== top.length ||
        !top.some((_, offset) =>
          bottom.every((p, i) =>
            xySame(p, top[(offset - i + top.length * 2) % top.length]!),
          ),
        )
      )
        throw Error("Original upper/lower cap footprints differ");
      const sideEdges = new Set<number>();
      for (const ft of component.filter((f) => !caps.includes(f))) {
        const ring = rings.get(ft)!;
        if (ring.length !== 4) throw Error("Unsupported prism side ring");
        if (
          ring.some((p, i) => {
            const q = ring[(i + 1) % ring.length]!;
            return xyzSame(p, q) || (!same(p[2], q[2]) && !xySame(p, q));
          })
        )
          throw Error("Original side is crossed or lacks exact vertical edges");
        const lows = ring.filter((p) => same(p[2], lo)),
          highs = ring.filter((p) => same(p[2], hi));
        if (
          lows.length !== 2 ||
          highs.length !== 2 ||
          !lows.every((p) => highs.some((q) => xySame(p, q)))
        )
          throw Error("Original side does not span both unmodified cap edges");
        const edge = top.findIndex(
          (p, i) =>
            (xySame(p, lows[0]!) &&
              xySame(top[(i + 1) % top.length]!, lows[1]!)) ||
            (xySame(p, lows[1]!) &&
              xySame(top[(i + 1) % top.length]!, lows[0]!)),
        );
        if (edge < 0 || sideEdges.has(edge))
          throw Error("Missing or duplicate original prism side");
        sideEdges.add(edge);
      }
      if (sideEdges.size !== top.length || component.length !== top.length + 2)
        throw Error("Original prism boundary is incomplete");
      const twiceArea = area2(top),
        volume = mul(new Rational(twiceArea.n, twiceArea.d * 2n), sub(hi, lo));
      report.prisms.push({
        faceTokens: component.toSorted((a, b) => a - b),
        footprint: top.map((p) => [pair(p[0]), pair(p[1])]),
        minimumElevationFeet: pair(lo),
        maximumElevationFeet: pair(hi),
        volumeCubicFeet: pair(volume),
      });
    }
    report.completeExactPrismBody = report.prisms.length > 0;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  return report;
}

export type OriginalStairTopologyComponent = {
  faceTokens: number[];
  edgeCount: number;
  abstractVertexCount: number;
  eulerCharacteristic: number;
  closedTwoManifoldSourceTopology: boolean;
};
export type OriginalStairTopologyReport = {
  completeClosedSourceTopology: boolean;
  components: OriginalStairTopologyComponent[];
  blockers: string[];
  /** Abstract source vertex incidence never joins numerical coordinates. */
  geometricVertexCoordinatesChanged: false;
  originalSourceAuthorityGranted: false;
};

/** Reconstruct the source half-edge incidence independently of coordinate
 * equality. A joined abstract vertex records the original coedge adjacency;
 * every raw numerical embedding remains in the separate exact predicate. */
export function inspectOriginalStairSourceTopology(
  replay: Revit2027GRepReplay,
): OriginalStairTopologyReport {
  const report: OriginalStairTopologyReport = {
    completeClosedSourceTopology: false,
    components: [],
    blockers: [],
    geometricVertexCoordinatesChanged: false,
    originalSourceAuthorityGranted: false,
  };
  try {
    const index = revit2027OwnerMeshIndex(replay);
    if (
      !index.faces.size ||
      index.faces.size > 8192 ||
      index.edges.size > 16384 ||
      index.faces.size !==
        replay.spans.filter((s) => s.readerId === "Revit2027Face").length ||
      index.edges.size !==
        replay.spans.filter((s) => s.readerId === "Revit2027GEdge").length ||
      index.loops.size !==
        replay.spans.filter((s) => s.readerId === "Revit2027EdgeLoop").length ||
      replay.spans.some((s) => s.ownerElementId !== replay.ownerElementId)
    )
      throw Error("Incomplete or foreign original source topology census");
    const parents = new Map<string, string>();
    const find = (key: string): string => {
      if (!parents.has(key)) parents.set(key, key);
      let root = key;
      while (parents.get(root) !== root) root = parents.get(root)!;
      while (parents.get(key) !== root) {
        const next = parents.get(key)!;
        parents.set(key, root);
        key = next;
      }
      return root;
    };
    const join = (a: string, b: string) => {
      const first = find(a),
        second = find(b);
      if (first !== second) parents.set(first, second);
    };
    const usedLoops = new Set<number>(),
      uses = new Map<number, { face: number; direction: number }[]>();
    const faceEdges = new Map<number, number[]>();
    for (const [token, face] of index.faces) {
      const loop = index.loops.get(face.firstLoop.token);
      if (
        !loop ||
        usedLoops.has(loop.token) ||
        loop.loop.faceReference !== token ||
        loop.loop.open ||
        loop.loop.nextLoop.token !== 0 ||
        face.faceRegions.count
      )
        throw Error(
          "Missing, open, shared or unsupported original source face loop",
        );
      usedLoops.add(loop.token);
      const walked = walkRevit2027DirectedLoopEdges({
        faceToken: token,
        loop,
        edges: index.edges,
        loopArity: "open",
      });
      if (!walked.ok || walked.edges.length < 3)
        throw Error("Original source face loop does not close");
      faceEdges.set(
        token,
        walked.edges.map((edge) => edge.token),
      );
      for (const [i, edge] of walked.edges.entries()) {
        const next = walked.edges[(i + 1) % walked.edges.length]!,
          previous =
            walked.edges[(i + walked.edges.length - 1) % walked.edges.length]!;
        if (
          edge.edge.nextReferences[edge.side] !==
            (i === walked.edges.length - 1 ? loop.token : next.token) ||
          edge.edge.previousReferences[edge.side] !==
            (i ? previous.token : loop.token)
        )
          throw Error("Original source coedge links are nonreciprocal");
        const entries = uses.get(edge.token) ?? [];
        entries.push({ face: token, direction: edge.direction });
        uses.set(edge.token, entries);
        const end = edge.direction === 1 ? 1 : 0,
          start = next.direction === 1 ? 0 : 1;
        join(`${edge.token}:${end}`, `${next.token}:${start}`);
      }
    }
    if (usedLoops.size !== index.loops.size)
      throw Error("Unconsumed original source loop");
    for (const [token, edge] of index.edges) {
      const entries = uses.get(token);
      if (
        !entries ||
        entries.length !== 2 ||
        entries[0]!.face === entries[1]!.face ||
        entries[0]!.direction !== -entries[1]!.direction ||
        new Set(edge.faceReferences).size !== 2 ||
        entries.some((entry) => !edge.faceReferences.includes(entry.face)) ||
        edge.faceReferences.some((f) => !index.faces.has(f))
      )
        throw Error(
          "Original source edge is open, multiply used, foreign or reverses its shared orientation",
        );
      if (find(`${token}:0`) === find(`${token}:1`))
        throw Error("Original source edge collapses to one abstract vertex");
    }
    const visited = new Set<number>();
    for (const seed of index.faces.keys()) {
      if (visited.has(seed)) continue;
      const queue = [seed],
        faces: number[] = [],
        edges = new Set<number>();
      visited.add(seed);
      for (let i = 0; i < queue.length; i++) {
        const face = queue[i]!;
        faces.push(face);
        for (const edge of faceEdges.get(face)!) {
          edges.add(edge);
          for (const next of index.edges.get(edge)!.faceReferences)
            if (!visited.has(next)) {
              visited.add(next);
              queue.push(next);
            }
        }
      }
      const vertices = new Set(
        [...edges].flatMap((edge) => [find(`${edge}:0`), find(`${edge}:1`)]),
      );
      let manifold = true;
      for (const vertex of vertices) {
        const links = new Map<number, number[]>();
        for (const edge of edges)
          if (find(`${edge}:0`) === vertex || find(`${edge}:1`) === vertex) {
            const [a, b] = index.edges.get(edge)!.faceReferences;
            links.set(a, [...(links.get(a) ?? []), b]);
            links.set(b, [...(links.get(b) ?? []), a]);
          }
        if ([...links.values()].some((neighbors) => neighbors.length !== 2)) {
          manifold = false;
          break;
        }
        const first = links.keys().next().value as number,
          seen = new Set([first]),
          fan = [first];
        for (let i = 0; i < fan.length; i++)
          for (const next of links.get(fan[i]!)!)
            if (!seen.has(next)) {
              seen.add(next);
              fan.push(next);
            }
        if (seen.size !== links.size) {
          manifold = false;
          break;
        }
      }
      const euler = vertices.size - edges.size + faces.length;
      report.components.push({
        faceTokens: faces.sort((a, b) => a - b),
        edgeCount: edges.size,
        abstractVertexCount: vertices.size,
        eulerCharacteristic: euler,
        closedTwoManifoldSourceTopology: manifold && euler === 2,
      });
    }
    report.completeClosedSourceTopology =
      report.components.length > 0 &&
      report.components.every((c) => c.closedTwoManifoldSourceTopology);
    if (!report.completeClosedSourceTopology)
      report.blockers.push(
        "An original source shell has an unsupported vertex fan or non-spherical boundary",
      );
  } catch (error) {
    report.blockers.push(
      error instanceof Error ? error.message : String(error),
    );
  }
  return report;
}

export type OriginalNativeStairSolidReport = {
  version: 1;
  sourceModelSha256: string;
  sourceSchemaSha256: string;
  nativeStairId: number;
  nativeRunId: number;
  nativeDefinitionId: number;
  sourceFrameSha256s: Record<string, string>;
  physicalTreadHistoryBindingComplete: boolean;
  originalSourceTopology: OriginalStairTopologyReport;
  originalExactGeometry: OriginalPlanarPrismReport;
  exactUvCoedgeDiscrepancyCount: number;
  exactTwinFaceEndpointDiscrepancyCount: number;
  originalPhysicalRunBodyApproved: boolean;
  discrepancyInterpretation: "Distinct exact embeddings of shared original source topology are representational discrepancies; this does not establish a real air gap";
  preparedFlightCorrespondenceApproved: false;
  terminalContactsApproved: false;
  ownBodyAndHeadroomClearanceApproved: false;
  routeApproved: false;
};
const certificateBrand: unique symbol = Symbol(
  "OriginalNativeStairSolidCertificate",
);
export type OriginalNativeStairSolidCertificate = {
  readonly [certificateBrand]: true;
  readonly sourceModelSha256: string;
  readonly nativeRunId: number;
  readonly nativeDefinitionId: number;
  readonly geometrySha256: string;
};
const certificates = new WeakMap<
  OriginalNativeStairSolidCertificate,
  OriginalNativeStairSolidReport
>();

/** Issue a run-definition body certificate only when every original face,
 * coedge, twin endpoint and positive finite prism agrees exactly. Tread-role
 * correspondence comes from original source history; authored sketch floats
 * are never substituted for physical planes. Complete stairs, terminal floors,
 * overhead material and runtime qualification remain separate. */
export function proveOriginalNativeStairSolid(
  context: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
):
  | { ok: false; report: OriginalNativeStairSolidReport }
  | {
      ok: true;
      report: OriginalNativeStairSolidReport;
      certificate: OriginalNativeStairSolidCertificate;
    } {
  const facts = readOriginalNativeStairPhysicalSource(context, nativeRunId);
  const roles = inspectOriginalNativeStairPhysicalInventory(
    context,
    nativeRunId,
  );
  const topology = inspectOriginalStairSourceTopology(facts.physicalDefinition),
    geometry = inspectPlanarPrismReplayGeometry(facts.physicalDefinition);
  const report: OriginalNativeStairSolidReport = {
    version: 1,
    sourceModelSha256: facts.sourceModelSha256,
    sourceSchemaSha256: facts.sourceSchemaSha256,
    nativeStairId: facts.nativeStairId,
    nativeRunId: facts.nativeRunId,
    nativeDefinitionId: facts.nativeDefinitionId,
    sourceFrameSha256s: facts.sourceFrameSha256s,
    physicalTreadHistoryBindingComplete: roles.treadHistoryBindingComplete,
    originalSourceTopology: topology,
    originalExactGeometry: geometry,
    exactUvCoedgeDiscrepancyCount: geometry.blockers.filter(
      (b) => b === "Original raw UV coedges do not meet exactly",
    ).length,
    exactTwinFaceEndpointDiscrepancyCount: geometry.blockers.filter(
      (b) =>
        b ===
        "Original twin-face parametrizations do not identify one exact 3D endpoint",
    ).length,
    originalPhysicalRunBodyApproved:
      roles.completeOriginalSourceFaceCensus &&
      roles.treadHistoryBindingComplete &&
      !roles.unsupportedPhysicalFaceTokens.length &&
      !roles.unsupportedPhysicalTreadEdgeTokens.length &&
      topology.completeClosedSourceTopology &&
      geometry.completeExactPrismBody,
    discrepancyInterpretation:
      "Distinct exact embeddings of shared original source topology are representational discrepancies; this does not establish a real air gap",
    preparedFlightCorrespondenceApproved: false,
    terminalContactsApproved: false,
    ownBodyAndHeadroomClearanceApproved: false,
    routeApproved: false,
  };
  if (!report.originalPhysicalRunBodyApproved) return { ok: false, report };
  const geometrySha256 = bytesToHex(
    sha256(new TextEncoder().encode(JSON.stringify(report))),
  );
  const certificate = Object.freeze({
    [certificateBrand]: true as const,
    sourceModelSha256: report.sourceModelSha256,
    nativeRunId,
    nativeDefinitionId: report.nativeDefinitionId,
    geometrySha256,
  });
  certificates.set(certificate, structuredClone(report));
  return { ok: true, report, certificate };
}
export function originalNativeStairSolidPrisms(
  certificate: OriginalNativeStairSolidCertificate,
) {
  const report = certificates.get(certificate);
  if (!report) throw Error("Untrusted original native stair solid certificate");
  return {
    coordinateSpace: "original-owned-run-definition" as const,
    sourceModelSha256: report.sourceModelSha256,
    nativeRunId: report.nativeRunId,
    nativeDefinitionId: report.nativeDefinitionId,
    geometrySha256: certificate.geometrySha256,
    prisms: structuredClone(report.originalExactGeometry.prisms),
    terminalContactsApproved: false as const,
    routeApproved: false as const,
  };
}
