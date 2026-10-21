import type { OriginalCapBackedTurnOperands } from "./native-stair-cap-backed-turn.ts";
import type { PortableOriginalRiserPartition } from "./native-stair-riser-local-partition.ts";
/** Browser/worker-safe v2 mathematical kernel. Portable operands are not RVT authority.
 * The source adapter must reconstruct the index from actual issued source
 * contexts; a generic untrusted JSON import cannot establish source membership.
 * This kernel never mints an original-source or route approval. */
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalParts as Parts,
  type NativeRationalPoint as Point2,
} from "./native-rational-overlay.ts";
import {
  inspectOriginalStairTypedRiserSequence,
  nativeSegmentInExactParts,
  nativeConservativeTwoFootStation,
  nativeStairStationLateralDirection,
  nativeStairStationParallelToSourceDirection,
  type NativeStairStationLateral,
  nativeConservativeTwoFootStrip,
} from "./native-stepped-stair-v2-stations.ts";
import { exactClosedSourcePlanarContact } from "./native-stepped-stair-v2-closed-contact.ts";
import {
  inspectOriginalFiniteTwoFootRiserCrossing,
  type OriginalFiniteNativeRiserLine,
} from "./native-stepped-stair-v2-riser-crossing.ts";
import { projectStatedTwoFootWalkingVolume } from "./native-stepped-stair-v2-walking-volume.ts";
import type {
  NativeStairTypedFifo,
  Revit2027GRepReplay,
} from "./native-stepped-stair-v2-source-types.ts";
import { inspectFiniteStairCarrierPrimitives } from "./native-stepped-stair-v2-carrier.ts";
import {
  replayPortableCapSideTopology,
  isExactOriginalSupportingSideAtFoot,
  type PortableCapSideTopology,
} from "./native-stepped-stair-v2-footing-boundary.ts";
import {
  assertPortableSteppedGraphBindingPreserved,
  type PortableSteppedGraphBinding,
} from "./native-stepped-stair-v2-graph-binding.ts";
export type { PortableSteppedGraphBinding } from "./native-stepped-stair-v2-graph-binding.ts";

type Q = Rational;
export type Point3 = [Q, Q, Q];
export type SteppedSupport = {
  id: string;
  nativeOwnerId: number;
  physicalFaceToken: number;
  role: "floor" | "tread" | "auxiliary";
  nativeLevelId?: number;
  typedIndex?: number;
  elevationFeet: Q;
  referencePartsFeet: Parts;
  innerPartsFeet: Parts;
  uncertaintyPartsFeet: Parts;
  closedUncertaintyFeet: Point2[][];
  sourceComponentFaceTokens?: number[];
  sourceOccurrenceFrameSha256?: string;
};
export type SteppedMaterialCell = {
  id: string;
  nativeOwnerId: number;
  originalFaceTokens: number[];
  geometryKind?:
    | "native-face-cells"
    | "complete-source-envelope"
    | "bounded-source-primitive";
  minimumElevationFeet: Q;
  maximumElevationFeet: Q;
  partsFeet: Parts;
  closedSegmentsFeet: Point2[][];
  originalCellRole?: "cap-bounded-core" | "original-boundary-domain";
  sourceComponentFaceTokens?: number[];
};
/** Every physical source occurrence has a distinct key, including repeated
 * placed instances. No 'absent'/'ignored'/'own-stair' representation exists. */
export type SteppedPhysicalBody = {
  key: string;
  nativeOwnerId: number;
  representation:
    | { kind: "unknown"; reason: string }
    | { kind: "cells"; cellIds: string[] };
};
export type PortableSteppedSourceIndex = {
  version: 2;
  kind: "original-native-stepped-source-operands";
  sourceModelSha256: string;
  sourceSchemaSha256: string;
  /** Exact original source-census region; receipts cannot leave its coverage. */
  sourceCensusScopeFeet: { minimum: Point3; maximum: Point3 };
  nativeStairId: number;
  nativeRunId: number;
  nativeDefinitionId?: number;
  run: NativeStairTypedFifo;
  riserPartition?: PortableOriginalRiserPartition;
  capBackedTurns?: OriginalCapBackedTurnOperands[];
  sourceFrameBindings?: Record<string, string>;
  servedLevelIds: [number, number];
  supports: SteppedSupport[];
  requiredPhysicalBodyKeys: string[];
  physicalBodies: SteppedPhysicalBody[];
  cells: SteppedMaterialCell[];
  carrierPrimitiveCensus?: {
    nativeDefinitionId: number;
    carrier: Revit2027GRepReplay;
  };
  capSideTopologies?: PortableCapSideTopology[];
};
export type PortableSteppedReceipt = {
  version: 2;
  kind: "original-native-stepped-support";
  sourceModelSha256: string;
  nativeStairId: number;
  nativeRunId: number;
  originalEdgeId: string;
  widthFeet: 2;
  headroomFeet: 6;
  /** Both approaches are ordered ORIGINAL graph physical point -> source
   * begin/end cap. The upper approach is reversed for upward traversal. */
  terminals: [
    {
      originalNodeId: string;
      originalLevelId: number;
      originalLogicalPointFeet: Point3;
      physicalAttachmentPointFeet: Point3;
      logicalToPhysicalHeightDeltaFeet: Q;
      floorSupportId: string;
      approachFeet: Point3[];
    } & NativeStairStationLateral,
    {
      originalNodeId: string;
      originalLevelId: number;
      originalLogicalPointFeet: Point3;
      physicalAttachmentPointFeet: Point3;
      logicalToPhysicalHeightDeltaFeet: Q;
      floorSupportId: string;
      approachFeet: Point3[];
    } & NativeStairStationLateral,
  ];
  stations: ({
    typedIndex: number;
    supportId: string;
    pointFeet: Point3;
  } & NativeStairStationLateral)[];
};
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const cmp = (a: Q, b: Q) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const same = (a: Q, b: Q) => cmp(a, b) === 0;
const pointSame = (a: Point3, b: Point3) => a.every((v, i) => same(v, b[i]!));
const plan = (p: Point3): Point2 => [p[0], p[1]];
const q = (v: unknown): v is Q => v instanceof Rational && v.d > 0n;
const point = (p: unknown, n: number): p is Q[] =>
  Array.isArray(p) &&
  p.length === n &&
  Array.from({ length: n }, (_, i) => i).every((i) => q(p[i]));
