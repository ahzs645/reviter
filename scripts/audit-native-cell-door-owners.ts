/** Offline ownership-diff audit for the opt-in native-cell door owner matcher.
 *
 * Inputs are display/diagnostic exports only (no master ZIP is read):
 *   PREVIEW_DATA_DIR  campus-preview/data with level-*.json (cells, rooms)
 *   GRAPH_COMPACT     graph-compact.json (doors with saved owners and state)
 *   NATIVE_SIDES      optional NATIVE-DOOR-SIDES.json (Python cross-check)
 *   OUT               output JSON path
 * For every saved door it compares the saved owners with nativeCellDoorOwners()
 * and, per level, the legacy vs native-cell code path of directoryDoorReviews().
 * Nothing is written back to any source.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  directoryDoorReviews,
  nativeCellDoorOwners,
  type NativeDoorCell,
} from "../lib/reviter/directory-navigation.ts";
import type { DirectoryDoor, DirectoryRoom, RoomPoint } from "../lib/reviter/room-directory.ts";

const [previewDir, graphPath, sidesPath, out] = process.argv.slice(2);
if (!previewDir || !graphPath || !out) throw new Error("Usage: audit-native-cell-door-owners.ts PREVIEW_DATA_DIR GRAPH_COMPACT NATIVE_SIDES|- OUT");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
type Ring = number[][];
type PreviewRoom = { key: string; number?: string; name?: string; levelId: number; walkable: boolean; circulation: boolean; ringsFeet: Ring[] };
type PreviewCell = { id: string; levelIds: number[]; roomKeys: string[]; ringsFeet: Ring[] };
type SavedDoor = { id: string; levelId: number; nativeElementId: number; state: string; roomKeys: string[]; pointFeet: number[]; normalFeet?: number[]; footprintFeet?: number[][] };

const xy = (ring: Ring): RoomPoint[] => ring.map((p) => [p[0]!, p[1]!]);
const inputs: Record<string, string> = { graphCompactSha256: sha(graphPath) };
const cellsByLevel = new Map<number, NativeDoorCell[]>();
const roomsByLevel = new Map<number, Map<string, PreviewRoom>>();
const allRooms = new Map<string, PreviewRoom>();
for (const name of readdirSync(previewDir).filter((n) => /^level-\d+\.json$/.test(n)).sort()) {
  inputs[name] = sha(join(previewDir, name));
  const level = JSON.parse(readFileSync(join(previewDir, name), "utf8")) as { level: { id: number }; cells: PreviewCell[]; rooms: PreviewRoom[] };
  const rooms = roomsByLevel.get(level.level.id) ?? new Map();
  for (const r of level.rooms) {
    rooms.set(r.key, r);
    allRooms.set(r.key, r);
  }
  roomsByLevel.set(level.level.id, rooms);
  for (const c of level.cells)
    for (const lid of c.levelIds) {
      const list = cellsByLevel.get(lid) ?? [];
      if (!list.some((x) => x.id === c.id)) list.push({ id: c.id, roomKeys: c.roomKeys, ringsFeet: c.ringsFeet.map(xy) });
      cellsByLevel.set(lid, list);
    }
}
const graph = JSON.parse(readFileSync(graphPath, "utf8")) as { doors: SavedDoor[] };
const label = (key: string) => {
  const r = allRooms.get(key);
  return r ? `${r.number ?? ""} ${r.name ?? ""}`.trim() || key : key;
};
const directoryRoom = (r: PreviewRoom, levelId: number): DirectoryRoom => ({
  key: r.key,
  levelId,
  number: r.number,
  name: r.name,
  polygonFeet: xy(r.ringsFeet[0]!),
  holesFeet: r.ringsFeet.slice(1).map(xy),
  labelPointFeet: [r.ringsFeet[0]![0]![0]!, r.ringsFeet[0]![0]![1]!],
  confidence: 1,
  ...(r.walkable ? {} : { walkability: "void" as const }),
});
const directoryDoor = (d: SavedDoor): DirectoryDoor => {
  const fp = d.footprintFeet?.map((p) => [p[0]!, p[1]!] as RoomPoint);
  const xs = fp?.map((p) => p[0]) ?? [d.pointFeet[0]!],
    ys = fp?.map((p) => p[1]) ?? [d.pointFeet[1]!];
  return {
    id: d.nativeElementId,
    point: [d.pointFeet[0]!, d.pointFeet[1]!],
    halfWidth: (Math.max(...xs) - Math.min(...xs)) / 2,
    halfHeight: (Math.max(...ys) - Math.min(...ys)) / 2,
    footprint: fp,
    normal: d.normalFeet ? [d.normalFeet[0]!, d.normalFeet[1]!] : undefined,
  };
};
/** Rooms for one door: its level's rooms plus any room a level cell names. */
const levelRooms = (levelId: number) => {
  const map = new Map(roomsByLevel.get(levelId) ?? []);
  for (const c of cellsByLevel.get(levelId) ?? []) for (const k of c.roomKeys) if (!map.has(k) && allRooms.has(k)) map.set(k, allRooms.get(k)!);
  return [...map.values()].map((r) => directoryRoom(r, levelId));
};
const roomCache = new Map<number, DirectoryRoom[]>();
const roomsFor = (levelId: number) => {
  if (!roomCache.has(levelId)) roomCache.set(levelId, levelRooms(levelId));
  return roomCache.get(levelId)!;
};

