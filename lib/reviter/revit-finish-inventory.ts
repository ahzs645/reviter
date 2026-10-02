import type { RoomDirectoryData } from './room-directory.ts';
import type { SemanticRoomBoundaryInput } from './semantic-room-boundaries.ts';
import type { SemanticDoorInput } from './semantic-door-links.ts';
import { containsRoomPoint, roomArea, validRoomBoundary } from './room-directory.ts';

type Point = [number, number];
type InventoryRoom = { nativeRoomUniqueId: string; phaseUniqueId: string; elevationFeet: number | null; ringsFeet: Point[][]; boundaryElementIds: number[] };
type InventoryDoor = { doorId: number; nativeDoorUniqueId: string; phaseUniqueId: string; fromNativeRoomUniqueId: string | null; toNativeRoomUniqueId: string | null };
type Mapping = { roomKey: string; nativeRoomUniqueId: string; phaseUniqueId: string; levelId: number };

/** Map exported native identities explicitly. Room numbers/nearest labels never
 * establish identity, and disconnected circuits never become bounding boxes. */
export function mapRevitFinishInventory(raw: unknown, mappingRaw: unknown, directory: RoomDirectoryData, modelSha256: string) {
  const inventory = raw as { format?: string; version?: number; sourceModelSha256?: string; units?: string; coordinateSystem?: string; boundaryLocation?: string; exporter?: string; rooms?: InventoryRoom[]; doors?: InventoryDoor[] };
  const mapping = mappingRaw as { version?: number; sourceModelSha256?: string; rooms?: Mapping[] };
  if (!inventory || inventory.format !== 'reviter-revit-finish-inventory' || inventory.version !== 1 || inventory.units !== 'feet' || inventory.coordinateSystem !== 'revit-internal' || inventory.boundaryLocation !== 'finish' || inventory.sourceModelSha256 !== modelSha256 || typeof inventory.exporter !== 'string' || !inventory.exporter.trim() || !Array.isArray(inventory.rooms) || !Array.isArray(inventory.doors))
    throw Error('Require a matching saved-model Revit Finish inventory in internal feet.');
  if (!mapping || mapping.version !== 1 || mapping.sourceModelSha256 !== modelSha256 || !Array.isArray(mapping.rooms)) throw Error('Room mapping must identify the exact model bytes.');
  const diagnostics: { code: string; roomKey?: string; nativeRoomUniqueId?: string; doorId?: number; message: string }[] = [];
  const rooms: SemanticRoomBoundaryInput['rooms'] = [];
  const source = new Map(directory.annotations.filter(a => a.status !== 'deleted').map(a => [a.key, a]));
  const counts = (field: keyof Mapping, value: unknown) => mapping.rooms!.filter(m => m?.[field] === value).length;
  for (const m of mapping.rooms) {
    const fail = (message: string) => diagnostics.push({ code: 'inventory-room-mapping', roomKey: m?.roomKey, nativeRoomUniqueId: m?.nativeRoomUniqueId, message });
    if (!m || typeof m.roomKey !== 'string' || typeof m.nativeRoomUniqueId !== 'string' || !m.nativeRoomUniqueId.trim() || typeof m.phaseUniqueId !== 'string' || !m.phaseUniqueId.trim() || !Number.isSafeInteger(m.levelId) || counts('roomKey', m.roomKey) !== 1 || counts('nativeRoomUniqueId', m.nativeRoomUniqueId) !== 1) { fail('Each native Room UniqueId maps to exactly one source annotation and phase.'); continue; }
    const annotation = source.get(m.roomKey);
    const native = inventory.rooms.filter(r => r?.nativeRoomUniqueId === m.nativeRoomUniqueId && r.phaseUniqueId === m.phaseUniqueId);
    if (!annotation || annotation.levelId !== m.levelId || native.length !== 1) { fail('Native identity/phase and the explicit annotation floor must agree.'); continue; }
    const r = native[0]!;
    if (typeof r.elevationFeet !== 'number' || !Number.isFinite(r.elevationFeet) || !Array.isArray(r.ringsFeet) || !r.ringsFeet.length || !Array.isArray(r.boundaryElementIds) || !r.boundaryElementIds.length || !r.boundaryElementIds.every(id => Number.isSafeInteger(id) && id > 0) || r.ringsFeet.some(ring => !Array.isArray(ring) || ring.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))) { fail('Unplaced, unenclosed or incomplete native rooms require model repair; no substitute polygon exported.'); continue; }
    const ordered = [...r.ringsFeet].sort((a, b) => roomArea(b) - roomArea(a));
    const outer = ordered[0]!;
    // A room may contain holes or several disconnected regions. Only one outer
    // region is accepted; holes must remain interior and must not be nested.
    if (!validRoomBoundary(outer) || ordered.slice(1).some(ring => roomArea(ring) <= 1e-8 || !ring.every(p => containsRoomPoint(p, outer))) || ordered.slice(1).some((ring, i, holes) => holes.some((other, j) => i !== j && containsRoomPoint(ring[0]!, other)))) { fail('Disconnected/nested native circuits need separate reviewed regions; never combine them into a box.'); continue; }
    rooms.push({ roomKey: m.roomKey, nativeRoomUniqueId: m.nativeRoomUniqueId, phaseUniqueId: m.phaseUniqueId, levelId: m.levelId, elevationFeet: r.elevationFeet, ringsFeet: ordered, boundaryElementIds: [...new Set(r.boundaryElementIds)].sort((a, b) => a - b) });
  }
  const accepted = new Map(rooms.map(r => [`${r.phaseUniqueId}:${r.nativeRoomUniqueId}`, r]));
  const doors: SemanticDoorInput[] = [];
  for (const d of inventory.doors) {
    const fail = (message: string) => diagnostics.push({ code: 'inventory-door-mapping', doorId: d?.doorId, message });
    if (!d || !Number.isSafeInteger(d.doorId) || d.doorId <= 0 || typeof d.nativeDoorUniqueId !== 'string' || !d.nativeDoorUniqueId.trim() || typeof d.phaseUniqueId !== 'string' || !d.phaseUniqueId.trim()) { fail('Door requires exact ElementId, UniqueId and phase identity.'); continue; }
    const from = accepted.get(`${d.phaseUniqueId}:${d.fromNativeRoomUniqueId}`), to = accepted.get(`${d.phaseUniqueId}:${d.toNativeRoomUniqueId}`);
    if (!from || !to || from.roomKey === to.roomKey || from.levelId !== to.levelId) { fail('Exterior/unmapped, same-room or different-floor door relationships remain unresolved.'); continue; }
    doors.push({ doorId: d.doorId, nativeDoorUniqueId: d.nativeDoorUniqueId, phaseUniqueId: d.phaseUniqueId, levelId: from.levelId, fromRoomKey: from.roomKey, toRoomKey: to.roomKey, fromNativeRoomUniqueId: from.nativeRoomUniqueId, toNativeRoomUniqueId: to.nativeRoomUniqueId });
  }
  // A door with two mapped phases is ambiguous until the mapping selects one.
  const duplicates = new Set(doors.filter((d, i) => doors.some((other, j) => i !== j && d.doorId === other.doorId)).map(d => d.doorId));
  for (const doorId of duplicates) diagnostics.push({ code: 'inventory-door-mapping', doorId, message: 'Several mapped phase relationships exist for this door; select one phase explicitly.' });
  const input: SemanticRoomBoundaryInput & { doors: SemanticDoorInput[] } = { format: 'reviter-semantic-room-boundaries', version: 1, sourceModelSha256: modelSha256, units: 'feet', coordinateSystem: 'revit-internal', boundaryLocation: 'finish', exporter: inventory.exporter, rooms, doors: doors.filter(d => !duplicates.has(d.doorId)) };
  return { input, diagnostics, inventoryRooms: inventory.rooms.length, mappedRooms: rooms.length, mappedDoors: input.doors.length };
}
