/** Pure complete retained carrier-role replay. Copied operands are not source authority. */
import { Rational, rational } from "./native-rational-overlay.ts";
import type {
  Revit2027GRepReplay,
  Revit2027GInstance,
  Revit2027InstanceInfo,
  Revit2027GLine,
  Revit2027GPoint,
} from "./native-stepped-stair-v2-source-types.ts";
import type { SteppedMaterialCell } from "./native-stepped-stair-v2-kernel.ts";
type P3 = [Rational, Rational, Rational];
const add = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
type OriginalCarrierNonSurfacePrimitive = {
  sourcePropertyToken: number;
  sourceReplayIndex: number;
  sourceKind: "original-GLine" | "original-GPoint";
  pointsFeet: P3[];
};
export type OriginalStairCarrierEnvelope = {
  nativeRunId: number;
  nativeDefinitionId: number;
  originalSpanCount: number;
  originalLineCount: number;
  originalPointCount: number;
  originalConditionCount: number;
  originalNonSurfacePrimitives: OriginalCarrierNonSurfacePrimitive[];
  allSourceVisibilityBranchesRetained: true;
  additionalPhysicalFaceCount: 0;
  completeSupportedCarrierCensus: true;
  physicalLineThicknessInvented: false;
  exactPhysicalBodyApproved: false;
  routeApproved: false;
};

/** Mathematical census only. A caller-authored replay cannot grant original
 * source membership. GLine is a finite one-dimensional source curve, GPoint
 * has schema-declared integer display sizes, and neither silently disappears:
 * both remain in the source ledger. They are not physical BRep faces. Every visibility branch is retained. */
