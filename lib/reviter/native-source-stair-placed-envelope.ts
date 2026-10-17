/** Unwired original-source obstruction operands. This does not certify a
 * walking body, terminal contact, source uncertainty join or human clearance. */
import {
  Rational,
  rational,
  type NativeRationalPoint,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import {
  exactClosedSourcePlanarContact,
  originalNativeSlabSupportEnvelope,
  type OriginalNativePlanarSlabEnvelope,
} from "./native-source-planar-slab-envelope.ts";
import {
  readOriginalNativeStairPhysicalSource,
  type OriginalNativeStairPhysicalContext,
} from "./native-source-stair-physical-inventory.ts";
import { inspectOriginalNativeStairSupportEnvelopes } from "./native-source-stair-support-envelopes.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import type {
  Revit2027GInstance,
  Revit2027InstanceInfo,
} from "./revit-2027-ginstance.ts";
import type { Revit2027GLine } from "./revit-2027-gline.ts";
import type { Revit2027GPoint } from "./revit-2027-gpoint.ts";
import {
  inspectOriginalStairLocalMaterialCells,
  type OriginalStairLocalMaterialCell,
} from "./native-source-stair-local-material.ts";
import {
  projectStatedTwoFootWalkingVolume,
  type SourceWalkingPoint3,
} from "./native-source-walking-volume.ts";

