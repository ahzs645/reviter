import {
  NATIVE_ROOM_CATEGORY_ID,
  nativeRoomOutlineFromFaces,
  type NativeRoomFace,
  type NativeRoomPiece,
  type NativeSourceRoom,
} from "./native-source-rooms.ts";
import { hypot } from "./deterministic-math.ts";

type Writer = { add(expression: string): number };
export type NativeRoomIfcContext = {
  ownerHistory: number;
  modelPlacement: number;
  bodyContext: number;
  extrusionDirection: number;
  buildingEntity: number;
  origin: { x: number; y: number; z: number };
  storeyByLevelId: ReadonlyMap<number, number>;
  /** Exact persisted level relationships may supplement a room's own slot. */
  levelByElementId?: ReadonlyMap<number, number>;
  /** Source ids already represented by accepted rooms or other source spaces. */
  representedSourceElementIds?: ReadonlySet<number>;
  /** Exact native candidate keys of accepted/exported reviewed rooms. */
  representedSourceRoomKeys?: ReadonlySet<string>;
  /** Native Export to IFC / NotExported decisions from exact source parameters. */
  suppressedElementIds?: ReadonlySet<number>;
  guid: (kind: string, key: string | number) => string;
  /** A proven native Revit/IFC identity. Absence retains deterministic fallback. */
  globalId?: (elementId: number) => string | undefined;
  quoted: (text: string) => string;
};
const metre = (feet: number) => {
  const value = feet * 0.3048;
  return Number.isInteger(value) ? `${value}.` : value.toFixed(9).replace(/0+$/, "");
};
const refs = (ids: readonly number[]) => `(${ids.map((id) => `#${id}`).join(",")})`;

/** Revalidate geometry at the serialization boundary before writing STEP. */
function measuredProfile(room: NativeSourceRoom) {
  if (!room.boundsFeet || room.outlineStatus !== "recovered" || room.outline?.source !== "partition_room_solid_faces") return undefined;
  const outline = room.outline, bounds = room.boundsFeet;
  const height = bounds.max.z - bounds.min.z;
  if (!Number.isFinite(height) || height <= 0.001 || height > 5000 || Math.abs(outline.elevationFeet - bounds.min.z) > 1e-3) return undefined;
  const pieces = [outline, ...outline.additionalPieces];
  const count = pieces.reduce((sum, piece) => sum + piece.outerFeet.length + piece.holesFeet.reduce((total, hole) => total + hole.length, 0), 0);
  if (count < 3 || count > 2048) return undefined;
  const faces: NativeRoomFace[] = [];
  for (const piece of pieces) for (const ring of [piece.outerFeet, ...piece.holesFeet]) {
    if (ring.length < 3) return undefined;
    for (let index = 0; index < ring.length; index++) {
      const point = ring[index]!, next = ring[(index + 1) % ring.length]!;
      if (point.length !== 2 || !point.every(Number.isFinite)) return undefined;
      const dx = next[0] - point[0], dy = next[1] - point[1], length = hypot(dx, dy);
      if (!(length > 0)) return undefined;
      faces.push({ uv: [0, 0, length, height], origin: [point[0], point[1], outline.elevationFeet], u: [dx / length, dy / length, 0], v: [0, 0, 1] });
    }
  }
  const profile = nativeRoomOutlineFromFaces(faces, bounds);
  if (!profile || !Number.isFinite(outline.areaSquareFeet) || Math.abs(profile.areaSquareFeet - outline.areaSquareFeet) > Math.max(1e-6, profile.areaSquareFeet * 1e-8)) return undefined;
  return { pieces: [profile, ...profile.additionalPieces] as NativeRoomPiece[], elevation: profile.elevationFeet, height };
}

