/** Unused mathematical enclosure of an explicitly bounded straight-cap family.
 * This reader cannot qualify source-body semantics, exact solids or walking. */
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalPoint as P2,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import {
  inspectOriginalStairLocalMaterialCells,
  type OriginalStairLocalMaterialCell,
} from "./native-source-stair-local-material.ts";
import { inspectOriginalStairSupportEnvelopes } from "./native-source-stair-support-envelopes.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  walkRevit2027DirectedLoopEdges,
  revit2027DirectedEdgeUvs,
} from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";

type Q = Rational;
type P3 = [Q, Q, Q];
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const cmp = (a: Q, b: Q) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const min = (v: Q[]) => v.reduce((a, b) => (cmp(a, b) < 0 ? a : b));
const max = (v: Q[]) => v.reduce((a, b) => (cmp(a, b) > 0 ? a : b));
const key = (p: readonly Q[]) => p.map((q) => `${q.n}/${q.d}`).join(":");
const xy = (p: P3): P2 => [p[0], p[1]];
const point = (s: Revit2027PlaneSurface, uv: readonly number[]): P3 => {
  if (uv.length !== 2 || uv.some((n) => !Number.isFinite(n)))
    throw Error("Nonfinite source endpoint");
  return [0, 1, 2].map((i) =>
    add(
      add(
        rational(s.origin[i]!),
        mul(rational(s.xVector[i]!), rational(uv[0]!)),
      ),
      mul(rational(s.yVector[i]!), rational(uv[1]!)),
    ),
  ) as P3;
};
const cross = (a: P2, b: P2, c: P2) =>
  sub(
    mul(sub(b[0], a[0]), sub(c[1], a[1])),
    mul(sub(b[1], a[1]), sub(c[0], a[0])),
  );
function hull(input: P2[]): P2[] {
  const sorted = [...new Map(input.map((p) => [key(p), p])).values()].sort(
    (a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]),
  );
  if (sorted.length < 3) return sorted;
  const half = (values: P2[]) => {
    const out: P2[] = [];
    for (const p of values) {
      while (out.length > 1 && cross(out.at(-2)!, out.at(-1)!, p).n <= 0n)
        out.pop();
      out.push(p);
    }
    return out;
  };
  return [
    ...half(sorted).slice(0, -1),
    ...half(sorted.toReversed()).slice(0, -1),
  ];
}
function simple(ring: P2[]) {
  if (ring.length < 3 || ring.length > 4096) return false;
  const on = (p: P2, a: P2, b: P2) =>
    cross(a, b, p).n === 0n &&
    [0, 1].every(
      (i) =>
        cmp(p[i]!, min([a[i]!, b[i]!])) >= 0 &&
        cmp(p[i]!, max([a[i]!, b[i]!])) <= 0,
    );
  let area = rational(0);
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length]!;
    area = add(area, sub(mul(a[0], b[1]), mul(a[1], b[0])));
    for (let j = i + 1; j < ring.length; j++) {
      const c = ring[j]!,
        d = ring[(j + 1) % ring.length]!;
      if (key(a) === key(c)) return false;
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      const u = cross(a, b, c).n,
        v = cross(a, b, d).n,
        w = cross(c, d, a).n,
        x = cross(c, d, b).n;
      if (
        (u && v && w && x && u < 0n !== v < 0n && w < 0n !== x < 0n) ||
        on(a, c, d) ||
        on(b, c, d) ||
        on(c, a, b) ||
        on(d, a, b)
      )
        return false;
    }
  }
  return area.n !== 0n;
}
const union = (parts: NativeRationalParts[]) =>
  parts.length
    ? nativeRationalOverlay("union", parts[0]!, ...parts.slice(1))
    : [];
