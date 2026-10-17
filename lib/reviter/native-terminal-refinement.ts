import { buildIndoorGrid } from "./indoor-grid.ts";
import {
  nativeExactPartsForProposals,
  nativeRationalPathSupported,
  nativeRationalPointInParts,
} from "./native-exact-planar-topology.ts";
import {
  nativeRationalOverlay,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import type { DirectoryRoom, RoomPoint } from "./room-directory.ts";

/** Pull a proposal through the unchanged exact face. Proposal vertices never
 * authorize support, including tiny gaps hidden by their IEEE coordinates. */
export function pullNativeSupportedPath(
  points: readonly RoomPoint[],
  parts: NativeRationalParts,
): RoomPoint[] | undefined {
  if (!points.length) return undefined;
  const out: RoomPoint[] = [points[0]!];
  for (let i = 0; i < points.length - 1; ) {
    let j = points.length - 1;
    while (j > i && !nativeRationalPathSupported([points[i]!, points[j]!], parts)) j--;
    if (j === i) return undefined;
    out.push(points[j]!);
    i = j;
  }
  return out;
}

/** A bounded fallback for original terminals which the ordinary 0.6 ft grid
 * cannot connect. Only the supplied original face/owned doorway halves may
 * support the result. No terminal movement, polygon snapping or gap filling.
 * Failure is inconclusive and must retain the original routing refusal. */
export function refineNativeTerminalPath(
  parts: NativeRationalParts,
  from: RoomPoint,
  to: RoomPoint,
): RoomPoint[] | undefined {
  if (![...from, ...to].every(Number.isFinite)) return undefined;
  if (!nativeRationalPointInParts(from, parts) || !nativeRationalPointInParts(to, parts)) return undefined;
  if (nativeRationalPathSupported([from, to], parts)) return [from, to];
  const padding = 8;
  const box = [
    Math.min(from[0], to[0]) - padding,
    Math.min(from[1], to[1]) - padding,
    Math.max(from[0], to[0]) + padding,
    Math.max(from[1], to[1]) + padding,
  ];
  // Terminal refinement is local work. Distant failures remain for the normal
  // floor planner; an unbounded fine grid must not exhaust the compiler.
  if (box[2]! - box[0]! > 96 || box[3]! - box[1]! > 96) return undefined;
  const clipped = nativeRationalOverlay("intersection", parts, [[[
    [box[0]!, box[1]!], [box[2]!, box[1]!],
    [box[2]!, box[3]!], [box[0]!, box[3]!],
  ]]]);
  const scope: DirectoryRoom[] = nativeExactPartsForProposals(clipped).map((part, i) => ({
    key: `terminal-window:${i}`, levelId: 0, polygonFeet: part[0]!,
    holesFeet: part.slice(1), labelPointFeet: [0, 0], confidence: 1,
  }));
  if (!scope.length) return undefined;
  for (const cell of [0.3, 0.15, 0.075]) {
    // A rotated grid fits inside a square with this diagonal. Keep each trial
    // well below buildIndoorGrid's two-million-cell hard limit.
    const span = Math.hypot(box[2]! - box[0]!, box[3]! - box[1]!);
    if ((span / cell + 4) ** 2 > 1_000_000) continue;
    const grid = buildIndoorGrid(scope, [], [
      { id: "from", roomKey: scope[0]!.key, point: from, maxSnapFeet: 1.2 },
      { id: "to", roomKey: scope[0]!.key, point: to, maxSnapFeet: 1.2 },
    ], { walls: [], columns: [] }, [], cell);
    for (const branch of grid.branches) {
      const proposal = branch.from === "from"
        ? [from, ...branch.points, to]
        : [from, ...branch.points.toReversed(), to];
      const pulled = pullNativeSupportedPath(proposal, parts);
      if (pulled && nativeRationalPathSupported(pulled, parts)) return pulled;
    }
  }
  return undefined;
}
