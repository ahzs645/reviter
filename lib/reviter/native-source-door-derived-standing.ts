/** A bounded ordinary-door standing capability. Original checked graph bytes
 * establish identity demand only; actual RVT handles supply every material,
 * native instance/level/host and floor predicate. This grants no door opening,
 * node insertion, arrival pointer, accessibility, policy or route admission. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { IndoorDataset } from "./indoor-contract.ts";
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalParts as Parts,
  type NativeRationalPoint as P,
} from "./native-rational-overlay.ts";
import { nativeRationalPointInParts } from "./native-exact-planar-topology.ts";
import { originalTwoFootStandingSquare } from "./native-source-standing-footprint.ts";
import { projectStatedTwoFootWalkingVolume } from "./native-source-walking-volume.ts";
import { readSchema } from "./schema-reader.ts";
import { inspectOriginalElementLevelPrefix } from "./native-source-element-level-prefix.ts";
import { readOriginalOrdinaryDoorTypedFifo } from "./native-source-ordinary-door-typed.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "./revit-2027-grep-replay.ts";
import { inspectOriginalPlacedTrimProjectedVolume } from "./native-source-placed-trim-projected-volume.ts";
import {
  originalNativeForeignEnvelopeFacts,
  readOriginalForeignEnvelopeScopedFrame,
  readOriginalForeignEnvelopeScopedSemantic,
  readOriginalForeignEnvelopeScopedFloor,
  auditOriginalForeignEnvelopeStandingSquare,
  auditOriginalForeignEnvelopeHorizontal,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import { inspectOriginalNativeFloorCapDemand } from "./native-source-floor-cap-demand.ts";
import {
  readOriginalNativeStairPhysicalSource,
  type OriginalNativeStairPhysicalContext,
} from "./native-source-stair-physical-inventory.ts";
import {
  certifyOriginalNativePlacedStairEnvelope,
  auditOriginalPlacedStairAboveFoot,
  auditOriginalPlacedStairAgainstWalkingLine,
} from "./native-source-stair-placed-envelope.ts";
import {
  certifyOriginalSimpleSystemPanelSourceEnvelope,
  originalSimpleSystemPanelSourceEnvelopeFact,
} from "./native-source-simple-system-panel.ts";
import {
  certifyOriginalRectangularMullionSourceEnvelope,
  originalRectangularMullionSourceEnvelopeFact,
} from "./native-source-rectangular-mullion-envelope.ts";

type Point3 = [number, number, number];
type Q = Rational;
const hash = (b: Uint8Array) => bytesToHex(sha256(b));
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const id = (v: unknown): number => {
  const n = (v as { m_id?: { m_id64?: unknown } })?.m_id?.m_id64;
  if (!Number.isSafeInteger(n) || Number(n) <= 0)
    throw Error("Missing positive original source id");
  return Number(n);
};
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q) => new Rational(a.n * b.d, a.d * b.n);
const cmp = (a: Q, b: Q) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const abs = (a: Q) => new Rational(a.n < 0n ? -a.n : a.n, a.d);
const point = (p: unknown): p is Point3 =>
  Array.isArray(p) &&
  p.length === 3 &&
  p.every((n) => typeof n === "number" && Number.isFinite(n));
function unique<T>(a: T[], message: string): T {
  if (a.length !== 1) throw Error(message);
  return a[0]!;
}
const demandBrand: unique symbol = Symbol("OriginalDoorStandingIdentityDemand");
export type OriginalDoorStandingIdentityDemand = {
  readonly [demandBrand]: true;
  readonly originalDatasetSha256: string;
  readonly sourceModelSha256: string;
  readonly scope: "original-door-owner-identity-demand-only";
};
type Identity = {
  room: IndoorDataset["records"][number];
  portal: IndoorDataset["nodes"][number];
  seed: IndoorDataset["nodes"][number];
  door: NonNullable<IndoorDataset["doors"]>[number];
  level: IndoorDataset["nativeLevels"][number];
  originalOwnNodes: IndoorDataset["nodes"];
  sameLevelPlaces: { key: string; levelId: number; ringsFeet: number[][][] }[];
  nativeOwnStairId: number;
};
const identities = new WeakMap<OriginalDoorStandingIdentityDemand, Identity>();

/** The independently selected baseline hash is required. Its checksum binds
 * identity/permissions, never geometry authority or a source-issued body. */
