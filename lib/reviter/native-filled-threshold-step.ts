import { outwardNativeRationalBound } from "./native-planar-component-envelopes.ts";
import type { Bounds3 } from "./types.ts";
import { readSchema } from "./schema-reader.ts";
import {
  readOriginalCurtainInstanceTypedFifo,
  type NativeCurtainInstanceTypedFifo,
} from "./native-source-curtain-instance.ts";
import {
  readOriginalMullionSymbolTypedFifo,
  type NativeMullionTypedFifo,
} from "./native-source-mullion-symbol.ts";
import { inspectOriginalNativeFloorCapDemand } from "./native-source-floor-cap-demand.ts";
import { inspectOriginalCurrentCurtainDoorMask } from "./native-source-curtain-door-mask.ts";
import { inspectOriginalCurrentCurtainDoorProfileCrossing } from "./native-source-curtain-door-profile.ts";
import { inspectFilledThresholdOwnSillStepping } from "./native-filled-threshold-underfoot.ts";
/** Exact filled-body threshold demand partition. The two risers follow the
 * original cap edges across the full width, including an oblique crossing.
 * This never substitutes an oriented bound or a uniform sampled stair strip. */
import {
  inspectFilledThresholdFrames,
  type ThresholdFrameInput,
  type FilledThresholdPairReport,
} from "./native-filled-threshold-body.ts";
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalPoint,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import {
  projectStatedTwoFootWalkingVolume,
  type SourceWalkingPoint3,
} from "./native-source-walking-volume.ts";
import { originalTwoFootStandingSquare } from "./native-source-standing-footprint.ts";
import { exactClosedSourcePlanarContact } from "./native-source-planar-slab-envelope.ts";
import {
  auditOriginalForeignEnvelopeHorizontal,
  auditOriginalForeignEnvelopeVertical,
  auditOriginalForeignEnvelopeStandingSquare,
  readOriginalForeignEnvelopeScopedFrame,
  readOriginalForeignEnvelopeScopedSemantic,
  originalNativeForeignEnvelopeFacts,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import {
  originalCurtainCellMemberBinding,
  type OriginalCurtainCellBindingCertificate,
} from "./native-source-curtain-cell-bindings.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  originalCurtainMaterialContainerFact,
  type OriginalCurtainMaterialContainer,
} from "./native-source-curtain-material-container.ts";
import {
  certifyOriginalRectangularMullionSourceEnvelope,
  originalRectangularMullionSourceEnvelopeFact,
} from "./native-source-rectangular-mullion-envelope.ts";
import {
  certifyOriginalSimpleSystemPanelSourceEnvelope,
  originalSimpleSystemPanelSourceEnvelopeFact,
} from "./native-source-simple-system-panel.ts";

type Q = Rational;
type P = NativeRationalPoint;
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q) => new Rational(a.n * b.d, a.d * b.n);
const cmp = (a: Q, b: Q) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const cross = (a: P, b: P) => sub(mul(a[0], b[1]), mul(a[1], b[0]));
const delta = (a: P, b: P): P => [sub(a[0], b[0]), sub(a[1], b[1])];
const unpack = ([n, d]: [string, string]) => new Rational(BigInt(n), BigInt(d));
const hash = (b: Uint8Array) => bytesToHex(sha256(b));
function hit(a: P, b: P, c: P, d: P) {
  const v = delta(b, a),
    w = delta(d, c),
    den = cross(v, w);
  if (!den.n) return undefined;
  const t = div(cross(delta(c, a), w), den),
    u = div(cross(delta(c, a), v), den);
  if (
    cmp(t, rational(0)) <= 0 ||
    cmp(t, rational(1)) >= 0 ||
    cmp(u, rational(0)) < 0 ||
    cmp(u, rational(1)) > 0
  )
    return undefined;
  return {
    parameter: t,
    sourceEdgeParameter: u,
    pointFeet: [add(a[0], mul(v[0], t)), add(a[1], mul(v[1], t))] as P,
  };
}
export type FilledThresholdStepGeometry = {
  ok: boolean;
  blockers: string[];
  body: FilledThresholdPairReport;
  fromFeet: Q[];
  toFeet: Q[];
  floorElevationFeet?: Q;
  topElevationFeet?: Q;
  riseFeet?: Q;
  fullWalkingStripFeet: NativeRationalParts;
  floorWalkingPartsFeet: NativeRationalParts;
  capWalkingPartsFeet: NativeRationalParts;
  standingSquaresFeet: NativeRationalParts[];
  risers: {
    originalCapEdgeIndex: number;
    originalSideFaceToken: number;
    centerIntersectionFeet: P;
    fullWidthBoundaryFeet: P[];
    centerParameter: Q;
    outerTrackParameters: Q[];
  }[];
  statedWidthFeet: 2;
  statedHeadroomFeet: 6;
  exactOriginalBodyUsed: boolean;
  floorSupportSourceAuthorityGranted: false;
  walkingClearanceApproved: false;
  routeApproved: false;
  wheelchairApproved: false;
};
/** Body-to-demand mathematics only. A success requires two complete original
 * risers across the strip and a positive original cap region. Floor support is
 * checked separately; neither a source member role nor this report proves it.
 * The oblique riser is a retained 2D boundary, never moved to a center sample. */
