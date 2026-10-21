/** Conservative support/obstacle operands from every original endpoint
 * embedding. Topological vertex identity is retained; coordinates are never
 * welded, snapped, averaged or assigned an epsilon. These are bounded source
 * uncertainty operands, not a certificate of one exact closed physical body. */
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalParts,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  revit2027DirectedEdgeUvs,
  walkRevit2027DirectedLoopEdges,
} from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import { inspectOriginalStairSourceTopology } from "./native-source-stair-solid-proof.ts";
import { originalStairPlanarFaceReversal } from "./native-source-stair-face-orientation.ts";
import {
  inspectOriginalNativeStairPhysicalInventory,
  readOriginalNativeStairPhysicalSource,
  type OriginalNativeStairPhysicalContext,
} from "./native-source-stair-physical-inventory.ts";

type Q = Rational;
type P2 = NativeRationalPoint;
type P3 = [Q, Q, Q];
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const cmp = (a: Q, b: Q) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const key = (p: readonly Q[]) => p.map((v) => `${v.n}/${v.d}`).join(":");
const cross = (a: P2, b: P2, c: P2) =>
  sub(
    mul(sub(b[0], a[0]), sub(c[1], a[1])),
    mul(sub(b[1], a[1]), sub(c[0], a[0])),
  );
const point = (plane: Revit2027PlaneSurface, uv: readonly number[]): P3 =>
  [0, 1, 2].map((i) =>
    add(
      add(
        rational(plane.origin[i]!),
        mul(rational(plane.xVector[i]!), rational(uv[0]!)),
      ),
      mul(rational(plane.yVector[i]!), rational(uv[1]!)),
    ),
  ) as P3;
