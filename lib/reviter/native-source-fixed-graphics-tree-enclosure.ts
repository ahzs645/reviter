/** Conservative fixed original graphics operands. This union does not select
 * a target/view, prove walking support, or grant source/route authority. */
import {
  Rational,
  rational,
} from "./native-rational-overlay.ts";
import type {
  Revit2027GRepReplay,
} from "./revit-2027-grep-replay.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import { inspectOriginalWallTrimObstacleBranches } from "./native-source-wall-trim-obstacles.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  walkRevit2027DirectedLoopEdges,
  revit2027DirectedEdgeUvs,
} from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import type { Revit2027GLine } from "./revit-2027-gline.ts";
import type { Revit2027GPoint } from "./revit-2027-gpoint.ts";
import type { Revit2027GBiFlipControl } from "./revit-2027-gbi-flip-control.ts";

type Q3 = [Rational, Rational, Rational];
type Matrix = Rational[][];
type RecordValue = Record<string, unknown>;
const add = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) =>
  new Rational(a.n * b.n, a.d * b.d);
const cmp = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const cross = (a: Q3, b: Q3): Q3 => [
  sub(mul(a[1], b[2]), mul(a[2], b[1])),
  sub(mul(a[2], b[0]), mul(a[0], b[2])),
  sub(mul(a[0], b[1]), mul(a[1], b[0])),
];
const dot = (a: Q3, b: Q3) =>
  add(add(mul(a[0], b[0]), mul(a[1], b[1])), mul(a[2], b[2]));
const validId = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= 0x7fffffff;
const hash = (v: string) => /^[a-f0-9]{64}$/.test(v);
/** Decoder contract pin, not a source capability. The actual-RVT wrapper must
 * check its module bytes and the complete original schema independently. */
export const ORIGINAL_FIXED_GRAPHICS_BIFLIP_DECODER_SHA256 =
  "3372e4e66b33f92a588d73aa56e21d55b3701bfaae53e8ad626f00ece64d35af";
const finite = (v: readonly number[], count: number) =>
  v.length === count && v.every(Number.isFinite);
const record = (v: unknown): RecordValue => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Missing original graphics record");
  return v as RecordValue;
};
const identity = (): Matrix => Array.from({ length: 4 }, (_, i) =>
  Array.from({ length: 4 }, (_, j) => rational(Number(i === j))),
);
function product(a: Matrix, b: Matrix): Matrix {
  return a.map((row) => b[0]!.map((_, j) => row.reduce(
    (n, q, k) => add(n, mul(q, b[k]![j]!)), rational(0),
  )));
}
function transform(m: Matrix, p: Q3, vector = false): Q3 {
  return [0, 1, 2].map((i) => p.reduce(
    (n, q, j) => add(n, mul(m[i]![j]!, q)),
    vector ? rational(0) : m[i]![3]!,
  )) as Q3;
}
function planePoint(s: Revit2027PlaneSurface, uv: readonly number[]): Q3 {
  if (!finite(uv, 2) || !finite(s.origin, 3) || !finite(s.xVector, 3) || !finite(s.yVector, 3))
    throw Error("Nonfinite original plane/control");
  return [0, 1, 2].map((i) => add(add(rational(s.origin[i]!), mul(rational(s.xVector[i]!), rational(uv[0]!))), mul(rational(s.yVector[i]!), rational(uv[1]!)))) as Q3;
}