export function inspectFilledThresholdStepGeometry(input: {
  placed: ThresholdFrameInput;
  definition: ThresholdFrameInput;
  fromFeet: SourceWalkingPoint3;
  toFeet: SourceWalkingPoint3;
}): FilledThresholdStepGeometry {
  const body = inspectFilledThresholdFrames(input.placed, input.definition);
  const out: FilledThresholdStepGeometry = {
    ok: false,
    blockers: [],
    body,
    fromFeet: [],
    toFeet: [],
    fullWalkingStripFeet: [],
    floorWalkingPartsFeet: [],
    capWalkingPartsFeet: [],
    standingSquaresFeet: [],
    risers: [],
    statedWidthFeet: 2,
    statedHeadroomFeet: 6,
    exactOriginalBodyUsed: false,
    floorSupportSourceAuthorityGranted: false,
    walkingClearanceApproved: false,
    routeApproved: false,
    wheelchairApproved: false,
  };
  try {
    if (
      !body.ok ||
      !body.exactClosedPlacedBox ||
      !body.bottomCap ||
      !body.topCap
    )
      throw Error(
        "Unqualified complete original filled threshold body: " +
          body.blockers.join("; "),
      );
    if (
      input.fromFeet.length !== 3 ||
      input.toFeet.length !== 3 ||
      [...input.fromFeet, ...input.toFeet].some(
        (q) => !(q instanceof Rational) && !Number.isFinite(q),
      )
    )
      throw Error("Invalid exact threshold approaches");
    const from = input.fromFeet.map(rational),
      to = input.toFeet.map(rational),
      low = unpack(body.bottomCap.elevationFeet),
      high = unpack(body.topCap.elevationFeet),
      rise = sub(high, low);
    if (cmp(from[2]!, low) || cmp(to[2]!, low))
      throw Error("Approaches differ from the exact original bottom cap plane");
    // Preserve the exact modeled rise. This geometric partition imposes no
    // accessibility/building-code permission; policy remains a separate gate.
    if (cmp(rise, rational(0)) <= 0)
      throw Error("Original sill has no positive rise");
    const cap = body.topCap.ringFeet.map(
        (p) => [unpack(p[0]), unpack(p[1])] as P,
      ),
      a = [from[0]!, from[1]!] as P,
      b = [to[0]!, to[1]!] as P;
    const projection = projectStatedTwoFootWalkingVolume(
        input.fromFeet,
        input.toFeet,
        low,
        high,
        6,
      ),
      strip = projection.unclippedStatedStripFeet;
    const tracks: [[P, P], [P, P]] = [
      [strip[0]!, strip[1]!],
      [strip[3]!, strip[2]!],
    ];
    const sideFor = (c: P, d: P) =>
      body.placedFaces!.filter(
        (f) =>
          body.sideFaceTokens!.includes(f.faceToken) &&
          [c, d].every((p) =>
            f.ringFeet.some(
              (v) =>
                cmp(unpack(v[0]), p[0]) === 0 && cmp(unpack(v[1]), p[1]) === 0,
            ),
          ),
      );
    for (const [i, c] of cap.entries()) {
      const d = cap[(i + 1) % cap.length]!,
        center = hit(a, b, c, d);
      if (!center) continue;
      const outer = tracks.map(([s, e]) => hit(s, e, c, d)),
        side = sideFor(c, d);
      if (outer.some((h) => !h) || side.length !== 1)
        throw Error(
          "Original body riser does not span the complete two-foot demand",
        );
      out.risers.push({
        originalCapEdgeIndex: i,
        originalSideFaceToken: side[0]!.faceToken,
        centerIntersectionFeet: center.pointFeet,
        fullWidthBoundaryFeet: outer.map((h) => h!.pointFeet),
        centerParameter: center.parameter,
        outerTrackParameters: outer.map((h) => h!.parameter),
      });
    }
    out.risers.sort((a, b) => cmp(a.centerParameter, b.centerParameter));
    if (
      out.risers.length !== 2 ||
      out.risers[0]!.originalSideFaceToken ===
        out.risers[1]!.originalSideFaceToken
    )
      throw Error(
        "Demand must cross exactly two distinct complete original body risers",
      );
    const demand = nativeRationalOverlay("union", [[strip]]),
      capParts = nativeRationalOverlay("intersection", demand, [[cap]]),
      floorParts = nativeRationalOverlay("difference", demand, [[cap]]);
    if (!capParts.length || floorParts.length !== 2)
      throw Error(
        "Original cap does not separate the two complete floor approaches",
      );
    const standing = [
      originalTwoFootStandingSquare(a),
      originalTwoFootStandingSquare(b),
    ];
    if (standing.some((s) => exactClosedSourcePlanarContact(s, [[cap]])))
      throw Error("Endpoint standing demand reaches the raised original cap");
    out.fromFeet = from;
    out.toFeet = to;
    out.floorElevationFeet = low;
    out.topElevationFeet = high;
    out.riseFeet = rise;
    out.fullWalkingStripFeet = demand;
    out.capWalkingPartsFeet = capParts;
    out.floorWalkingPartsFeet = floorParts;
    out.standingSquaresFeet = standing;
    out.ok = out.exactOriginalBodyUsed = true;
  } catch (e) {
    out.blockers.push(e instanceof Error ? e.message : String(e));
  }
  return out;
}

