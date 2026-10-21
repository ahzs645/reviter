/** Explicit vertical stepping over the complete original filled sill.
 * This is a bounded source-body/footplane result. No leaf, sill, foreign
 * material, source owner or public/step-free policy is removed or inferred. */
import { Rational, rational, nativeRationalOverlay, type NativeRationalPoint as P, type NativeRationalParts } from "./native-rational-overlay.ts";
import type { FilledThresholdStepGeometry } from "./native-filled-threshold-step.ts";
import { projectStatedTwoFootWalkingVolume } from "./native-source-walking-volume.ts";
import { exactClosedSourcePlanarContact } from "./native-source-planar-slab-envelope.ts";
type Q = Rational;
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d), sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d), mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d), div = (a: Q, b: Q) => new Rational(a.n * b.d, a.d * b.n), cmp = (a: Q, b: Q) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0, unpack = ([n, d]: [
    string,
    string
]) => new Rational(BigInt(n), BigInt(d));
const cross = (a: P, b: P) => sub(mul(a[0], b[1]), mul(a[1], b[0])), delta = (a: P, b: P): P => [sub(a[0], b[0]), sub(a[1], b[1])];
/** Pure exact geometry. The source consumer calls this with its private,
 * freshly source-issued body/demand, after whole-footprint floor qualification.
 * The exact 6/5 ft positive-rise bound is the established physical vertical
 * transfer bound in native-stepped-stair-v2-kernel.ts; it is not a legal
 * maximum, a 50 mm waiver, or an accessibility claim. */