export function captureOriginalDoorStandingIdentityDemand(
  bytes: Uint8Array,
  expectedDatasetSha256: string,
  expectedModelSha256: string,
  roomKey: string,
  nativeDoorId: number,
  originalPortalId: string,
): OriginalDoorStandingIdentityDemand {
  if (
    !/^[a-f0-9]{64}$/.test(expectedDatasetSha256) ||
    !/^[a-f0-9]{64}$/.test(expectedModelSha256) ||
    hash(bytes) !== expectedDatasetSha256
  )
    throw Error("Original door identity bytes differ");
  const data = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as IndoorDataset;
  if (
    data.source?.modelSha256 !== expectedModelSha256 ||
    !Array.isArray(data.records) ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.nativeLevels) ||
    !Array.isArray(data.edges) ||
    !Array.isArray(data.doors)
  )
    throw Error("Missing original door graph identity");
  const room = unique(
      data.records.filter((r) => r.key === roomKey),
      "Missing or duplicated original place",
    ),
    portal = unique(
      data.nodes.filter((n) => n.id === originalPortalId),
      "Missing or duplicated original own portal",
    ),
    seed = unique(
      data.nodes.filter((n) => n.id === `arrival:${roomKey}`),
      "Missing or duplicated original arrival seed",
    ),
    level = unique(
      data.nativeLevels.filter((l) => l.id === room.levelId),
      "Missing original native level",
    ),
    door = unique(
      data.doors.filter(
        (d) =>
          d.state === "connected" &&
          d.levelId === room.levelId &&
          d.roomKeys.includes(roomKey),
      ),
      "Original own doorway is not unique",
    );
  if (
    door.nativeElementId !== nativeDoorId ||
    !Number.isSafeInteger(nativeDoorId) ||
    nativeDoorId <= 0 ||
    !door.hostWallNativeElementId ||
    door.roomKeys.length !== 2 ||
    new Set(door.roomKeys).size !== 2 ||
    portal.kind !== "portal" ||
    portal.roomKey !== roomKey ||
    portal.levelId !== room.levelId ||
    portal.surfaceId !== room.surfaceId ||
    seed.kind !== "arrival" ||
    seed.roomKey !== roomKey ||
    seed.levelId !== room.levelId ||
    seed.surfaceId !== room.surfaceId ||
    !point(portal.pointFeet) ||
    !point(seed.pointFeet) ||
    portal.pointFeet[2] !== level.elevationFeet ||
    seed.pointFeet[2] !== level.elevationFeet ||
    room.elevationFeet !== level.elevationFeet ||
    !room.walkable ||
    !["public", "staff", "unknown"].includes(room.access)
  )
    throw Error("Original door/place/portal/native-level identity differs");
  const edge = unique(
    data.edges.filter((e) => e.id === door.id),
    "Original native door edge missing",
  );
  if (
    edge.kind !== "door" ||
    edge.nativeElementId !== nativeDoorId ||
    ![edge.from, edge.to].includes(portal.id) ||
    !equal(edge.roomKeys, door.roomKeys)
  )
    throw Error("Original own portal does not bind its native door edge");
  const ownStairs = [
    ...new Set(
      data.edges
        .filter(
          (e) =>
            ["stairs", "local-steps"].includes(e.kind) &&
            e.roomKeys.includes(roomKey) &&
            Number.isSafeInteger(e.nativeElementId) &&
            Number(e.nativeElementId) > 0,
        )
        .map((e) => e.nativeElementId!),
    ),
  ];
  const nativeOwnStairId = unique(
    ownStairs,
    "Original own stair identity is not unique",
  );
  if (
    data.nodes.some(
      (n) => n.id === `arrival:door-derived:${roomKey}:${nativeDoorId}`,
    ) ||
    data.edges.some(
      (e) => e.id === `walk:door-derived:${roomKey}:${nativeDoorId}`,
    )
  )
    throw Error(
      "Derived standing proposal collides with an original graph identity",
    );
  const sameLevelPlaces = data.records
    .filter((r) => r.levelId === room.levelId)
    .map((r) => ({ key: r.key, levelId: r.levelId, ringsFeet: r.ringsFeet }));
  if (
    sameLevelPlaces.some(
      (r) =>
        !Array.isArray(r.ringsFeet) ||
        !r.ringsFeet.length ||
        r.ringsFeet.some(
          (ring) =>
            !Array.isArray(ring) ||
            ring.length < 3 ||
            ring.some(
              (p) =>
                !Array.isArray(p) ||
                p.length !== 2 ||
                p.some((n) => !Number.isFinite(n)),
            ),
        ),
    )
  )
    throw Error("Incomplete original same-level identity outlines");
  const demand = Object.freeze({
    [demandBrand]: true as const,
    originalDatasetSha256: expectedDatasetSha256,
    sourceModelSha256: expectedModelSha256,
    scope: "original-door-owner-identity-demand-only" as const,
  });
  identities.set(
    demand,
    structuredClone({
      room,
      portal,
      seed,
      door,
      level,
      sameLevelPlaces,
      nativeOwnStairId,
      originalOwnNodes: data.nodes.filter((n) => n.roomKey === roomKey),
    }),
  );
  return demand;
}
function identity(d: OriginalDoorStandingIdentityDemand) {
  const s = identities.get(d);
  if (!s) throw Error("Checked original door identity handle required");
  return s;
}