const xy = (p: P3): P2 => [p[0], p[1]];
function hull(input: readonly P2[]): P2[] {
  const sorted = [...new Map(input.map((p) => [key(p), p])).values()].sort(
    (a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]),
  );
  if (sorted.length < 3) return sorted;
  const chain = (values: readonly P2[]) => {
    const out: P2[] = [];
    for (const p of values) {
      while (out.length > 1 && cross(out.at(-2)!, out.at(-1)!, p).n <= 0n)
        out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = chain(sorted),
    upper = chain([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function simple(ring: readonly P2[]): boolean {
  if (ring.length < 3 || ring.length > 4096) return false;
  let area = new Rational(0n);
  const on = (p: P2, a: P2, b: P2) =>
    cross(a, b, p).n === 0n &&
    cmp(p[0], cmp(a[0], b[0]) < 0 ? a[0] : b[0]) >= 0 &&
    cmp(p[0], cmp(a[0], b[0]) > 0 ? a[0] : b[0]) <= 0 &&
    cmp(p[1], cmp(a[1], b[1]) < 0 ? a[1] : b[1]) >= 0 &&
    cmp(p[1], cmp(a[1], b[1]) > 0 ? a[1] : b[1]) <= 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    area = add(area, sub(mul(a[0], b[1]), mul(b[0], a[1])));
    for (let j = i + 1; j < ring.length; j++) {
      if (key(a) === key(ring[j]!)) return false;
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      const c = ring[j]!,
        d = ring[(j + 1) % ring.length]!,
        u = cross(a, b, c).n,
        v = cross(a, b, d).n,
        w = cross(c, d, a).n,
        x = cross(c, d, b).n;
      if (u < 0n !== v < 0n && w < 0n !== x < 0n && u && v && w && x)
        return false;
      if (on(a, c, d) || on(b, c, d) || on(c, a, b) || on(d, a, b))
        return false;
    }
  }
  return area.n !== 0n;
}
const polygon = (ring: P2[]): NativeRationalParts =>
  ring.length < 3 ? [] : nativeRationalOverlay("union", [[ring]]);
const union = (parts: readonly NativeRationalParts[]) =>
  parts.length
    ? nativeRationalOverlay("union", parts[0]!, ...parts.slice(1))
    : [];

export type OriginalSourceCapEnvelope = {
  physicalFaceToken: number;
  physicalFaceTag: number;
  sourceComponentIndex: number;
  originalPhysicalPlaneHeightFeet: Q;
  allEndpointEmbeddingHeightBand: [Q, Q];
  /** Reference winding operand only: not a replacement original source face. */
  referenceEmbedding: NativeRationalParts;
  boundaryUncertainty: NativeRationalParts;
  guaranteedInnerPlanSupport: NativeRationalParts;
  originalEdgeTokens: number[];
};
export type OriginalSourceComponentEnvelope = {
  sourceComponentIndex: number;
  physicalFaceTokens: number[];
  originalEdgeCount: number;
  allEndpointEmbeddingHeightBand: [Q, Q];
  /** Obstruction superset only. Never positive walking support. */
  conservativeOuterPlanEnvelope: NativeRationalParts;
};
export type OriginalSourceSupportEnvelopeReport = {
  sourceFaceCount: number;
  sourceEdgeCount: number;
  abstractSourceVertexCount: number;
  sourceEndpointEmbeddingCount: number;
  sourceVerticesWithCompetingEmbeddings: number;
  completeOriginalStraightPlanarSourceCensus: boolean;
  caps: OriginalSourceCapEnvelope[];
  components: OriginalSourceComponentEnvelope[];
  blockers: string[];
  coordinatesChanged: false;
  originalSourceAuthorityGranted: false;
  exactClosedPhysicalBodyApproved: false;
  routeApproved: false;
};

/** For each source edge, every straight segment between any of its original
 * endpoint embeddings lies in their convex hull. During a vertex homotopy,
 * boundaries can move only inside these edge hulls. A point with nonzero
 * reference winding outside their union therefore stays in every closed
 * embedding in this explicitly bounded family. Exact rational differences
 * keep every positive uncertainty strip, however small. Holes/curved faces
 * are refused here rather than filled or linearized. */
export function inspectOriginalStairSupportEnvelopes(
  replay: Revit2027GRepReplay,
): OriginalSourceSupportEnvelopeReport {
  const report: OriginalSourceSupportEnvelopeReport = {
    sourceFaceCount: 0,
    sourceEdgeCount: 0,
    abstractSourceVertexCount: 0,
    sourceEndpointEmbeddingCount: 0,
    sourceVerticesWithCompetingEmbeddings: 0,
    completeOriginalStraightPlanarSourceCensus: false,
    caps: [],
    components: [],
    blockers: [],
    coordinatesChanged: false,
    originalSourceAuthorityGranted: false,
    exactClosedPhysicalBodyApproved: false,
    routeApproved: false,
  };
  try {
    const topology = inspectOriginalStairSourceTopology(replay);
    if (!topology.completeClosedSourceTopology)
      throw Error("Original source topology is incomplete or unsupported");
    const index = revit2027OwnerMeshIndex(replay),
      allowed = new Set([
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
      ) ||
      replay.spans.filter((s) => s.readerId === "Revit2027Geometry").length !==
        1
    )
      throw Error("Unsupported original source branch");
    const tokens = replay.spans.map((s) => s.propertyToken);
    const declared = replay.spans.find(
      (s) => s.readerId === "Revit2027Geometry",
    )!.value as {
      faces: { count: number; entries: { token: number }[] };
      edges: { count: number; entries: { token: number }[] };
    };
    const equalTokens = (
      entries: { token: number }[],
      actual: Iterable<number>,
    ) =>
      JSON.stringify(entries.map((e) => e.token).sort((a, b) => a - b)) ===
      JSON.stringify([...actual].sort((a, b) => a - b));
    if (
      new Set(tokens).size !== tokens.length ||
      !declared ||
      declared.faces.count !== index.faces.size ||
      declared.edges.count !== index.edges.size ||
      !equalTokens(declared.faces.entries, index.faces.keys()) ||
      !equalTokens(declared.edges.entries, index.edges.keys()) ||
      replay.spans.filter((s) => s.readerId === "Revit2027AnalyticSurface:634")
        .length !== index.faces.size
    )
      throw Error("Incomplete original declared face/edge/plane census");
    report.sourceFaceCount = index.faces.size;
    report.sourceEdgeCount = index.edges.size;
    const parents = new Map<string, string>();
    const find = (a: string): string => {
      if (!parents.has(a)) parents.set(a, a);
      let root = a;
      while (parents.get(root) !== root) root = parents.get(root)!;
      while (parents.get(a) !== root) {
        const next = parents.get(a)!;
        parents.set(a, root);
        a = next;
      }
      return root;
    };
    const join = (a: string, b: string) => {
      a = find(a);
      b = find(b);
      if (a !== b) parents.set(a, b);
    };
    const planes = new Map<number, Revit2027PlaneSurface>(),
      faceWalks = new Map<
        number,
        ReturnType<typeof walkRevit2027DirectedLoopEdges> & { ok: true }
      >();
    for (const [token, face] of index.faces) {
      const plane = revit2027OwnerSurface<Revit2027PlaneSurface>(
          index,
          634,
          token,
        ),
        loop = index.loops.get(face.firstLoop.token);
      if (
        !plane ||
        plane.kind !== "plane" ||
        face.cutType !== 0 ||
        originalStairPlanarFaceReversal(face.faceFlags, plane) === undefined ||
        !loop ||
        loop.loop.nextLoop.token !== 0 ||
        face.faceRegions.count ||
        [...plane.origin, ...plane.xVector, ...plane.yVector].some(
          (n) => !Number.isFinite(n),
        )
      )
        throw Error("Unsupported original face/plane/hole semantics");
      const walked = walkRevit2027DirectedLoopEdges({
        faceToken: token,
        loop,
        edges: index.edges,
        loopArity: "open",
      });
      if (!walked.ok) throw Error("Original source coedge loop does not close");
      planes.set(token, plane);
      faceWalks.set(token, walked);
      for (const [i, edge] of walked.edges.entries()) {
        if (edge.edge.interiorEdgePoints.length)
          throw Error(
            "Original curved edge cannot acquire a straight uncertainty envelope",
          );
        const next = walked.edges[(i + 1) % walked.edges.length]!;
        join(
          `${edge.token}:${edge.direction === 1 ? 1 : 0}`,
          `${next.token}:${next.direction === 1 ? 0 : 1}`,
        );
      }
    }
    const vertices = new Map<string, Map<string, P3>>();
    for (const [token, edge] of index.edges)
      for (const [endpoint, p] of edge.firstAndLastEdgePoints.entries())
        for (const side of [0, 1] as const) {
          const plane = planes.get(edge.faceReferences[side]);
          if (!plane) throw Error("Missing original adjacent plane");
          const original = point(plane, side ? p.secondFaceUv : p.firstFaceUv),
            vertex = find(`${token}:${endpoint}`),
            list = vertices.get(vertex) ?? new Map<string, P3>();
          list.set(key(original), original);
          vertices.set(vertex, list);
        }
    report.abstractSourceVertexCount = vertices.size;
    report.sourceEndpointEmbeddingCount = [...vertices.values()].reduce(
      (n, v) => n + v.size,
      0,
    );
    report.sourceVerticesWithCompetingEmbeddings = [
      ...vertices.values(),
    ].filter((v) => v.size > 1).length;
    const faceToComponent = new Map<number, number>();
    for (const [componentIndex, component] of topology.components.entries()) {
      const edgeTokens = new Set<number>();
      for (const face of component.faceTokens) {
        faceToComponent.set(face, componentIndex);
        for (const edge of faceWalks.get(face)!.edges)
          edgeTokens.add(edge.token);
      }
      const all = [
        ...new Set(
          [...edgeTokens].flatMap((token) => [
            find(`${token}:0`),
            find(`${token}:1`),
          ]),
        ),
      ].flatMap((vertex) => [...vertices.get(vertex)!.values()]);
      const zs = all.map((p) => p[2]),
        low = zs.reduce((a, b) => (cmp(a, b) < 0 ? a : b)),
        high = zs.reduce((a, b) => (cmp(a, b) > 0 ? a : b));
      report.components.push({
        sourceComponentIndex: componentIndex,
        physicalFaceTokens: component.faceTokens,
        originalEdgeCount: edgeTokens.size,
        allEndpointEmbeddingHeightBand: [low, high],
        conservativeOuterPlanEnvelope: polygon(hull(all.map(xy))),
      });
    }
    for (const [token, plane] of planes) {
      const normal =
        sub(
          mul(rational(plane.xVector[0]), rational(plane.yVector[1])),
          mul(rational(plane.xVector[1]), rational(plane.yVector[0])),
        ).n * (plane.surface.orientFlag ? 1n : -1n) *
        BigInt(originalStairPlanarFaceReversal(index.faces.get(token)!.faceFlags, plane)!);
      if (plane.xVector[2] !== 0 || plane.yVector[2] !== 0 || normal <= 0n)
        continue;
      const walked = faceWalks.get(token)!,
        reference: P2[] = [],
        edgeUncertainty: NativeRationalParts[] = [];
      const all: P3[] = [];
      for (const edge of walked.edges) {
        const uv = revit2027DirectedEdgeUvs(edge);
        if (uv.length !== 2)
          throw Error("Unsupported original cap coedge samples");
        reference.push(xy(point(plane, uv[0]!)));
        const candidates = [
          ...[...vertices.get(find(`${edge.token}:0`))!.values()],
          ...[...vertices.get(find(`${edge.token}:1`))!.values()],
        ];
        all.push(...candidates);
        const swept = hull(candidates.map(xy));
        if (swept.length > 2) edgeUncertainty.push(polygon(swept));
      }
      if (!simple(reference))
        throw Error(
          "Original cap reference embedding is not a simple positive ring",
        );
      const referenceEmbedding = polygon(reference);
      if (!referenceEmbedding.length)
        throw Error("Original reference winding has no positive cap interior");
      // Overlay supplies validity/partitioning, not a body authority. Preserve all
      // positive source boundary uncertainty; zero-area exact edges add no fill.
      const boundaryUncertainty = union(edgeUncertainty),
        guaranteedInnerPlanSupport = boundaryUncertainty.length
          ? nativeRationalOverlay(
              "difference",
              referenceEmbedding,
              boundaryUncertainty,
            )
          : referenceEmbedding;
      const zs = all.map((p) => p[2]);
      report.caps.push({
        physicalFaceToken: token,
        physicalFaceTag: index.faces.get(token)!.gInfo.tag,
        sourceComponentIndex: faceToComponent.get(token)!,
        originalPhysicalPlaneHeightFeet: rational(plane.origin[2]),
        allEndpointEmbeddingHeightBand: [
          zs.reduce((a, b) => (cmp(a, b) < 0 ? a : b)),
          zs.reduce((a, b) => (cmp(a, b) > 0 ? a : b)),
        ],
        referenceEmbedding,
        boundaryUncertainty,
        guaranteedInnerPlanSupport,
        originalEdgeTokens: walked.edges.map((edge) => edge.token),
      });
    }
    report.completeOriginalStraightPlanarSourceCensus = true;
  } catch (error) {
    report.blockers.push(
      error instanceof Error ? error.message : String(error),
    );
  }
  return report;
}

export function inspectOriginalNativeStairSupportEnvelopes(
  context: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
) {
  const source = readOriginalNativeStairPhysicalSource(context, nativeRunId),
    inventory = inspectOriginalNativeStairPhysicalInventory(
      context,
      nativeRunId,
    ),
    report = inspectOriginalStairSupportEnvelopes(source.physicalDefinition);
  return {
    sourceModelSha256: source.sourceModelSha256,
    sourceSchemaSha256: source.sourceSchemaSha256,
    nativeStairId: source.nativeStairId,
    nativeRunId,
    nativeDefinitionId: source.nativeDefinitionId,
    sourceFrameSha256s: source.sourceFrameSha256s,
    completeOriginalSourceFaceCensus:
      inventory.completeOriginalSourceFaceCensus,
    originalTreadHistoryBindingComplete: inventory.treadHistoryBindingComplete,
    originalWalkingFaceTokens: inventory.treads.map((t) => ({
      typedIndex: t.typedIndex,
      physicalFaceToken: t.physicalFaceToken,
    })),
    sourceBoundOriginalOperands: true as const,
    ...report,
    terminalContactsApproved: false as const,
    ownBodyAndHeadroomClearanceApproved: false as const,
  };
}
