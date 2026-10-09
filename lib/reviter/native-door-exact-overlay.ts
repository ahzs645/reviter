/// <reference path="./native-room-presentation-jsts.d.ts" />
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import { nativeExactGeosOverlay } from "./native-exact-geos-overlay";
type Point = [number, number];
type Rings = Point[][];
const closed = (rings: Rings) =>
  rings.map((r) =>
    r.length && (r[0][0] !== r.at(-1)![0] || r[0][1] !== r.at(-1)![1])
      ? [...r, r[0]]
      : r,
  );
/** Independent boolean replay only after the ordinary exact sweep failed.
 * Operands retain every original coordinate and hole. Sequential subtraction
 * computes coverage by the native slab union without buffer, grid or snapping. */
export function exactNativeDoorFloorDifference(
  subject: Rings,
  floors: Rings[],
): Rings[] {
  try {
    return rawNativeDoorFloorDifference(subject, floors);
  } catch {
    return nativeExactGeosOverlay("difference", [subject], [floors]);
  }
}
function rawNativeDoorFloorDifference(
  subject: Rings,
  floors: Rings[],
): Rings[] {
  const reader = new GeoJSONReader(),
    writer = new GeoJSONWriter();
  let current = reader.read({ type: "Polygon", coordinates: closed(subject) });
  for (const rings of floors)
    current = OverlayOp.overlayOp(
      current,
      reader.read({ type: "Polygon", coordinates: closed(rings) }),
      OverlayOp.DIFFERENCE,
    );
  const json = writer.write(current) as {
    type: string;
    coordinates: Rings | Rings[];
    geometries?: unknown[];
  };
  if (json.type === "Polygon")
    return (json.coordinates as Rings)[0]?.length
      ? [json.coordinates as Rings]
      : [];
  if (json.type === "MultiPolygon")
    return (json.coordinates as Rings[]).filter((p) => p[0]?.length);
  if (json.type === "GeometryCollection" && !json.geometries?.length) return [];
  throw new Error("Unclassifiable original native threshold coverage overlay.");
}