export type OriginalDoorDerivedStandingRequest = {
  nativeRunId: number;
  /** A finite retained component is a source reference, never a leaf waiver. */
  originalMaterialReferenceGeometryToken: number;
  nativeFloorElementId: number;
  originalCapFaceToken: number;
};
const standingBrand: unique symbol = Symbol("OriginalDoorDerivedStanding");
export type OriginalDoorDerivedStanding = {
  readonly [standingBrand]: true;
  readonly sourceModelSha256: string;
  readonly scope: "original-source-door-standing-and-short-approach-only";
};

/** Pure source-derived REQUEST mathematics. All exact retained reference and
 * twin/join bounds of the chosen material component determine the offset.
 * It retains the original portal's source-local X/physical Z and selects the
 * side independently established by that portal. Rounding grants no authority;
 * the actual-source constructor checks the complete rounded demand afresh. */
export function deriveOriginalDoorStandingRequest(
  occurrence: Revit2027GRepReplay,
  definition: Revit2027GRepReplay,
  originalPortalFeet: Point3,
  materialReferenceGeometryToken: number,
) {
  if (!point(originalPortalFeet))
    throw Error("Invalid original portal request");
  const foot = rational(originalPortalFeet[2]),
    head = add(foot, rational(6)),
    bound = inspectOriginalPlacedTrimProjectedVolume(
      occurrence,
      definition,
      {
        footprintFeet: originalTwoFootStandingSquare(
          originalPortalFeet.slice(0, 2).map(rational) as P,
        ),
        minimumElevationFeet: foot,
        maximumElevationFeet: head,
      },
      [1, 2],
    );
  if (!bound.ok) throw Error(bound.blockers.join("; "));
  const component = unique(
      bound.components.filter(
        (c) => c.originalGeometryToken === materialReferenceGeometryToken,
      ),
      "Original material reference absent/ambiguous",
    ),
    points = component.faces.flatMap((f) => [
      ...f.originalProjectedReferenceRingFeet,
      ...f.retainedTwinAndJoinBoundaryPartsFeet.flat(2),
      ...f.retainedZeroAreaClosedBoundarySegmentsFeet.flat(),
    ]);
  if (!points.length) throw Error("Empty original material reference");
  const low = points.map((p) => p[0]).reduce((a, b) => (cmp(a, b) < 0 ? a : b)),
    high = points.map((p) => p[0]).reduce((a, b) => (cmp(a, b) > 0 ? a : b)),
    thickness = sub(high, low);
  if (thickness.n <= 0n)
    throw Error("Original material reference has no positive finite thickness");
  const bindings = collectRevit2027GInstanceBindings(occurrence);
  if (!bindings.ok || bindings.value.length !== 1)
    throw Error("Original affine missing");
  const t = bindings.value[0]!.instance.transform,
    x = t.xAxis.map(rational),
    y = t.yAxis.map(rational),
    z = t.zAxis.map(rational),
    o = t.origin.map(rational),
    p = originalPortalFeet.map(rational),
    det = sub(mul(x[0]!, y[1]!), mul(x[1]!, y[0]!)),
    dx = sub(p[0]!, o[0]!),
    dy = sub(p[1]!, o[1]!),
    local = [
      div(sub(mul(dx, y[1]!), mul(dy, y[0]!)), det),
      div(sub(mul(x[0]!, dy), mul(x[1]!, dx)), det),
      div(sub(p[2]!, o[2]!), z[2]!),
    ],
    half = add(abs(div(x[1]!, det)), abs(div(x[0]!, det)));
  const positive = cmp(local[1]!, high) > 0,
    negative = cmp(local[1]!, low) < 0;
  if (!positive && !negative)
    throw Error("Original own portal does not establish a material side");
  const localCandidate = [
      local[0]!,
      positive
        ? add(add(high, half), thickness)
        : sub(sub(low, half), thickness),
      local[2]!,
    ],
    exact = o.map((v, i) =>
      add(
        add(
          add(v, mul(x[i]!, localCandidate[0]!)),
          mul(y[i]!, localCandidate[1]!),
        ),
        mul(z[i]!, localCandidate[2]!),
      ),
    ),
    requested = exact.map((q) => Number(q.n) / Number(q.d));
  if (!point(requested) || requested[2] !== originalPortalFeet[2])
    throw Error("Unsupported finite literal source-derived request");
  return {
    requestedPointFeet: requested,
    exactSourceDerivedPointFeet: exact,
    originalMaterialReferenceGeometryToken: materialReferenceGeometryToken,
    sourceMaterialYBoundsFeet: [low, high],
    originalMaterialThicknessFeet: thickness,
    sourceLocalPortalFeet: local,
    sourceLocalYHalfWidthOfFullWorldSquareFeet: half,
    sourceSide: positive ? ("positive-Y" as const) : ("negative-Y" as const),
    sourceAuthorityGranted: false as const,
  };
}