export type OriginalFixedGraphicsNode = {
  nativeElementId: number;
  originalFrameSha256: string;
  replay: Revit2027GRepReplay;
};
export type OriginalFixedGraphicsContract = {
  /** Must be rebuilt from the actual original schema by the source wrapper. */
  sourceSchemaSha256: string;
  gBiFlipControl: {
    sourceClassSlot: 2219;
    originalClassName: "GBiFlipControl";
    originalAncestorNames: string[];
    originalDerivedFieldNames: string[];
    originalBodyBytes: 76;
    role: "non-solid-annotation-control-no-child-or-material-operands";
    decoderSourceSha256: string;
  };
};
export type OriginalFixedGraphicsOperands = {
  mode: "all-original-fixed-graphics-branches-v1";
  sourceModelSha256: string;
  sourceSchemaSha256: string;
  rootNativeElementIds: number[];
  nodes: OriginalFixedGraphicsNode[];
  contracts: OriginalFixedGraphicsContract;
};
export type OriginalFixedGraphicsEnclosure = {
  nativeRootId: number;
  sourceGeometryOwnerElementId: number;
  originalFrameSha256: string;
  originalInstancePath: { ownerId: number; sourceReplayIndex: number; definitionId: number }[];
  kind: "original-planar-component-envelope" | "original-auxiliary-plane-domain" | "original-reference-edge-envelope" | "original-GLine" | "original-GPoint" | "original-control-origin";
  originalFaceTokens: number[];
  originalSourceReplayIndices: number[];
  pointsFeet: Q3[];
  separatingAxes: Q3[];
};
const authority = {
  originalSourceAuthorityGranted: false as const,
  walkingSupportApproved: false as const,
  indoorCellApproved: false as const,
  routeApproved: false as const,
};
type Descriptor = { token: number; sourceClassSlot: number; byteOffset: number; endOffset: number };
function descriptorList(value: unknown): Descriptor[] {
  if (!Array.isArray(value)) throw Error("Missing original declared children");
  return value as Descriptor[];
}
function validateFullReplay(replay: Revit2027GRepReplay, contract: OriginalFixedGraphicsContract) {
  const allowed = new Map([
    ["Revit2027GGroup", 2248], ["Revit2027GFilter", 2254],
    ["Revit2027GConditionDir", 2235], ["Revit2027GConditionInt", 2238],
    ["Revit2027Geometry", 2343], ["Revit2027Face", 1825],
    ["Revit2027GEdge", 1423], ["Revit2027EdgeLoop", 1434],
    ["Revit2027AnalyticSurface:634", 634], ["Revit2027GFilling", 2253],
    ["Revit2027GLine", 1973], ["Revit2027GPoint", 2271],
    ["Revit2027GInstance", 2215], ["Revit2027InstanceInfo", 2513],
    ["Revit2027GBiFlipControl", 2219],
  ]);
  if (!replay.spans.length || replay.spans.length > 100000 || replay.descriptors.some((d) => d.state === "reused"))
    throw Error("Empty, oversized or reused original graphics tree");
  const queued = replay.descriptors.filter((d) => d.state === "queued");
  if (queued.length !== replay.spans.length) throw Error("Unconsumed original tree descriptor");
  const positive = replay.spans.filter((s) => s.propertyToken > 0);
  if (new Set(positive.map((s) => s.propertyToken)).size !== positive.length)
    throw Error("Aliased original graphics property token");
  for (const [i, s] of replay.spans.entries()) {
    if (s.replayIndex !== i || s.ownerElementId !== replay.ownerElementId ||
      allowed.get(s.readerId) !== s.propertySourceClassSlot ||
      (s.parentReplayIndex !== null && (!Number.isSafeInteger(s.parentReplayIndex) || s.parentReplayIndex < 0 || s.parentReplayIndex >= i)))
      throw Error("Unknown original graphics class/owner/ancestry");
    const ds = queued.filter((d) => d.queueSequence === s.queueSequence);
    if (ds.length !== 1 || ds[0]!.token !== s.propertyToken || ds[0]!.sourceClassSlot !== s.propertySourceClassSlot ||
      ds[0]!.ownerElementId !== s.ownerElementId || ds[0]!.parentReplayIndex !== s.parentReplayIndex ||
      ds[0]!.descriptorOffset !== s.descriptorOffset || ds[0]!.descriptorEndOffset !== s.descriptorEndOffset)
      throw Error("Foreign/stale original descriptor consumer");
    const v = record(s.value), children = replay.spans.filter((c) => c.parentReplayIndex === i);
    if (v.gInfo && s.readerId !== "Revit2027GBiFlipControl" && s.readerId !== "Revit2027Geometry" && record(v.gInfo).controlCommand !== 0)
      throw Error("Unknown geometry-changing original graphics command");
    if (s.readerId === "Revit2027GGroup" || s.readerId === "Revit2027GFilter") {
      const group = s.readerId === "Revit2027GFilter" ? record(v.group) : v;
      if (record(group.gInfo).controlCommand !== 0) throw Error("Unknown geometry-changing original group control");
      const declared = [...descriptorList(group.children), ...(s.readerId === "Revit2027GFilter" ? descriptorList(v.conditions) : [])];
      if (s.readerId === "Revit2027GFilter" && v.isNestedDetailFamily !== false)
        throw Error("Unqualified original nested detail-family resolution");
      if (declared.length !== children.length || declared.some((d) => children.filter((c) => c.propertyToken === d.token && c.propertySourceClassSlot === d.sourceClassSlot && c.descriptorOffset === d.byteOffset && c.descriptorEndOffset === d.endOffset).length !== 1))
        throw Error("Missing/extra original group/filter operand");
    } else if (s.readerId === "Revit2027GConditionDir" || s.readerId === "Revit2027GConditionInt") {
      const parent = s.parentReplayIndex === null ? undefined : replay.spans[s.parentReplayIndex];
      if (parent?.readerId !== "Revit2027GFilter" || children.length || !Number.isSafeInteger(v.compareMode))
        throw Error("Unbound original visibility condition");
      if (s.readerId === "Revit2027GConditionDir" && (!Array.isArray(v.direction) || !finite(v.direction, 3) || v.direction.every((n) => n === 0) || typeof v.negateDirectionCondition !== "boolean"))
        throw Error("Invalid original direction condition");
      if (s.readerId === "Revit2027GConditionInt" && (!Number.isSafeInteger(v.parameter) || !Number.isSafeInteger(v.value)))
        throw Error("Invalid original integer condition");
    } else if (s.readerId === "Revit2027Geometry") {
      // GInfo is retained literally. Neither the schema nor the pinned native
      // traversal currently establishes a nonzero command's effect on material
      // or coordinates. An all-visibility union cannot resolve that uncertainty.
      if (record(v.gInfo).controlCommand !== 0)
        throw Error(`Unqualified original Geometry controlCommand ${String(record(v.gInfo).controlCommand)}`);
    } else if (s.readerId === "Revit2027GBiFlipControl") {
      const c = contract.gBiFlipControl, value = s.value as Revit2027GBiFlipControl;
      if (c.sourceClassSlot !== 2219 || c.originalClassName !== "GBiFlipControl" ||
        c.role !== "non-solid-annotation-control-no-child-or-material-operands" ||
        !c.originalAncestorNames.includes("GControl") || !c.originalAncestorNames.includes("GNode") ||
        JSON.stringify(c.originalDerivedFieldNames) !== JSON.stringify(["m_origin", "m_base", "m_length"]) ||
        c.originalBodyBytes !== 76 || c.decoderSourceSha256 !== ORIGINAL_FIXED_GRAPHICS_BIFLIP_DECODER_SHA256 ||
        s.endOffset - s.startOffset !== 76 || children.length ||
        !finite(value.origin, 3) || !finite(value.base, 3) || !Number.isFinite(value.length) || value.length < 0)
        throw Error("Unqualified original annotation/control role or operand");
    }
  }
}