type P3 = [Rational, Rational, Rational];
const add = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const cmp = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
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
      !replay.spans.length ||
      replay.spans.length > 10000 ||
      replay.spans.some(
        (span) =>
          span.ownerElementId !== replay.ownerElementId ||
          allowed.get(span.readerId) !== span.propertySourceClassSlot,
      )
    )
      throw Error("Unsupported original carrier owner, branch or primitive");
    if (
      new Set(replay.spans.map((span) => span.replayIndex)).size !==
      replay.spans.length
    )
      throw Error("Duplicate original carrier replay entry");
    const count = (id: string) =>
      replay.spans.filter((span) => span.readerId === id).length;
    if (
      count("Revit2027GInstance") !== 1 ||
      count("Revit2027InstanceInfo") !== 1 ||
      count("Revit2027Geometry") !== 1
    )
      throw Error(
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
        throw Error("Incomplete original carrier FIFO ownership");
    }
    if (
      replay.descriptors.filter((entry) => entry.state === "queued").length !==
      replay.spans.length
    )
      throw Error("Original carrier has an unconsumed source descriptor");
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
      throw Error("Unsupported original carrier placement or symbol semantics");
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
        (list) => list.count !== 0 || list.entries.length !== 0,
      ) ||
      geometry.queuedProperties.length
    )
      throw Error(
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
          throw Error("Nonfinite or degenerate original carrier curve");
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
          throw Error("Unsupported original carrier point/display fields");
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

const brand: unique symbol = Symbol("OriginalNativePlacedStairEnvelope");
export type OriginalNativePlacedStairEnvelope = {
  readonly [brand]: true;
  readonly sourceModelSha256: string;
  readonly sourceSchemaSha256: string;
  readonly nativeRunId: number;
};
type Component = {
  sourceComponentIndex: number;
  physicalFaceTokens: number[];
  allEndpointEmbeddingHeightBand: [Rational, Rational];
  conservativeOuterPlanEnvelope: NativeRationalParts;
};
const originals = new WeakMap<
  OriginalNativePlacedStairEnvelope,
  {
    carrier: OriginalStairCarrierEnvelope;
    components: Component[];
    localizedCells: OriginalStairLocalMaterialCell[];
    localizationBlockers: string[];
    sourceFrameSha256s: Record<string, string>;
  }
>();

/** Only the opaque actual-RVT context can issue source material authority.
 * Complete physical source topology is required, including all 47 original
 * components where present. This issues an obstruction superset, never a
 * sewn-body, walking-support or clearance certificate. */
export function certifyOriginalNativePlacedStairEnvelope(
  context: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
) {
  const source = readOriginalNativeStairPhysicalSource(context, nativeRunId),
    carrier = inspectOriginalStairCarrierEnvelope(
      source.carrier,
      source.nativeDefinitionId,
    ),
    physical = inspectOriginalNativeStairSupportEnvelopes(context, nativeRunId);
  if (!carrier.ok) return { ok: false as const, blockers: carrier.blockers };
  if (
    !physical.sourceBoundOriginalOperands ||
    !physical.completeOriginalSourceFaceCensus ||
    !physical.originalTreadHistoryBindingComplete ||
    !physical.completeOriginalStraightPlanarSourceCensus ||
    physical.blockers.length ||
    !physical.components.length
  )
    return {
      ok: false as const,
      blockers: [
        "Complete original physical definition/uncertainty census unavailable",
        ...physical.blockers,
      ],
    };
  const localization = inspectOriginalStairLocalMaterialCells(
    source.physicalDefinition,
  );
  const certificate = Object.freeze({
    [brand]: true as const,
    sourceModelSha256: source.sourceModelSha256,
    sourceSchemaSha256: source.sourceSchemaSha256,
    nativeRunId,
  });
  originals.set(certificate, {
    carrier: carrier.geometry,
    components: physical.components,
    localizedCells: localization.cells,
    localizationBlockers: localization.blockers,
    sourceFrameSha256s: { ...source.sourceFrameSha256s },
  });
  return {
    ok: true as const,
    certificate,
    summary: {
      sourceModelSha256: source.sourceModelSha256,
      sourceSchemaSha256: source.sourceSchemaSha256,
      sourceFrameSha256s: source.sourceFrameSha256s,
      nativeRunId,
      nativeDefinitionId: source.nativeDefinitionId,
      originalCarrierSpans: carrier.geometry.originalSpanCount,
      originalLineCount: carrier.geometry.originalLineCount,
      originalPointCount: carrier.geometry.originalPointCount,
      physicalComponentCount: physical.components.length,
      physicalFaceCount: physical.sourceFaceCount,
      physicalEdgeCount: physical.sourceEdgeCount,
      sourceMaterialLocalizationBlockers:
        originals.get(certificate)!.localizationBlockers,
      originalLocalizedMaterialCellCount:
        originals.get(certificate)!.localizedCells.length,
      allBranchesAndPhysicalComponentsRetained: true as const,
      exactPhysicalBodyApproved: false as const,
      routeApproved: false as const,
    },
  };
}

/** Constant-height mathematical demand against EVERY placed physical component.
 * Every original non-surface wire/point is reported separately in its ledger. The open lower height bound permits exact foot support;
 * a two-inch raised glass operand still intersects the full body band. Caller
 * demand is not source walking authority, so this cannot approve a route. */
export function auditOriginalPlacedStairAboveFoot(
  certificate: OriginalNativePlacedStairEnvelope,
  demand: NativeRationalParts,
  footHeightFeet: Rational,
  headroomFeet: Rational,
) {
  const original = originals.get(certificate);
  if (!original) throw Error("Untrusted original placed stair envelope");
  if (
    !(footHeightFeet instanceof Rational) ||
    !(headroomFeet instanceof Rational) ||
    headroomFeet.n <= 0n ||
    cmp(headroomFeet, rational(30)) > 0
  )
    throw Error("Invalid explicit headroom demand");
  const high = add(footHeightFeet, headroomFeet);
  const componentContacts = original.components
    .filter(
      (component) =>
        cmp(component.allEndpointEmbeddingHeightBand[1], footHeightFeet) > 0 &&
        cmp(component.allEndpointEmbeddingHeightBand[0], high) <= 0 &&
        exactClosedSourcePlanarContact(
          demand,
          component.conservativeOuterPlanEnvelope,
        ),
    )
    .map((component) => ({
      sourceComponentIndex: component.sourceComponentIndex,
      physicalFaceTokens: [...component.physicalFaceTokens],
    }));
  // Preserve all source curve/point ownership and diagnostic contacts. These
  // non-surface records are not physical faces or obstacles. Zero-thickness
  // physical glass remains a closed-contact physical BRep operand above.
  const nonSurfaceGraphicalContacts =
    original.carrier.originalNonSurfacePrimitives
      .filter((primitive) => {
        const heights = primitive.pointsFeet.map((p) => p[2]),
          lo = heights.reduce((a, b) => (cmp(a, b) < 0 ? a : b)),
          hi = heights.reduce((a, b) => (cmp(a, b) > 0 ? a : b));
        return (
          cmp(hi, footHeightFeet) > 0 &&
          cmp(lo, high) <= 0 &&
          exactClosedSourcePlanarContact(
            demand,
            [],
            [
              primitive.pointsFeet.map(
                (p) => [p[0], p[1]] as NativeRationalPoint,
              ),
            ],
          )
        );
      })
      .map((primitive) => ({
        sourceReplayIndex: primitive.sourceReplayIndex,
        sourceKind: primitive.sourceKind,
      }));
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    nativeRunId: certificate.nativeRunId,
    componentContacts,
    nonSurfaceGraphicalContacts,
    nonSurfaceGraphicalContactsArePhysicalVetoes: false as const,
    completeOriginalPlacedMaterialCensus: true as const,
    suppliedDemandHasWalkingAuthority: false as const,
    completeHumanHeadroomApproved: false as const,
    routeApproved: false as const,
  };
}