/** Pure exact coverage, including source floor holes and BOTH full standing
 * interiors. A caller-supplied support polygon grants no source capability.
 * Requiring support under the complete strip also prevents inventing a sill
 * bridge across a floor void under the bottom cap. */
export function inspectFilledThresholdStepFloorSupport(
  step: FilledThresholdStepGeometry,
  floor: { elevationFeet: Q; guaranteedInnerPartsFeet: NativeRationalParts },
) {
  const rejected = (reason: string, residual: NativeRationalParts = []) => ({
    ok: false as const,
    reason,
    residual,
    sourceSupportAuthorityGranted: false as const,
    routeApproved: false as const,
  });
  if (
    !step.ok ||
    !step.floorElevationFeet ||
    !(floor.elevationFeet instanceof Rational) ||
    cmp(step.floorElevationFeet, floor.elevationFeet)
  )
    return rejected("Original support plane differs from the exact sill base");
  const demand = nativeRationalOverlay(
      "union",
      step.fullWalkingStripFeet,
      ...step.standingSquaresFeet,
    ),
    residual = nativeRationalOverlay(
      "difference",
      demand,
      floor.guaranteedInnerPartsFeet,
    );
  if (residual.length)
    return rejected(
      "Positive unsupported full-width floor or standing interior",
      residual,
    );
  return {
    ok: true as const,
    completeStripAndBothStandingInteriorsCovered: true as const,
    retainedOriginalCapRegion: step.capWalkingPartsFeet,
    sourceSupportAuthorityGranted: false as const,
    routeApproved: false as const,
  };
}

/** The private census is scope-bounded. A larger walking/standing demand
 * must be rejected before any scoped exclusions or material audits are used. */
export function filledThresholdDemandFitsSourceScope(
  step: FilledThresholdStepGeometry,
  scope: Bounds3,
) {
  if (!step.ok || !step.floorElevationFeet || !step.riseFeet) return false;
  const head = outwardNativeRationalBound(add(rational(6), step.riseFeet), 1);
  if (!Number.isFinite(head) || head > 30) return false;
  const high = add(step.floorElevationFeet, rational(head));
  if (
    !Number.isFinite(scope.min.z) ||
    !Number.isFinite(scope.max.z) ||
    cmp(step.floorElevationFeet, rational(scope.min.z)) < 0 ||
    cmp(high, rational(scope.max.z)) > 0
  )
    return false;
  return [...step.fullWalkingStripFeet, ...step.standingSquaresFeet.flat()]
    .flat(2)
    .every((p) =>
      [0, 1].every((i) => {
        const axis = i === 0 ? "x" : "y";
        return (
          Number.isFinite(scope.min[axis]) &&
          Number.isFinite(scope.max[axis]) &&
          cmp(p[i]!, rational(scope.min[axis])) >= 0 &&
          cmp(p[i]!, rational(scope.max[axis])) <= 0
        );
      }),
    );
}
function assertScope(
  census: OriginalNativeForeignEnvelopeCensus,
  step: FilledThresholdStepGeometry,
) {
  if (
    !filledThresholdDemandFitsSourceScope(
      step,
      originalNativeForeignEnvelopeFacts(census).scopeBoundsFeet,
    )
  )
    throw Error(
      "Complete original threshold walking/standing demand exceeds its source census scope",
    );
}
/** Exact conservative full-height demand against a complete source enclosure.
 * Covers the entire strip AND both standing interiors. Closed lateral/head
 * contacts remain vetoes; material at/below the original floor is underfoot.
 * This mathematical predicate grants no original-source identity by itself. */