export function inspectFilledThresholdOwnSillStepping(step: FilledThresholdStepGeometry, profile: "walking" | "step-free") {
    if (profile !== "walking")
        throw Error("A positive filled sill step is unavailable to step-free routing");
    if (!step.ok || !step.exactOriginalBodyUsed || !step.body.ok || !step.body.exactClosedPlacedBox || !step.body.topCap || !step.body.bottomCap || !step.body.placedFaces || step.body.placedFaces.length !== 6 || new Set(step.body.placedFaces.map(f => f.faceToken)).size !== 6 || step.risers.length !== 2 || !step.floorElevationFeet || !step.topElevationFeet || !step.riseFeet)
        throw Error("Complete original six-face sill and full-width stepped demand are required");
    const faceTokens=step.body.placedFaces.map(f=>f.faceToken),sideTokens=step.body.sideFaceTokens;
    if(!sideTokens||sideTokens.length!==4||new Set(sideTokens).size!==4||sideTokens.includes(step.body.topCap.faceToken)||sideTokens.includes(step.body.bottomCap.faceToken)||step.body.topCap.faceToken===step.body.bottomCap.faceToken||![...sideTokens,step.body.topCap.faceToken,step.body.bottomCap.faceToken].every(t=>faceTokens.includes(t)))
        throw Error("Incomplete original named cap and reciprocal side census");
    const low = step.floorElevationFeet, high = step.topElevationFeet, rise = sub(high, low), maximumRise = new Rational(6n, 5n), zero = rational(0), one = rational(1), half = rational(2);
    if (cmp(rise, zero) <= 0 || cmp(rise, maximumRise) > 0 || cmp(rise, step.riseFeet) !== 0)
        throw Error("Invalid explicit physical source step rise");
    if (cmp(unpack(step.body.bottomCap.elevationFeet), low) || cmp(unpack(step.body.topCap.elevationFeet), high))
        throw Error("Original sill cap and stated footplanes differ");
    const cap = step.body.topCap.ringFeet.map(p => [unpack(p[0]), unpack(p[1])] as P), capParts: NativeRationalParts = [[cap]];
    if (cap.length !== 4 || step.body.bottomCap.ringFeet.length !== 4 || step.body.placedFaces.some(f => f.ringFeet.length !== 4 || f.ringFeet.some(v => { const z = unpack(v[2]); return cmp(z, low) < 0 || cmp(z, high) > 0 || !cap.some(p => cmp(p[0], unpack(v[0])) === 0 && cmp(p[1], unpack(v[1])) === 0); })))
        throw Error("Original sill material leaves its exact closed cap prism");
    const expectedCap = nativeRationalOverlay("intersection", step.fullWalkingStripFeet, capParts), expectedFloor = nativeRationalOverlay("difference", step.fullWalkingStripFeet, capParts);
    if (expectedCap.length !== 1 || expectedFloor.length !== 2 || nativeRationalOverlay("xor", expectedCap, step.capWalkingPartsFeet).length || nativeRationalOverlay("xor", expectedFloor, step.floorWalkingPartsFeet).length)
        throw Error("Original floor/cap partition is stale or incomplete");
    if (step.standingSquaresFeet.length !== 2 || step.standingSquaresFeet.some(s => exactClosedSourcePlanarContact(s, capParts)))
        throw Error("Original standing interiors touch raised sill material");
    const entry = [...step.risers[0]!.outerTrackParameters].sort(cmp), exit = [...step.risers[1]!.outerTrackParameters].sort(cmp);
    if (entry.length !== 2 || exit.length !== 2 || cmp(entry[0]!, zero) <= 0 || cmp(entry[1]!, exit[0]!) >= 0 || cmp(exit[1]!, one) >= 0)
        throw Error("Two complete oblique risers leave no full-width cap or floor approaches");
    const from = step.fromFeet as [
        Q,
        Q,
        Q
    ], to = step.toFeet as [
        Q,
        Q,
        Q
    ], projection = projectStatedTwoFootWalkingVolume(from, to, low, high, 6), strip = projection.unclippedStatedStripFeet, tracks: [
        [
            P,
            P
        ],
        [
            P,
            P
        ]
    ] = [[strip[0]!, strip[1]!], [strip[3]!, strip[2]!]], at = (a: P, b: P, t: Q): P => [add(a[0], mul(sub(b[0], a[0]), t)), add(a[1], mul(sub(b[1], a[1]), t))];
    if (nativeRationalOverlay("xor", [[strip]], step.fullWalkingStripFeet).length)
        throw Error("Original complete walking strip differs from its stated approaches");
    const parameters = [div(entry[0]!, half), div(add(entry[1]!, exit[0]!), half), div(add(exit[1]!, one), half)], stations = parameters.map(t => ({ parameter: t, centerFeet: at([from[0], from[1]], [to[0], to[1]], t), lateralFeet: tracks.map(([a, b]) => at(a, b, t)) as [
            P,
            P
        ] }));
    const strictInside = (p: P) => { const signs = cap.map((a, i) => cmp(cross(delta(cap[(i + 1) % 4]!, a), delta(p, a)), zero)); return signs.every(s => s > 0) || signs.every(s => s < 0); };
    if (stations[1]!.lateralFeet.some(p => !strictInside(p)))
        throw Error("Complete raised station leaves the original finite cap interior");
    for (const i of [0, 2])
        if (exactClosedSourcePlanarContact([], capParts, [], [stations[i]!.lateralFeet]))
            throw Error("Vertical step station contacts original sill material above its lower footplane");
    const lowerApproach: NativeRationalParts = [[[strip[0]!, stations[0]!.lateralFeet[0], stations[0]!.lateralFeet[1], strip[3]!]]], upperApproach: NativeRationalParts = [[[stations[2]!.lateralFeet[0], strip[1]!, strip[2]!, stations[2]!.lateralFeet[1]]]];
    if (exactClosedSourcePlanarContact(lowerApproach, capParts) || exactClosedSourcePlanarContact(upperApproach, capParts))
        throw Error("Floor-level approach contacts positive original sill material");
    const p3 = (p: P, z: Q): [
        Q,
        Q,
        Q
    ] => [p[0], p[1], z], physicalForwardPointsFeet: [
        Q,
        Q,
        Q
    ][] = [from, p3(stations[0]!.centerFeet, low), p3(stations[0]!.centerFeet, high), p3(stations[1]!.centerFeet, high), p3(stations[2]!.centerFeet, high), p3(stations[2]!.centerFeet, low), to];
    return { ownSillSteppedFootplaneGeometryQualified: true as const, profile: "walking" as const, originalNativeSillElementId: step.body.suppliedFrames.placed.nativeElementId, originalPlacedFrameSha256: step.body.suppliedFrames.placed.sha256, originalDefinitionFrameSha256: step.body.suppliedFrames.definition.sha256, originalRiseFeet: rise, explicitPhysicalVerticalTransferMaximumRiseFeet: maximumRise, explicitPolicySource: "native-stepped-stair-v2-kernel.ts:transfer", originalLowerFootPlaneFeet: low, originalCapFootPlaneFeet: high, originalTopCapFaceToken: step.body.topCap.faceToken, allOriginalPhysicalFaceTokens: step.body.placedFaces.map(f => f.faceToken), retainedOriginalRiserFaceTokens: step.risers.map(r => r.originalSideFaceToken), completeSourceCapRegionFeet: expectedCap, completeSourceFloorApproachPartsFeet: expectedFloor, stations, physicalForwardPointsFeet, physicalReversePointsFeet: physicalForwardPointsFeet.toReversed(), verticalTransitionsRetained: 2 as const, wholeLowerStationsAndApproachesClearOfOwnSill: true as const, wholeBodyAtOrBelowNamedCapFootPlaneDuringRaisedTransfers: true as const, originalNamedCapAndReciprocalSideFootContactsRetained: true as const, completeFloorSupportRequiredSeparately: true as const, completeForeignMaterialCensusRequiredSeparately: true as const, intermediateStandingApproved: false as const, sourceSillMaterialOmitted: false as const, sourceSillUnderfootExceptionApproved: false as const, sourceLeafOperationApproved: false as const, sourceOwnerPairApplied: false as const, routeApproved: false as const, wheelchairApproved: false as const };
}