type Walk = ReturnType<typeof walkRevit2027DirectedLoopEdges> & { ok: true };
export type OriginalStairCapLoftCell = OriginalStairLocalMaterialCell & {
  enclosureRole:
    | "unchanged-source-boundary"
    | "cap-band-boundary-shadow"
    | "residual-boundary-shadow";
};
export type OriginalStairCapLoftComponent = {
  sourceComponentIndex: number;
  originalFaceTokens: number[];
  bottomCapFaceToken: number;
  topCapFaceToken: number;
  originalCapHeightBand: [Q, Q];
  allOriginalDomainAndEmbeddingHeightBand: [Q, Q];
  topToBottomVertexEdges: {
    edgeToken: number;
    topVertex: string;
    bottomVertex: string;
  }[];
  sides: {
    faceToken: number;
    topEdgeToken: number;
    bottomEdgeToken: number;
    verticalEdgeTokens: number[];
    originalPlane: Revit2027PlaneSurface;
    originalDomainCornersFeet: P3[];
    allOriginalVertexEmbeddings: P3[];
    completeProjectedDomain: P2[];
  }[];
  caps: {
    faceToken: number;
    originalPlane: Revit2027PlaneSurface;
    originalReferenceVerticesFeet: P3[];
    referenceEmbedding: NativeRationalParts;
    originalEdgeTokens: number[];
  }[];
  edgeEmbeddingHulls: {
    edgeToken: number;
    originalEndpointEmbeddings: P3[];
    projectedHull: P2[];
  }[];
};

/** Family contract, NOT a source-body capability:
 * - fixed original horizontal cap planes, one simple trim per cap;
 * - every possible straight trim/seam is confined to the convex hull of its
 *   complete ORIGINAL abstract endpoint embeddings; every finite side-domain
 *   and all residual coordinates are retained independently;
 * - complete reciprocal two-cap/quad incidence, including the cyclic vertex
 *   bijection, is required. No existence of an exactly sewn body is asserted.
 *
 * An edge homotopy cannot cross a point outside its endpoint hull. Its winding
 * therefore agrees with the simple cap reference there. Cap reference union
 * all edge hulls encloses every cap in this stated family, including concavities.
 * Side hulls include their full finite original domain and all vertex clusters.
 * For ANY bounded closed set, a vertical fiber through its interior reaches its
 * boundary. Its XY projection is consequently contained in the full boundary
 * shadow. This proves an obstruction SUPERSET, never a positive support set.
 * Outside the two fixed cap heights, that fiber's extreme boundary cannot lie
 * on either cap: only side/seam shadows are retained there. A high side-domain
 * residual therefore never becomes a lid over the complete cap reference.
 *
 * Unknown Geometry commands are retained literally. Whether this family is a
 * valid interpretation of the actual source BODY is a separate required proof.
 * This pure reader never grants that qualification or restores serialized trust.
 */