/** A mathematical projection of the ORIGINAL Geometry operands only. The full
 * replay is checked above, and every complement is separately retained below.
 * Only replay indices are renumbered; all source tokens/values/UVs stay exact. */
function geometryView(replay: Revit2027GRepReplay): Revit2027GRepReplay {
  const selected = new Set<number>();
  for (const s of replay.spans)
    if (s.readerId === "Revit2027Geometry" || (s.parentReplayIndex !== null && selected.has(s.parentReplayIndex))) selected.add(s.replayIndex);
  const spans = replay.spans.filter((s) => selected.has(s.replayIndex)), indices = new Map(spans.map((s, i) => [s.replayIndex, i]));
  return { ...replay, spans: spans.map((s, i) => ({ ...s, replayIndex: i, parentReplayIndex: s.parentReplayIndex === null ? null : indices.get(s.parentReplayIndex) ?? null })) };
}
type LocalCell = Omit<OriginalFixedGraphicsEnclosure, "nativeRootId" | "sourceGeometryOwnerElementId" | "originalFrameSha256" | "originalInstancePath">;
function localCells(replay: Revit2027GRepReplay): LocalCell[] {
  const cells: LocalCell[] = [], index = revit2027OwnerMeshIndex(replay);
  if (index.faces.size) {
    const guarded = inspectOriginalWallTrimObstacleBranches(geometryView(replay));
    if (!guarded.ok) throw Error(guarded.blockers.join(";"));
    const remaining = new Set([...index.faces].filter(([, f]) => f.firstLoop.token > 0).map(([t]) => t));
    const materialFaces = new Set(remaining);
    while (remaining.size) {
      const component = new Set<number>(), todo = [remaining.values().next().value!];
      while (todo.length) { const token = todo.pop()!; if (component.has(token)) continue; component.add(token); remaining.delete(token);
        for (const e of index.edges.values()) if (e.faceReferences.includes(token))
          for (const other of e.faceReferences) if (materialFaces.has(other) && !component.has(other)) todo.push(other);
      }
      const points: Q3[] = [], axes: Q3[] = [];
      for (const token of component) {
        const face = index.faces.get(token)!, plane = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, token);
        if (!plane || plane.kind !== "plane") throw Error("Unknown original component surface");
        axes.push(cross(plane.xVector.map(rational) as Q3, plane.yVector.map(rational) as Q3));
        const corners = [plane.surface.envelope.firstCorner, plane.surface.envelope.secondCorner];
        if (corners.some((c) => !finite(c, 2))) throw Error("Nonfinite original plane parameter envelope");
        for (const u of corners.map((p) => p[0]!)) for (const v of corners.map((p) => p[1]!)) points.push(planePoint(plane, [u, v]));
        const seen = new Set<number>(); let loopToken = face.firstLoop.token;
        while (loopToken) { if (seen.has(loopToken)) throw Error("Cyclic original material loop"); seen.add(loopToken); const loop = index.loops.get(loopToken); if (!loop) throw Error("Missing original material loop");
          const walked = walkRevit2027DirectedLoopEdges({ faceToken: token, loop, edges: index.edges, loopArity: "open" });
          if (!walked.ok) throw Error("Unclosed original material coedge census");
          for (const e of walked.edges) { const uv = revit2027DirectedEdgeUvs(e); if (uv.length !== 2) throw Error("Curved original material boundary"); points.push(...uv.map((p) => planePoint(plane, p))); }
          loopToken = loop.loop.nextLoop.token;
        }
      }
      cells.push({ kind: "original-planar-component-envelope", originalFaceTokens: [...component], originalSourceReplayIndices: replay.spans.filter((s) => s.readerId === "Revit2027Face" && component.has(s.propertyToken)).map((s) => s.replayIndex), pointsFeet: points, separatingAxes: axes });
    }
    for (const token of guarded.auxiliaryNullLoopFaceTokens) {
      const plane = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, token); if (!plane) throw Error("Missing original auxiliary surface");
      const a = plane.surface.envelope.firstCorner, b = plane.surface.envelope.secondCorner;
      const points = [planePoint(plane, a), planePoint(plane, [a[0]!, b[1]!]), planePoint(plane, b), planePoint(plane, [b[0]!, a[1]!])];
      cells.push({ kind: "original-auxiliary-plane-domain", originalFaceTokens: [token], originalSourceReplayIndices: replay.spans.filter((s) => s.readerId === "Revit2027Face" && s.propertyToken === token).map((s) => s.replayIndex), pointsFeet: points, separatingAxes: [cross(plane.xVector.map(rational) as Q3, plane.yVector.map(rational) as Q3)] });
    }
    for (const token of guarded.unlinkedGraphicEdgeTokens) {
      const edge = index.edges.get(token)!, points: Q3[] = [];
      for (const [side, face] of edge.faceReferences.entries()) {
        if (!face) continue;
        const plane = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, face);
        if (!plane) throw Error("Unlinked original Edge lacks its original finite plane");
        points.push(...edge.firstAndLastEdgePoints.map(p => planePoint(plane, side === 0 ? p.firstFaceUv : p.secondFaceUv)));
      }
      if (!points.length) throw Error("Unlinked original Edge has no source coordinate arena");
      cells.push({ kind: "original-reference-edge-envelope", originalFaceTokens: edge.faceReferences.filter(t => t > 0), originalSourceReplayIndices: replay.spans.filter(s => s.readerId === "Revit2027GEdge" && s.propertyToken === token).map(s => s.replayIndex), pointsFeet: points, separatingAxes: [] });
    }
  } else for (const s of replay.spans.filter((s) => s.readerId === "Revit2027Geometry")) {
    const v = record(s.value);
    if (record(v.faces).count !== 0 || record(v.edges).count !== 0 || record(v.sharedSurfaceInfo).count !== 0 || !Array.isArray(v.queuedProperties) || v.queuedProperties.length)
      throw Error("Unconsumed original empty Geometry operand");
  }
  for (const s of replay.spans) {
    let points: Q3[] | undefined, kind: LocalCell["kind"] | undefined;
    if (s.readerId === "Revit2027GLine") { const v = s.value as Revit2027GLine;
      if (!finite(v.origin, 3) || !finite(v.direction, 3) || !finite(v.endParameters, 2) || v.direction.every((q) => q === 0) || v.gInfo.controlCommand !== 0) throw Error("Unknown original finite line/control");
      points = v.endParameters.map((t) => [0, 1, 2].map((i) => add(rational(v.origin[i]!), mul(rational(v.direction[i]!), rational(t)))) as Q3); kind = "original-GLine";
    } else if (s.readerId === "Revit2027GPoint") { const v = s.value as Revit2027GPoint;
      if (!finite(v.coordinate, 3) || !Number.isSafeInteger(v.size) || !Number.isSafeInteger(v.borderSize) || v.size < 0 || v.borderSize < 0 || v.gInfo.controlCommand !== 0) throw Error("Unknown original finite point/control");
      points = [v.coordinate.map(rational) as Q3]; kind = "original-GPoint";
    } else if (s.readerId === "Revit2027GBiFlipControl") { const v = s.value as Revit2027GBiFlipControl; points = [v.origin.map(rational) as Q3]; kind = "original-control-origin"; }
    if (points && kind) {
      if (replay.spans.some((c) => c.parentReplayIndex === s.replayIndex)) throw Error("Original finite primitive hides child material");
      const parent = s.parentReplayIndex === null ? undefined : replay.spans[s.parentReplayIndex];
      if (parent && !["Revit2027GGroup", "Revit2027GFilter"].includes(parent.readerId)) throw Error("Original primitive is consumed by body/generator");
      cells.push({ kind, originalFaceTokens: [], originalSourceReplayIndices: [s.replayIndex], pointsFeet: points, separatingAxes: [] });
    }
  }
  return cells;
}