/** Complete own-run obstruction query for a stated walking trajectory. Each
 * original shell retains its full conservative plan hull AND exact source
 * endpoint height band. Upper treads/risers are not owner-exempted. Exact
 * support at or below every walking foot is permitted; all uncertain positive
 * heights, raised material and closed side/head contacts remain candidates. */
export function auditOriginalPlacedStairAgainstWalkingLine(
  certificate: OriginalNativePlacedStairEnvelope,
  pointsFeet: readonly SourceWalkingPoint3[],
  headroomFeet: number,
) {
  const original = originals.get(certificate);
  if (!original) throw Error("Untrusted original placed stair envelope");
  if (
    pointsFeet.length < 2 ||
    pointsFeet.some(
      (point) =>
        point.length !== 3 ||
        !point.every(
          (value) => value instanceof Rational || Number.isFinite(value),
        ),
    ) ||
    !Number.isFinite(headroomFeet) ||
    headroomFeet <= 0 ||
    headroomFeet > 30
  )
    throw Error("Invalid stated walking demand");
  const rows = pointsFeet.slice(1).map((end, segmentIndex) => {
    const start = pointsFeet[segmentIndex]!,
      lowestFoot =
        cmp(rational(start[2]), rational(end[2])) < 0
          ? rational(start[2])
          : rational(end[2]);
    const contacts = original.components.flatMap((component) => {
      if (cmp(component.allEndpointEmbeddingHeightBand[1], lowestFoot) <= 0)
        return [];
      const demand = projectStatedTwoFootWalkingVolume(
          start,
          end,
          ...component.allEndpointEmbeddingHeightBand,
          headroomFeet,
        ),
        ring = demand.possibleClosedProjectionFeet;
      const closedContact = demand.positiveProjectionArea
        ? exactClosedSourcePlanarContact(
            [[ring]],
            component.conservativeOuterPlanEnvelope,
          )
        : ring.length > 0 &&
          exactClosedSourcePlanarContact(
            component.conservativeOuterPlanEnvelope,
            [],
            [ring],
          );
      return closedContact
        ? [
            {
              sourceComponentIndex: component.sourceComponentIndex,
              physicalFaceTokens: [...component.physicalFaceTokens],
              allEndpointEmbeddingHeightBand:
                component.allEndpointEmbeddingHeightBand.map((q) => [
                  q.n.toString(),
                  q.d.toString(),
                ]),
              exactStatedWidthEnclosed: true as const,
            },
          ]
        : [];
    });
    const localizedContacts = original.localizationBlockers.length
      ? undefined
      : original.localizedCells.flatMap((cell) => {
          if (cmp(cell.maximumElevationFeet, lowestFoot) <= 0) return [];
          const demand = projectStatedTwoFootWalkingVolume(
              start,
              end,
              cell.minimumElevationFeet,
              cell.maximumElevationFeet,
              headroomFeet,
            ),
            ring = demand.possibleClosedProjectionFeet;
          const contact = demand.positiveProjectionArea
            ? exactClosedSourcePlanarContact(
                [[ring]],
                cell.partsFeet,
                cell.closedSegmentsFeet,
              )
            : ring.length > 0 &&
              exactClosedSourcePlanarContact(
                [],
                cell.partsFeet,
                cell.closedSegmentsFeet,
                [ring],
              );
          return contact
            ? [
                {
                  sourceComponentIndex: cell.sourceComponentIndex,
                  role: cell.role,
                  originalFaceTokens: [...cell.originalFaceTokens],
                },
              ]
            : [];
        });
    return {
      segmentIndex,
      originalStartFeet: start,
      originalEndFeet: end,
      contacts,
      localizedContacts,
    };
  });
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    nativeRunId: certificate.nativeRunId,
    headroomFeet,
    statedWidthFeet: 2 as const,
    physicalComponentsChecked: original.components.length,
    nonSurfaceOriginalLineCount: original.carrier.originalLineCount,
    nonSurfaceOriginalPointCount: original.carrier.originalPointCount,
    nonSurfaceBranchesSilentlyDropped: false as const,
    rows,
    contactSegments: rows
      .filter((row) => row.contacts.length)
      .map((row) => row.segmentIndex),
    localizedContactSegments: original.localizationBlockers.length
      ? undefined
      : rows
          .filter((row) => row.localizedContacts?.length)
          .map((row) => row.segmentIndex),
    sourceMaterialLocalizationBlockers: original.localizationBlockers,
    completeOriginalPlacedMaterialCensus: true as const,
    sourceWalkingPathAuthorityGranted: false as const,
    completeHumanHeadroomApproved: false as const,
    routeApproved: false as const,
  };
}