/** Opt-in source-authored IfcSpaces. No native evidence enters routing here. */
export function emitNativeRoomsIfc(writer: Writer, rooms: readonly NativeSourceRoom[], context: NativeRoomIfcContext) {
  const { ownerHistory, modelPlacement, bodyContext, extrusionDirection, buildingEntity, origin, guid, quoted } = context;
  const exported = new Set<number>(context.representedSourceElementIds), spacesByParent = new Map<number, number[]>();
  const entityByElementId = new Map<number, number>();
  let spaceCount = 0, outlineExtrusionCount = 0, identityOnlyCount = 0;
  for (const room of rooms) {
    if (!Number.isInteger(room.elementId) || room.elementId <= 0 || room.categoryId !== NATIVE_ROOM_CATEGORY_ID || room.source !== "element-header" || room.certifiedForRouting !== false || exported.has(room.elementId) || context.representedSourceRoomKeys?.has(room.key) || context.suppressedElementIds?.has(room.elementId)) continue;
    exported.add(room.elementId);
    const profile = measuredProfile(room);
    let shape: number | undefined;
    if (profile && Object.values(origin).every(Number.isFinite)) {
      const polyline = (ring: readonly [number, number][]) => {
        const points = ring.map(([x, y]) => writer.add(`IFCCARTESIANPOINT((${metre(x - origin.x)},${metre(y - origin.y)}))`));
        points.push(points[0]!);
        return writer.add(`IFCPOLYLINE(${refs(points)})`);
      };
      const axisPoint = writer.add(`IFCCARTESIANPOINT((0.,0.,${metre(profile.elevation - origin.z)}))`);
      const axis = writer.add(`IFCAXIS2PLACEMENT3D(#${axisPoint},$,$)`);
      const solids: number[] = [];
      for (const piece of profile.pieces) {
        const outer = polyline(piece.outerFeet), holes = piece.holesFeet.map(polyline);
        const area = holes.length
          ? writer.add(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,#${outer},${refs(holes)})`)
          : writer.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${outer})`);
        solids.push(writer.add(`IFCEXTRUDEDAREASOLID(#${area},#${axis},#${extrusionDirection},${metre(profile.height)})`));
      }
      const representation = writer.add(`IFCSHAPEREPRESENTATION(#${bodyContext},'Body','SweptSolid',${refs(solids)})`);
      shape = writer.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${representation}))`);
      outlineExtrusionCount++;
    } else identityOnlyCount++;
    const nativeGuid = context.globalId?.(room.elementId);
    const globalId = nativeGuid && /^[0-3][0-9A-Za-z_$]{21}$/.test(nativeGuid) ? nativeGuid : guid("native-space", room.elementId);
    const label = room.number || room.name || `Native room ${room.elementId}`;
    const space = writer.add(`IFCSPACE(${quoted(globalId)},#${ownerHistory},${quoted(label)},'Native source room evidence; enclosure and access require separate review','Native source room',#${modelPlacement},${shape ? `#${shape}` : "$"},${room.name ? quoted(room.name) : "$"},.ELEMENT.,.NOTDEFINED.,$)`);
    entityByElementId.set(room.elementId, space);
    const text = (name: string, value: string) => writer.add(`IFCPROPERTYSINGLEVALUE(${quoted(name)},$ ,IFCTEXT(${quoted(value)}),$)`);
    const properties = [
      text("NativeElementId", String(room.elementId)), text("Source", room.source),
      text("OutlineStatus", room.outlineStatus),
      text("GeometrySource", shape ? "stored-room-plan-outline-extruded-to-record-height" : "identity-only"),
      writer.add("IFCPROPERTYSINGLEVALUE('CertifiedForRouting',$,IFCBOOLEAN(.F.),$)"),
      ...(room.designOptionId == null ? [] : [text("DesignOptionId", String(room.designOptionId))]),
      ...(room.parameterSource ? [text("ParameterSource", room.parameterSource)] : []),
    ];
    const pset = writer.add(`IFCPROPERTYSET(${quoted(guid("pset-native-room", room.elementId))},#${ownerHistory},'Reviter_NativeRoom','Source evidence only; extrusion does not reproduce ceiling steps',${refs(properties)})`);
    writer.add(`IFCRELDEFINESBYPROPERTIES(${quoted(guid("rel-native-room-evidence", room.elementId))},#${ownerHistory},$,$,(#${space}),#${pset})`);
    // RE-153: Revit's source space Reference is its name plus number; its
    // FloorCovering is ROOM_FINISH_FLOOR from the checksum-verified owner.
    const common: number[] = [];
    if (room.name && room.number) common.push(writer.add(`IFCPROPERTYSINGLEVALUE('Reference',$,IFCIDENTIFIER(${quoted(`${room.name} ${room.number}`)}),$)`));
    if (room.floorFinish && room.floorFinishEvidence) common.push(writer.add(`IFCPROPERTYSINGLEVALUE('FloorCovering',$,IFCLABEL(${quoted(room.floorFinish)}),$)`));
    if (common.length) {
      const spaceCommon = writer.add(`IFCPROPERTYSET(${quoted(guid("pset-space-common", room.elementId))},#${ownerHistory},'Pset_SpaceCommon',$,${refs(common)})`);
      writer.add(`IFCRELDEFINESBYPROPERTIES(${quoted(guid("rel-space-common", room.elementId))},#${ownerHistory},$,$,(#${space}),#${spaceCommon})`);
    }
    const levelId = room.levelId ?? context.levelByElementId?.get(room.elementId);
    // Unknown levels aggregate under the building: no inferred storey assignment.
    const parent = levelId == null ? buildingEntity : context.storeyByLevelId.get(levelId) ?? buildingEntity;
    const spaces = spacesByParent.get(parent) ?? [];
    spaces.push(space); spacesByParent.set(parent, spaces); spaceCount++;
  }
  for (const [parent, spaces] of spacesByParent) writer.add(`IFCRELAGGREGATES(${quoted(guid("aggregate-native-spaces", parent))},#${ownerHistory},'Native source rooms',$,#${parent},${refs(spaces)})`);
  return { spaceCount, outlineExtrusionCount, identityOnlyCount, entityByElementId };
}