/** Plain operands have no source authority. The actual-RVT wrapper must bind
 * every frame/category/owner and the reader/schema annotation contract. */
export function inspectOriginalFixedGraphicsTreeOperands(input: OriginalFixedGraphicsOperands) {
  try {
    if (input.mode !== "all-original-fixed-graphics-branches-v1" || !hash(input.sourceModelSha256) || !hash(input.sourceSchemaSha256) || input.contracts.sourceSchemaSha256 !== input.sourceSchemaSha256 ||
      !input.rootNativeElementIds.length || new Set(input.rootNativeElementIds).size !== input.rootNativeElementIds.length || input.rootNativeElementIds.some((id) => !validId(id)) ||
      !input.nodes.length || input.nodes.length > 256 || new Set(input.nodes.map((n) => n.nativeElementId)).size !== input.nodes.length)
      throw Error("Invalid original fixed-tree binding/mode");
    const nodes = new Map(input.nodes.map((n) => [n.nativeElementId, n])), locals = new Map<number, LocalCell[]>(), bindings = new Map<number, ReturnType<typeof collectRevit2027GInstanceBindings>>();
    for (const n of input.nodes) {
      if (!validId(n.nativeElementId) || !hash(n.originalFrameSha256) || Number(n.replay.ownerElementId) !== n.nativeElementId) throw Error("Foreign original fixed-tree owner/frame");
      validateFullReplay(n.replay, input.contracts); locals.set(n.nativeElementId, localCells(n.replay));
      const b = collectRevit2027GInstanceBindings(n.replay); if (!b.ok) throw Error(b.error);
      for (const link of b.value) {
        const i = link.instance;
        if (link.kind !== "external" || i.resolveSymbolInView || i.hasScale || i.gRepId !== 0 || i.cda !== 1 || !validId(Number(i.symbolElementId)) || !nodes.has(Number(i.symbolElementId)) ||
          !finite(i.transform.matrix, 16) || JSON.stringify([3, 7, 11, 15].map(k => i.transform.matrix[k])) !== JSON.stringify([0, 0, 0, 1]))
          throw Error("Missing/unfixed original symbol, transform, view or body branch");
        const span = n.replay.spans[i.instanceReplayIndex]!;
        if (record(record(span.value).gInfo).controlCommand !== 0) throw Error("Unknown geometry-changing instance control");
      }
      bindings.set(n.nativeElementId, b);
    }
    const cells: OriginalFixedGraphicsEnclosure[] = [], literalSelectorLedger: { nativeElementId: number; sourceReplayIndex: number; readerId: string; originalValue: unknown }[] = [], originalOperandLedger: { nativeElementId: number; originalFrameSha256: string; replay: Revit2027GRepReplay }[] = [], visited = new Set<number>();
    // Preserve the full complement, including every original unlinked graphic
    // edge, filling, face, coedge, UV and descriptor. The ledger is diagnostic;
    // this mathematical input never recreates original-source authority.
    for (const n of input.nodes) originalOperandLedger.push({ nativeElementId: n.nativeElementId, originalFrameSha256: n.originalFrameSha256, replay: structuredClone(n.replay) });
    for (const n of input.nodes) for (const s of n.replay.spans)
      if (["Revit2027GFilter", "Revit2027GConditionDir", "Revit2027GConditionInt", "Revit2027GInstance", "Revit2027GBiFlipControl", "Revit2027Geometry"].includes(s.readerId))
        literalSelectorLedger.push({ nativeElementId: n.nativeElementId, sourceReplayIndex: s.replayIndex, readerId: s.readerId, originalValue: structuredClone(s.value) });
    const walk = (id: number, rootId: number, matrix: Matrix, path: OriginalFixedGraphicsEnclosure["originalInstancePath"], ancestors: Set<number>) => {
      if (ancestors.has(id) || path.length > 64 || cells.length > 100000) throw Error("Cyclic/oversized original instance tree");
      const n = nodes.get(id); if (!n) throw Error("Missing original fixed-tree root"); visited.add(id); const next = new Set(ancestors); next.add(id);
      for (const cell of locals.get(id)!) cells.push({ ...cell, nativeRootId: rootId, sourceGeometryOwnerElementId: id, originalFrameSha256: n.originalFrameSha256, originalInstancePath: structuredClone(path), pointsFeet: cell.pointsFeet.map((p) => transform(matrix, p)), separatingAxes: cell.separatingAxes.map((axis) => {
        // For a general affine source basis use inverse-transpose normals.
        const a = [matrix[0]![0]!, matrix[1]![0]!, matrix[2]![0]!] as Q3, b = [matrix[0]![1]!, matrix[1]![1]!, matrix[2]![1]!] as Q3, c = [matrix[0]![2]!, matrix[1]![2]!, matrix[2]![2]!] as Q3;
        const columns = [cross(b, c), cross(c, a), cross(a, b)];
        return [0, 1, 2].map((i) => columns.reduce((sum, column, j) => add(sum, mul(column[i]!, axis[j]!)), rational(0))) as Q3;
      }) });
      const b = bindings.get(id)!; if (!b.ok) throw Error(b.error);
      for (const link of b.value) { const i = link.instance, values = i.transform.matrix.map(rational), local = Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, column) => values[column * 4 + row]!));
        const det = dot([local[0]![0]!, local[1]![0]!, local[2]![0]!] as Q3, cross([local[0]![1]!, local[1]![1]!, local[2]![1]!] as Q3, [local[0]![2]!, local[1]![2]!, local[2]![2]!] as Q3));
        if (!det.n) throw Error("Degenerate original fixed affine");
        walk(Number(i.symbolElementId), rootId, product(matrix, local), [...path, { ownerId: id, sourceReplayIndex: i.instanceReplayIndex, definitionId: Number(i.symbolElementId) }], next);
      }
    };
    for (const rootId of input.rootNativeElementIds) walk(rootId, rootId, identity(), [], new Set());
    if (visited.size !== nodes.size) throw Error("Foreign/unreachable original fixed-tree node");
    return { ok: true as const, cells, literalSelectorLedger, originalOperandLedger, conservativeOriginalFixedMaterialEnclosureComplete: true as const, targetSelectionPerformed: false as const, widgetExtentApproved: false as const, ...authority };
  } catch (error) {
    return { ok: false as const, blockers: [error instanceof Error ? error.message : String(error)], cells: [], conservativeOriginalFixedMaterialEnclosureComplete: false as const, ...authority };
  }
}