export function filledThresholdEnvelopeDisjointFromDemand(
  step: FilledThresholdStepGeometry,
  minimumFeet: readonly Q[],
  maximumFeet: readonly Q[],
) {
  if (
    !step.ok ||
    !step.floorElevationFeet ||
    !step.topElevationFeet ||
    minimumFeet.length !== 3 ||
    maximumFeet.length !== 3 ||
    minimumFeet.some(
      (q, i) =>
        !(q instanceof Rational) ||
        !(maximumFeet[i] instanceof Rational) ||
        cmp(q, maximumFeet[i]!) > 0,
    )
  )
    throw Error("Invalid complete original threshold material envelope");
  if (
    cmp(maximumFeet[2]!, step.floorElevationFeet) <= 0 ||
    cmp(minimumFeet[2]!, add(step.topElevationFeet, rational(6))) > 0
  )
    return true;
  const lo: P = [minimumFeet[0]!, minimumFeet[1]!],
    hi: P = [maximumFeet[0]!, maximumFeet[1]!],
    parts: NativeRationalParts =
      cmp(lo[0], hi[0]) === 0 || cmp(lo[1], hi[1]) === 0
        ? []
        : [[[lo, [hi[0], lo[1]], hi, [lo[0], hi[1]]]]];
  return !exactClosedSourcePlanarContact(
    [...step.fullWalkingStripFeet, ...step.standingSquaresFeet.flat()],
    parts,
    [[lo, hi]],
  );
}

/** Pure reciprocal source identity/affine correspondence only. Original
 * metadata and the saved body must agree before an actual-RVT certificate can
 * compose them. Signed zero remains in the ledger while its rational affine
 * effect is exactly zero; every tiny NONZERO term is compared exactly. */
export function inspectFilledThresholdNativeCorrespondence(
  member: ReturnType<typeof originalCurtainCellMemberBinding>,
  sill: NativeMullionTypedFifo,
  door: NativeCurtainInstanceTypedFifo,
  body: FilledThresholdPairReport,
) {
  try {
    const sourceId = (value: unknown) =>
      (value as { m_id: { m_id64: number } }).m_id.m_id64;
    const references = sill.entries.filter(
      (e) => e.sourceClassName === "MullionFamRef",
    );
    const info = sill.entries.filter(
      (e) => e.sourceClassName === "InstanceInfo",
    );
    const doorReferences = door.entries.filter(
      (e) => e.sourceClassName === "CurtainCellFamRef",
    );
    const current = member.cell.edgeMembers.filter(
      (m) => m.nativeMullionElementId === member.nativeMullionElementId,
    );
    if (
      !body.ok ||
      sill.nativeElementId !== member.nativeMullionElementId ||
      door.nativeElementId !== member.nativePanelElementId ||
      body.suppliedFrames.placed.nativeElementId !== sill.nativeElementId ||
      references.length !== 1 ||
      info.length !== 1 ||
      doorReferences.length !== 1 ||
      current.length !== 1 ||
      sourceId(sill.root.m_hostId) !== member.nativeHostElementId ||
      sourceId(door.root.m_hostId) !== member.nativeHostElementId ||
      sourceId(references[0]!.value.m_hostId) !== member.nativeHostElementId ||
      sourceId(doorReferences[0]!.value.m_hostId) !==
        member.nativeHostElementId ||
      references[0]!.value.m_edgeTag !== current[0]!.sourceEdgeTag ||
      sourceId(info[0]!.value.m_symbolId) !==
        body.suppliedFrames.definition.nativeElementId ||
      info[0]!.value.m_GRepId !== 0 ||
      references[0]!.value.m_driverId !== -1 ||
      doorReferences[0]!.value.m_driverId !== -1
    )
      throw Error(
        "Original member native host/edge/definition contradicts the current curtain cell",
      );
    for (const field of ["m_gridId0", "m_gridId1"]) {
      const grid = sourceId(doorReferences[0]!.value[field]);
      if (!member.cell.originalGridlineIds.includes(grid))
        throw Error(
          "Original door native grid identity contradicts its current cell",
        );
    }
    const native = info[0]!.value.m_Trf as {
      m_3x3: number[][];
      m_or: number[];
    };
    const placed = (
      body.originalPlacement as {
        instance: {
          transform: {
            xAxis: unknown[];
            yAxis: unknown[];
            zAxis: unknown[];
            origin: unknown[];
          };
        };
      }
    ).instance.transform;
    if (
      native.m_3x3.length !== 3 ||
      native.m_3x3.some(
        (r) => r.length !== 3 || r.some((n) => !Number.isFinite(n)),
      ) ||
      native.m_or.length !== 3 ||
      native.m_or.some((n) => !Number.isFinite(n))
    )
      throw Error("Nonfinite or malformed original native sill affine");
    const expected = [0, 1, 2].map((i) => native.m_3x3.map((r) => r[i]!));
    expected.push(native.m_or);
    for (const [i, values] of [
      placed.xAxis,
      placed.yAxis,
      placed.zAxis,
      placed.origin,
    ].entries()) {
      if (
        values.length !== 3 ||
        values.some((v, j) => {
          const decoded =
            typeof v === "number"
              ? v
              : v &&
                  typeof v === "object" &&
                  (v as { binary64?: string }).binary64 === "-0"
                ? -0
                : NaN;
          return (
            !Number.isFinite(decoded) ||
            cmp(rational(decoded), rational(expected[i]![j]!)) !== 0
          );
        })
      )
        throw Error(
          "Original native sill affine contradicts the saved physical instance",
        );
    }
    return {
      ok: true as const,
      blockers: [] as string[],
      reciprocalOriginalHostEdgeAndAffineMatched: true as const,
      sourceAuthorityGranted: false as const,
      routeApproved: false as const,
    };
  } catch (e) {
    return {
      ok: false as const,
      blockers: [e instanceof Error ? e.message : String(e)],
      sourceAuthorityGranted: false as const,
      routeApproved: false as const,
    };
  }
}