const python = sidesPath && sidesPath !== "-" ? (JSON.parse(readFileSync(sidesPath, "utf8")) as { rows: { door: number; kind: string; sideA: { cell: string | null }; sideB: { cell: string | null } }[] }) : undefined;
if (sidesPath && sidesPath !== "-") inputs.nativeDoorSidesSha256 = sha(sidesPath);
const pythonRows = new Map(python?.rows.map((r) => [r.door, r]) ?? []);

const rows: Record<string, unknown>[] = [];
const tally = new Map<string, number>();
const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
let pythonCellMismatch = 0;
const pythonMismatches: unknown[] = [];
for (const saved of graph.doors) {
  const rooms = roomsFor(saved.levelId),
    cells = cellsByLevel.get(saved.levelId) ?? [];
  const door = directoryDoor(saved);
  const result = nativeCellDoorOwners(rooms, door, cells);
  const existing = [...saved.roomKeys].sort();
  const proposed = result.rooms ? [...result.rooms].sort() : undefined;
  const same = !!proposed && existing.length === 2 && proposed.join() === existing.join();
  const category =
    saved.state === "connected"
      ? proposed
        ? same
          ? "connected:agree"
          : "connected:CHANGE"
        : `connected:retained-legacy:${result.kind}${result.kind === "native-pair" ? ":no-decision" : ""}`
      : proposed
        ? `${saved.state}:new-native-pair`
        : `${saved.state}:unresolved:${result.kind}`;
  bump(category);
  const py = pythonRows.get(saved.nativeElementId);
  if (py && (py.sideA.cell ?? undefined) !== result.sides[1].cellId || py && (py.sideB.cell ?? undefined) !== result.sides[0].cellId) {
    pythonCellMismatch++;
    pythonMismatches.push({ door: saved.nativeElementId, python: [py!.sideB.cell, py!.sideA.cell], typescript: [result.sides[0].cellId, result.sides[1].cellId] });
  }
  if (category === "connected:agree") continue;
  const gaps = result.sides.map((x) => x.ownerGapFeet ?? 0);
  const flags = proposed
    ? [
        ...(Math.max(...gaps) > 2 ? [`owner-gap-over-2ft(${Math.max(...gaps).toFixed(2)})`] : []),
        ...(existing.length && !existing.some((k) => proposed.includes(k)) ? ["no-saved-candidate-retained"] : []),
        ...(proposed.some((k) => /stair/i.test(label(k))) ? ["stair-owner"] : []),
      ]
    : [];
  rows.push({
    flags,
    door: saved.nativeElementId,
    id: saved.id,
    levelId: saved.levelId,
    state: saved.state,
    category,
    existingOwners: existing.map(label),
    existingKeys: existing,
    nativeKind: result.kind,
    nativeOwners: proposed?.map(label),
    nativeKeys: proposed,
    reason: result.reason,
    sides: result.sides.map((s) => ({ cell: s.cellId, stepFeet: s.stepFeet, owner: s.owner && label(s.owner), ownerGapFeet: s.ownerGapFeet === undefined ? undefined : Math.round(s.ownerGapFeet * 1000) / 1000, reason: s.reason })),
  });
}