/** Exact sufficient separation. Failing to find an axis is a conservative
 * contact/refusal, never proof that the original material intersects. */
export function auditOriginalFixedGraphicsEnclosuresStanding(cells: readonly OriginalFixedGraphicsEnclosure[], center: [Rational, Rational], foot: Rational, height: Rational) {
  if ([...center, foot, height].some((q) => !(q instanceof Rational)) || height.n <= 0n) throw Error("Invalid exact standing volume");
  const unit = [0, 1, 2].map((i) => [0, 1, 2].map((j) => rational(Number(i === j))) as Q3), head = add(foot, height), corners: Q3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [foot, head]) corners.push([add(center[0], rational(x)), add(center[1], rational(y)), z]);
  const contacts: number[] = [], witnesses: { cellIndex: number; axis: Q3; sourceRange: [Rational, Rational]; standingRange: [Rational, Rational] }[] = [];
  const range = (points: Q3[], axis: Q3): [Rational, Rational] => { const values = points.map((p) => dot(p, axis)); return [values.reduce((a, b) => cmp(a, b) < 0 ? a : b), values.reduce((a, b) => cmp(a, b) > 0 ? a : b)]; };
  for (const [cellIndex, cell] of cells.entries()) {
    if (!cell.pointsFeet.length) throw Error("Empty original source enclosure");
    const zr = range(cell.pointsFeet, unit[2]!); if (cmp(zr[1], foot) <= 0 || cmp(zr[0], head) > 0) continue;
    const axes = [...unit, ...cell.separatingAxes];
    for (const p of cell.pointsFeet.slice(1)) for (const a of unit) axes.push(cross(p.map((q, i) => sub(q, cell.pointsFeet[0]![i]!)) as Q3, a));
    let separated = false;
    for (const axis of axes) { if (axis.every((q) => q.n === 0n)) continue; const sourceRange = range(cell.pointsFeet, axis), standingRange = range(corners, axis);
      if (cmp(sourceRange[1], standingRange[0]) < 0 || cmp(standingRange[1], sourceRange[0]) < 0) { witnesses.push({ cellIndex, axis, sourceRange, standingRange }); separated = true; break; }
    }
    if (!separated) contacts.push(cellIndex);
  }
  return { everyOriginalEnclosureDisjointFromStatedVolume: contacts.length === 0, conservativeContactCellIndices: contacts, separatingWitnesses: witnesses, physicalIntersectionProved: false as const, ...authority };
}
