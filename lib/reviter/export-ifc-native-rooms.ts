/** Source-authored rooms stay distinct from reviewed enclosure/navigation data. */
import type { NativeRoom } from "./native-rooms.ts";

type Writer = { add(expression: string): number; refs(ids: readonly number[]): string };

/**
 * Emits semantic spaces and, only when decoded, stored plan curves. Never
 * extrudes a room to an invented height or promotes a footprint to an enclosure.
 */
export function emitNativeRooms(input: {
  writer: Writer;
  rooms: readonly NativeRoom[];
  ownerHistory: number;
  building: number;
  modelPlacement: number;
  context: number;
  origin: { x: number; y: number; z: number };
  storeyByLevelId: ReadonlyMap<number, number>;
  uniqueIds: ReadonlyMap<number, string>;
  includeElement?: (elementId: number) => boolean;
  guid(kind: string, key: string | number): string;
  elementGuid(elementId: number): string;
  emitAdditionalProperties?: (product: number, elementId: number) => void;
  quoted(value: string): string;
  number(value: number): string;
}): number {
  const { writer, rooms, ownerHistory, building, modelPlacement, context, origin,
    storeyByLevelId, uniqueIds, guid, quoted, number } = input;
  const byParent = new Map<number, number[]>();
  const seen = new Set<number>();
  let count = 0;
  for (const room of rooms) {
    if (seen.has(room.elementId) || input.includeElement?.(room.elementId) === false) continue;
    seen.add(room.elementId);
    let shape: number | undefined;
    if (room.outline && room.outlineStatus === "decoded") {
      const elevation = room.outline.elevationFeet;
      const rings = [room.outline.outer, ...room.outline.holes];
      // The collector checks closed simple rings. Recheck finite shape at this
      // public export boundary for direct API callers and stale serialized data.
      if (Number.isFinite(elevation) && rings.every(ring => ring.length >= 3 &&
        ring.every(p => p.length === 2 && p.every(Number.isFinite)))) {
        const lines = rings.map(ring => {
          const closed = [...ring, ring[0]!];
          const points = closed.map(([x, y]) => writer.add(
            `IFCCARTESIANPOINT((${number((x - origin.x) * 0.3048)},${number((y - origin.y) * 0.3048)},${number((elevation - origin.z) * 0.3048)}))`,
          ));
          return writer.add(`IFCPOLYLINE(${writer.refs(points)})`);
        });
        const set = writer.add(`IFCGEOMETRICCURVESET(${writer.refs(lines)})`);
        const representation = writer.add(`IFCSHAPEREPRESENTATION(#${context},'FootPrint','GeometricCurveSet',(#${set}))`);
        shape = writer.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${representation}))`);
      }
    }
    const space = writer.add(
      `IFCSPACE(${quoted(input.elementGuid(room.elementId))},#${ownerHistory},${quoted(room.number || room.name || `Revit room ${room.elementId}`)},'Native RVT room; enclosure and navigation unreviewed','Native source room',#${modelPlacement},${shape ? `#${shape}` : "$"},${room.name ? quoted(room.name) : "$"},.ELEMENT.,.NOTDEFINED.,$)`,
    );
    const values: Array<[string, string | number]> = [
      ["RevitElementId", room.elementId], ["Source", room.source],
      ["Enclosure", "unreviewed-source"], ["OutlineStatus", room.outlineStatus],
      ["GeometryRepresentation", shape ? "stored-plan-curves-only" : "metadata-only"],
      ...(room.levelId == null ? [] : [["NativeLevelId", room.levelId] as [string, number]]),
      ...(room.name ? [["NativeRoomName", room.name] as [string, string]] : []),
      ...(room.number ? [["NativeRoomNumber", room.number] as [string, string]] : []),
      ...(uniqueIds.has(room.elementId) ? [["RevitUniqueId", uniqueIds.get(room.elementId)!] as [string, string]] : []),
    ];
    const properties = values.map(([name, value]) => writer.add(
      `IFCPROPERTYSINGLEVALUE(${quoted(name)},$,${typeof value === "number" ? `IFCINTEGER(${value})` : `IFCTEXT(${quoted(value)})`},$)`,
    ));
    const propertySet = writer.add(`IFCPROPERTYSET(${quoted(guid("pset-native-room", room.elementId))},#${ownerHistory},'Reviter_NativeRoom','Source evidence; no routing or volume certification',${writer.refs(properties)})`);
    writer.add(`IFCRELDEFINESBYPROPERTIES(${quoted(guid("rel-native-room", room.elementId))},#${ownerHistory},$,$,(#${space}),#${propertySet})`);
    input.emitAdditionalProperties?.(space, room.elementId);
    const parent = room.levelId == null ? building : storeyByLevelId.get(room.levelId) ?? building;
    const spaces = byParent.get(parent) ?? [];
    spaces.push(space);
    byParent.set(parent, spaces);
    count += 1;
  }
  for (const [parent, spaces] of byParent) writer.add(
    `IFCRELAGGREGATES(${quoted(guid("aggregate-native-rooms", parent))},#${ownerHistory},'Unreviewed native source rooms',$,#${parent},${writer.refs(spaces)})`,
  );
  return count;
}