const id = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length < 500;
const nid = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0;
function partsValid(value: Parts, allowEmpty = true) {
  if (
    !Array.isArray(value) ||
    value.length > 10_000 ||
    (!allowEmpty && value.length === 0)
  )
    return false;
  let count = 0;
  return value.every(
    (part) =>
      Array.isArray(part) &&
      part.length > 0 &&
      part.every(
        (ring) =>
          Array.isArray(ring) &&
          ring.length >= 3 &&
          (count += ring.length) <= 200_000 &&
          ring.every((p) => point(p, 2)),
      ),
  );
}
const segmentsValid = (value: Point2[][]) =>
  Array.isArray(value) &&
  value.length <= 200_000 &&
  value.every(
    (segment) =>
      Array.isArray(segment) &&
      segment.length > 0 &&
      segment.every((p) => point(p, 2)),
  );
function lateral(
  p: Point3,
  orientation: NativeStairStationLateral,
): [Point2, Point2] {
  return nativeConservativeTwoFootStation(
    plan(p),
    nativeStairStationLateralDirection(orientation),
  );
}
function square(p: Point3): Parts {
  const [x, y] = p,
    one = rational(1);
  return [
    [
      [
        [sub(x, one), sub(y, one)],
        [add(x, one), sub(y, one)],
        [add(x, one), add(y, one)],
        [sub(x, one), add(y, one)],
      ],
    ],
  ];
}
const closedContact = (
  demand: Parts,
  lines: Point2[][],
  parts: Parts,
  boundaries: Point2[][] = [],
) => exactClosedSourcePlanarContact(demand, parts, boundaries, lines);
type ExactBounds = { minX: Q; maxX: Q; minY: Q; maxY: Q };
function exactBounds(parts: Parts, segments: Point2[][]): ExactBounds {
  const points = [...parts.flatMap((part) => part.flat()), ...segments.flat()];
  if (points.length === 0)
    throw new Error("Missing exact closed material bounds");
  const first = points[0]!,
    bounds = { minX: first[0], maxX: first[0], minY: first[1], maxY: first[1] };
  for (const p of points) {
    if (cmp(p[0], bounds.minX) < 0) bounds.minX = p[0];
    if (cmp(p[0], bounds.maxX) > 0) bounds.maxX = p[0];
    if (cmp(p[1], bounds.minY) < 0) bounds.minY = p[1];
    if (cmp(p[1], bounds.maxY) > 0) bounds.maxY = p[1];
  }
  return bounds;
}
const strictlyApart = (a: ExactBounds, b: ExactBounds) =>
  cmp(a.maxX, b.minX) < 0 ||
  cmp(b.maxX, a.minX) < 0 ||
  cmp(a.maxY, b.minY) < 0 ||
  cmp(b.maxY, a.minY) < 0;
function lineControls(run: NativeStairTypedFifo, descriptor: unknown) {
  const d = descriptor as {
    token: number;
    start: number;
    end: number;
    path: string;
    sourceClassSlot: number;
  };
  if (!d || !Number.isSafeInteger(d.token))
    throw new Error("Missing source line descriptor");
  const entries = run.entries.filter((e) =>
    d.token > 0
      ? e.descriptor.token === d.token
      : e.descriptor.start === d.start &&
        e.descriptor.end === d.end &&
        e.descriptor.path === d.path,
  );
  if (
    entries.length !== 1 ||
    entries[0]!.sourceClassName !== "GLine" ||
    entries[0]!.descriptor.sourceClassSlot !== d.sourceClassSlot
  )
    throw new Error("Ambiguous source line");
  const v = entries[0]!.value;
  const numbers = (a: unknown, count: number) =>
    Array.isArray(a) &&
    a.length === count &&
    Array.from({ length: count }, (_, i) => i).every(
      (i) => typeof a[i] === "number" && Number.isFinite(a[i]),
    );
  if (
    !numbers(v.m_origin, 3) ||
    !numbers(v.m_dirVec, 3) ||
    !numbers(v.m_endParams, 2)
  )
    throw new Error("Invalid source line controls");
  const origin = (v.m_origin as number[]).map(rational),
    direction = (v.m_dirVec as number[]).map(rational),
    parameters = (v.m_endParams as number[]).map(rational);
  if (
    direction[2]!.n !== 0n ||
    same(parameters[0]!, parameters[1]!) ||
    (!direction[0]!.n && !direction[1]!.n)
  )
    throw new Error("Nonfinite/unsupported source riser line");
  return {
    origin,
    direction,
    parameters,
    sourceSpan: [entries[0]!.start, entries[0]!.end] as [number, number],
  };
}

type Movement = {
  kind: "horizontal" | "vertical" | "standing";
  label: string;
  start: Point3;
  end: Point3;
  lateralFeet?: [Point2, Point2];
  supportIds: string[];
  footprint?: Parts;
};
export type SteppedKernelResult = {
  navigationProfile: "stepped-transverse-2ft-headroom-6ft-flat-standing-caps-v2";
  mathematicalReplayPassed: boolean;
  issues: string[];
  unknownPhysicalBodyKeys: string[];
  materialContacts: {
    movement: string;
    cellId: string;
    nativeOwnerId: number;
  }[];
  physicalPointsFeet: Point3[];
  checkedMovements: number;
  originalSourceAuthorityGranted: false;
  humanoidGaitApproved: false;
  routeApproved: false;
};

/** Runtime geometry replay only. index is the preserved checked-source
 * operand index, never geometry supplied by a proposed receipt. The source
 * adapter must independently prove membership/completeness of that index.
 * Every unknown required body refuses, even with a matching model/hash. */
