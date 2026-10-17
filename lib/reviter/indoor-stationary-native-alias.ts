import type {
  IndoorNode,
  IndoorRecord,
  IndoorDataset,
} from "./indoor-contract.ts";
import { nativeRationalPointInParts } from "./native-exact-planar-topology.ts";
import type { NativeRationalParts } from "./native-rational-overlay.ts";

type NativeCell = NonNullable<
  IndoorDataset["circulationGeometry"]
>["cells"][number];

/** A strictly stationary identity transfer has no travelled passage to approve.
 * Only identical original nodes in the same owned exact physical floor cell
 * qualify. This never approves a short segment, a stair flight, a doorway,
 * clearance or access to an adjoining region. Call only with the original
 * model-bound cell's exact parts, never a doorway-expanded approach polygon. */
export function certifiedStationaryNativeAlias(
  a: IndoorNode,
  b: IndoorNode,
  cell: NativeCell,
  originalParts: NativeRationalParts,
  owner: IndoorRecord | undefined,
): boolean {
  if (
    !a.id ||
    !b.id ||
    a.id === b.id ||
    !owner ||
    !owner.walkable ||
    owner.access === "staff" ||
    a.roomKey !== owner.key ||
    b.roomKey !== owner.key ||
    !cell.roomKeys.includes(owner.key) ||
    a.levelId !== b.levelId ||
    !cell.levelIds.includes(a.levelId) ||
    !a.surfaceId ||
    a.surfaceId !== b.surfaceId ||
    a.pointFeet.length !== 3 ||
    b.pointFeet.length !== 3 ||
    a.pointFeet.some(
      (value, i) => !Number.isFinite(value) || value !== b.pointFeet[i],
    ) ||
    a.pointFeet[2] !== cell.elevationFeet
  )
    return false;
  return nativeRationalPointInParts(a.pointFeet, originalParts);
}
