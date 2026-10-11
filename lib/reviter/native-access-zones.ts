import { nativeRationalOverlay, type NativeRationalParts } from "./native-rational-overlay.ts";
import { freezeNativeRationalParts, nativeRationalAreaCompare } from "./native-exact-planar-topology.ts";
import { nativeRoomIdentityRings } from "./native-floor-opening-ownership.ts";
import { nativeRationalIntersectionOperand } from "./native-rational-intersection-broadphase.ts";
import type { IndoorDataset, IndoorRecord } from "./indoor-contract.ts";

/** Mirror of openindoormaps app/indoor-project/native-access-zones.ts (keep identical). */
export const NATIVE_ACCESS_ZONES_VERSION = "native-access-zones-v1";

type P2 = [number, number];
type Rings = P2[][];
/** A reviewed access carve-out of a shared native walking face. The zone's
 * exact parts are subtracted from every physical face on its plane; the
 * remainder is classified by the ordinary majority rule, and the zone itself
 * becomes restricted circulation whose branches carry every member identity
 * (so the existing access policy keeps public routes out). A zone never
 * creates floor, moves a wall or relaxes a restriction. */
export type NativeAccessZone = {
  id: string;
  levelId: number;
  elevationFeet: number;
  /** "staff": restricted staff circulation. "non-walkable": subtracted, no cell. */
  access: "staff" | "non-walkable";
  /** Every record whose identity lies mostly inside the zone. */
  memberRoomKeys: string[];
  /** Members that are staff circulation (metadata only; access is unchanged). */
  staffCirculationRoomKeys?: string[];
  partsFeet: Rings[];
  decision: { source: string; id: string; summary: string };
  evidence?: string;
  notes?: string;
};
export type NativeAccessZones = { version: 1; sourceModelSha256: string; zones: NativeAccessZone[] };
export type NativeAccessZoneBinding = {
  zones: { zone: NativeAccessZone; parts: NativeRationalParts }[];
  issues: { zoneId: string; reason: string }[];
};

const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e7;
/** Shape only. Record/geometry binding is checked by nativeAccessZoneBinding. */
export function validateNativeAccessZones(value: unknown, sourceModelSha256?: string): asserts value is NativeAccessZones | undefined {
  if (value === undefined) return;
  const v = value as NativeAccessZones;
  const ids = new Set<string>();
  if (
    !v || typeof v !== "object" || v.version !== 1 || !/^[a-f0-9]{64}$/.test(String(v.sourceModelSha256)) ||
    (sourceModelSha256 !== undefined && v.sourceModelSha256 !== sourceModelSha256) ||
    !Array.isArray(v.zones) || v.zones.length > 1000 ||
    v.zones.some((z) => {
      if (
        !z || !text(z.id, 200) || ids.has(z.id) || !Number.isSafeInteger(z.levelId) || !finite(z.elevationFeet) ||
        !["staff", "non-walkable"].includes(z.access) ||
        !Array.isArray(z.memberRoomKeys) || !z.memberRoomKeys.length || z.memberRoomKeys.length > 1000 ||
        new Set(z.memberRoomKeys).size !== z.memberRoomKeys.length || z.memberRoomKeys.some((k) => !text(k, 500)) ||
        (z.staffCirculationRoomKeys !== undefined && (!Array.isArray(z.staffCirculationRoomKeys) ||
          new Set(z.staffCirculationRoomKeys).size !== z.staffCirculationRoomKeys.length ||
          z.staffCirculationRoomKeys.some((k) => !z.memberRoomKeys.includes(k)) || (z.access !== "staff" && z.staffCirculationRoomKeys.length > 0))) ||
        !Array.isArray(z.partsFeet) || !z.partsFeet.length || z.partsFeet.length > 1000 ||
        z.partsFeet.some((part) => !Array.isArray(part) || !part.length || part.length > 10000 ||
          part.some((ring) => !Array.isArray(ring) || ring.length < 3 || ring.length > 100000 ||
            ring.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(finite)))) ||
        !z.decision || !text(z.decision.source, 500) || !text(z.decision.id, 200) || !text(z.decision.summary, 10000) ||
        (z.evidence !== undefined && !text(z.evidence, 10000)) || (z.notes !== undefined && !text(z.notes, 10000))
      )
        return true;
      ids.add(z.id);
      return false;
    })
  )
    throw new Error("Invalid reviewed native access zones.");
}

const restricted = (zone: NativeAccessZone, r: IndoorRecord) =>
  zone.access === "staff" ? r.access === "staff" : !r.walkable;
