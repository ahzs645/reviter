/// <reference path="./native-room-presentation-jsts.d.ts" />
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import pc from "polygon-clipping";
import { nativeExactGeosOverlay } from "./native-exact-geos-overlay.ts";
type Point = [number, number];
type Rings = Point[][];
type GeometryJSON = {
  type: string;
  coordinates?: Rings | Rings[];
  geometries?: GeometryJSON[];
};
const closed = (parts: Rings[]) =>
  parts.map((rings) =>
    rings.map((ring) =>
      ring.length &&
      (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1])
        ? [...ring, ring[0]]
        : ring,
    ),
  );

/** Independent replay after a failed sweep. Source coordinates, individual
 * holes and operands remain unchanged; no grid, buffer or area waiver is used. */
function rawNativeSelectionOverlay(
  operation: "difference" | "intersection",
  subject: Rings[],
  operands: Rings[][],
): Rings[] {
  const reader = new GeoJSONReader(),
    writer = new GeoJSONWriter();
  const polygons = (geometry: GeometryJSON): Rings[] => {
    if (geometry.type === "Polygon")
      return (geometry.coordinates as Rings)[0]?.length
        ? [geometry.coordinates as Rings]
        : [];
    if (geometry.type === "MultiPolygon")
      return (geometry.coordinates as Rings[]).filter(
        (rings) => rings[0]?.length,
      );
    if (geometry.type === "GeometryCollection")
      return (geometry.geometries ?? []).flatMap(polygons);
    // A point/line contact has no floor area; it cannot become a selectable face.
    if (
      ["Point", "MultiPoint", "LineString", "MultiLineString"].includes(
        geometry.type,
      )
    )
      return [];
    throw new Error("Unclassifiable exact native selection overlay.");
  };
  if (operation === "difference") {
    const box = (rings: Rings) => {
      const points = rings.flat();
      return [
        Math.min(...points.map((p) => p[0])),
        Math.min(...points.map((p) => p[1])),
        Math.max(...points.map((p) => p[0])),
        Math.max(...points.map((p) => p[1])),
      ];
    };
    let faces = subject.map((rings) => ({ rings, bounds: box(rings) }));
    // Distribute subtraction over disjoint source components. Processing one
    // original mask/face pair avoids non-noded contacts between unrelated
    // components in the legacy overlay engine, without dissolving a real gap.
    for (const mask of operands.flat()) {
      const b = box(mask);
      faces = faces.flatMap((face) => {
        const a = face.bounds;
        if (a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1])
          return [face];
        let result: Rings[];
        try {
          result = pc.difference([face.rings], [mask]);
        } catch {
          const raw = OverlayOp.overlayOp(
            reader.read({
              type: "Polygon",
              coordinates: closed([face.rings])[0],
            }),
            reader.read({ type: "Polygon", coordinates: closed([mask])[0] }),
            OverlayOp.DIFFERENCE,
          );
          result = polygons(writer.write(raw) as GeometryJSON);
        }
        return result.map((rings) => ({ rings, bounds: box(rings) }));
      });
    }
    return faces.map((face) => face.rings);
  }
  let current = reader.read({
    type: "MultiPolygon",
    coordinates: closed(subject),
  });
  for (const parts of operands) {
    const other = reader.read({
      type: "MultiPolygon",
      coordinates: closed(parts),
    });
    // Static intersection uses SnapIfNeededOverlayOp internally. Selection
    // must never admit that engine's automatic snapping retry.
    current = OverlayOp.overlayOp(current, other, OverlayOp.INTERSECTION);
  }
  return polygons(writer.write(current) as GeometryJSON);
}

/** Retain original operands for the audited local numerical-contact engine if
 * the independent raw engine cannot node them. Initialization is explicit in
 * the asynchronous native tracing entry point; failures stay visible. */
export function exactNativeSelectionOverlay(
  operation: "difference" | "intersection",
  subject: Rings[],
  operands: Rings[][],
): Rings[] {
  try {
    return rawNativeSelectionOverlay(operation, subject, operands);
  } catch {
    return nativeExactGeosOverlay(operation, subject, operands);
  }
}