/** A vertical source step is not converted to a flat supported floor. This
 * separate station query sweeps the ENTIRE body from its lower foot plane to
 * upper foot+headroom. Closed line stations and physical tangent material are
 * retained. The caller must separately establish source support/step/width
 * authority for this station, and census all other foreign materials. */
export function auditOriginalStairAndSlabVerticalStation(
  certificate: OriginalNativePlacedStairEnvelope,
  slabCertificate: OriginalNativePlanarSlabEnvelope,
  station: {
    partsFeet: NativeRationalParts;
    closedSegmentsFeet: NativeRationalPoint[][];
    lowerFootFeet: Rational;
    upperFootFeet: Rational;
  },
  headroomFeet: number,
) {
  const original = originals.get(certificate);
  if (!original) throw Error("Untrusted original placed stair envelope");
  const slab = originalNativeSlabSupportEnvelope(slabCertificate);
  if (
    slab.sourceModelSha256 !== certificate.sourceModelSha256 ||
    slab.sourceSchemaSha256 !== certificate.sourceSchemaSha256
  )
    throw Error("Vertical station original source identities differ");
  if (
    !(station.lowerFootFeet instanceof Rational) ||
    !(station.upperFootFeet instanceof Rational) ||
    cmp(station.lowerFootFeet, station.upperFootFeet) > 0 ||
    !Number.isFinite(headroomFeet) ||
    headroomFeet <= 0 ||
    headroomFeet > 30 ||
    (!station.partsFeet.length &&
      !station.closedSegmentsFeet.some((segment) => segment.length))
  )
    throw Error("Invalid explicit vertical station demand");
  const high = add(station.upperFootFeet, rational(headroomFeet));
  const touches = (
    parts: NativeRationalParts,
    segments: NativeRationalPoint[][] = [],
  ) =>
    (station.partsFeet.length &&
      exactClosedSourcePlanarContact(station.partsFeet, parts, segments)) ||
    (station.closedSegmentsFeet.length > 0 &&
      exactClosedSourcePlanarContact(
        [],
        parts,
        segments,
        station.closedSegmentsFeet,
      ));
  const componentContacts = original.components
    .filter(
      (component) =>
        cmp(
          component.allEndpointEmbeddingHeightBand[1],
          station.lowerFootFeet,
        ) > 0 &&
        cmp(component.allEndpointEmbeddingHeightBand[0], high) <= 0 &&
        touches(component.conservativeOuterPlanEnvelope),
    )
    .map((component) => ({
      sourceComponentIndex: component.sourceComponentIndex,
      physicalFaceTokens: [...component.physicalFaceTokens],
    }));
  const slabContact =
    cmp(slab.maximumMaterialElevationFeet, station.lowerFootFeet) > 0 &&
    cmp(slab.minimumMaterialElevationFeet, high) <= 0 &&
    !!touches(
      slab.completeConservativeMaterialPartsFeet,
      slab.excludedZeroAreaBoundarySegmentsFeet,
    );
  const localizedComponentContacts = original.localizationBlockers.length
    ? undefined
    : original.localizedCells
        .filter(
          (cell) =>
            cmp(cell.maximumElevationFeet, station.lowerFootFeet) > 0 &&
            cmp(cell.minimumElevationFeet, high) <= 0 &&
            touches(cell.partsFeet, cell.closedSegmentsFeet),
        )
        .map((cell) => ({
          sourceComponentIndex: cell.sourceComponentIndex,
          role: cell.role,
          originalFaceTokens: [...cell.originalFaceTokens],
        }));
  const localizedSlabContacts = slab.completeOriginalMaterialCellsFeet
    .filter(
      (cell) =>
        cmp(cell.maximumElevationFeet, station.lowerFootFeet) > 0 &&
        cmp(cell.minimumElevationFeet, high) <= 0 &&
        touches(cell.partsFeet, cell.closedSegmentsFeet),
    )
    .map((cell) => ({
      role: cell.role,
      originalFaceTokens: [...cell.originalFaceTokens],
    }));
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    nativeRunId: certificate.nativeRunId,
    nativeSlabId: slab.nativeSlabElementId,
    headroomFeet,
    componentContacts,
    slabContact,
    localizedComponentContacts,
    localizedSlabContacts,
    sourceMaterialLocalizationBlockers: original.localizationBlockers,
    all47OrOtherDeclaredRunComponentsChecked: original.components.length,
    fullVerticalBodySweepRetained: true as const,
    sourceStationSupportAndWidthApproved: false as const,
    otherForeignMaterialsApproved: false as const,
    completeHumanHeadroomApproved: false as const,
    routeApproved: false as const,
  };
}

