import {
  assertStairBaseCompilerInputIdentityPreserved,
  assertStairBaseIdentityFieldsPreserved,
  assertStairBaseProposalFieldsPreserved,
} from "./native-source-stair-base-identity-guard.ts";
import {
  originalDirectWallTrimObstacleFacts,
  type OriginalDirectWallTrimObstacleCertificate,
} from "./native-source-placed-planar-obstacles.ts";
import {
  originalRecordedStairIntentDemandFacts,
  type OriginalRecordedStairIntentDemand,
} from "./native-source-stair-recorded-intent.ts";
import { originalSourceBaseApproachDemand } from "./native-source-stair-base-approach-demand.ts";
import { inspectWholeFootprintEnvelopeCandidates } from "./native-source-whole-footprint-envelope-query.ts";
/** A source-derived base standing request. Original graph identity and native
 * source geometry are separate inputs. No cell owner, original node, policy,
 * arrival pointer or physical stair profile is changed or approved here. */
import { assertOriginalStairBaseCompilerSession } from "./indoor-pipeline.ts";
import type { RoomDirectoryData } from "./room-directory.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { IndoorDataset } from "./indoor-contract.ts";
import {
  Rational,
  rational,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
import { originalTwoFootStandingSquare } from "./native-source-standing-footprint.ts";
import { readSchema } from "./schema-reader.ts";
import { inspectOriginalElementLevelPrefix } from "./native-source-element-level-prefix.ts";
import {
  originalNativeStairAssemblyMembershipFacts,
  type OriginalNativeStairAssemblyMembership,
} from "./native-source-stair-assembly.ts";
import {
  readOriginalNativeStairPhysicalSource,
  type OriginalNativeStairPhysicalContext,
} from "./native-source-stair-physical-inventory.ts";
import {
  certifyOriginalNativePlacedStairEnvelope,
  auditOriginalPlacedStairAboveFoot,
} from "./native-source-stair-placed-envelope.ts";
import { inspectOriginalStairLandingCarrierMaterial } from "./native-source-stair-landing-carrier-material.ts";
import { exactClosedSourcePlanarContact } from "./native-source-planar-slab-envelope.ts";
import {
  originalNativeForeignEnvelopeFacts,
  readOriginalForeignEnvelopeScopedSemantic,
  readOriginalForeignEnvelopeScopedFloor,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import { inspectOriginalNativeFloorCapDemand } from "./native-source-floor-cap-demand.ts";
import {
  certifyOriginalRectangularMullionSourceEnvelope,
  originalRectangularMullionSourceEnvelopeFact,
} from "./native-source-rectangular-mullion-envelope.ts";
import {
  certifyOriginalSimpleSystemPanelSourceEnvelope,
  originalSimpleSystemPanelSourceEnvelopeFact,
} from "./native-source-simple-system-panel.ts";
const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const sourceId = (v: unknown) =>
  (v as { m_id?: { m_id64?: unknown } } | undefined)?.m_id?.m_id64;
const compare = (a: Rational, b: Rational) => a.n * b.d - b.n * a.d;
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const one = <T>(rows: T[], message: string): T => {
  if (rows.length !== 1) throw new Error(message);
  return rows[0]!;
};
type Point3 = [number, number, number];
const validPoint = (p: unknown): p is Point3 =>
  Array.isArray(p) &&
  p.length === 3 &&
  [0, 1, 2].every((i) => typeof p[i] === "number" && Number.isFinite(p[i]));
const identityBrand: unique symbol = Symbol("OriginalStairBaseIdentity");
export type OriginalStairBaseIdentityDemand = {
  readonly [identityBrand]: true;
  readonly originalDatasetSha256: string;
  readonly sourceModelSha256: string;
};
const identities = new WeakMap<
  OriginalStairBaseIdentityDemand,
  {
    room: IndoorDataset["records"][number];
    seed: IndoorDataset["nodes"][number];
    node: IndoorDataset["nodes"][number];
    edge: IndoorDataset["edges"][number];
    originalSourceRoomsSha256?: string;
    nativeLevel?: IndoorDataset["nativeLevels"][number];
    approach?: {
      node: IndoorDataset["nodes"][number];
      room: IndoorDataset["records"][number];
      originalEnabledWalkIncidentEdgeIds: string[];
    };
  }
>();
/** A checked original graph binds the unique held source-stair/place relation.
 * This is identity demand, never a native room/cell ownership certificate. */
export function captureOriginalStairBaseIdentityDemand(
  bytes: Uint8Array,
  expectedDatasetSha256: string,
  expectedModelSha256: string,
  roomKey: string,
  nativeStairId: number,
  options: { approachNodeId?: string } = {},
) {
  if (
    !/^[a-f0-9]{64}$/.test(expectedDatasetSha256) ||
    !/^[a-f0-9]{64}$/.test(expectedModelSha256) ||
    hash(bytes) !== expectedDatasetSha256
  )
    throw new Error("Original stair-base identity bytes differ");
  const data = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as IndoorDataset;
  if (
    data.source?.modelSha256 !== expectedModelSha256 ||
    !Array.isArray(data.records) ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.edges)
  )
    throw new Error("Missing original source stair graph");
  const room = one(
      data.records.filter((r) => r.key === roomKey),
      "Original stair place is not unique",
    ),
    seed = one(
      data.nodes.filter((n) => n.id === `arrival:${roomKey}`),
      "Original stair arrival seed is not unique",
    ),
    edges = data.edges.filter(
      (e) =>
        e.kind === "stairs" &&
        e.nativeElementId === nativeStairId &&
        e.roomKeys.includes(roomKey),
    ),
    edge = one(edges, "Original own native stair edge is not unique"),
    node = one(
      data.nodes.filter(
        (n) => [edge.from, edge.to].includes(n.id) && n.roomKey === roomKey,
      ),
      "Original own native stair terminal is not unique",
    );
  if (
    !room.stair ||
    !room.walkable ||
    !["public", "staff", "unknown"].includes(room.access) ||
    !validPoint(seed.pointFeet) ||
    !validPoint(node.pointFeet) ||
    seed.roomKey !== roomKey ||
    seed.levelId !== room.levelId ||
    node.levelId !== room.levelId ||
    seed.surfaceId !== room.surfaceId ||
    node.surfaceId !== room.surfaceId ||
    seed.pointFeet[2] !== room.elevationFeet ||
    !equal(seed.pointFeet, node.pointFeet) ||
    !Number.isSafeInteger(nativeStairId) ||
    nativeStairId <= 0 ||
    edge.enabled !== false
  )
    throw new Error("Original held own stair/place/seed identity differs");
  let approach:
    | {
        node: IndoorDataset["nodes"][number];
        room: IndoorDataset["records"][number];
        originalEnabledWalkIncidentEdgeIds: string[];
      }
    | undefined;
  if (options.approachNodeId !== undefined) {
    const approachNode = one(
        data.nodes.filter((n) => n.id === options.approachNodeId),
        "Original base approach node is not unique",
      ),
      approachRoom = one(
        data.records.filter((r) => r.key === approachNode.roomKey),
        "Original base approach room is not unique",
      ),
      incident = data.edges.filter(
        (e) =>
          e.kind === "walk" &&
          e.enabled !== false &&
          [e.from, e.to].includes(approachNode.id),
      );
    if (
      !validPoint(approachNode.pointFeet) ||
      !approachRoom.walkable ||
      !approachRoom.circulation ||
      !["public", "unknown"].includes(approachRoom.access) ||
      approachNode.levelId !== room.levelId ||
      approachRoom.levelId !== room.levelId ||
      approachNode.surfaceId !== room.surfaceId ||
      approachRoom.surfaceId !== room.surfaceId ||
      approachNode.pointFeet[2] !== room.elevationFeet ||
      !incident.length
    )
      throw new Error("Original base approach node/room/policy demand differs");
    approach = {
      node: approachNode,
      room: approachRoom,
      originalEnabledWalkIncidentEdgeIds: incident.map((e) => e.id),
    };
  }
  const demand = Object.freeze({
    [identityBrand]: true as const,
    originalDatasetSha256: expectedDatasetSha256,
    sourceModelSha256: expectedModelSha256,
  });
  identities.set(
    demand,
    structuredClone({
      room,
      seed,
      node,
      edge,
      originalSourceRoomsSha256: data.source.roomsSha256,
      nativeLevel: Array.isArray(data.nativeLevels)
        ? one(
            data.nativeLevels.filter((l) => l.id === room.levelId),
            "Original stair level missing/duplicated",
          )
        : undefined,
      approach,
    }),
  );
  return demand;
}
function resolve(
  run: ReturnType<typeof readOriginalNativeStairPhysicalSource>["run"],
  descriptor: unknown,
) {
  const d = descriptor as {
    token: number;
    start: number;
    end: number;
    path: string;
  };
  if (!d || !d.token)
    throw new Error("Missing original native base descriptor");
  return one(
    run.entries.filter((e) =>
      d.token > 0
        ? e.descriptor.token === d.token
        : e.descriptor.start === d.start &&
          e.descriptor.end === d.end &&
          e.descriptor.path === d.path,
    ),
    "Ambiguous original native base descriptor",
  );
}
/** A deterministic mathematical request anchored to the literal original
 * finite start boundary and first original tread depth/direction. It is never
 * represented as a native authored point. Every demanded volume is rechecked. */
export function deriveOriginalStairBaseStandingRequest(
  run: ReturnType<typeof readOriginalNativeStairPhysicalSource>["run"],
  outsetTreadDepthMultiple = 1,
) {
  if (
    !Number.isSafeInteger(outsetTreadDepthMultiple) ||
    outsetTreadDepthMultiple < 1
  )
    throw new Error("Invalid original base tread-depth setback request");
  const start = resolve(run, run.root.m_oStartRiser),
    descriptors = run.root.m_stairsTreadInfoArr;
  if (
    start.sourceClassName !== "GLine" ||
    !Array.isArray(descriptors) ||
    !descriptors.length ||
    run.root.m_beginWithRiser !== 1
  )
    throw new Error("Unsupported original finite native stair base");
  const tread = resolve(run, descriptors[0]),
    line = start.value,
    origin = line.m_origin,
    direction = line.m_dirVec,
    parameters = line.m_endParams,
    forward = tread.value.m_runDirProj,
    depth = tread.value.m_actDepth,
    foot = run.root.m_bottomElevation;
  if (
    !Array.isArray(origin) ||
    origin.length !== 3 ||
    !Array.isArray(direction) ||
    direction.length !== 3 ||
    !Array.isArray(parameters) ||
    parameters.length !== 2 ||
    !Array.isArray(forward) ||
    forward.length !== 3 ||
    [...origin, ...direction, ...parameters, ...forward, depth, foot].some(
      (v) => typeof v !== "number" || !Number.isFinite(v),
    ) ||
    direction[2] !== 0 ||
    forward[2] !== 0 ||
    parameters[0] === parameters[1] ||
    typeof depth !== "number" ||
    depth <= 0 ||
    typeof foot !== "number" ||
    tread.sourceClassName !== "StairsTreadInfo"
  )
    throw new Error("Incomplete original source base line/tread direction");
  const scale = Math.max(Math.abs(forward[0]), Math.abs(forward[1]));
  if (!(scale > 0)) throw new Error("Zero original first-tread run direction");
  const u = (parameters[0] + parameters[1]) / 2,
    midpoint = [origin[0] + direction[0] * u, origin[1] + direction[1] * u],
    outset = 1 + outsetTreadDepthMultiple * depth,
    sourceBaseSpanMaxComponentFeet =
      Math.max(Math.abs(direction[0]), Math.abs(direction[1])) *
      Math.abs(parameters[1] - parameters[0]),
    pointFeet: Point3 = [
      midpoint[0] - (forward[0] / scale) * outset,
      midpoint[1] - (forward[1] / scale) * outset,
      foot,
    ];
  if (!validPoint(pointFeet) || !Number.isFinite(outset))
    throw new Error("Nonfinite derived source base request");
  // Additional candidate setbacks stay within the original finite start
  // boundary's conservative max-component span. This bounds a request; it
  // supplies no landing, room, floor, body or approach authority.
  if (
    outsetTreadDepthMultiple > 1 &&
    (!Number.isFinite(sourceBaseSpanMaxComponentFeet) ||
      outset > sourceBaseSpanMaxComponentFeet)
  )
    throw new Error("Original source base setback exceeds its finite span");
  return {
    pointFeet,
    originalAuthoredPoint: false as const,
    originalStartBoundaryDescriptor: start.descriptor,
    originalStartBoundary: structuredClone(line),
    originalFirstTreadDescriptor: tread.descriptor,
    originalFirstTreadDepthFeet: depth,
    originalRunDirection: structuredClone(forward),
    outsetTreadDepthMultiple,
    sourceBaseSpanMaxComponentFeet,
    requestedOutsetFeet: outset,
    formula:
      "start-boundary midpoint minus original run direction/maxComponent times (one standing halfwidth plus selected integer multiple of first source tread depth)",
  };
}
const brand: unique symbol = Symbol("OriginalSourceStairBaseStanding");
export type OriginalSourceStairBaseStanding = {
  readonly [brand]: true;
  readonly sourceModelSha256: string;
  readonly sourceCensusSha256: string;
  readonly roomKey: string;
};
const issued = new WeakMap<
  OriginalSourceStairBaseStanding,
  ReturnType<typeof construct>
>();
function construct(
  demand: OriginalStairBaseIdentityDemand,
  sources: {
    stair: OriginalNativeStairPhysicalContext;
    membership: OriginalNativeStairAssemblyMembership;
    foreign: OriginalNativeForeignEnvelopeCensus;
    directWalls?: readonly OriginalDirectWallTrimObstacleCertificate[];
    recordedIntent?: OriginalRecordedStairIntentDemand;
  },
  request: {
    nativeRunId: number;
    nativeFloorElementId: number;
    originalCapFaceToken: number;
    outsetTreadDepthMultiple?: number;
    expectedDerivedPointFeet?: Point3;
    approachXYFeet?: [number, number][];
  },
) {
  const identity = identities.get(demand);
  if (!identity)
    throw new Error("Untrusted original stair-base identity demand");
  const recordedIntent = sources.recordedIntent
    ? originalRecordedStairIntentDemandFacts(sources.recordedIntent)
    : undefined;
  if (
    recordedIntent &&
    (recordedIntent.sourceRoomsSha256 !== identity.originalSourceRoomsSha256 ||
      recordedIntent.declaredSourceModelSha256 !== demand.sourceModelSha256 ||
      recordedIntent.nativeStairId !== identity.edge.nativeElementId ||
      recordedIntent.nativeRunId !== request.nativeRunId ||
      recordedIntent.lowerRoom.key !== identity.room.key ||
      recordedIntent.lowerRoom.levelId !== identity.room.levelId ||
      identity.edge.roomKeys.length !== 2 ||
      !identity.edge.roomKeys.includes(recordedIntent.upperRoom.key))
  )
    throw new Error("Original recorded intent differs from its checked graph");
  if (
    (identity.approach && !recordedIntent) ||
    (!identity.approach && request.approachXYFeet !== undefined)
  )
    throw new Error("Original source approach lacks checked recorded intent");
  const member = originalNativeStairAssemblyMembershipFacts(sources.membership),
    physical = readOriginalNativeStairPhysicalSource(
      sources.stair,
      request.nativeRunId,
    ),
    foreign = originalNativeForeignEnvelopeFacts(sources.foreign);
  if (
    member.sourceModelSha256 !== demand.sourceModelSha256 ||
    physical.sourceModelSha256 !== demand.sourceModelSha256 ||
    foreign.sourceModelSha256 !== demand.sourceModelSha256 ||
    physical.sourceSchemaSha256 !== foreign.sourceSchemaSha256 ||
    member.sourceSchemaSha256 !== foreign.sourceSchemaSha256 ||
    member.nativeStairId !== identity.edge.nativeElementId ||
    physical.nativeStairId !== member.nativeStairId ||
    !member.schemaChildUnionClosed ||
    !member.completeOriginalChildSemanticOccurrenceCensus ||
    !equal(member.originalRunIds, [request.nativeRunId]) ||
    member.originalLandingIds.length ||
    member.originalBaseOnlyChildOccurrenceCount ||
    member.originalParentDeclaredIdsAbsentFromLiveChildCensus.length
  )
    throw new Error("Incomplete/foreign unique original source base ownership");
  const parent = readOriginalForeignEnvelopeScopedSemantic(
      sources.foreign,
      member.nativeStairId,
      4075,
    ),
    schema = readSchema(parent.originalSourceSchemaBytes);
  if (!schema.ok) throw new Error("Original stair-base schema unavailable");
  const ancestry = inspectOriginalElementLevelPrefix(
      parent.originalFrameBytes,
      schema.schema,
      "StairsElement",
    ),
    level = identity.room.levelId;
  if (
    parent.originalFrameSha256 !== member.originalParentSemanticFrameSha256 ||
    ancestry.nativeElementId !== member.nativeStairId ||
    !ancestry.stair ||
    ancestry.stair.originalBaseLevelId !== level ||
    ancestry.stair.originalBaseLevelOffsetFeet !== 0 ||
    (recordedIntent !== undefined &&
      (ancestry.stair.originalTopLevelId !== recordedIntent.upperRoom.levelId ||
        ancestry.stair.originalTopLevelOffsetFeet !== 0)) ||
    physical.run.root.m_bottomElevation !== identity.room.elevationFeet ||
    sourceId(physical.run.root.m_stairsId) !== member.nativeStairId ||
    sourceId(physical.symbol.root.m_hostId) !== request.nativeRunId
  )
    throw new Error(
      "Original native base served plane/place/run chain differs",
    );
  const derived = deriveOriginalStairBaseStandingRequest(
      physical.run,
      request.outsetTreadDepthMultiple,
    ),
    point = derived.pointFeet,
    center = point.slice(0, 2).map(rational) as NativeRationalPoint,
    foot = rational(point[2]),
    head = new Rational(foot.n + 6n * foot.d, foot.d),
    standingSquare = originalTwoFootStandingSquare(center),
    approach = identity.approach
      ? originalSourceBaseApproachDemand(
          identity.approach.node.pointFeet,
          point,
          request.approachXYFeet,
        )
      : undefined,
    square = approach?.completeFootprintFeet ?? standingSquare,
    own = certifyOriginalNativePlacedStairEnvelope(
      sources.stair,
      request.nativeRunId,
    );
  if (
    (derived.outsetTreadDepthMultiple > 1 &&
      !validPoint(request.expectedDerivedPointFeet)) ||
    (request.expectedDerivedPointFeet !== undefined &&
      !equal(request.expectedDerivedPointFeet, point))
  )
    throw new Error("Original selected source base request point differs");
  if (!own.ok) throw new Error(own.blockers.join(";"));
  const ownStanding = auditOriginalPlacedStairAboveFoot(
    own.certificate,
    square,
    foot,
    rational(6),
  );
  if (
    !ownStanding.localizedComponentContacts ||
    ownStanding.localizedComponentContacts.length ||
    ownStanding.sourceMaterialLocalizationBlockers.length
  )
    throw new Error(
      "Original complete own source base standing remains blocked",
    );
  const vertices = square.flat(2),
    lower = [0, 1].map((i) =>
      vertices.map((p) => p[i]!).reduce((a, b) => (compare(a, b) < 0n ? a : b)),
    ),
    upper = [0, 1].map((i) =>
      vertices.map((p) => p[i]!).reduce((a, b) => (compare(a, b) > 0n ? a : b)),
    ),
    scope = foreign.scopeBoundsFeet;
  for (const [index, axis] of [
    [0, "x"],
    [1, "y"],
    [2, "z"],
  ] as const)
    if (
      compare(rational(scope.min[axis]), index === 2 ? foot : lower[index]!) >
        0n ||
      compare(rational(scope.max[axis]), index === 2 ? head : upper[index]!) <
        0n
    )
      throw new Error(
        "Original foreign census does not cover the full base standing demand",
      );
  const carrier = inspectOriginalStairLandingCarrierMaterial(
    physical.carrier,
    physical.nativeDefinitionId,
  );
  if (
    !carrier.allOriginalCarrierMaterialEnclosed ||
    carrier.cells.some(
      (cell) =>
        compare(cell.maximumElevationFeet, foot) > 0n &&
        compare(cell.minimumElevationFeet, head) <= 0n &&
        exactClosedSourcePlanarContact(
          square,
          cell.partsFeet,
          cell.closedSegmentsFeet,
        ),
    )
  )
    throw new Error(
      "Original complete base carrier material remains blocked or unknown",
    );
  const standing = {
      ...inspectWholeFootprintEnvelopeCandidates(
        foreign.rows,
        square,
        foot,
        head,
      ),
      sourceCensusSha256: foreign.sourceCensusSha256,
    },
    ownFrames = new Set(Object.values(physical.sourceFrameSha256s)),
    bounded = standing.candidateNativeElementIds;
  const wallFacts = (sources.directWalls ?? []).map((certificate) => ({
    nativeElementId: certificate.nativeElementId,
    facts: originalDirectWallTrimObstacleFacts(certificate),
  }));
  if (
    new Set(wallFacts.map((w) => w.nativeElementId)).size !== wallFacts.length
  )
    throw new Error("Duplicate original standing wall refinements");
  for (const { nativeElementId, facts } of wallFacts) {
    const row = one(
      foreign.rows.filter((r) => r.nativeElementId === nativeElementId),
      "Original standing wall source census is ambiguous",
    );
    if (
      facts.sourceFacts.sourceModelSha256 !== physical.sourceModelSha256 ||
      facts.sourceFacts.sourceSchemaSha256 !== physical.sourceSchemaSha256 ||
      facts.sourceFacts.nativeCategoryId !== -2000011 ||
      row.categoryId !== -2000011 ||
      row.sourceFrameSha256 !== facts.sourceFacts.originalFrameSha256
    )
      throw new Error("Foreign/stale original standing wall source refinement");
  }
  const boundedForeignRefinements: {
    nativeElementId: number;
    facts: ReturnType<typeof originalDirectWallTrimObstacleFacts>;
  }[] = [];
  const unresolvedBounded: {
    nativeElementId: number;
    reason: string;
    rows: typeof foreign.rows;
  }[] = [];
  for (const nativeId of bounded) {
    const rows = foreign.rows.filter((r) => r.nativeElementId === nativeId);
    if (
      nativeId === request.nativeRunId &&
      rows.length === 1 &&
      ownFrames.has(rows[0]!.sourceFrameSha256)
    )
      continue;
    const refined = wallFacts.find((w) => w.nativeElementId === nativeId);
    // Keep every contact and unresolved row. A whole-plan disjoint enclosure
    // proves absence at every height; a closed contact still vetoes standing.
    if (
      !refined ||
      exactClosedSourcePlanarContact(
        square,
        refined.facts.outerPlanEnvelope,
        [],
      )
    ) {
      unresolvedBounded.push({
        nativeElementId: nativeId,
        reason: refined
          ? "complete-original-wall-envelope-closed-contact"
          : "no-bound-current-complete-source-refinement",
        rows,
      });
      continue;
    }
    boundedForeignRefinements.push(refined);
  }
  if (unresolvedBounded.length > 0)
    throw Object.assign(
      new Error(
        `Original bounded foreign source standing remains: ${unresolvedBounded.map((r) => r.nativeElementId).join(", ")}`,
      ),
      {
        originalStandingSourceRefusal: {
          diagnosticOnly: true,
          standingPointFeet: [...point],
          candidateNativeElementIds: [...bounded],
          unresolvedBounded: structuredClone(unresolvedBounded),
          sourceModelSha256: foreign.sourceModelSha256,
          sourceSchemaSha256: foreign.sourceSchemaSha256,
          sourceCensusSha256: foreign.sourceCensusSha256,
          sourceAuthorityGranted: false,
          routeApproved: false,
        },
      },
    );
  const lo = lower,
    hi = upper,
    touch = (min: Rational[], max: Rational[]) =>
      compare(max[2]!, foot) > 0n &&
      compare(min[2]!, head) <= 0n &&
      compare(max[0]!, lo[0]!) >= 0n &&
      compare(min[0]!, hi[0]!) <= 0n &&
      compare(max[1]!, lo[1]!) >= 0n &&
      compare(min[1]!, hi[1]!) <= 0n;
  const refinements = standing.unboundedNativeElementIds.map((nativeId) => {
    const row = one(
      foreign.rows.filter((r) => r.nativeElementId === nativeId),
      "Ambiguous original unbounded source",
    );
    if (row.categoryId === -2000170) {
      const c = certifyOriginalSimpleSystemPanelSourceEnvelope(
        sources.foreign,
        nativeId,
      );
      if (!c.ok) throw new Error(c.blockers.join(";"));
      const f = originalSimpleSystemPanelSourceEnvelopeFact(
        sources.foreign,
        c.certificate,
      );
      if (
        f.conservativeMaterialBoxesFeet.some((b) =>
          touch(b.minimumFeet, b.maximumFeet),
        )
      )
        throw new Error(`Original panel blocks base standing:${nativeId}`);
      return f;
    }
    if (row.categoryId === -2000171) {
      const c = certifyOriginalRectangularMullionSourceEnvelope(
        sources.foreign,
        nativeId,
      );
      if (!c.ok) throw new Error(c.blockers.join(";"));
      const f = originalRectangularMullionSourceEnvelopeFact(
          sources.foreign,
          c.certificate,
        ),
        b = f.boundsFeet;
      if (
        touch(
          [b.min.x, b.min.y, b.min.z].map(rational),
          [b.max.x, b.max.y, b.max.z].map(rational),
        )
      )
        throw new Error(`Original mullion blocks base standing:${nativeId}`);
      return f;
    }
    throw new Error(`Unknown original foreign source:${nativeId}`);
  });
  const floorSource = readOriginalForeignEnvelopeScopedFloor(
      sources.foreign,
      request.nativeFloorElementId,
    ),
    floorSchema = readSchema(floorSource.originalSourceSchemaBytes);
  if (!floorSchema.ok)
    throw new Error("Original base floor schema unavailable");
  const floorIdentity = inspectOriginalElementLevelPrefix(
    floorSource.originalFloorFrameBytes,
    floorSchema.schema,
    "Floor",
  );
  if (floorIdentity.nativeAssociatedLevelId !== level)
    throw new Error("Original source base floor level differs");
  const floor = inspectOriginalNativeFloorCapDemand(
    sources.foreign,
    request.nativeFloorElementId,
    request.originalCapFaceToken,
    square,
  );
  if (
    !floor.completeConnectedDemandSupported ||
    compare(floor.originalPhysicalTopElevationFeet, foot) !== 0n
  )
    throw new Error(
      "Complete original source base square/floor plane unsupported",
    );
  return {
    kind: "original-source-stair-base-standing" as const,
    sourceModelSha256: demand.sourceModelSha256,
    sourceSchemaSha256: foreign.sourceSchemaSha256,
    sourceCensusSha256: foreign.sourceCensusSha256,
    originalDatasetSha256: demand.originalDatasetSha256,
    roomKey: identity.room.key,
    originalAccess: identity.room.access,
    originalIdentity: structuredClone({
      sourceModelSha256: demand.sourceModelSha256,
      sourceRoomsSha256: identity.originalSourceRoomsSha256,
      room: identity.room,
      seed: identity.seed,
      terminal: identity.node,
      heldEdge: identity.edge,
      nativeLevel: identity.nativeLevel,
      approach: identity.approach
        ? { node: identity.approach.node, room: identity.approach.room }
        : undefined,
    }),
    originalLevelId: level,
    originalSeed: structuredClone(identity.seed),
    originalNativeEdge: structuredClone(identity.edge),
    originalNativeTerminal: structuredClone(identity.node),
    nativeStairId: member.nativeStairId,
    nativeRunId: request.nativeRunId,
    nativeDefinitionId: physical.nativeDefinitionId,
    originalSourceFrameSha256s: physical.sourceFrameSha256s,
    originalParentSemanticFrameSha256: parent.originalFrameSha256,
    completeNativeSingleRunBaseRelationship: true as const,
    originalRecordedNativeIdentityIntent: recordedIntent,
    originalRecordedIntentAndNativeBaseCorrespondenceQualified:
      recordedIntent !== undefined,
    originalSourceApproach:
      approach && identity.approach
        ? {
            ...approach,
            originalNode: structuredClone(identity.approach.node),
            originalRoom: structuredClone(identity.approach.room),
            originalEnabledWalkIncidentEdgeIds: [
              ...identity.approach.originalEnabledWalkIncidentEdgeIds,
            ],
          }
        : undefined,
    fullSourceFiniteApproachQualified: approach !== undefined,
    proposedNode:
      approach && identity.approach
        ? {
            id: `arrival:stair-base-derived:${identity.room.key}:${member.nativeStairId}:${request.nativeRunId}`,
            roomKey: identity.room.key,
            levelId: level,
            building: identity.room.building,
            surfaceId: identity.room.surfaceId,
            kind: "arrival" as const,
            pointFeet: [...point] as Point3,
          }
        : undefined,
    proposedApproach:
      approach && identity.approach
        ? {
            id: `walk:stair-base-derived:${identity.room.key}:${member.nativeStairId}:${request.nativeRunId}`,
            from: identity.approach.node.id,
            to: `arrival:stair-base-derived:${identity.room.key}:${member.nativeStairId}:${request.nativeRunId}`,
            kind: "walk" as const,
            pointsFeet: structuredClone(approach.requestedPathFeet),
            accessible: "unknown" as const,
            enabled: false as const,
          }
        : undefined,
    completeSourceStandingAndApproachFootprintFeet: square,
    derived,
    ownStanding,
    originalCarrierMaterial: carrier,
    foreignStanding: standing,
    allUnboundedOriginalSourceRefinements: refinements,
    allBoundedOriginalSourceRefinements: boundedForeignRefinements,
    completeOriginalForeignRowCount: foreign.rows.length,
    floorIdentity,
    floor,
    completeTwoFootSixFootStandingSourcePredicatesPassed: true as const,
    currentCellOwnerQualified: false as const,
    sourceRoomNativeOwnershipAsserted: false as const,
    fullApproachOrStairProfileApproved: false as const,
    cellOwnersChanged: false as const,
    originalGraphChanged: false as const,
    arrivalPointerApplied: false as const,
    routeApproved: false as const,
  };
}
export function certifyOriginalSourceStairBaseStanding(
  demand: OriginalStairBaseIdentityDemand,
  sources: Parameters<typeof construct>[1],
  request: Parameters<typeof construct>[2],
): OriginalSourceStairBaseStanding {
  const facts = construct(demand, sources, request),
    handle = Object.freeze({
      [brand]: true as const,
      sourceModelSha256: facts.sourceModelSha256,
      sourceCensusSha256: facts.sourceCensusSha256,
      roomKey: facts.roomKey,
    });
  issued.set(handle, structuredClone(facts));
  return handle;
}
export function originalSourceStairBaseStandingFacts(
  handle: OriginalSourceStairBaseStanding,
) {
  const facts = issued.get(handle);
  if (!facts) throw new Error("Untrusted original source base standing");
  return structuredClone(facts);
}

/** Kept separately from the immutable raw source-room checksum. A caller cannot
 * mint a pipeline session or restore this binding from serialized evidence. */
const compilerBindings = new WeakMap<OriginalSourceStairBaseStanding, {
  current: IndoorDataset;
  compilerInputSha256: string;
}>();
export function bindOriginalSourceStairBaseCompilerInput(
  handle: OriginalSourceStairBaseStanding,
  current: IndoorDataset,
  normalizedRoomDirectoryInput: RoomDirectoryData,
): void {
  const facts = issued.get(handle);
  if (!facts || !facts.originalRecordedNativeIdentityIntent ||
      !facts.fullSourceFiniteApproachQualified ||
      !facts.originalRecordedIntentAndNativeBaseCorrespondenceQualified)
    throw new Error("Live complete original source stair approach/intent required");
  // Compare the exact serialized bytes that were hashed, including any JSON
  // serialization behavior, rather than reading a potentially different object.
  const serialized = JSON.stringify(normalizedRoomDirectoryInput),
    compilerInputSha256 = hash(new TextEncoder().encode(serialized));
  assertOriginalStairBaseCompilerSession(handle, current, compilerInputSha256);
  if (current.source.modelSha256 !== facts.sourceModelSha256)
    throw new Error("Normalized compiler changed original source model");
  assertStairBaseCompilerInputIdentityPreserved(
    facts.originalRecordedNativeIdentityIntent, JSON.parse(serialized));
  const previous = compilerBindings.get(handle);
  if (previous && (previous.current !== current ||
      previous.compilerInputSha256 !== compilerInputSha256))
    throw new Error("Original source stair compiler binding cannot be rebound");
  compilerBindings.set(handle, {current, compilerInputSha256});
}
function checkedCompilerBinding(
  handle: OriginalSourceStairBaseStanding,
  current: IndoorDataset,
) {
  const binding = compilerBindings.get(handle);
  if (!binding || binding.current !== current)
    throw new Error("Live same-dataset original stair compiler binding required");
  assertOriginalStairBaseCompilerSession(handle, current, binding.compilerInputSha256);
  return binding.compilerInputSha256;
}

/** Identity preservation only; missing exact original derived seed/corridor
 * arrival pointers may remain pending. This neither inserts nor applies them. */
export function assertOriginalSourceStairBaseIdentityPreserved(
  handle: OriginalSourceStairBaseStanding,
  current: IndoorDataset,
) {
  const facts = issued.get(handle);
  if (!facts)
    throw new Error("Live original source stair base capability required");
  assertStairBaseIdentityFieldsPreserved(facts.originalIdentity, current,
    checkedCompilerBinding(handle, current));
  return {
    originalIdentityPreserved: true as const,
    routeApproved: false as const,
  };
}

/** Compare an inserted proposal with private source-qualified demand only.
 * Complete current free-cell/material replay and policy are separate gates. */
export function assertOriginalSourceStairBaseProposal(
  handle: OriginalSourceStairBaseStanding,
  current: IndoorDataset,
) {
  const facts = issued.get(handle);
  if (
    !facts ||
    !facts.fullSourceFiniteApproachQualified ||
    !facts.originalRecordedIntentAndNativeBaseCorrespondenceQualified ||
    !facts.proposedNode ||
    !facts.proposedApproach
  )
    throw new Error(
      "Live complete original source stair finite approach required",
    );
  return assertStairBaseProposalFieldsPreserved(
    {
      original: facts.originalIdentity,
      nativeFloorElementId: facts.floor.nativeFloorElementId,
      proposedNode: facts.proposedNode,
      proposedApproach: facts.proposedApproach,
    },
    current,
    checkedCompilerBinding(handle, current),
  );
}