function decode(census: OriginalNativeForeignEnvelopeCensus, id: number) {
  const bytes = readOriginalForeignEnvelopeScopedFrame(census, id),
    v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length),
    root = decodeRevit2027FramedGRepRoot(
      bytes,
      {
        offset: 0,
        elementId: id,
        marker: 2246,
        objectLength: v.getUint32(12, true),
        typeCode: v.getUint32(18, true),
      },
      2027,
    );
  if (!root.ok) throw Error(root.error);
  const replay = replayRevit2027GRepFifo(bytes, root.value);
  if (!replay.ok) throw Error(replay.error);
  if (
    replay.value.ownerElementId !== BigInt(id) ||
    replay.value.endOffset !== root.value.dynamicPayloadEndOffset
  )
    throw Error("Unconsumed/foreign original door graphics");
  return { bytes, replay: replay.value };
}
function typed(
  census: OriginalNativeForeignEnvelopeCensus,
  nativeId: number,
  marker: 2031 | 2064,
  root: "FamilyInstance" | "FamilySymbol",
) {
  const source = readOriginalForeignEnvelopeScopedSemantic(
      census,
      nativeId,
      marker,
    ),
    schema = readSchema(source.originalSourceSchemaBytes);
  if (!schema.ok) throw Error(schema.error);
  const read = readOriginalOrdinaryDoorTypedFifo(
    source.originalFrameBytes,
    schema.schema,
    root,
  );
  if (!read.ok) throw Error(read.error);
  if (read.value.nativeElementId !== nativeId)
    throw Error("Original native door owner differs");
  return { source, read: read.value };
}
const proofs = new WeakMap<
  OriginalDoorDerivedStanding,
  {
    census: OriginalNativeForeignEnvelopeCensus;
    stair: OriginalNativeStairPhysicalContext;
    demand: OriginalDoorStandingIdentityDemand;
    receipt: ReturnType<typeof construct>;
  }
