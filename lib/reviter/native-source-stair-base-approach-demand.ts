/** Request geometry only. Source floor/material/foreign predicates must prove
 * the complete returned two-foot footprint and six-foot height separately. */
import {
  rational,
  nativeRationalOverlay,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
import { originalTwoFootStandingSquare } from "./native-source-standing-footprint.ts";
import { nativeConservativeTwoFootStrip } from "./native-source-stair-stepped-stations.ts";
type Point3 = [number, number, number];
export function originalSourceBaseApproachDemand(
  originalNodePointFeet: Point3,
  derivedStandingPointFeet: Point3,
  requestedXYFeet?: readonly (readonly [number, number])[],
) {
  if (
    [originalNodePointFeet, derivedStandingPointFeet].some(
      (p) => p.length !== 3 || !p.every(Number.isFinite),
    ) ||
    originalNodePointFeet[2] !== derivedStandingPointFeet[2]
  )
    throw new Error("Original base approach requires one unchanged foot plane");
  const path = requestedXYFeet ?? [
    originalNodePointFeet.slice(0, 2),
    derivedStandingPointFeet.slice(0, 2),
  ];
  if (
    path.length < 2 ||
    path.length > 64 ||
    path.some((p) => p.length !== 2 || !p.every(Number.isFinite)) ||
    [0, 1].some(
      (i) =>
        path[0]![i] !== originalNodePointFeet[i] ||
        path.at(-1)![i] !== derivedStandingPointFeet[i],
    )
  )
    throw new Error("Original base approach changed its checked endpoint");
  const points = path.map((p) => p.map(rational) as NativeRationalPoint),
    squares = points.map(originalTwoFootStandingSquare),
    strips = points.slice(1).map((p, i) => {
      const strip = nativeConservativeTwoFootStrip(points[i]!, p);
      if (!strip.length)
        throw new Error("Repeated original base approach point");
      return strip;
    }),
    completeFootprintFeet = nativeRationalOverlay(
      "union",
      squares[0]!,
      ...squares.slice(1),
      ...strips,
    );
  if (
    completeFootprintFeet.length !== 1 ||
    completeFootprintFeet[0]!.length !== 1
  )
    throw new Error("Original base approach footprint is not simply connected");
  return {
    requestedPathFeet: path.map(
      (p) => [p[0], p[1], originalNodePointFeet[2]] as Point3,
    ),
    completeFootprintFeet,
    completeBothEndpointStandingSquaresIncluded: true as const,
    fullTwoFootStripsAndTurnSquaresIncluded: true as const,
    sourceGeometryOrRouteApproved: false as const,
  };
}
