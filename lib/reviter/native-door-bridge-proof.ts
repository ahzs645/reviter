import * as DMath from "./deterministic-math.ts";
import { nativeRationalOverlay, Rational, type NativeRationalParts } from "./native-rational-overlay.ts";
import { freezeNativeRationalParts, nativeRationalFootprintSupported } from "./native-exact-planar-topology.ts";

type Point = [number, number];
type Plane = { levelId: number; elevationFeet: number };
type Binding = Plane & { sourceModelSha256: string };
type OriginalDoor = Binding & {
  nativeElementId: number;
  hostNativeElementId: number;
  footprintFeet: Point[];
  normalFeet: Point;
  /** The original model's persisted element -> host relation. */
  hostRelation: { elementId: number; hostId: number; evidence: "persisted" };
  hasExplicitOwnershipReview: boolean;
};
export type CompleteNativeBridgeOwner = Binding & {
  nativeElementId: number;
  sourceCategoryId: number;
  cutElevationFeet: number;
  /** A complete original section, not an additive positive material band. */
  positiveSubsetOnly?: true;
  sourceNativeHostRelationsVerified?: true;
  originalPhysicalChildIds: readonly number[];
};
export type NativeBridgeObstacle = {
  /** Only an original native door-leaf operand can receive its own aperture. */
  kind: "native-door-leaf" | "physical-material" | "raised-panel" | "headroom" | "restricted-mask" | "other";
  parts: NativeRationalParts;
  sourceModelSha256: string;
  nativeElementId?: number;
  hostNativeElementId?: number;
};
export type NativeDoorBridgeAuthority = Binding & {
  originalDoor: OriginalDoor;
  originalExactFloorParts: NativeRationalParts;
  /** Every original physical obstacle/mask, retaining exact rational operands. */
  originalObstacles: readonly NativeBridgeObstacle[];
  completeOriginalOwners: readonly CompleteNativeBridgeOwner[];
  originalCheckedSourceElementIds: ReadonlySet<number>;
  physicalScope: Binding & {
    materialCutElevationFeet: number;
    sourceTreadHeadroomVetoFeet: number;
    includesAllOriginalWalkingOperands: true;
    includesPositiveMaterialParts: true;
    includesLowSlabs: true;
    includesRestrictedMasks: true;
    unclassifiedSourceElementIds: readonly number[];
  };
};
export type NativeDoorBridgeRequest = Binding & {
  nativeDoorElementId: number;
  nativeHostElementId: number;
  originalNativeApertureFeet: Point[];
  fromDepthFeet: number;
  toDepthFeet: number;
  from: Point;
  to: Point;
  footprint: NativeRationalParts;
  legacyBlockingNativeElementIds: readonly number[];
};

const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const sameRing = (a: Point[], b: Point[]) => a.length === b.length && a.every((p, i) => samePoint(p, b[i]!));
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
const snapshot = (parts: NativeRationalParts): NativeRationalParts => freezeNativeRationalParts(parts.map(part => part.map(ring =>
  ring.map(point => point.map(value => new Rational(value.n, value.d, value.original)) as [Rational, Rational]))));
const compare = (a: Rational, b: Rational) => {
  const d = a.n * b.d - b.n * a.d;
  return d < 0n ? -1 : d > 0n ? 1 : 0;
};
const exactBounds = (parts: NativeRationalParts) => {
  const points = parts.flat(2);
  if (!points.length) return;
  let [x0, y0] = points[0]!, x1 = x0, y1 = y0;
  for (const [x, y] of points) {
    if (compare(x, x0) < 0) x0 = x; if (compare(x, x1) > 0) x1 = x;
    if (compare(y, y0) < 0) y0 = y; if (compare(y, y1) > 0) y1 = y;
  }
  return [x0, y0, x1, y1] as const;
};
const disjoint = (a: ReturnType<typeof exactBounds>, b: ReturnType<typeof exactBounds>) => !!a && !!b &&
  (compare(a[2], b[0]) < 0 || compare(a[0], b[2]) > 0 || compare(a[3], b[1]) < 0 || compare(a[1], b[3]) > 0);

/** Unwired compiler helper. The source walking-region constructor must supply
 * its complete original operands and original door-leaf provenance. This is
 * ephemeral immutable constructor state, not a serialized clearance receipt.
 *
 * A legacy rectangle may be superseded only for complete original owners at
 * this exact physical plane, and only after the entire original two-foot
 * bridge passes every original public-walking operand. This retains the
 * original ankle-cut material/positive parts, low slabs and source-tread
 * headroom veto; it is not a continuous general body-clearance certificate.
 * Own host material is NEVER
 * erased. Only the actual door leaf inside its unchanged native aperture is
 * excepted; foreign coincident material remains a veto. Access is not inferred.
 */