const bounds = (rings: Rings) => {
  const p = rings.flat();
  return [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
};

/** Fail-closed record binding. A zone applies only when: its plane exists; every
 * member is a record on that plane with at least half of its identity inside
 * the zone; at least one member carries the zone's restriction; no member is
 * reviewed public; and no other record on the plane has half or more of its
 * identity inside the zone (a zone cannot silently swallow an unlisted place).
 * Zones on one plane must be disjoint. A failing zone is not applied at all.
 * Uncached: callers bind it to one immutable calculation. */
export function nativeAccessZoneBinding(data: IndoorDataset): NativeAccessZoneBinding {
  const value = data.nativeAccessZones;
  if (!value) return { zones: [], issues: [] };
  const binding: NativeAccessZoneBinding = { zones: [], issues: [] };
  try {
    validateNativeAccessZones(value, data.source.modelSha256);
  } catch (error) {
    for (const z of Array.isArray(value.zones) ? value.zones : []) binding.issues.push({ zoneId: String(z?.id), reason: String(error) });
    return binding;
  }
  const byKey = new Map(data.records.map((r) => [r.key, r]));
  for (const zone of value.zones) {
    const fail = (reason: string) => binding.issues.push({ zoneId: zone.id, reason });
    try {
      if (!data.nativeLevels.some((l) => l.id === zone.levelId && Math.abs(l.elevationFeet - zone.elevationFeet) < 0.05)) { fail("its native level and plane do not exist"); continue; }
      const parts = freezeNativeRationalParts(nativeRationalOverlay("union", zone.partsFeet));
      if (!parts.length || nativeRationalAreaCompare(parts, []) <= 0) { fail("it has no positive exact area"); continue; }
      const members = zone.memberRoomKeys.map((k) => byKey.get(k));
      if (members.some((r) => !r || Math.abs(r.elevationFeet - zone.elevationFeet) >= 0.05)) { fail("a member record is missing or on another plane"); continue; }
      if (!members.some((r) => restricted(zone, r!))) { fail(`no member carries the ${zone.access} restriction`); continue; }
      if (members.some((r) => r!.access === "public")) { fail("a reviewed public record cannot be carved into a restricted zone"); continue; }
      const box = bounds(zone.partsFeet.flat());
      const inside = (r: IndoorRecord) => {
        const identity = nativeRoomIdentityRings(data, r), b = bounds(identity);
        if (b[0]! > box[2]! || b[2]! < box[0]! || b[1]! > box[3]! || b[3]! < box[1]!) return false;
        const exact = nativeRationalOverlay("union", [identity]);
        const near = nativeRationalIntersectionOperand(exact, parts);
        if (!near.length) return false;
        return nativeRationalAreaCompare(nativeRationalOverlay("intersection", exact, near), exact, 2n) >= 0;
      };
      if (members.some((r) => !inside(r!))) { fail("a member's identity lies mostly outside the zone"); continue; }
      const unlisted = data.records.find((r) => !zone.memberRoomKeys.includes(r.key) && Math.abs(r.elevationFeet - zone.elevationFeet) < 0.05 && inside(r));
      if (unlisted) { fail(`unlisted record ${unlisted.key} lies mostly inside the zone`); continue; }
      const overlap = binding.zones.find((z) => Math.abs(z.zone.elevationFeet - zone.elevationFeet) < 0.05 && nativeRationalOverlay("intersection", z.parts, parts).length);
      if (overlap) { fail(`it overlaps zone ${overlap.zone.id}`); continue; }
      binding.zones.push({ zone, parts });
    } catch (error) {
      fail(`exact zone geometry is unclassifiable: ${String(error)}`);
    }
  }
  return binding;
}
/** Applied zones on one physical plane. */
export function nativeAccessZonesAt(data: IndoorDataset, elevationFeet: number) {
  return nativeAccessZoneBinding(data).zones.filter((z) => Math.abs(z.zone.elevationFeet - elevationFeet) < 0.05);
}
/** The applied zone a restricted circulation cell names, if any. */
export function nativeAccessZoneById(data: IndoorDataset, id: string | undefined) {
  return id === undefined ? undefined : nativeAccessZoneBinding(data).zones.find((z) => z.zone.id === id);
}
/** Compiler metadata step: report every refused zone and mark the reviewed
 * staff-circulation members (metadata only; access and walkability stay). */
export function applyNativeAccessZoneMetadata(data: IndoorDataset) {
  const binding = nativeAccessZoneBinding(data);
  for (const { zone } of binding.zones)
    for (const key of zone.staffCirculationRoomKeys ?? []) {
      const record = data.records.find((r) => r.key === key);
      if (record) record.properties.staffCirculation = { zoneId: zone.id, decisionId: zone.decision.id };
    }
  return binding;
}
/** Split exact physical faces along the applied zones of their plane: every
 * remainder polygon and every zone piece is returned as its own polygon, with
 * the zone it lies in. Nothing is added, dropped or moved: the pieces union
 * back exactly to the input. */
export function nativeAccessZoneSplit(
  faces: NativeRationalParts,
  zones: NativeAccessZoneBinding["zones"],
): { part: NativeRationalParts[number]; zone?: NativeAccessZoneBinding["zones"][number] }[] {
  if (!zones.length) return faces.map((part) => ({ part }));
  const union = nativeRationalOverlay("union", ...(zones.map((z) => z.parts) as [NativeRationalParts, ...NativeRationalParts[]]));
  const pieces: { part: NativeRationalParts[number]; zone?: NativeAccessZoneBinding["zones"][number] }[] = [];
  for (const part of faces) {
    const near = nativeRationalIntersectionOperand([part], union);
    if (!near.length || !nativeRationalOverlay("intersection", [part], near).length) { pieces.push({ part }); continue; }
    for (const rest of nativeRationalOverlay("difference", [part], union)) pieces.push({ part: rest });
    for (const zone of zones) for (const inside of nativeRationalOverlay("intersection", [part], zone.parts)) pieces.push({ part: inside, zone });
  }
  return pieces;
}