export function replayPortableSteppedStairV2(
  index: PortableSteppedSourceIndex,
  receipt: PortableSteppedReceipt,
  expectedGraphBinding: PortableSteppedGraphBinding,
  currentGraphBinding: PortableSteppedGraphBinding,
  options: {
    profile?: "walking" | "step-free";
    direction?: "forward" | "reverse";
    broadPhase?: "exact-bounds" | "disabled";
  } = {},
): SteppedKernelResult {
  const issues: string[] = [],
    unknownPhysicalBodyKeys: string[] = [],
    materialContacts: SteppedKernelResult["materialContacts"] = [],
    physicalPointsFeet: Point3[] = [],
    movements: Movement[] = [];
  function fail(message: string): never {
    throw new Error(message);
  }
  try {
    const graph = assertPortableSteppedGraphBindingPreserved(
      expectedGraphBinding,
      currentGraphBinding,
    );
    if (
      (options.profile !== undefined &&
        !["walking", "step-free"].includes(options.profile)) ||
      (options.direction !== undefined &&
        !["forward", "reverse"].includes(options.direction)) ||
      (options.broadPhase !== undefined &&
        !["exact-bounds", "disabled"].includes(options.broadPhase))
    )
      fail("Unsupported routing profile/direction");
    if (
      index.version !== 2 ||
      index.kind !== "original-native-stepped-source-operands" ||
      receipt.version !== 2 ||
      receipt.kind !== "original-native-stepped-support" ||
      receipt.widthFeet !== 2 ||
      receipt.headroomFeet !== 6 ||
      index.sourceModelSha256 !== expectedGraphBinding.sourceModelSha256 ||
      receipt.sourceModelSha256 !== index.sourceModelSha256 ||
      !/^[a-f0-9]{64}$/.test(index.sourceSchemaSha256) ||
      receipt.nativeStairId !== index.nativeStairId ||
      receipt.nativeRunId !== index.nativeRunId ||
      graph.edge.nativeElementId !== index.nativeStairId ||
      receipt.originalEdgeId !== graph.edge.id ||
      !nid(index.nativeStairId) ||
      !nid(index.nativeRunId)
    )
      fail("Source/model/original graph/variant binding differs");
    const sourceScope = index.sourceCensusScopeFeet;
    if (
      !sourceScope ||
      !point(sourceScope.minimum, 3) ||
      !point(sourceScope.maximum, 3) ||
      [0, 1, 2].some(
        (axis) =>
          cmp(sourceScope.minimum[axis]!, sourceScope.maximum[axis]!) >= 0,
      )
    )
      fail("Missing, malformed or inverted original source census scope");
    if (
      !Array.isArray(receipt.terminals) ||
      receipt.terminals.length !== 2 ||
      !Array.isArray(receipt.stations) ||
      receipt.stations.length > 10_000
    )
      fail("Invalid receipt points for original source census scope");
    const scopePoints = [
      ...receipt.terminals.flatMap((terminal) => {
        if (
          !Array.isArray(terminal.approachFeet) ||
          terminal.approachFeet.length > 1000
        )
          fail("Invalid terminal approach census scope");
        return terminal.approachFeet;
      }),
      ...receipt.stations.map((station) => station.pointFeet),
    ];
    if (
      scopePoints.some(
        (p) =>
          !point(p, 3) ||
          [0, 1].some(
            (axis) =>
              cmp(sub(p[axis]!, rational(2)), sourceScope.minimum[axis]!) < 0 ||
              cmp(add(p[axis]!, rational(2)), sourceScope.maximum[axis]!) > 0,
          ) ||
          cmp(p[2], sourceScope.minimum[2]) < 0 ||
          cmp(add(p[2], rational(6)), sourceScope.maximum[2]) > 0,
      )
    )
      fail("Receipt leaves the complete original source census scope");
    if (options.profile === "step-free")
      fail("Stairs are unavailable to step-free routing");
    if (
      ((options.direction ?? "forward") === "reverse" &&
        graph.edge.direction === "from-to") ||
      ((options.direction ?? "forward") === "forward" &&
        graph.edge.direction === "to-from")
    )
      fail("Original source direction refuses traversal");
    if (
      !Array.isArray(index.supports) ||
      index.supports.length === 0 ||
      index.supports.length > 10_000 ||
      !Array.isArray(index.cells) ||
      index.cells.length > 200_000 ||
      !Array.isArray(index.physicalBodies) ||
      index.physicalBodies.length > 100_000 ||
      !Array.isArray(index.requiredPhysicalBodyKeys) ||
      index.requiredPhysicalBodyKeys.length === 0 ||
      new Set(index.requiredPhysicalBodyKeys).size !==
        index.requiredPhysicalBodyKeys.length ||
      index.requiredPhysicalBodyKeys.some((key) => !id(key))
    )
      fail("Invalid complete physical index shape");
    const unresolved = index.physicalBodies.filter(
      (body) => body.representation?.kind === "unknown",
    );
    if (unresolved.length > 0) {
      unknownPhysicalBodyKeys.push(...unresolved.map((body) => body.key));
      fail(
        `Unknown original physical bodies: ${unresolved.length}; complete clearance cannot run`,
      );
    }
    const supports = new Map(index.supports.map((s) => [s.id, s])),
      cells = new Map(index.cells.map((s) => [s.id, s]));
    if (
      supports.size !== index.supports.length ||
      cells.size !== index.cells.length
    )
      fail("Duplicated support/material identity");
    for (const support of index.supports) {
      if (
        !id(support.id) ||
        !nid(support.nativeOwnerId) ||
        !nid(support.physicalFaceToken) ||
        !q(support.elevationFeet) ||
        !["floor", "tread", "auxiliary"].includes(support.role) ||
        !partsValid(support.referencePartsFeet, false) ||
        !partsValid(support.innerPartsFeet, support.role === "auxiliary") ||
        !partsValid(support.uncertaintyPartsFeet) ||
        !segmentsValid(support.closedUncertaintyFeet) ||
        nativeRationalOverlay(
          "difference",
          support.innerPartsFeet,
          support.referencePartsFeet,
        ).length > 0 ||
        nativeRationalOverlay(
          "intersection",
          support.innerPartsFeet,
          support.uncertaintyPartsFeet,
        ).length > 0
      )
        fail("Invalid physical support/retained source uncertainty");
    }
    for (const cell of index.cells) {
      if (
        !id(cell.id) ||
        !nid(cell.nativeOwnerId) ||
        !Array.isArray(cell.originalFaceTokens) ||
        (cell.originalFaceTokens.length === 0 &&
          !["complete-source-envelope", "bounded-source-primitive"].includes(
            cell.geometryKind ?? "",
          )) ||
        (cell.geometryKind !== undefined &&
          ![
            "native-face-cells",
            "complete-source-envelope",
            "bounded-source-primitive",
          ].includes(cell.geometryKind)) ||
        new Set(cell.originalFaceTokens).size !==
          cell.originalFaceTokens.length ||
        cell.originalFaceTokens.some((t) => !nid(t)) ||
        !q(cell.minimumElevationFeet) ||
        !q(cell.maximumElevationFeet) ||
        cmp(cell.minimumElevationFeet, cell.maximumElevationFeet) > 0 ||
        !partsValid(cell.partsFeet) ||
        !segmentsValid(cell.closedSegmentsFeet) ||
        (cell.partsFeet.length === 0 && cell.closedSegmentsFeet.length === 0)
      )
        fail("Invalid complete original material cell");
    }
    // Bounds are built only after complete exact shape validation, from every
    // positive polygon and retained zero-area primitive. They live for this
    // replay only; an authoring mutation can never reuse stale bounds.
    const cellBounds = new Map(
      index.cells.map((cell) => [
        cell.id,
        exactBounds(cell.partsFeet, cell.closedSegmentsFeet),
      ]),
    );
    const capSides = new Map<
      string,
      ReturnType<typeof replayPortableCapSideTopology> & {
        sourceOccurrenceFrameSha256: string;
      }
    >();
    for (const topology of index.capSideTopologies ?? []) {
      const key = `${topology.nativeOwnerElementId}:${topology.capFaceToken}`;
      if (
        topology.sourceModelSha256 !== index.sourceModelSha256 ||
        topology.sourceSchemaSha256 !== index.sourceSchemaSha256 ||
        capSides.has(key) ||
        !topology.sourceOccurrenceFrameSha256 ||
        !/^[a-f0-9]{64}$/.test(topology.sourceOccurrenceFrameSha256) ||
        !topology.sourceGeometryFrameSha256 ||
        !/^[a-f0-9]{64}$/.test(topology.sourceGeometryFrameSha256) ||
        (topology.nativeOwnerElementId === index.nativeRunId
          ? topology.sourceGeometryOwnerElementId !== index.nativeDefinitionId
          : topology.sourceGeometryOwnerElementId !==
            topology.nativeOwnerElementId)
      )
        fail("Original supporting-side source ownership differs");
      capSides.set(key, {
        ...replayPortableCapSideTopology(topology),
        sourceOccurrenceFrameSha256: topology.sourceOccurrenceFrameSha256,
      });
    }
    const primitiveCells = index.cells.filter(
      (cell) => cell.geometryKind === "bounded-source-primitive",
    );
    if (primitiveCells.length > 0 || index.carrierPrimitiveCensus) {
      const source = index.carrierPrimitiveCensus;
      if (
        !source ||
        source.carrier.ownerElementId !== BigInt(index.nativeRunId)
      )
        fail("Missing original finite primitive consumer census");
      const proved = inspectFiniteStairCarrierPrimitives(
        source.carrier,
        source.nativeDefinitionId,
      );
      if (
        !proved.ok ||
        proved.cells.length !== primitiveCells.length ||
        proved.cells.some(
          (cell) =>
            encodeSteppedStairV2Operands(cell) !==
            encodeSteppedStairV2Operands(cells.get(cell.id)),
        )
      )
        fail(
          "Finite primitive material does not replay its complete source consumer graph",
        );
    }
    const bodies = new Map(index.physicalBodies.map((b) => [b.key, b]));
    if (
      bodies.size !== index.physicalBodies.length ||
      bodies.size !== index.requiredPhysicalBodyKeys.length ||
      index.requiredPhysicalBodyKeys.some((key) => !bodies.has(key))
    )
      fail("Missing/duplicated original physical occurrence");
    const usedCells = new Set<string>();
    for (const body of index.physicalBodies) {
      if (!nid(body.nativeOwnerId)) fail("Invalid physical owner");
      if (body.representation.kind === "unknown") {
        unknownPhysicalBodyKeys.push(body.key);
        continue;
      }
      if (
        body.representation.kind !== "cells" ||
        body.representation.cellIds.length === 0 ||
        new Set(body.representation.cellIds).size !==
          body.representation.cellIds.length
      )
        fail("Physical source body cannot be declared empty/absent");
      for (const cellId of body.representation.cellIds) {
        const cell = cells.get(cellId);
        if (
          !cell ||
          cell.nativeOwnerId !== body.nativeOwnerId ||
          usedCells.has(cellId)
        )
          fail("Missing/borrowed/duplicated original body material cell");
        usedCells.add(cellId);
      }
    }
    if (usedCells.size !== cells.size) fail("Uncensused material cells");
    if (unknownPhysicalBodyKeys.length > 0)
      issues.push(
        `Unknown original physical bodies: ${unknownPhysicalBodyKeys.length}`,
      );
    for (const support of index.supports.filter(
      (s) => s.role !== "auxiliary",
    )) {
      const sourceCells = index.cells.filter(
        (cell) =>
          cell.nativeOwnerId === support.nativeOwnerId &&
          cell.originalFaceTokens.includes(support.physicalFaceToken) &&
          cmp(cell.minimumElevationFeet, support.elevationFeet) <= 0 &&
          cmp(cell.maximumElevationFeet, support.elevationFeet) >= 0,
      );
      const physical = sourceCells.flatMap((cell) => cell.partsFeet);
      if (
        physical.length === 0 ||
        nativeRationalOverlay(
          "difference",
          support.innerPartsFeet,
          nativeRationalOverlay("union", physical),
        ).length > 0
      )
        fail(
          "A declared walking face is absent from its complete source body cells",
        );
    }
    const treads = index.supports
      .filter((s) => s.role === "tread")
      .sort((a, b) => a.typedIndex! - b.typedIndex!);
    if (
      treads.length < 2 ||
      treads.some(
        (s, i) => s.typedIndex !== i || s.nativeOwnerId !== index.nativeRunId,
      )
    )
      fail("Incomplete ordered physical tread roles");
    if (
      index.riserPartition &&
      (index.riserPartition.sourceModelSha256 !== index.sourceModelSha256 ||
        index.riserPartition.sourceSchemaSha256 !== index.sourceSchemaSha256 ||
        index.riserPartition.nativeStairId !== index.nativeStairId)
    )
      fail("Foreign original riser partition source binding");
    if (index.capBackedTurns !== undefined) {
      if (
        !index.riserPartition ||
        !index.sourceFrameBindings ||
        !Array.isArray(index.capBackedTurns) ||
        index.capBackedTurns.length === 0
      )
        fail("Incomplete explicit cap-backed original source binding");
      const encodeParts = (parts: Parts) =>
        parts.map((part) =>
          part.map((ring) =>
            ring.map((p) => p.map((q) => [q.n.toString(), q.d.toString()])),
          ),
        );
      const exactParts = (a: Parts, b: Parts) =>
        JSON.stringify(encodeParts(a)) === JSON.stringify(encodeParts(b));
      for (const packet of index.capBackedTurns) {
        const support = treads[packet.typedIndex];
        if (
          !support ||
          packet.sourceModelSha256 !== index.sourceModelSha256 ||
          packet.sourceSchemaSha256 !== index.sourceSchemaSha256 ||
          packet.nativeStairId !== index.nativeStairId ||
          packet.nativeRunId !== index.nativeRunId ||
          packet.nativeDefinitionId !== index.nativeDefinitionId ||
          packet.sourceGeometryOwnerElementId !== index.nativeDefinitionId ||
          packet.originalRunFrameSha256 !==
            index.sourceFrameBindings![`${index.nativeRunId}:4102`] ||
          !index.riserPartition!.ownedRuns.some(
            (r) =>
              r.run.nativeRunId === index.nativeRunId &&
              r.originalRunFrameSha256 === packet.originalRunFrameSha256,
          ) ||
          packet.originalDefinitionFrameSha256 !==
            index.sourceFrameBindings![`${index.nativeDefinitionId}:2246`] ||
          packet.cap.physicalFaceToken !== support.physicalFaceToken ||
          !same(
            packet.cap.originalPhysicalPlaneHeightFeet,
            support.elevationFeet,
          ) ||
          !exactParts(
            packet.cap.referenceEmbedding,
            support.referencePartsFeet,
          ) ||
          !exactParts(
            packet.cap.guaranteedInnerPlanSupport,
            support.innerPartsFeet,
          ) ||
          !exactParts(
            packet.cap.boundaryUncertainty,
            support.uncertaintyPartsFeet,
          ) ||
          support.closedUncertaintyFeet.length > 0
        )
          fail(
            "Foreign/stale original cap-backed support or source frame binding",
          );
      }
    }
    const sequence = inspectOriginalStairTypedRiserSequence(
      index.run,
      treads.length,
      index.riserPartition,
      index.capBackedTurns,
    );
    if (!sequence.completeNamedSourceRiserSequence)
      fail(
        `Original typed riser sequence refused: ${sequence.blockers.join("; ")}`,
      );
    if (
      !Array.isArray(receipt.stations) ||
      receipt.stations.length < treads.length ||
      receipt.stations.length > 10_000
    )
      fail("Invalid physical station count");
    const stationSupports: SteppedSupport[] = [];
    const supportedLine = (
      support: SteppedSupport,
      endpoints: [Point2, Point2],
    ) =>
      nativeSegmentInExactParts(
        endpoints[0],
        endpoints[1],
        support.innerPartsFeet,
      ) &&
      !closedContact(
        [],
        [endpoints],
        support.uncertaintyPartsFeet,
        support.closedUncertaintyFeet,
      );
    const supportedParts = (support: SteppedSupport, demand: Parts) =>
      nativeRationalOverlay("difference", demand, support.innerPartsFeet)
        .length === 0 &&
      !closedContact(
        demand,
        [],
        support.uncertaintyPartsFeet,
        support.closedUncertaintyFeet,
      );
    for (const [i, station] of receipt.stations.entries()) {
      const support = supports.get(station.supportId);
      if (
        !support ||
        support.role !== "tread" ||
        support.typedIndex !== station.typedIndex ||
        !point(station.pointFeet, 3) ||
        !same(station.pointFeet[2], support.elevationFeet) ||
        (i
          ? station.typedIndex < receipt.stations[i - 1]!.typedIndex ||
            station.typedIndex > receipt.stations[i - 1]!.typedIndex + 1
          : station.typedIndex !== 0) ||
        !supportedLine(support, lateral(station.pointFeet, station))
      )
        fail("Unsupported/skipped original physical tread station");
      const intent =
        sequence.treadRelations[station.typedIndex]
          ?.originalIntentPlanPartsFeet ?? [];
      const relation = sequence.treadRelations[station.typedIndex];
      if (
        !relation ||
        ![
          relation.originalFiniteStartLine,
          relation.originalFiniteEndLine,
        ].some((line) =>
          nativeStairStationParallelToSourceDirection(
            station,
            (line.m_dirVec as number[]).slice(0, 2) as [number, number],
          ),
        )
      )
        fail(
          "Station lateral direction differs from its original finite riser boundaries",
        );
      if (
        intent.length > 0 &&
        !nativeSegmentInExactParts(
          ...lateral(station.pointFeet, station),
          intent,
        )
      )
        fail("Station leaves finite native tread intent");
      stationSupports.push(support);
    }
    if (receipt.stations.at(-1)!.typedIndex !== treads.length - 1)
      fail("Final original tread unvisited");
    const platformTurns = new Set<number>();
    for (let i = 1; i < receipt.stations.length - 1; i++) {
      const a = receipt.stations[i - 1]!,
        b = receipt.stations[i]!,
        c = receipt.stations[i + 1]!;
      if (a.typedIndex !== b.typedIndex && b.typedIndex !== c.typedIndex)
        continue;
      const ax = sub(b.pointFeet[0], a.pointFeet[0]),
        ay = sub(b.pointFeet[1], a.pointFeet[1]),
        bx = sub(c.pointFeet[0], b.pointFeet[0]),
        by = sub(c.pointFeet[1], b.pointFeet[1]);
      if (
        sub(mul(ax, by), mul(ay, bx)).n !== 0n ||
        add(mul(ax, bx), mul(ay, by)).n < 0n
      ) {
        if (!supportedParts(stationSupports[i]!, square(b.pointFeet)))
          fail("Flat platform turn lacks its complete standing support");
        platformTurns.add(i);
      }
    }
    const move = (
      kind: Movement["kind"],
      label: string,
      a: Point3,
      b: Point3,
      ids: string[],
      line?: [Point2, Point2],
      footprint?: Parts,
    ) => {
      if (!point(a, 3) || !point(b, 3))
        fail("Invalid physical movement points");
      movements.push({
        kind,
        label,
        start: a,
        end: b,
        supportIds: ids,
        ...(line ? { lateralFeet: line } : {}),
        ...(footprint ? { footprint } : {}),
      });
      if (kind !== "standing") {
        if (physicalPointsFeet.length === 0) physicalPointsFeet.push(a);
        if (!pointSame(physicalPointsFeet.at(-1)!, a))
          fail("Disconnected physical movement chain");
        if (!pointSame(a, b)) physicalPointsFeet.push(b);
      }
    };
    const transfer = (
      label: string,
      a: Point3,
      b: Point3,
      lower: SteppedSupport,
      upper: SteppedSupport,
      line: [Point2, Point2],
      riserIndex: number,
      permittedCorridor: Parts,
    ) => {
      const original = sequence.orderedRisers.find(
        (r) => r.index === riserIndex,
      );
      if (!original) fail("Missing original named riser");
      const crossing = inspectOriginalFiniteTwoFootRiserCrossing(
        original.originalCurve as OriginalFiniteNativeRiserLine,
        plan(a),
        plan(b),
      );
      if (!crossing.properCrossingForFullTwoFootStrip)
        fail("A full-width crossing leaves the exact finite source riser");
      const physicalParts = index.cells
        .filter(
          (cell) =>
            cell.nativeOwnerId === index.nativeRunId &&
            cmp(cell.maximumElevationFeet, a[2]) >= 0 &&
            cmp(cell.minimumElevationFeet, b[2]) <= 0,
        )
        .flatMap((cell) => cell.partsFeet);
      if (
        cmp(b[2], a[2]) <= 0 ||
        cmp(sub(b[2], a[2]), new Rational(6n, 5n)) > 0
      )
        fail("Invalid physical source riser height");
      const corridor = nativeRationalOverlay(
        "union",
        lower.referencePartsFeet,
        upper.referencePartsFeet,
        lower.uncertaintyPartsFeet,
        upper.uncertaintyPartsFeet,
        physicalParts,
        permittedCorridor,
      );
      const strip = nativeConservativeTwoFootStrip(plan(a), plan(b));
      if (
        strip.length === 0 ||
        nativeRationalOverlay("difference", strip, corridor).length > 0
      )
        fail("Riser transfer leaves actual source body/cap/intent corridor");
      const raised: Point3 = [a[0], a[1], b[2]];
      move("vertical", `${label}:rise`, a, raised, [lower.id], line);
      move("horizontal", `${label}:go`, raised, b, [upper.id]);
    };
    const terminalFloors: SteppedSupport[] = [];
    for (const side of [0, 1] as const) {
      const terminal = receipt.terminals[side],
        node = graph.terminals[side]!.node,
        floor = supports.get(terminal.floorSupportId),
        approach = terminal.approachFeet;
      if (
        terminal.originalNodeId !== node.id ||
        !floor ||
        floor.role !== "floor" ||
        floor.nativeLevelId !== node.levelId ||
        terminal.originalLevelId !== node.levelId ||
        !point(terminal.originalLogicalPointFeet, 3) ||
        !point(terminal.physicalAttachmentPointFeet, 3) ||
        !q(terminal.logicalToPhysicalHeightDeltaFeet) ||
        !pointSame(
          terminal.originalLogicalPointFeet,
          node.pointFeet.map(rational) as Point3,
        ) ||
        index.servedLevelIds[side] !== node.levelId ||
        !Array.isArray(approach) ||
        approach.length < 2 ||
        approach.length > 1000 ||
        approach.some(
          (p) => !point(p, 3) || !same(p[2], floor.elevationFeet),
        ) ||
        !same(approach[0]![0], rational(node.pointFeet[0])) ||
        !same(approach[0]![1], rational(node.pointFeet[1])) ||
        !pointSame(terminal.physicalAttachmentPointFeet, approach[0]!) ||
        !same(
          terminal.logicalToPhysicalHeightDeltaFeet,
          sub(floor.elevationFeet, rational(node.pointFeet[2])),
        )
      )
        fail("Original node to named physical floor attachment differs");
      // The explicit source-qualified local mode retains stale root scalars.
      // Its complete original ordered boundary supplies a distinct, actual
      // source Z reference; original graph/floor/level checks still follow.
      const nominal =
        index.riserPartition && side === 1
          ? (
              sequence.orderedRisers.at(-1)!.originalCurve.m_origin as number[]
            )[2]
          : index.run.root[side ? "m_topElevation" : "m_bottomElevation"];
      if (
        typeof nominal !== "number" ||
        !same(rational(nominal), rational(node.pointFeet[2]))
      )
        fail("Original logical height differs from named run demand");
      for (let i = 1; i < approach.length; i++) {
        if (
          pointSame(approach[i - 1]!, approach[i]!) ||
          !supportedParts(
            floor,
            nativeConservativeTwoFootStrip(
              plan(approach[i - 1]!),
              plan(approach[i]!),
            ),
          )
        )
          fail(
            "Original terminal approach crosses unsupported floor/hole/uncertainty",
          );
      }
      // Actual graph points and approach turns have an explicit standing
      // square. The internal riser station uses its stated lateral demand.
      for (const p of approach.slice(0, -1))
        if (!supportedParts(floor, square(p)))
          fail("Original terminal turn/standing square unsupported");
      const last = approach.at(-1)!,
        original = lineControls(
          index.run,
          index.run.root[side ? "m_oEndRiser" : "m_oStartRiser"],
        ),
        ordered =
          sequence.orderedRisers[side ? sequence.orderedRisers.length - 1 : 0]!
            .originalCurve;
      if (!supportedLine(floor, lateral(last, terminal)))
        fail(
          "Terminal rise station lacks full-width actual named floor support",
        );
      const planControls = (line: {
        origin: Q[];
        direction: Q[];
        parameters: Q[];
      }) =>
        encodeSteppedStairV2Operands([
          line.origin.slice(0, 2),
          line.direction,
          line.parameters,
        ]);
      if (
        planControls(original) !==
        encodeSteppedStairV2Operands([
          (ordered.m_origin as number[]).slice(0, 2).map(rational),
          (ordered.m_dirVec as number[]).map(rational),
          (ordered.m_endParams as number[]).map(rational),
        ])
      )
        fail(
          "Named begin/end riser differs from the original ordered source boundary",
        );
      // Additional finite refusal only; this never supplies floor/body support.
      if (
        !nativeStairStationParallelToSourceDirection(
          terminal,
          (ordered.m_dirVec as number[]).slice(0, 2) as [number, number],
        )
      )
        fail(
          "Terminal lateral direction differs from its original named riser boundary",
        );
      const dx = original.direction[0]!,
        dy = original.direction[1]!,
        distanceNumerator = sub(
          mul(sub(last[0], original.origin[0]!), dy),
          mul(sub(last[1], original.origin[1]!), dx),
        ),
        depth = rational(
          sequence.treadRelations[
            side ? sequence.treadRelations.length - 1 : 0
          ]!.originalActualDepthFeet,
        );
      if (
        depth.n <= 0n ||
        cmp(
          mul(distanceNumerator, distanceNumerator),
          mul(mul(depth, depth), add(mul(dx, dx), mul(dy, dy))),
        ) > 0
      )
        fail(
          "Outward station exceeds the original finite terminal tread depth",
        );
      terminalFloors.push(floor);
    }
    const lowerApproach = receipt.terminals[0].approachFeet,
      lowerFloor = terminalFloors[0]!;
    for (const [i, p] of lowerApproach.entries()) {
      if (i < lowerApproach.length - 1)
        move(
          "standing",
          `lower-standing:${i}`,
          p,
          p,
          [lowerFloor.id],
          undefined,
          square(p),
        );
      if (i)
        move(
          "horizontal",
          `lower-approach:${i - 1}`,
          lowerApproach[i - 1]!,
          p,
          [lowerFloor.id],
        );
    }
    transfer(
      "begin-riser",
      lowerApproach.at(-1)!,
      receipt.stations[0]!.pointFeet,
      lowerFloor,
      stationSupports[0]!,
      lateral(lowerApproach.at(-1)!, receipt.terminals[0]),
      sequence.orderedRisers[0]!.index,
      sequence.treadRelations[0]!.originalIntentPlanPartsFeet,
    );
    for (let i = 1; i < receipt.stations.length; i++) {
      const prior = receipt.stations[i - 1]!,
        next = receipt.stations[i]!,
        a = prior.pointFeet,
        b = next.pointFeet,
        lower = stationSupports[i - 1]!,
        upper = stationSupports[i]!;
      if (same(a[2], b[2])) {
        if (
          prior.typedIndex !== next.typedIndex ||
          lower.id !== upper.id ||
          !supportedParts(
            lower,
            nativeConservativeTwoFootStrip(plan(a), plan(b)),
          )
        )
          fail("Same-tread platform movement leaves complete physical support");
        move("horizontal", `platform:${i - 1}`, a, b, [lower.id]);
      } else
        transfer(
          `internal-riser:${i - 1}`,
          a,
          b,
          lower,
          upper,
          lateral(a, prior),
          sequence.treadRelations[prior.typedIndex]!.endRiserIndex,
          nativeRationalOverlay(
            "union",
            sequence.treadRelations[prior.typedIndex]!
              .originalIntentPlanPartsFeet,
            sequence.treadRelations[next.typedIndex]!
              .originalIntentPlanPartsFeet,
          ),
        );
      if (platformTurns.has(i))
        move(
          "standing",
          `platform-standing:${i}`,
          b,
          b,
          [upper.id],
          undefined,
          square(b),
        );
    }
    const lastStation = receipt.stations.at(-1)!,
      upperFloor = terminalFloors[1]!;
    transfer(
      "end-riser",
      lastStation.pointFeet,
      receipt.terminals[1].approachFeet.at(-1)!,
      stationSupports.at(-1)!,
      upperFloor,
      lateral(lastStation.pointFeet, lastStation),
      sequence.orderedRisers.at(-1)!.index,
      sequence.treadRelations.at(-1)!.originalIntentPlanPartsFeet,
    );
    const upperApproach = receipt.terminals[1].approachFeet;
    for (let i = upperApproach.length - 1; i >= 0; i--) {
      if (i < upperApproach.length - 1) {
        move(
          "horizontal",
          `upper-approach:${i}`,
          upperApproach[i + 1]!,
          upperApproach[i]!,
          [upperFloor.id],
        );
        move(
          "standing",
          `upper-standing:${i}`,
          upperApproach[i]!,
          upperApproach[i]!,
          [upperFloor.id],
          undefined,
          square(upperApproach[i]!),
        );
      }
    }
    for (const motion of movements) {
      const lowest =
          cmp(motion.start[2], motion.end[2]) < 0
            ? motion.start[2]
            : motion.end[2],
        highest =
          cmp(motion.start[2], motion.end[2]) > 0
            ? motion.start[2]
            : motion.end[2];
      // Use the original walking projection's own unmodified complete strip,
      // rather than a different approximate normal, for this proposal bound.
      const movementBounds =
        motion.kind === "horizontal"
          ? exactBounds(
              [
                [
                  projectStatedTwoFootWalkingVolume(
                    motion.start,
                    motion.end,
                    lowest,
                    add(highest, rational(6)),
                    6,
                  ).unclippedStatedStripFeet,
                ],
              ],
              [],
            )
          : exactBounds(
              motion.footprint ?? [],
              motion.lateralFeet ? [motion.lateralFeet] : [],
            );
      if (
        cmp(movementBounds.minX, sourceScope.minimum[0]) < 0 ||
        cmp(movementBounds.maxX, sourceScope.maximum[0]) > 0 ||
        cmp(movementBounds.minY, sourceScope.minimum[1]) < 0 ||
        cmp(movementBounds.maxY, sourceScope.maximum[1]) > 0 ||
        cmp(lowest, sourceScope.minimum[2]) < 0 ||
        cmp(add(highest, rational(6)), sourceScope.maximum[2]) > 0
      )
        fail("Complete swept motion leaves original source census scope");
      for (const cell of index.cells) {
        if (
          cmp(cell.maximumElevationFeet, lowest) < 0 ||
          cmp(cell.minimumElevationFeet, add(highest, rational(6))) > 0
        )
          continue;
        if (
          options.broadPhase !== "disabled" &&
          strictlyApart(movementBounds, cellBounds.get(cell.id)!)
        )
          continue;
        const namedFootContact =
          same(cell.maximumElevationFeet, lowest) &&
          motion.supportIds.some((key) => {
            const support = supports.get(key)!;
            if (
              support.nativeOwnerId !== cell.nativeOwnerId ||
              !same(support.elevationFeet, lowest)
            )
              return false;
            if (cell.originalFaceTokens.includes(support.physicalFaceToken))
              return true;
            const adjacency = capSides.get(
              `${support.nativeOwnerId}:${support.physicalFaceToken}`,
            );
            return (
              !!adjacency &&
              isExactOriginalSupportingSideAtFoot(
                cell,
                support,
                lowest,
                adjacency,
              )
            );
          });
        if (namedFootContact) continue;
        let contact = false;
        if (motion.kind === "horizontal") {
          const projection = projectStatedTwoFootWalkingVolume(
              motion.start,
              motion.end,
              cell.minimumElevationFeet,
              cell.maximumElevationFeet,
              6,
            ),
            ring = projection.possibleClosedProjectionFeet;
          contact = projection.positiveProjectionArea
            ? closedContact(
                [[ring]],
                [],
                cell.partsFeet,
                cell.closedSegmentsFeet,
              )
            : ring.length > 0 &&
              closedContact(
                [],
                [ring],
                cell.partsFeet,
                cell.closedSegmentsFeet,
              );
        } else
          contact = closedContact(
            motion.footprint ?? [],
            motion.lateralFeet ? [motion.lateralFeet] : [],
            cell.partsFeet,
            cell.closedSegmentsFeet,
          );
        if (contact)
          materialContacts.push({
            movement: motion.label,
            cellId: cell.id,
            nativeOwnerId: cell.nativeOwnerId,
          });
      }
    }
    if (materialContacts.length > 0)
      issues.push(
        `Closed six-foot material contacts: ${materialContacts.length}`,
      );
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return {
    navigationProfile:
      "stepped-transverse-2ft-headroom-6ft-flat-standing-caps-v2",
    mathematicalReplayPassed: issues.length === 0,
    issues,
    unknownPhysicalBodyKeys,
    materialContacts,
    physicalPointsFeet:
      options.direction === "reverse"
        ? [...physicalPointsFeet].reverse()
        : physicalPointsFeet,
    checkedMovements: movements.length,
    originalSourceAuthorityGranted: false,
    humanoidGaitApproved: false,
    routeApproved: false,
  };
}

/** Explicit bounded transport. Self-hashed/decoded facts still have no original
 * source authority; a source importer must rebuild and compare them. */
export function encodeSteppedStairV2Operands(value: unknown): string {
  const ancestors = new Set<object>();
  let nodes = 0;
  const walk = (v: unknown, depth: number): unknown => {
    if (++nodes > 4_000_000 || depth > 512)
      throw new Error("Oversized/deep stepped operands");
    if (v instanceof Rational) return { $rational: [String(v.n), String(v.d)] };
    if (typeof v === "bigint") return { $bigint: String(v) };
    if (typeof v === "number" && !Number.isFinite(v))
      throw new Error("Nonfinite stepped operand");
    if (
      v === null ||
      ["string", "number", "boolean", "undefined"].includes(typeof v)
    )
      return v;
    if (!v || typeof v !== "object" || ancestors.has(v))
      throw new Error("Invalid/cyclic stepped operand");
    ancestors.add(v);
    const result = Array.isArray(v)
      ? Array.from({ length: v.length }, (_, i) => {
          if (!(i in v) || v[i] === undefined)
            throw new Error("Sparse stepped operand");
          return walk(v[i], depth + 1);
        })
      : Object.fromEntries(
          Object.entries(v)
            .filter(([, child]) => child !== undefined)
            .map(([key, child]) => [key, walk(child, depth + 1)]),
        );
    ancestors.delete(v);
    return result;
  };
  return JSON.stringify(walk(value, 0));
}
export function decodeSteppedStairV2Operands(text: string): unknown {
  if (text.length > 100_000_000)
    throw new Error("Oversized stepped source operands");
  let rationals = 0;
  return JSON.parse(text, (_key, v) => {
    if (v && typeof v === "object" && "$bigint" in v) {
      if (
        Object.keys(v).length !== 1 ||
        typeof v.$bigint !== "string" ||
        v.$bigint.length > 4096 ||
        !/^-?(0|[1-9][0-9]*)$/.test(v.$bigint) ||
        v.$bigint === "-0"
      )
        throw new Error("Invalid exact source integer wire value");
      return BigInt(v.$bigint);
    }
    if (!v || typeof v !== "object" || !("$rational" in v)) return v;
    const pair = v.$rational;
    if (
      Object.keys(v).length !== 1 ||
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      ++rationals > 2_000_000 ||
      !pair.every(
        (n: unknown) =>
          typeof n === "string" &&
          n.length <= 4096 &&
          /^-?(0|[1-9][0-9]*)$/.test(n),
      ) ||
      pair[0] === "-0" ||
      !/^[1-9][0-9]*$/.test(pair[1])
    )
      throw new Error("Invalid exact stepped rational wire value");
    const result = new Rational(BigInt(pair[0]), BigInt(pair[1]));
    if (String(result.n) !== pair[0] || String(result.d) !== pair[1])
      throw new Error("Unnormalized exact stepped rational");
    return result;
  });
}

/** JSON-safe exact transport. Store this plain value verbatim in shared
 * dataset indices and edge receipts; do not JSON.stringify Rational objects. */
export type SteppedStairV2WireValue =
  | null
  | boolean
  | number
  | string
  | SteppedStairV2WireValue[]
  | { [key: string]: SteppedStairV2WireValue };
export function encodeSteppedStairV2WireValue(
  value: unknown,
): SteppedStairV2WireValue {
  return JSON.parse(
    encodeSteppedStairV2Operands(value),
  ) as SteppedStairV2WireValue;
}
export function decodeSteppedStairV2WireValue(
  value: SteppedStairV2WireValue,
): unknown {
  let count = 0;
  const parents = new Set<object>();
  function check(v: unknown, depth: number): void {
    if (++count > 4_000_000 || depth > 512)
      throw new Error("Oversized/deep stepped wire value");
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("Nonfinite stepped wire value");
      return;
    }
    if (
      !v ||
      typeof v !== "object" ||
      v instanceof Rational ||
      parents.has(v) ||
      (!Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null)
    )
      throw new Error("Stepped transport must contain plain JSON wire values");
    parents.add(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (!(i in v)) throw new Error("Sparse stepped wire value");
        check(v[i], depth + 1);
      }
    } else for (const child of Object.values(v)) check(child, depth + 1);
    parents.delete(v);
  }
  check(value, 0);
  return decodeSteppedStairV2Operands(JSON.stringify(value));
}