export function inspectOriginalStairCapLoftEnclosure(
  replay: Revit2027GRepReplay,
) {
  const cells: OriginalStairCapLoftCell[] = [],
    components: OriginalStairCapLoftComponent[] = [],
    blockers: string[] = [];
  const originalGeometryGInfo = replay.spans.find(
    (s) => s.readerId === "Revit2027Geometry",
  )?.value as { gInfo?: unknown } | undefined;
  try {
    if (
      typeof replay.ownerElementId !== "bigint" ||
      replay.spans.some(
        (s, i) =>
          s.replayIndex !== i || s.ownerElementId !== replay.ownerElementId,
      )
    )
      throw Error("Stale, foreign or incomplete original replay");
    // Every native queued child is retained, not rejected merely for existing.
    // Its exact descriptor must resolve to exactly one complete original span.
    if (
      replay.descriptors.length !== replay.spans.length ||
      replay.descriptors.some((d, i) => {
        const s = replay.spans[i];
        return (
          !s ||
          d.descriptorIndex !== i ||
          d.state !== "queued" ||
          d.queueSequence !== s.queueSequence ||
          d.ownerElementId !== replay.ownerElementId ||
          d.parentReplayIndex !== s.parentReplayIndex ||
          d.token !== s.propertyToken ||
          d.sourceClassSlot !== s.propertySourceClassSlot ||
          d.descriptorOffset !== s.descriptorOffset ||
          d.descriptorEndOffset !== s.descriptorEndOffset ||
          JSON.stringify(d.path) !== JSON.stringify(s.path)
        );
      })
    )
      throw Error("Unresolved, stale or reused original FIFO descriptor");
    for (const s of replay.spans) {
      const queued =
        (
          s.value as {
            queuedProperties?: {
              token: number;
              sourceClassSlot: number;
              byteOffset: number;
              endOffset: number;
            }[];
          }
        ).queuedProperties ?? [];
      const children = replay.descriptors.filter(
        (d) => d.parentReplayIndex === s.replayIndex,
      );
      if (
        queued.length !== children.length ||
        queued.some((q, i) => {
          const d = children[i]!;
          return (
            q.token !== d.token ||
            q.sourceClassSlot !== d.sourceClassSlot ||
            q.byteOffset !== d.descriptorOffset ||
            q.endOffset !== d.descriptorEndOffset
          );
        })
      )
        throw Error("Omitted or extra original queued child");
    }
    const geometry = replay.spans.filter(
      (s) => s.readerId === "Revit2027Geometry",
    );
    const declared = geometry[0]?.value as
      | { flags?: number; sharedSurfaceInfo?: { count?: number } }
      | undefined;
    if (
      geometry.length !== 1 ||
      declared?.flags !== 7 ||
      declared.sharedSurfaceInfo?.count !== 0
    )
      throw Error("Unknown original Geometry/body operands");
    const local = inspectOriginalStairLocalMaterialCells(replay),
      global = inspectOriginalStairSupportEnvelopes(replay);
    if (
      !local.allOriginalFaceDomainsEnclosed ||
      !global.completeOriginalStraightPlanarSourceCensus
    )
      throw Error(
        "Complete original straight planar cap/side family unavailable",
      );
    const index = revit2027OwnerMeshIndex(replay),
      planes = new Map<number, Revit2027PlaneSurface>(),
      walks = new Map<number, Walk>(),
      parents = new Map<string, string>();
    const find = (start: string): string => {
      if (!parents.has(start)) parents.set(start, start);
      let root = start;
      while (parents.get(root) !== root) root = parents.get(root)!;
      let at = start;
      while (parents.get(at) !== root) {
        const next = parents.get(at)!;
        parents.set(at, root);
        at = next;
      }
      return root;
    };
    const join = (a: string, b: string) => parents.set(find(a), find(b));
    for (const [token, face] of index.faces) {
      const plane = revit2027OwnerSurface<Revit2027PlaneSurface>(
          index,
          634,
          token,
        ),
        loop = index.loops.get(face.firstLoop.token);
      if (!plane || !loop) throw Error("Missing original face plane/loop");
      const walk = walkRevit2027DirectedLoopEdges({
        faceToken: token,
        loop,
        edges: index.edges,
        loopArity: "open",
      });
      if (!walk.ok) throw Error("Unclosed original face");
      planes.set(token, plane);
      walks.set(token, walk);
      for (const [i, edge] of walk.edges.entries()) {
        const next = walk.edges[(i + 1) % walk.edges.length]!;
        join(
          `${edge.token}:${edge.direction === 1 ? 1 : 0}`,
          `${next.token}:${next.direction === 1 ? 0 : 1}`,
        );
      }
    }
    const vertices = new Map<string, Map<string, P3>>();
    const ends = (token: number) =>
      [find(`${token}:0`), find(`${token}:1`)] as const;
    for (const [token, edge] of index.edges)
      for (const [endpoint, uv] of edge.firstAndLastEdgePoints.entries())
        for (const side of [0, 1] as const) {
          const p = point(
              planes.get(edge.faceReferences[side])!,
              side ? uv.secondFaceUv : uv.firstFaceUv,
            ),
            vertex = find(`${token}:${endpoint}`),
            values = vertices.get(vertex) ?? new Map<string, P3>();
          values.set(key(p), p);
          vertices.set(vertex, values);
        }
    for (const component of global.components) {
      const core = local.cells.find(
        (c) =>
          c.sourceComponentIndex === component.sourceComponentIndex &&
          c.role === "cap-bounded-core",
      );
      if (!core || core.originalFaceTokens.length !== 2)
        throw Error("Missing original two-cap component");
      const [bottom, top] = core.originalFaceTokens as [number, number],
        topWalk = walks.get(top)!,
        bottomWalk = walks.get(bottom)!,
        topVertices = new Set(topWalk.edges.flatMap((e) => [...ends(e.token)])),
        bottomVertices = new Set(
          bottomWalk.edges.flatMap((e) => [...ends(e.token)]),
        );
      if ([...topVertices].some((v) => bottomVertices.has(v)))
        throw Error("Top/bottom source vertices overlap");
      const edgeTokens = [
          ...new Set(
            component.physicalFaceTokens.flatMap((f) =>
              walks.get(f)!.edges.map((e) => e.token),
            ),
          ),
        ],
        verticals = edgeTokens.filter((e) =>
          index.edges
            .get(e)!
            .faceReferences.every((f) => f !== top && f !== bottom),
        );
      const mapping = verticals.map((edgeToken) => {
        const v = ends(edgeToken),
          t = v.filter((x) => topVertices.has(x)),
          b = v.filter((x) => bottomVertices.has(x));
        if (t.length !== 1 || b.length !== 1)
          throw Error("Non-bijective original vertical endpoint incidence");
        return { edgeToken, topVertex: t[0]!, bottomVertex: b[0]! };
      });
      if (
        topWalk.edges.length !== bottomWalk.edges.length ||
        topWalk.edges.length !== mapping.length ||
        new Set(mapping.map((m) => m.topVertex)).size !== topVertices.size ||
        new Set(mapping.map((m) => m.bottomVertex)).size !== bottomVertices.size
      )
        throw Error("Incomplete original cap vertex bijection");
      const capParts: NativeRationalParts[] = [],
        uncertaintyParts: NativeRationalParts[] = [],
        uncertaintySegments: P2[][] = [],
        allPoints: P3[] = [];
      const addHull = (points: P3[]) => {
        const projected = hull(points.map(xy));
        allPoints.push(...points);
        if (projected.length >= 3) uncertaintyParts.push([[projected]]);
        else if (projected.length) uncertaintySegments.push(projected);
        return projected;
      };
      const capRows = [bottom, top].map((faceToken) => {
        const walk = walks.get(faceToken)!,
          plane = planes.get(faceToken)!,
          ring = walk.edges.map((e) =>
            xy(point(plane, revit2027DirectedEdgeUvs(e)[0]!)),
          );
        if (!simple(ring)) throw Error("Original cap reference is not simple");
        const referenceEmbedding: NativeRationalParts = [[ring]];
        capParts.push(referenceEmbedding);
        return {
          faceToken,
          originalPlane: plane,
          originalReferenceVerticesFeet: walk.edges.map((e) =>
            point(plane, revit2027DirectedEdgeUvs(e)[0]!),
          ),
          referenceEmbedding,
          originalEdgeTokens: walk.edges.map((e) => e.token),
        };
      });
      const edgeEmbeddingHulls = [...topWalk.edges, ...bottomWalk.edges].map(
        (edge) => {
          const originalEndpointEmbeddings = ends(edge.token).flatMap((v) => [
            ...vertices.get(v)!.values(),
          ]);
          return {
            edgeToken: edge.token,
            originalEndpointEmbeddings,
            projectedHull: addHull(originalEndpointEmbeddings),
          };
        },
      );
      const sides = component.physicalFaceTokens
        .filter((f) => f !== top && f !== bottom)
        .map((faceToken) => {
          const walk = walks.get(faceToken)!,
            t = walk.edges.filter((e) => e.edge.faceReferences.includes(top)),
            b = walk.edges.filter((e) =>
              e.edge.faceReferences.includes(bottom),
            ),
            vertical = walk.edges.filter((e) => verticals.includes(e.token));
          if (
            walk.edges.length !== 4 ||
            t.length !== 1 ||
            b.length !== 1 ||
            vertical.length !== 2
          )
            throw Error("Original side does not join one top/bottom edge");
          const mapped = ends(t[0]!.token)
              .map((v) => mapping.find((m) => m.topVertex === v)?.bottomVertex)
              .sort(),
            lower = [...ends(b[0]!.token)].sort();
          if (mapped.some((v, i) => !v || v !== lower[i]))
            throw Error(
              "Crossed or foreign original cap-to-side correspondence",
            );
          const plane = planes.get(faceToken)!,
            e = plane.surface.envelope,
            sourceDomain = [
              [e.firstCorner[0], e.firstCorner[1]],
              [e.firstCorner[0], e.secondCorner[1]],
              [e.secondCorner[0], e.firstCorner[1]],
              [e.secondCorner[0], e.secondCorner[1]],
            ].map((uv) => point(plane, uv));
          const allOriginalVertexEmbeddings = walk.edges.flatMap((edge) =>
            [...ends(edge.token)].flatMap((v) => [
              ...vertices.get(v)!.values(),
            ]),
          );
          const complete = [...sourceDomain, ...allOriginalVertexEmbeddings];
          return {
            faceToken,
            topEdgeToken: t[0]!.token,
            bottomEdgeToken: b[0]!.token,
            verticalEdgeTokens: vertical.map((e) => e.token),
            originalPlane: plane,
            originalDomainCornersFeet: sourceDomain,
            allOriginalVertexEmbeddings,
            completeProjectedDomain: addHull(complete),
          };
        });
      if (sides.length !== topWalk.edges.length)
        throw Error("Original cap/side count mismatch");
      allPoints.push(
        ...capRows.flatMap((c) =>
          walks
            .get(c.faceToken)!
            .edges.flatMap((e) =>
              revit2027DirectedEdgeUvs(e).map((uv) =>
                point(planes.get(c.faceToken)!, uv),
              ),
            ),
        ),
      );
      const allZ = allPoints.map((p) => p[2]),
        low = min(allZ),
        high = max(allZ),
        nonCapShadow = union(uncertaintyParts),
        shadow = union([...capParts, nonCapShadow]);
      if (!shadow.length) throw Error("Empty original boundary shadow");
      cells.push(
        ...local.cells
          .filter(
            (c) =>
              c.sourceComponentIndex === component.sourceComponentIndex &&
              c.role === "original-boundary-domain",
          )
          .map((c) => ({
            ...c,
            enclosureRole: "unchanged-source-boundary" as const,
          })),
      );
      cells.push({
        ...core,
        partsFeet: shadow,
        closedSegmentsFeet: uncertaintySegments,
        enclosureRole: "cap-band-boundary-shadow",
      });
      for (const [lo, hi] of [
        [low, core.minimumElevationFeet],
        [core.maximumElevationFeet, high],
      ] as const)
        if (cmp(lo, hi) < 0)
          cells.push({
            sourceComponentIndex: component.sourceComponentIndex,
            role: "original-boundary-domain",
            originalFaceTokens: [],
            partsFeet: nonCapShadow,
            closedSegmentsFeet: uncertaintySegments,
            minimumElevationFeet: lo,
            maximumElevationFeet: hi,
            enclosureRole: "residual-boundary-shadow",
          });
      components.push({
        sourceComponentIndex: component.sourceComponentIndex,
        originalFaceTokens: [...component.physicalFaceTokens],
        bottomCapFaceToken: bottom,
        topCapFaceToken: top,
        originalCapHeightBand: [
          core.minimumElevationFeet,
          core.maximumElevationFeet,
        ],
        allOriginalDomainAndEmbeddingHeightBand: [low, high],
        topToBottomVertexEdges: mapping,
        sides,
        caps: capRows,
        edgeEmbeddingHulls,
      });
    }
    if (
      components.flatMap((c) => c.originalFaceTokens).length !==
        index.faces.size ||
      new Set(components.flatMap((c) => c.originalFaceTokens)).size !==
        index.faces.size
    )
      throw Error("Original boundary shadow omitted a component face");
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  return {
    cells: blockers.length ? [] : cells,
    components: blockers.length ? [] : components,
    blockers,
    completeStatedBoundaryFamilyEnclosure: blockers.length === 0,
    originalGeometryGInfo: originalGeometryGInfo?.gInfo,
    sourceBodyQualificationRequired: true as const,
    originalSourceAuthorityGranted: false as const,
    exactClosedPhysicalBodyApproved: false as const,
    supportApproved: false as const,
    routeApproved: false as const,
  };
}