const brand: unique symbol = Symbol("OriginalFilledThresholdDemand");
export type OriginalFilledThresholdDemand = {
  readonly [brand]: true;
  readonly sourceModelSha256: string;
  readonly sourceSchemaSha256: string;
  readonly nativeSillElementId: number;
  readonly nativeDoorElementId: number;
  readonly nativeHostElementId: number;
  readonly originalSillNativeFrameSha256: string;
  readonly originalDoorNativeFrameSha256: string;
  readonly routeApproved: false;
};
function exactSnapshot<T>(value: T): T {
  if (value instanceof Rational) return new Rational(value.n, value.d) as T;
  if (Array.isArray(value)) return value.map(exactSnapshot) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, exactSnapshot(v)]),
    ) as T;
  return value;
}
const demands = new WeakMap<
  OriginalFilledThresholdDemand,
  FilledThresholdStepGeometry
>();
/** Source-bound body/member/demand certificate only. The private original RVT
 * census supplies both complete frames afresh; the host cell capability must
 * originate in that same model/schema. Host and leaf material remain vetoes. */
export function certifyOriginalFilledThresholdDemand(input: {
  census: OriginalNativeForeignEnvelopeCensus;
  hostBinding: OriginalCurtainCellBindingCertificate;
  nativeDoorElementId: number;
  nativeSillElementId: number;
  nativeSillDefinitionId: number;
  fromFeet: SourceWalkingPoint3;
  toFeet: SourceWalkingPoint3;
}): OriginalFilledThresholdDemand {
  const member = originalCurtainCellMemberBinding(
    input.hostBinding,
    input.nativeDoorElementId,
    input.nativeSillElementId,
  );
  if (
    member.sourceModelSha256 !== input.census.sourceModelSha256 ||
    member.sourceSchemaSha256 !== input.census.sourceSchemaSha256
  )
    throw Error("Original threshold source/cell binding is stale");
  const sillNative = readOriginalForeignEnvelopeScopedSemantic(
    input.census,
    input.nativeSillElementId,
    2031,
  );
  const doorNative = readOriginalForeignEnvelopeScopedSemantic(
    input.census,
    input.nativeDoorElementId,
    2031,
  );
  if (
    sillNative.originalCategoryDeclarations.length !== 1 ||
    sillNative.originalCategoryDeclarations[0] !== -2000171 ||
    doorNative.originalCategoryDeclarations.length !== 1 ||
    doorNative.originalCategoryDeclarations[0] !== -2000023
  )
    throw Error(
      "Original sill/door native categories are absent or contradictory",
    );
  const schema = readSchema(sillNative.originalSourceSchemaBytes);
  if (!schema.ok) throw Error(schema.error);
  const sill = readOriginalMullionSymbolTypedFifo(
    sillNative.originalFrameBytes,
    schema.schema,
    "FamilyInstance",
  );
  const door = readOriginalCurtainInstanceTypedFifo(
    doorNative.originalFrameBytes,
    schema.schema,
  );
  if (!sill.ok) throw Error(sill.error);
  if (!door.ok) throw Error(door.error);
  const placed = readOriginalForeignEnvelopeScopedFrame(
      input.census,
      input.nativeSillElementId,
    ),
    definition = readOriginalForeignEnvelopeScopedFrame(
      input.census,
      input.nativeSillDefinitionId,
    );
  const step = inspectFilledThresholdStepGeometry({
    placed: {
      bytes: placed,
      nativeElementId: input.nativeSillElementId,
      sha256: hash(placed),
    },
    definition: {
      bytes: definition,
      nativeElementId: input.nativeSillDefinitionId,
      sha256: hash(definition),
    },
    fromFeet: input.fromFeet,
    toFeet: input.toFeet,
  });
  if (!step.ok) throw Error(step.blockers.join("; "));
  const correspondence = inspectFilledThresholdNativeCorrespondence(
    member,
    sill.value,
    door.value,
    step.body,
  );
  if (!correspondence.ok) throw Error(correspondence.blockers.join("; "));
  assertScope(input.census, step);
  const certificate = Object.freeze({
    [brand]: true as const,
    sourceModelSha256: member.sourceModelSha256,
    sourceSchemaSha256: member.sourceSchemaSha256,
    nativeSillElementId: input.nativeSillElementId,
    nativeDoorElementId: input.nativeDoorElementId,
    nativeHostElementId: member.nativeHostElementId,
    originalSillNativeFrameSha256: sillNative.originalFrameSha256,
    originalDoorNativeFrameSha256: doorNative.originalFrameSha256,
    routeApproved: false as const,
  });
  demands.set(certificate, exactSnapshot(step));
  return certificate;
}
/** No own-body exclusion is passed. This initial production six-foot census
 * deliberately keeps sill, host, leaf, holes and unknown material candidates.
 * A later consumer must separately qualify any actual underfoot exception. */