>();
function construct(
  census: OriginalNativeForeignEnvelopeCensus,
  stair: OriginalNativeStairPhysicalContext,
  demand: OriginalDoorStandingIdentityDemand,
  request: OriginalDoorDerivedStandingRequest,
) {
  const s = identity(demand);
  if (census.sourceModelSha256 !== demand.sourceModelSha256)
    throw Error("Original door source model differs");
  const facts = originalNativeForeignEnvelopeFacts(census),
    nativeId = s.door.nativeElementId!,
    native = typed(census, nativeId, 2031, "FamilyInstance"),
    r = native.read.root;
  if (
    !equal(native.source.originalCategoryDeclarations, [-2000023]) ||
    id(r.m_id) !== nativeId ||
    id(r.m_assocLevelId) !== s.level.id ||
    r.m_moribund !== 0 ||
    r.m_dummy !== 0 ||
    r.m_invisible !== 0 ||
    r.m_instDormant !== 0
  )
    throw Error("Original native ordinary door role/level is unavailable");
  const info = unique(
      native.read.entries.filter((e) => e.sourceClassName === "InstanceInfo"),
      "Original instance placement is ambiguous",
    ),
    symbolId = id(info.value.m_symbolId),
    symbol = typed(census, symbolId, 2064, "FamilySymbol");
  if (
    id(symbol.read.root.m_id) !== symbolId ||
    id(r.m_masterSymbolId) !== id(symbol.read.root.m_masterId) ||
    symbol.read.root.m_active !== 1
  )
    throw Error("Original ordinary instance/definition/master binding differs");
  const occurrence = decode(census, nativeId),
    definition = decode(census, symbolId),
    binding = collectRevit2027GInstanceBindings(occurrence.replay);
  if (
    !binding.ok ||
    binding.value.length !== 1 ||
    binding.value[0]!.kind !== "external" ||
    binding.value[0]!.instance.symbolElementId !== BigInt(symbolId)
  )
    throw Error("Original ordinary GInstance definition differs");
  const t = binding.value[0]!.instance.transform,
    trf = info.value.m_Trf as { m_3x3?: unknown; m_or?: unknown };
  if (
    !equal(trf?.m_or, t.origin) ||
    !equal(trf?.m_3x3, [
      [t.xAxis[0], t.yAxis[0], t.zAxis[0]],
      [t.xAxis[1], t.yAxis[1], t.zAxis[1]],
      [t.xAxis[2], t.yAxis[2], t.zAxis[2]],
    ]) ||
    !equal(s.door.pointFeet, t.origin.slice(0, 2)) ||
    t.origin[2] !== s.level.elevationFeet
  )
    throw Error("Original native placement/own door/physical level differs");
  if (!Array.isArray(r.m_extraHostIds) || !Array.isArray(r.m_explicitHostIds))
    throw Error("Original complete host list unavailable");
  const primary = id(r.m_hostId),
    hosts = [
      primary,
      ...r.m_extraHostIds.map(id),
      ...r.m_explicitHostIds.map(id),
    ];
  if (
    primary !== s.door.hostWallNativeElementId ||
    new Set(hosts).size !== hosts.length
  )
    throw Error("Original host identity differs/duplicates");
  const retainedHosts = hosts.map((h) => {
    const row = unique(
      facts.rows.filter((f) => f.nativeElementId === h),
      "Original host census absent/ambiguous",
    );
    const source = decode(census, h);
    if (
      !row.boundsFeet ||
      row.blocker ||
      row.sourceFrameSha256 !== hash(source.bytes)
    )
      throw Error("Original host has unknown material");
    return { ...row, originalHostFrameSha256: hash(source.bytes) };
  });
  const derived = deriveOriginalDoorStandingRequest(
      occurrence.replay,
      definition.replay,
      s.portal.pointFeet,
      request.originalMaterialReferenceGeometryToken,
    ),
    candidate = derived.requestedPointFeet,
    foot = rational(candidate[2]),
    head = add(foot, rational(6)),
    square = originalTwoFootStandingSquare(
      candidate.slice(0, 2).map(rational) as P,
    ),
    strip: Parts = [
      [
        projectStatedTwoFootWalkingVolume(
          s.portal.pointFeet,
          candidate,
          foot,
          head,
          6,
        ).unclippedStatedStripFeet,
      ],
    ];
  if (nativeRationalOverlay("difference", strip, square).length)
    throw Error(
      "Complete short approach is not contained by stated standing demand",
    );
  const owners = s.sameLevelPlaces.filter((r) =>
    nativeRationalPointInParts(candidate, [
      r.ringsFeet.map((ring) => ring.map((p) => p.map(rational) as P)),
    ]),
  );
  if (
    owners.length !== 1 ||
    owners[0]!.key !== s.room.key ||
    !nativeRationalPointInParts(s.portal.pointFeet, [
      s.room.ringsFeet.map((ring) => ring.map((p) => p.map(rational) as P)),
    ])
  )
    throw Error("Original derived standing place ownership is not unique");
  const scope = facts.scopeBoundsFeet,
    lower = square[0]![0]![0]!,
    upper = square[0]![0]![2]!;
  if (
    [0, 1, 2].some((i) => {
      const axis = ["x", "y", "z"][i] as "x" | "y" | "z";
      return (
        cmp(rational(scope.min[axis]), i === 2 ? foot : lower[i]!) > 0 ||
        cmp(rational(scope.max[axis]), i === 2 ? head : upper[i]!) < 0
      );
    })
  )
    throw Error(
      "Original census scope does not cover complete standing/approach demand",
    );
  const physical = readOriginalNativeStairPhysicalSource(
    stair,
    request.nativeRunId,
  );
  if (
    physical.sourceModelSha256 !== census.sourceModelSha256 ||
    physical.sourceSchemaSha256 !== census.sourceSchemaSha256 ||
    physical.nativeStairId !== s.nativeOwnStairId
  )
    throw Error("Original own stair source identity differs");
  const own = certifyOriginalNativePlacedStairEnvelope(
    stair,
    request.nativeRunId,
  );
  if (!own.ok) throw Error(own.blockers.join("; "));
  const ownStanding = auditOriginalPlacedStairAboveFoot(
      own.certificate,
      square,
      foot,
      rational(6),
    ),
    ownApproach = auditOriginalPlacedStairAgainstWalkingLine(
      own.certificate,
      [s.portal.pointFeet, candidate],
      6,
    );
  if (
    ownStanding.sourceMaterialLocalizationBlockers.length ||
    !ownStanding.localizedComponentContacts ||
    ownStanding.localizedComponentContacts.length ||
    ownApproach.sourceMaterialLocalizationBlockers.length ||
    !ownApproach.localizedContactSegments ||
    ownApproach.localizedContactSegments.length
  )
    throw Error(
      "Original complete own material standing/approach remains blocked or unknown",
    );
  const door = inspectOriginalPlacedTrimProjectedVolume(
    occurrence.replay,
    definition.replay,
    {
      footprintFeet: square,
      minimumElevationFeet: foot,
      maximumElevationFeet: head,
    },
    [1, 2],
  );
  if (!door.ok || !door.completeStatedFullVolumeDisjoint)
    throw Error(
      "Original complete ordinary door material contacts derived standing/approach",
    );
  const originalPortalStandingMaterialQuery =
    inspectOriginalPlacedTrimProjectedVolume(
      occurrence.replay,
      definition.replay,
      {
        footprintFeet: originalTwoFootStandingSquare(
          s.portal.pointFeet.slice(0, 2).map(rational) as P,
        ),
        minimumElevationFeet: foot,
        maximumElevationFeet: head,
      },
      [0, 2],
    );
  if (!originalPortalStandingMaterialQuery.ok)
    throw Error("Unknown original portal standing material remains");
  const standing = auditOriginalForeignEnvelopeStandingSquare(
      census,
      candidate.slice(0, 2).map(rational) as P,
      foot,
      6,
    ),
    approach = auditOriginalForeignEnvelopeHorizontal(
      census,
      s.portal.pointFeet,
      candidate,
      6,
    ),
    bounded = [
      ...new Set([
        ...standing.candidateNativeElementIds,
        ...approach.candidateNativeElementIds,
      ]),
    ];
  if (bounded.some((i) => i !== nativeId))
    throw Error(
      "Original bounded foreign material remains: " +
        bounded.filter((i) => i !== nativeId).join(","),
    );
  const touch = (lo: Q[], hi: Q[]) =>
    cmp(hi[2]!, foot) > 0 &&
    cmp(lo[2]!, head) <= 0 &&
    cmp(hi[0]!, lower[0]) >= 0 &&
    cmp(lo[0]!, upper[0]) <= 0 &&
    cmp(hi[1]!, lower[1]) >= 0 &&
    cmp(lo[1]!, upper[1]) <= 0;
  const refinements = [
    ...new Set([
      ...standing.unboundedNativeElementIds,
      ...approach.unboundedNativeElementIds,
    ]),
  ].map((i) => {
    const row = unique(
      facts.rows.filter((r) => r.nativeElementId === i),
      "Original unbounded material is ambiguous",
    );
    if (row.categoryId === -2000170) {
      const c = certifyOriginalSimpleSystemPanelSourceEnvelope(census, i);
      if (!c.ok) throw Error(c.blockers.join("; "));
      const f = originalSimpleSystemPanelSourceEnvelopeFact(
        census,
        c.certificate,
      );
      if (
        f.conservativeMaterialBoxesFeet.some((b) =>
          touch(b.minimumFeet, b.maximumFeet),
        )
      )
        throw Error("Original source panel contacts standing/approach");
      return {
        nativeElementId: i,
        kind: "original-system-panel" as const,
        sourceFact: f,
      };
    }
    if (row.categoryId === -2000171) {
      const c = certifyOriginalRectangularMullionSourceEnvelope(census, i);
      if (!c.ok) throw Error(c.blockers.join("; "));
      const f = originalRectangularMullionSourceEnvelopeFact(
          census,
          c.certificate,
        ),
        b = f.boundsFeet;
      if (
        touch(
          [b.min.x, b.min.y, b.min.z].map(rational),
          [b.max.x, b.max.y, b.max.z].map(rational),
        )
      )
        throw Error("Original source mullion contacts standing/approach");
      return {
        nativeElementId: i,
        kind: "original-rectangular-mullion" as const,
        sourceFact: f,
      };
    }
    throw Error("Unknown original unbounded foreign material remains");
  });
  const floorSource = readOriginalForeignEnvelopeScopedFloor(
      census,
      request.nativeFloorElementId,
    ),
    schema = readSchema(floorSource.originalSourceSchemaBytes);
  if (!schema.ok) throw Error(schema.error);
  const floorIdentity = inspectOriginalElementLevelPrefix(
    floorSource.originalFloorFrameBytes,
    schema.schema,
    "Floor",
  );
  if (floorIdentity.nativeAssociatedLevelId !== s.level.id)
    throw Error("Original floor/native door/place served level differs");
  const floor = inspectOriginalNativeFloorCapDemand(
    census,
    request.nativeFloorElementId,
    request.originalCapFaceToken,
    square,
  );
  if (
    !floor.completeConnectedDemandSupported ||
    cmp(floor.originalPhysicalTopElevationFeet, foot) !== 0
  )
    throw Error(
      "Original complete connected standing/approach floor or physical height refuses",
    );
  return {
    kind: "original-source-door-derived-standing" as const,
    sourceModelSha256: census.sourceModelSha256,
    sourceSchemaSha256: census.sourceSchemaSha256,
    sourceCensusSha256: census.sourceCensusSha256,
    originalDatasetSha256: demand.originalDatasetSha256,
    roomKey: s.room.key,
    originalAccess: s.room.access,
    originalLevelId: s.level.id,
    originalPortalId: s.portal.id,
    originalPortalPointFeet: [...s.portal.pointFeet] as Point3,
    originalArrivalNodeId: s.seed.id,
    originalArrivalPointFeet: [...s.seed.pointFeet] as Point3,
    nativeDoorElementId: nativeId,
    nativeDefinitionElementId: symbolId,
    nativeOwnStairId: s.nativeOwnStairId,
    nativeRunId: request.nativeRunId,
    originalPrimaryHostId: primary,
    allOriginalHostIds: hosts,
    retainedHosts,
    originalNativeInstanceFrameSha256: native.source.originalFrameSha256,
    originalNativeDefinitionFrameSha256: symbol.source.originalFrameSha256,
    derived,
    ownStanding,
    ownApproach,
    door,
    originalPortalStandingMaterialQuery,
    foreignStanding: standing,
    foreignApproach: approach,
    allUnboundedSourceRefinements: refinements,
    floor,
    floorIdentity,
    walkingStripWidthFeet: 2 as const,
    headroomFeet: 6 as const,
    proposedNode: {
      id: `arrival:door-derived:${s.room.key}:${nativeId}`,
      roomKey: s.room.key,
      levelId: s.level.id,
      building: s.room.building,
      surfaceId: s.room.surfaceId,
      kind: "arrival" as const,
      pointFeet: [...candidate] as Point3,
    },
    proposedApproach: {
      id: `walk:door-derived:${s.room.key}:${nativeId}`,
      from: s.portal.id,
      to: `arrival:door-derived:${s.room.key}:${nativeId}`,
      kind: "walk" as const,
      pointsFeet: [[...s.portal.pointFeet], [...candidate]] as Point3[],
      roomKeys: [s.room.key],
      accessible: "unknown" as const,
      enabled: false as const,
    },
    completeStandingAndShortApproachPhysicalPredicatesPassed: true as const,
    approachFootprintSemantics:
      "complete-finite-transverse-two-foot-strip" as const,
    completeFiniteApproachContainedByCandidateStandingDemand: true as const,
    originalPortalCenteredStandingSquareApproved: false as const,
    approachStartCenteredStandingSquareApproved: false as const,
    upstreamCrossDoorBranchApproved: false as const,
    closedDoorCrossingApproved: false as const,
    originalNodesChanged: false as const,
    arrivalPointerApplied: false as const,
    publicAccessApproved: false as const,
    currentNativeCellRouteApproved: false as const,
    routeApproved: false as const,
  };
}