// Code path: legacy vs native-cell directoryDoorReviews per level on the same
// rooms, in the default fill-only policy and with overrideLegacy.
const newPath = () => ({ doors: 0, legacyConnected: 0, nativeConnected: 0, portalChanged: 0, legacyConnectedLost: 0, legacyConnectedOwnerChanged: 0, conflictsReported: 0, changedWithoutNativeDecision: 0, changes: [] as unknown[] });
const codePaths = { defaultFillOnly: newPath(), overrideLegacy: newPath() };
const doorsByLevel = new Map<number, SavedDoor[]>();
for (const d of graph.doors) doorsByLevel.set(d.levelId, [...(doorsByLevel.get(d.levelId) ?? []), d]);
for (const [levelId, saved] of doorsByLevel) {
  const rooms = roomsFor(levelId).filter((r) => (roomsByLevel.get(levelId) ?? new Map()).has(r.key));
  const doors = saved.map(directoryDoor);
  const legacy = directoryDoorReviews(rooms, doors);
  for (const [name, overrideLegacy] of [["defaultFillOnly", false], ["overrideLegacy", true]] as const) {
    const codePath = codePaths[name];
    const native = directoryDoorReviews(rooms, doors, [], [], { mode: "native-cell", cells: cellsByLevel.get(levelId) ?? [], overrideLegacy });
    legacy.forEach((l, i) => {
      const n = native[i]!;
      codePath.doors++;
      if (l.portal) codePath.legacyConnected++;
      if (n.portal) codePath.nativeConnected++;
      if (n.nativeOwners?.conflict) codePath.conflictsReported++;
      if (l.portal && !n.portal) codePath.legacyConnectedLost++;
      const lk = l.portal ? [...l.portal.rooms].sort().join() : "",
        nk = n.portal ? [...n.portal.rooms].sort().join() : "";
      if (l.portal && n.portal && lk !== nk) codePath.legacyConnectedOwnerChanged++;
      if (lk !== nk) {
        codePath.portalChanged++;
        if (!n.nativeOwners?.decided) codePath.changedWithoutNativeDecision++;
        codePath.changes.push({ door: l.door.id, levelId, legacy: l.portal?.rooms.map(label) ?? null, native: n.portal?.rooms.map(label) ?? null, savedState: saved[i]!.state, savedOwners: saved[i]!.roomKeys.map(label) });
      }
    });
  }
}

const count = (prefix: string) => [...tally].filter(([k]) => k.startsWith(prefix)).reduce((s, [, n]) => s + n, 0);
const report = {
  format: "native-cell-door-owner-audit-v1",
  diagnosticOnly: true,
  rule: "Each door side owner is the nearest room by outline (0 when inside the outer ring and outside its holes) among the room keys of the native cell containing the probe point at footprint depth + {0.25, 0.5, 1, 1.5} ft along the unit normal (first step that lands in a cell). Decides only for two different cells with two different, walkable, untied owners; otherwise the legacy owners stand.",
  inputs,
  doors: graph.doors.length,
  categories: Object.fromEntries([...tally].sort()),
  connected: {
    total: count("connected"),
    agree: tally.get("connected:agree") ?? 0,
    change: tally.get("connected:CHANGE") ?? 0,
    retainedLegacy: count("connected:retained-legacy"),
  },
  pythonSideCellCrossCheck: python ? { compared: graph.doors.filter((d) => pythonRows.has(d.nativeElementId)).length, note: "NATIVE-DOOR-SIDES rows omit the 1,303 agreeing connected doors.", mismatches: pythonCellMismatch, examples: pythonMismatches.slice(0, 20) } : null,
  defaultPolicyOutcomeAgainstSavedOwners: {
    note: "Default fill-only policy: a saved connected door keeps its owners; a pure-rule disagreement is reported as a conflict. Saved unmatched/ambiguous doors with a native pair would be filled.",
    connectedOwnersChanged: 0,
    connectedConflictsReported: tally.get("connected:CHANGE") ?? 0,
    unmatchedOrAmbiguousFilled: count("unmatched:new-native-pair") + count("ambiguous:new-native-pair"),
  },
  codePaths,
  rows,
};
writeFileSync(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ doors: report.doors, categories: report.categories, connected: report.connected, python: report.pythonSideCellCrossCheck && { compared: report.pythonSideCellCrossCheck.compared, mismatches: pythonCellMismatch }, codePaths: Object.fromEntries(Object.entries(codePaths).map(([k, v]) => [k, { ...v, changes: v.changes.length }])) }, null, 1));