export function createCheckedNativeDoorBridgeProof(authority: NativeDoorBridgeAuthority) {
  const source = authority.sourceModelSha256;
  const plane = { levelId: authority.levelId, elevationFeet: authority.elevationFeet };
  const bound = (b: Binding) => b.sourceModelSha256 === source &&
    b.levelId === plane.levelId && b.elevationFeet === plane.elevationFeet;
  const door = structuredClone(authority.originalDoor);
  const scope = structuredClone(authority.physicalScope);
  const checked = new Set(authority.originalCheckedSourceElementIds);
  const owners = new Map(authority.completeOriginalOwners.map(o => [o.nativeElementId, structuredClone(o)]));
  const floors = snapshot(authority.originalExactFloorParts);
  const obstacles = authority.originalObstacles.map(o => {
    const parts = snapshot(o.parts);
    return { ...o, parts, box: exactBounds(parts) };
  });
  const completeOwner = (id: number) => {
    const owner = owners.get(id);
    return !!owner && validId(id) && bound(owner) && checked.has(id) &&
      !owner.positiveSubsetOnly && owner.cutElevationFeet === plane.elevationFeet + 0.1 &&
      new Set(owner.originalPhysicalChildIds).size === owner.originalPhysicalChildIds.length &&
      owner.originalPhysicalChildIds.every(child => validId(child) && checked.has(child));
  };
  const verifiedLegacyAssembly = (id: number) => {
    const owner = owners.get(id);
    return completeOwner(id) && owner?.sourceCategoryId === -2000011 &&
      owner.sourceNativeHostRelationsVerified === true && owner.originalPhysicalChildIds.length > 0;
  };
  const valid = /^[a-f0-9]{64}$/.test(source) && Number.isSafeInteger(plane.levelId) &&
    Number.isFinite(plane.elevationFeet) && bound(door) && bound(scope) &&
    validId(door.nativeElementId) && validId(door.hostNativeElementId) &&
    door.hostRelation?.evidence === "persisted" &&
    door.hostRelation.elementId === door.nativeElementId &&
    door.hostRelation.hostId === door.hostNativeElementId && !door.hasExplicitOwnershipReview &&
    door.footprintFeet.length >= 3 && door.footprintFeet.every(p => p.length === 2 && p.every(Number.isFinite)) &&
    door.normalFeet.length === 2 && door.normalFeet.every(Number.isFinite) &&
    Math.abs(DMath.hypot(...door.normalFeet) - 1) <= 1e-5 &&
    scope.materialCutElevationFeet === plane.elevationFeet + 0.1 && Number.isFinite(scope.sourceTreadHeadroomVetoFeet) && scope.sourceTreadHeadroomVetoFeet >= 6 &&
    scope.includesAllOriginalWalkingOperands === true && scope.includesPositiveMaterialParts === true &&
    scope.includesLowSlabs === true && scope.includesRestrictedMasks === true &&
    scope.unclassifiedSourceElementIds.length === 0 &&
    owners.size === authority.completeOriginalOwners.length && completeOwner(door.hostNativeElementId) &&
    obstacles.every(o => o.sourceModelSha256 === source) &&
    obstacles.filter(o => o.kind === "native-door-leaf" && o.nativeElementId === door.nativeElementId &&
      o.hostNativeElementId === door.hostNativeElementId).length === 1;

  return (request: NativeDoorBridgeRequest): boolean => {
    if (!valid || !bound(request) || request.nativeDoorElementId !== door.nativeElementId ||
      request.nativeHostElementId !== door.hostNativeElementId ||
      !sameRing(request.originalNativeApertureFeet, door.footprintFeet) ||
      !request.legacyBlockingNativeElementIds.length ||
      !request.legacyBlockingNativeElementIds.every(verifiedLegacyAssembly) ||
      ![request.fromDepthFeet, request.toDepthFeet].every(d => Number.isFinite(d) && d > 0 && d <= 1.5)) return false;
    try {
      const [nx, ny] = door.normalFeet, ux = -ny, uy = nx;
      const ns = door.footprintFeet.map(p => p[0] * nx + p[1] * ny);
      const us = door.footprintFeet.map(p => p[0] * ux + p[1] * uy);
      const lo = Math.min(...ns), hi = Math.max(...ns), left = Math.min(...us), right = Math.max(...us), mid = (left + right) / 2;
      if (right - left < 2) return false;
      const at = (u: number, n: number): Point => [ux * u + nx * n, uy * u + ny * n];
      const from = at(mid, lo - request.fromDepthFeet), to = at(mid, hi + request.toDepthFeet);
      if (!samePoint(request.from, from) || !samePoint(request.to, to)) return false;
      // Identical expressions to the original ownership producer: no new
      // rounded corners, narrowed proof width, relocated endpoints or tolerance.
      const required = nativeRationalOverlay("union", [[[
        at(mid - 1, lo - request.fromDepthFeet), at(mid + 1, lo - request.fromDepthFeet),
        at(mid + 1, hi + request.toDepthFeet), at(mid - 1, hi + request.toDepthFeet),
      ]]]);
      if (nativeRationalOverlay("xor", request.footprint, required).length ||
        !nativeRationalFootprintSupported(required, floors)) return false;
      const aperture = nativeRationalOverlay("union", [[door.footprintFeet]]);
      const box = exactBounds(required);
      for (const obstacle of obstacles) {
        // Strict rational disjointness only. Touching/thin positive overlaps
        // retain the original exact physical test; inputs are immutable here.
        if (disjoint(box, obstacle.box)) continue;
        const ownLeaf = obstacle.kind === "native-door-leaf" && obstacle.nativeElementId === door.nativeElementId &&
          obstacle.hostNativeElementId === door.hostNativeElementId;
        const parts = ownLeaf ? nativeRationalOverlay("difference", obstacle.parts, aperture) : obstacle.parts;
        if (nativeRationalOverlay("intersection", required, parts).length) return false;
      }
      return true;
    } catch { return false; }
  };
}