/** No receipt, graph flag, callback, detached geometry, replacement list or
 * serialized certificate can substitute for either actual source context. */
export function certifyOriginalDoorDerivedStanding(
  census: OriginalNativeForeignEnvelopeCensus,
  stair: OriginalNativeStairPhysicalContext,
  demand: OriginalDoorStandingIdentityDemand,
  request: OriginalDoorDerivedStandingRequest,
) {
  const receipt = construct(census, stair, demand, request),
    certificate = Object.freeze({
      [standingBrand]: true as const,
      sourceModelSha256: census.sourceModelSha256,
      scope: "original-source-door-standing-and-short-approach-only" as const,
    });
  proofs.set(certificate, { census, stair, demand, receipt });
  return certificate;
}
/** Detached evidence only; cloning this result never transfers capability. */
export function inspectOriginalDoorDerivedStanding(
  certificate: OriginalDoorDerivedStanding,
) {
  const p = proofs.get(certificate);
  if (!p)
    throw Error("Original source-issued door standing capability required");
  return structuredClone(p.receipt);
}

/** Identity preservation only; a caller must additionally run ordinary current
 * native-cell, complete-strip/material, route and policy gates. It does not
 * insert/enable the proposed node/edge or change an arrival pointer. */
export function assertOriginalDoorDerivedStandingIdentityPreserved(
  certificate: OriginalDoorDerivedStanding,
  current: IndoorDataset,
) {
  const p = proofs.get(certificate);
  if (!p)
    throw Error("Original source-issued door standing capability required");
  const s = identity(p.demand);
  const currentRoom = unique(
    current.records.filter((r) => r.key === s.room.key),
    "Current original place missing",
  );
  // Ordinary compilation clears an unsupported derived pointer before the
  // final arrival gate. Only absence of this exact original seed pointer is
  // permitted; no alternate pointer or any other record change is accepted.
  const unchangedRoomIdentity =
    currentRoom.arrivalNodeId === undefined &&
    s.room.arrivalNodeId === s.seed.id
      ? { ...currentRoom, arrivalNodeId: s.seed.id }
      : currentRoom;
  if (
    current.source.modelSha256 !== p.demand.sourceModelSha256 ||
    !equal(unchangedRoomIdentity, s.room) ||
    !equal(
      unique(
        current.nativeLevels.filter((l) => l.id === s.level.id),
        "Current original level missing",
      ),
      s.level,
    ) ||
    s.originalOwnNodes.some(
      (n) =>
        !equal(
          unique(
            current.nodes.filter((v) => v.id === n.id),
            "Original own node missing/duplicated",
          ),
          n,
        ),
    ) ||
    !equal(
      unique(
        (current.doors ?? []).filter((d) => d.id === s.door.id),
        "Original door missing/duplicated",
      ),
      s.door,
    )
  )
    throw Error(
      "Current compilation changed original place/door/node/level/access identity",
    );
  return {
    originalIdentityPreserved: true as const,
    routeApproved: false as const,
  };
}