export function auditOriginalFilledThresholdDemand(
  census: OriginalNativeForeignEnvelopeCensus,
  demand: OriginalFilledThresholdDemand,
) {
  return auditFilledThresholdMaterial(census, demand, []);
}
function auditFilledThresholdMaterial(
  census: OriginalNativeForeignEnvelopeCensus,
  demand: OriginalFilledThresholdDemand,
  sourceContainerReplacements: readonly number[],
) {
  const step = demands.get(demand);
  if (!step) throw Error("Untrusted original filled threshold demand");
  if (
    census.sourceModelSha256 !== demand.sourceModelSha256 ||
    census.sourceSchemaSha256 !== demand.sourceSchemaSha256
  )
    throw Error("Stale original filled threshold demand census");
  assertScope(census, step);
  const from = step.fromFeet as [Q, Q, Q],
    to = step.toFeet as [Q, Q, Q];
  return exactSnapshot({
    originalSillNativeFrameSha256: demand.originalSillNativeFrameSha256,
    originalDoorNativeFrameSha256: demand.originalDoorNativeFrameSha256,
    sourceModelSha256: demand.sourceModelSha256,
    sourceSchemaSha256: demand.sourceSchemaSha256,
    step,
    forward: auditOriginalForeignEnvelopeHorizontal(
      census,
      from,
      to,
      6,
      sourceContainerReplacements,
    ),
    reverse: auditOriginalForeignEnvelopeHorizontal(
      census,
      to,
      from,
      6,
      sourceContainerReplacements,
    ),
    // This full 2D strip query covers the interior as well as its boundary.
    // The band is six feet above the highest foot plane, outward enclosed
    // from the lowest plane. It is not the old seven-foot diagnostic screen.
    fullFloorToCapVolumeDemand: auditOriginalForeignEnvelopeHorizontal(
      census,
      from,
      to,
      outwardNativeRationalBound(add(rational(6), step.riseFeet!), 1),
      sourceContainerReplacements,
    ),
    fullDemandSourceScopeVerified: true as const,
    fullFloorToCapVerticalDemand: auditOriginalForeignEnvelopeVertical(
      census,
      step.fullWalkingStripFeet[0]![0]!,
      step.floorElevationFeet!,
      step.topElevationFeet!,
      6,
      sourceContainerReplacements,
    ),
    standing: step.standingSquaresFeet.map((_, i) =>
      auditOriginalForeignEnvelopeStandingSquare(
        census,
        i === 0 ? [from[0], from[1]] : [to[0], to[1]],
        step.floorElevationFeet!,
        6,
        sourceContainerReplacements,
      ),
    ),
    sourceMembershipAndCellBindingRevalidated: true as const,
    hostMaterialOmitted: false as const,
    leafMaterialOmitted: false as const,
    sillMaterialOmitted: false as const,
    fullHumanClearanceApproved: false as const,
    floorSupportApproved: false as const,
    sourceOwnerPairApplied: false as const,
    routeApproved: false as const,
    wheelchairApproved: false as const,
  });
}

/** Compose native assembly decomposition with the complete stepped demand.
 * The original current leaf, sill, jamb/header members and every foreign row
 * remain physical. This cannot waive a closed leaf or certify access/owners. */