export function inspectOriginalStairCarrierEnvelope(
  replay: Revit2027GRepReplay,
  nativeDefinitionId: number,
):
  | { ok: true; geometry: OriginalStairCarrierEnvelope }
  | { ok: false; blockers: string[] } {
  try {
    const allowed = new Map([
      ["Revit2027GFilter", 2254],
      ["Revit2027GGroup", 2248],
      ["Revit2027GInstance", 2215],
      ["Revit2027InstanceInfo", 2513],
      ["Revit2027GConditionInt", 2238],
      ["Revit2027Geometry", 2343],
      ["Revit2027GLine", 1973],
      ["Revit2027GPoint", 2271],
    ]);
    if (
      !Number.isSafeInteger(nativeDefinitionId) ||
      nativeDefinitionId <= 0 ||
      replay.spans.length === 0 ||
      replay.spans.length > 10_000 ||
      replay.spans.some(
        (span) =>
          span.ownerElementId !== replay.ownerElementId ||
          allowed.get(span.readerId) !== span.propertySourceClassSlot,
      )
    )
      throw new Error(
        "Unsupported original carrier owner, branch or primitive",
      );
    if (
      new Set(replay.spans.map((span) => span.replayIndex)).size !==
      replay.spans.length
    )
      throw new Error("Duplicate original carrier replay entry");
    const count = (id: string) =>
      replay.spans.filter((span) => span.readerId === id).length;
    if (
      count("Revit2027GInstance") !== 1 ||
      count("Revit2027InstanceInfo") !== 1 ||
      count("Revit2027Geometry") !== 1
    )
      throw new Error(
        "Carrier does not have one complete physical definition placement",
      );
    for (const span of replay.spans) {
      const descriptors = replay.descriptors.filter(
        (entry) =>
          entry.state === "queued" &&
          entry.queueSequence === span.queueSequence,
      );
      if (
        descriptors.length !== 1 ||
        descriptors[0]!.ownerElementId !== replay.ownerElementId ||
        descriptors[0]!.sourceClassSlot !== span.propertySourceClassSlot ||
        descriptors[0]!.token !== span.propertyToken ||
        descriptors[0]!.parentReplayIndex !== span.parentReplayIndex ||
        JSON.stringify(descriptors[0]!.path) !== JSON.stringify(span.path)
      )
        throw new Error("Incomplete original carrier FIFO ownership");
    }
    if (
      replay.descriptors.filter((entry) => entry.state === "queued").length !==
      replay.spans.length
    )
      throw new Error("Original carrier has an unconsumed source descriptor");
    const instanceSpan = replay.spans.find(
        (span) => span.readerId === "Revit2027GInstance",
      )!,
      instance = instanceSpan.value as Revit2027GInstance;
    const placementSpan = replay.spans.find(
        (span) => span.readerId === "Revit2027InstanceInfo",
      )!,
      placement = placementSpan.value as Revit2027InstanceInfo;
    if (
      instance.embeddedSymbolGRep.token !== 0 ||
      instance.embeddedSymbolGRep.sourceClassSlot !== null ||
      instance.instanceInfo.sourceClassSlot !== 2513 ||
      instance.forbiddenTarget !== 0 ||
      instance.resolveSymbolInView ||
      instance.hasScale ||
      placementSpan.parentReplayIndex !== instanceSpan.replayIndex ||
      placement.symbolElementId !== BigInt(nativeDefinitionId) ||
      instance.gInfo.tag !== nativeDefinitionId ||
      placement.gRepId !== 0 ||
      placement.cda !== 1 ||
      JSON.stringify(placement.transform.matrix) !==
        JSON.stringify([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    )
      throw new Error(
        "Unsupported original carrier placement or symbol semantics",
      );
    const geometry = replay.spans.find(
      (span) => span.readerId === "Revit2027Geometry",
    )!.value as {
      flags: number;
      faces: { count: number; entries: unknown[] };
      edges: { count: number; entries: unknown[] };
      sharedSurfaceInfo: { count: number; entries: unknown[] };
      queuedProperties: unknown[];
    };
    if (
      geometry.flags !== 7 ||
      [geometry.faces, geometry.edges, geometry.sharedSurfaceInfo].some(
        (list) => list.count !== 0 || list.entries.length > 0,
      ) ||
      geometry.queuedProperties.length > 0
    )
      throw new Error(
        "Additional original carrier Geometry is not an empty declared body",
      );
    const originalNonSurfacePrimitives: OriginalCarrierNonSurfacePrimitive[] =
      [];
    for (const span of replay.spans) {
      if (span.readerId === "Revit2027GLine") {
        const line = span.value as Revit2027GLine;
        if (
          [...line.origin, ...line.direction, ...line.endParameters].some(
            (value) => !Number.isFinite(value),
          ) ||
          line.direction.every((value) => value === 0)
        )
          throw new Error("Nonfinite or degenerate original carrier curve");
        originalNonSurfacePrimitives.push({
          sourcePropertyToken: span.propertyToken,
          sourceReplayIndex: span.replayIndex,
          sourceKind: "original-GLine",
          pointsFeet: line.endParameters.map(
            (t) =>
              [0, 1, 2].map((axis) =>
                add(
                  rational(line.origin[axis]!),
                  mul(rational(line.direction[axis]!), rational(t)),
                ),
              ) as P3,
          ),
        });
      } else if (span.readerId === "Revit2027GPoint") {
        const point = span.value as Revit2027GPoint;
        if (
          point.coordinate.some((value) => !Number.isFinite(value)) ||
          !Number.isSafeInteger(point.size) ||
          !Number.isSafeInteger(point.borderSize) ||
          point.size < 0 ||
          point.borderSize < 0
        )
          throw new Error("Unsupported original carrier point/display fields");
        originalNonSurfacePrimitives.push({
          sourcePropertyToken: span.propertyToken,
          sourceReplayIndex: span.replayIndex,
          sourceKind: "original-GPoint",
          pointsFeet: [point.coordinate.map(rational) as P3],
        });
      }
    }
    return {
      ok: true,
      geometry: {
        nativeRunId: Number(replay.ownerElementId),
        nativeDefinitionId,
        originalSpanCount: replay.spans.length,
        originalLineCount: count("Revit2027GLine"),
        originalPointCount: count("Revit2027GPoint"),
        originalConditionCount: count("Revit2027GConditionInt"),
        originalNonSurfacePrimitives,
        allSourceVisibilityBranchesRetained: true,
        additionalPhysicalFaceCount: 0,
        completeSupportedCarrierCensus: true,
        physicalLineThicknessInvented: false,
        exactPhysicalBodyApproved: false,
        routeApproved: false,
      },
    };
  } catch (error) {
    return {
      ok: false,
      blockers: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function inspectFiniteStairCarrierPrimitives(
  replay: Revit2027GRepReplay,
  nativeDefinitionId: number,
) {
  const original = inspectOriginalStairCarrierEnvelope(
    replay,
    nativeDefinitionId,
  );
  if (!original.ok)
    return {
      ok: false as const,
      issues: original.blockers,
      cells: [],
      originalSourceAuthorityGranted: false as const,
    };
  try {
    const spans = new Map(replay.spans.map((span) => [span.replayIndex, span]));
    const positive = replay.spans.filter((span) => span.propertyToken > 0);
    if (
      new Set(positive.map((span) => span.propertyToken)).size !==
      positive.length
    )
      throw new Error("Aliased original carrier property identity");
    const cells: SteppedMaterialCell[] = [];
    for (const primitive of original.geometry.originalNonSurfacePrimitives) {
      const span = spans.get(primitive.sourceReplayIndex);
      if (
        !span ||
        span.propertyToken <= 0 ||
        replay.spans.some(
          (child) => child.parentReplayIndex === span.replayIndex,
        )
      )
        throw new Error(
          "Original primitive has body/profile descendants or no unique source occurrence",
        );
      const consumers = replay.descriptors.filter(
        (descriptor) => descriptor.token === span.propertyToken,
      );
      if (
        consumers.length !== 1 ||
        consumers[0]!.state !== "queued" ||
        consumers[0]!.parentReplayIndex !== span.parentReplayIndex ||
        consumers[0]!.sourceClassSlot !== span.propertySourceClassSlot ||
        consumers[0]!.descriptorOffset !== span.descriptorOffset ||
        consumers[0]!.descriptorEndOffset !== span.descriptorEndOffset
      )
        throw new Error(
          "Original primitive has a reused/unbound source consumer",
        );
      const seen = new Set<number>();
      let at = span.parentReplayIndex;
      while (at !== null) {
        if (seen.has(at)) throw new Error("Cyclic original primitive ancestry");
        seen.add(at);
        const parent = spans.get(at);
        if (
          !parent ||
          !["Revit2027GGroup", "Revit2027GFilter"].includes(parent.readerId)
        )
          throw new Error(
            "Original primitive lies in a body/profile/generator consumer",
          );
        at = parent.parentReplayIndex;
      }
      const parent =
          span.parentReplayIndex === null
            ? undefined
            : spans.get(span.parentReplayIndex),
        value = parent?.value as
          | {
              children?: {
                token: number;
                sourceClassSlot: number;
                byteOffset: number;
                endOffset: number;
              }[];
              group?: {
                children?: {
                  token: number;
                  sourceClassSlot: number;
                  byteOffset: number;
                  endOffset: number;
                }[];
              };
            }
          | undefined,
        children =
          parent?.readerId === "Revit2027GFilter"
            ? value?.group?.children
            : value?.children;
      if (
        parent &&
        (!children ||
          children.filter(
            (child) =>
              child.token === span.propertyToken &&
              child.sourceClassSlot === span.propertySourceClassSlot &&
              child.byteOffset === span.descriptorOffset &&
              child.endOffset === span.descriptorEndOffset,
          ).length !== 1)
      )
        throw new Error(
          "Original primitive is not its exact declared group/filter child",
        );
      const points = primitive.pointsFeet;
      if (points.length !== (primitive.sourceKind === "original-GLine" ? 2 : 1))
        throw new Error("Unsupported original primitive bounds");
      const lo = points
          .map((p) => p[2])
          .reduce((a, b) => (a.n * b.d < b.n * a.d ? a : b)),
        hi = points
          .map((p) => p[2])
          .reduce((a, b) => (a.n * b.d > b.n * a.d ? a : b));
      cells.push({
        id: `native:${Number(replay.ownerElementId)}:primitive:${primitive.sourceReplayIndex}`,
        nativeOwnerId: Number(replay.ownerElementId),
        geometryKind: "bounded-source-primitive",
        originalFaceTokens: [],
        minimumElevationFeet: lo,
        maximumElevationFeet: hi,
        partsFeet: [],
        closedSegmentsFeet: [points.map((p) => [p[0], p[1]])],
      });
    }
    return {
      ok: true as const,
      cells,
      issues: [],
      primitiveCount: cells.length,
      originalSourceAuthorityGranted: false as const,
      walkingSupportApproved: false as const,
      routeApproved: false as const,
    };
  } catch (error) {
    return {
      ok: false as const,
      cells: [],
      issues: [error instanceof Error ? error.message : String(error)],
      originalSourceAuthorityGranted: false as const,
    };
  }
}