/** Bind an inserted proposal back to the live source capability. This is
 * still NOT current-cell/free-space/material replay or route admission. */
export function assertOriginalDoorDerivedStandingProposal(
  certificate: OriginalDoorDerivedStanding,
  current: IndoorDataset,
) {
  assertOriginalDoorDerivedStandingIdentityPreserved(certificate, current);
  const p = proofs.get(certificate)!,
    a = p.receipt.proposedNode,
    b = p.receipt.proposedApproach,
    node = unique(
      current.nodes.filter((n) => n.id === a.id),
      "Derived standing node absent/duplicated",
    ),
    edge = unique(
      current.edges.filter((e) => e.id === b.id),
      "Derived standing approach absent/duplicated",
    );
  if (
    node.kind !== a.kind ||
    node.roomKey !== a.roomKey ||
    node.levelId !== a.levelId ||
    node.surfaceId !== a.surfaceId ||
    node.building !== a.building ||
    !equal(node.pointFeet, a.pointFeet) ||
    edge.kind !== b.kind ||
    edge.from !== b.from ||
    edge.to !== b.to ||
    !equal(edge.pointsFeet, b.pointsFeet) ||
    edge.accessible !== "unknown" ||
    (edge.direction ?? "both") !== "both"
  )
    throw Error(
      "Derived node/approach differs from original-source qualified request",
    );
  const geometry = current.circulationGeometry;
  if (
    !edge.nativeCellId ||
    geometry?.sourceModelSha256 !== certificate.sourceModelSha256
  )
    throw Error(
      "Derived approach requires its current original-model native cell",
    );
  const cell = unique(
    geometry.cells.filter((c) => c.id === edge.nativeCellId),
    "Derived native cell absent/duplicated",
  );
  if (
    !cell.roomKeys.length ||
    new Set(cell.roomKeys).size !== cell.roomKeys.length ||
    !cell.roomKeys.includes(a.roomKey) ||
    !cell.levelIds.includes(a.levelId) ||
    cell.elevationFeet !== a.pointFeet[2] ||
    !cell.nativeFloorIds.includes(p.receipt.floor.nativeFloorElementId) ||
    new Set(edge.roomKeys).size !== edge.roomKeys.length ||
    !equal(edge.roomKeys, [...cell.roomKeys].sort())
  )
    throw Error(
      "Derived approach must retain exactly every current native-cell owner and its served level/floor",
    );
  const owners = current.records.filter(
    (r) =>
      r.levelId === a.levelId &&
      nativeRationalPointInParts(a.pointFeet, [
        r.ringsFeet.map((ring) => ring.map((p) => p.map(rational) as P)),
      ]),
  );
  if (owners.length !== 1 || owners[0]!.key !== a.roomKey)
    throw Error("Current derived standing place identity is not unique");
  return {
    sourceQualifiedStandingRequestMatched: true as const,
    currentNativeCellRouteApproved: false as const,
    routeApproved: false as const,
  };
}