export function auditOriginalFilledThresholdCurtainMembers(
  census: OriginalNativeForeignEnvelopeCensus,
  demand: OriginalFilledThresholdDemand,
  container: OriginalCurtainMaterialContainer,
) {
  const fact = originalCurtainMaterialContainerFact(census, container);
  if (
    !demands.has(demand) ||
    fact.nativeHostElementId !== demand.nativeHostElementId ||
    !fact.currentMemberElementIds.includes(demand.nativeDoorElementId) ||
    !fact.currentMemberElementIds.includes(demand.nativeSillElementId)
  )
    throw Error(
      "Original curtain material container does not own this threshold demand",
    );
  return {
    ...auditFilledThresholdMaterial(census, demand, [fact.nativeHostElementId]),
    originalCurtainContainer: fact,
    hostAssemblyEnvelopeReplacedByCompleteOriginalMembers: true as const,
    physicalMemberMaterialOmitted: false as const,
  };
}

/** Compose full strip/standing source support, complete current native host
 * decomposition and EVERY original unknown-envelope refinement. A refinement
 * may replace an unknown row only when its entire conservative source material
 * envelope is disjoint from the complete strip/standing six-foot demand.
 * Intersecting/unsupported unknowns stay physical vetoes. Door and sill remain
 * material candidates; this function never invents a leaf-operation exemption. */