/** Fresh exact obstruction operands from an actual source-issued handle. The
 * returned copy is transport input, not an independent source certificate. */
export function originalNativePlacedStairMaterialEnvelope(
  certificate: OriginalNativePlacedStairEnvelope,
) {
  const value = originals.get(certificate);
  if (!value) throw Error("Untrusted original placed stair envelope");
  const q = (a: Rational) => new Rational(a.n, a.d),
    parts = (a: NativeRationalParts): NativeRationalParts =>
      a.map((p) => p.map((r) => r.map(([x, y]) => [q(x), q(y)]))),
    segments = (a: NativeRationalPoint[][]): NativeRationalPoint[][] =>
      a.map((r) => r.map(([x, y]) => [q(x), q(y)]));
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    sourceSchemaSha256: certificate.sourceSchemaSha256,
    nativeRunId: certificate.nativeRunId,
    nativeDefinitionId: value.carrier.nativeDefinitionId,
    sourceFrameSha256s: { ...value.sourceFrameSha256s },
    components: value.components.map((c) => ({
      ...c,
      physicalFaceTokens: [...c.physicalFaceTokens],
      conservativeOuterPlanEnvelope: parts(c.conservativeOuterPlanEnvelope),
      allEndpointEmbeddingHeightBand: c.allEndpointEmbeddingHeightBand.map(
        q,
      ) as [Rational, Rational],
    })),
    localizedCells: value.localizedCells.map((c) => ({
      ...c,
      originalFaceTokens: [...c.originalFaceTokens],
      partsFeet: parts(c.partsFeet),
      closedSegmentsFeet: segments(c.closedSegmentsFeet),
      minimumElevationFeet: q(c.minimumElevationFeet),
      maximumElevationFeet: q(c.maximumElevationFeet),
    })),
    localizationBlockers: [...value.localizationBlockers],
    nonSurfaceOriginalPrimitives:
      value.carrier.originalNonSurfacePrimitives.map((p) => ({
        ...p,
        pointsFeet: p.pointsFeet.map((p) => p.map(q) as P3),
      })),
    completeOriginalPlacedMaterialCensus: true as const,
    walkingSupportApproved: false as const,
    routeApproved: false as const,
  };
}
