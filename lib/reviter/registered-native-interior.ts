import type pc from "polygon-clipping";
import {
  containsRoomPoint,
  nearestRoomBoundary,
  roomArea,
  type RoomPoint,
} from "./room-directory.ts";

type Rings = RoomPoint[][];
const area = (rings: Rings) =>
  roomArea(rings[0]!) - rings.slice(1).reduce((s, r) => s + roomArea(r), 0);
const contains = (p: RoomPoint, rings: Rings) =>
  containsRoomPoint(p, rings[0]!) &&
  !rings.slice(1).some((h) => containsRoomPoint(p, h));

/** A native wall can cut a tiny unlabelled pocket off the outside of a registered
 * drawing cell. Keep its uniquely labelled native interior, never reconnect
 * through the wall. Only narrow outer-edge pockets may be omitted from display;
 * a second substantive room region, an interior island or another authored
 * label keeps the entire cell unresolved. Native floor/void and identity checks
 * still run on the returned component in the registered enclosure compiler. */
export function registeredNativeInterior(
  parts: pc.MultiPolygon,
  label: RoomPoint,
  registeredShell: RoomPoint[],
  otherLabels: readonly RoomPoint[] = [],
):
  | {
      ringsFeet: Rings;
      omittedEdgeFragments: Rings[];
      omittedSquareFeet: number;
    }
  | undefined {
  const rings = parts as Rings[];
  const containing = rings.filter((r) => contains(label, r));
  if (containing.length !== 1) return;
  const chosen = containing[0]!,
    omitted = rings.filter((r) => r !== chosen);
  if (!omitted.length)
    return {
      ringsFeet: chosen,
      omittedEdgeFragments: [],
      omittedSquareFeet: 0,
    };
  const omittedArea = omitted.reduce((s, r) => s + area(r), 0),
    total = area(chosen) + omittedArea;
  if (
    omittedArea > 2 ||
    omittedArea > total * 0.02 ||
    omitted.some((r) => otherLabels.some((p) => contains(p, r)))
  )
    return;
  for (const polygon of omitted) {
    // Vertices alone cannot measure a triangular corner pocket's inward reach.
    // Sample every quarter foot along its edges and its interior triangle fans.
    const outer = polygon[0]!,
      samples: RoomPoint[] = [...outer];
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i]!,
        b = outer[(i + 1) % outer.length]!,
        steps = Math.max(
          1,
          Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25),
        );
      for (let j = 1; j < steps; j++)
        samples.push([
          a[0] + ((b[0] - a[0]) * j) / steps,
          a[1] + ((b[1] - a[1]) * j) / steps,
        ]);
      const center: RoomPoint = [
        (outer[0]![0] + a[0] + b[0]) / 3,
        (outer[0]![1] + a[1] + b[1]) / 3,
      ];
      if (contains(center, polygon)) samples.push(center);
    }
    if (
      samples.some(
        (p) => nearestRoomBoundary(p, registeredShell).distance > 0.5,
      )
    )
      return;
  }
  return {
    ringsFeet: chosen,
    omittedEdgeFragments: omitted,
    omittedSquareFeet: omittedArea,
  };
}