export function auditOriginalFilledThresholdSupportedMaterial(
  census: OriginalNativeForeignEnvelopeCensus,
  demand: OriginalFilledThresholdDemand,
  container: OriginalCurtainMaterialContainer,
  floorCapLocators: Parameters<
    typeof auditOriginalFilledThresholdFloorSupport
  >[2],
  unchangedDoorComparisonMaskFeet?: NativeRationalParts,
  traversalProfile: "walking" | "step-free" = "walking",
) {
  const assembly = originalCurtainMaterialContainerFact(census, container);
  if (
    !demands.has(demand) ||
    assembly.nativeHostElementId !== demand.nativeHostElementId ||
    !assembly.currentMemberElementIds.includes(demand.nativeDoorElementId) ||
    !assembly.currentMemberElementIds.includes(demand.nativeSillElementId)
  )
    throw Error(
      "Original material assembly does not own this source threshold",
    );
  const support = auditOriginalFilledThresholdFloorSupport(
    census,
    demand,
    floorCapLocators,
  );
  if (!support.fullStripAndBothStandingInteriorsSourceSupported)
    throw Error(
      "Complete original threshold/standing support remains unqualified",
    );
  const facts = originalNativeForeignEnvelopeFacts(census),
    step = demands.get(demand)!;
  const apart = (minimum: readonly Q[], maximum: readonly Q[]) =>
    filledThresholdEnvelopeDisjointFromDemand(step, minimum, maximum);
  const unknown = facts.rows.filter((r) => !r.boundsFeet || r.blocker),
    ids = [...new Set(unknown.map((r) => r.nativeElementId))].sort(
      (a, b) => a - b,
    ),
    replaced = [assembly.nativeHostElementId],
    refinements: unknown[] = [];
  for (const id of ids) {
    try {
      const rows = unknown.filter((r) => r.nativeElementId === id),
        categories = [...new Set(rows.map((r) => r.categoryId))];
      if (categories.length !== 1)
        throw Error("Contradictory original unknown material categories");
      let fact: unknown,
        disjoint = false;
      if (categories[0] === -2000171) {
        const result = certifyOriginalRectangularMullionSourceEnvelope(
          census,
          id,
        );
        if (!result.ok) throw Error(result.blockers.join("; "));
        const value = originalRectangularMullionSourceEnvelopeFact(
            census,
            result.certificate,
          ),
          b = value.boundsFeet;
        disjoint = apart(
          [b.min.x, b.min.y, b.min.z].map(rational),
          [b.max.x, b.max.y, b.max.z].map(rational),
        );
        fact = value;
      } else if (categories[0] === -2000170) {
        const result = certifyOriginalSimpleSystemPanelSourceEnvelope(
          census,
          id,
        );
        if (!result.ok) throw Error(result.blockers.join("; "));
        const value = originalSimpleSystemPanelSourceEnvelopeFact(
          census,
          result.certificate,
        );
        disjoint = value.conservativeMaterialBoxesFeet.every((b) =>
          apart(b.minimumFeet, b.maximumFeet),
        );
        fact = value;
      } else
        throw Error(
          "Original unknown physical category has no qualified source constructor",
        );
      refinements.push({
        nativeElementId: id,
        ok: true,
        wholeSourceEnvelopeDisjointFromCompleteDemand: disjoint,
        originalSourceFact: fact,
      });
      if (disjoint) replaced.push(id);
    } catch (e) {
      refinements.push({
        nativeElementId: id,
        ok: false,
        blocker: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const originalDoorMaterialComparison = unchangedDoorComparisonMaskFeet
    ? inspectOriginalCurrentCurtainDoorMask(
        census, container, demand.nativeDoorElementId, unchangedDoorComparisonMaskFeet,
      )
    : undefined;
  let originalFiniteProfileCrossing: {ok:true;result:ReturnType<typeof inspectOriginalCurrentCurtainDoorProfileCrossing>} | {ok:false;blocked:string};
  try {
    if (!originalDoorMaterialComparison)
      throw Error("Original native door/graphics affine comparison is required");
    originalFiniteProfileCrossing = {ok:true,result:inspectOriginalCurrentCurtainDoorProfileCrossing(
      census,container,demand.nativeDoorElementId,step.fullWalkingStripFeet,
      step.topElevationFeet!,add(step.topElevationFeet!,rational(6)),
    )};
  } catch(e) {
    originalFiniteProfileCrossing = {ok:false,blocked:e instanceof Error?e.message:String(e)};
  }
  let originalOwnSillStepping: {ok:true;result:ReturnType<typeof inspectFilledThresholdOwnSillStepping>} | {ok:false;blocked:string};
  try {
    originalOwnSillStepping = {ok:true,result:inspectFilledThresholdOwnSillStepping(step,traversalProfile)};
  } catch(e) {
    originalOwnSillStepping = {ok:false,blocked:e instanceof Error?e.message:String(e)};
  }
  return {
    ...auditFilledThresholdMaterial(census, demand, replaced),
    originalCurtainContainer: assembly,
    originalFullFootprintSupport: support,
    originalUnknownMaterialRefinements: refinements,
    originalDoorMaterialComparison,
    originalDoorComparisonMaskChecked: !!unchangedDoorComparisonMaskFeet,
    originalFiniteProfileCrossing,
    originalOwnSillStepping,
    retainedUnknownNativeElementIds: ids.filter((id) => !replaced.includes(id)),
    hostAssemblyEnvelopeReplacedByCompleteOriginalMembers: true as const,
    refinedForeignMaterialExcludedOnlyOutsideCompleteDemand: true as const,
    physicalMemberMaterialOmitted: false as const,
    sourceLeafOperationApproved: false as const,
    sourceSillUnderfootExceptionApproved: false as const,
  };
}

/** Original current native cap locators are discovery inputs only. Every Floor,
 * category, cap plane, hole and boundary uncertainty is read afresh from the
 * same actual-RVT census. This grants scoped support, never host absence,
 * overhead clearance, ownership, accessibility or routing permission. */
export function auditOriginalFilledThresholdFloorSupport(
  census: OriginalNativeForeignEnvelopeCensus,
  demand: OriginalFilledThresholdDemand,
  floorCapLocators: readonly {
    nativeFloorElementId: number;
    originalCapFaceToken: number;
  }[],
) {
  const step = demands.get(demand);
  if (!step) throw Error("Untrusted original filled threshold demand");
  if (
    census.sourceModelSha256 !== demand.sourceModelSha256 ||
    census.sourceSchemaSha256 !== demand.sourceSchemaSha256
  )
    throw Error("Stale original threshold support census");
  if (
    !floorCapLocators.length ||
    floorCapLocators.length > 64 ||
    new Set(
      floorCapLocators.map(
        (f) => `${f.nativeFloorElementId}:${f.originalCapFaceToken}`,
      ),
    ).size !== floorCapLocators.length
  )
    throw Error("Invalid original threshold floor cap locator census");
  assertScope(census, step);
  const footprint = nativeRationalOverlay(
    "union",
    step.fullWalkingStripFeet,
    ...step.standingSquaresFeet,
  );
  const caps = floorCapLocators.map((f) =>
    inspectOriginalNativeFloorCapDemand(
      census,
      f.nativeFloorElementId,
      f.originalCapFaceToken,
      footprint,
    ),
  );
  if (
    caps.some(
      (c) =>
        cmp(c.originalPhysicalTopElevationFeet, step.floorElevationFeet!) !== 0,
    )
  )
    throw Error("Original floor physical cap differs from the exact sill base");
  return exactSnapshot({
    originalCapReceipts: caps,
    fullStripAndBothStandingInteriorsSourceSupported: caps.some(
      (c) => c.completeConnectedDemandSupported,
    ),
    supportDemandIsCompleteConnectedFootprint: true as const,
    globalFloorReferenceRepaired: false as const,
    sourceBoundOriginalOperands: true as const,
    overheadClearanceApproved: false as const,
    sourceOwnersApplied: false as const,
    routeApproved: false as const,
    wheelchairApproved: false as const,
  });
}
