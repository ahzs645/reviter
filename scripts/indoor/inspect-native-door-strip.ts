/** Read-only exact negative-material diagnostic, not doorway/route approval.
 * Run with the complete dataset and an explicit proposed flat centreline.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { IndoorDataset } from "../../lib/reviter/indoor-contract.ts";
import { initializeNativeExactGeosOverlay } from "../../lib/reviter/native-exact-geos-overlay.ts";
import { nativeRationalOverlay, rational } from "../../lib/reviter/native-rational-overlay.ts";
import { nativeRationalAreaCompare, nativeRationalFootprintSupported } from "../../lib/reviter/native-exact-planar-topology.ts";
import { projectStatedTwoFootWalkingVolume } from "../../lib/reviter/native-stepped-stair-v2-walking-volume.ts";
import { createNativeRoutingMaterialQuery } from "../../lib/reviter/native-routing-material.ts";
import { nativeRationalIntersectionOperand } from "../../lib/reviter/native-rational-intersection-broadphase.ts";

const [input, proposal, output] = process.argv.slice(2);
if (!input || !proposal || !output)
  throw Error("Usage: inspect-native-door-strip.ts COMPLETE-SOURCE.json PROPOSAL.json NEW-OUTPUT.json");
const sha = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const raw = readFileSync(input), data = JSON.parse(raw.toString()) as IndoorDataset;
const before = sha(JSON.stringify(data));
const request = JSON.parse(readFileSync(proposal, "utf8")) as {
  nativeDoorElementId: number; proposedPointsFeet: [number, number, number][];
};
const matches = data.doors?.filter(d => d.nativeElementId === request.nativeDoorElementId) ?? [];
const points = request.proposedPointsFeet;
if (matches.length !== 1 || !Array.isArray(points) || points.length < 2 ||
    points.length > 100 || points.some(p => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)))
  throw Error("Select one original native doorway and a finite proposed path");
const door = matches[0]!, z = data.nativeLevels.find(l => l.id === door.levelId)?.elevationFeet;
if (z === undefined || points.some(p => p[2] !== z) || !door.footprintFeet)
  throw Error("The proposal must retain the original doorway's exact flat native plane");
await initializeNativeExactGeosOverlay();
const strips = points.slice(1).flatMap((b, i) => {
  const a = points[i]!;
  if (a[0] === b[0] && a[1] === b[1]) return [];
  return [[projectStatedTwoFootWalkingVolume(a, b, rational(z), rational(z), 6).unclippedStatedStripFeet]];
});
if (!strips.length) throw Error("A moving proposed walking strip is required");
const footprint = nativeRationalOverlay("union", strips);
const floors = data.walkingSupport?.sourceModelSha256 === data.source.modelSha256
  ? data.walkingSupport.floors.filter(f => f.elevationFeet === z).flatMap(f => f.partsFeet ?? [f.ringsFeet]) : [];
const material = createNativeRoutingMaterialQuery(data)(z);
const materialVetoes: { nativeElementId?: number; derivedMaterial?: boolean; positiveOverlap: true;
  positiveOverlapOutsideOriginalDoor?: boolean }[] = [];
for (const part of material.parts) {
  const original = nativeRationalIntersectionOperand(footprint, [part.rings]);
  if (!original.length) continue;
  const overlap = nativeRationalOverlay("intersection", footprint, original);
  if (nativeRationalAreaCompare(overlap, []) <= 0) continue;
  materialVetoes.push({ nativeElementId: part.nativeElementId, positiveOverlap: true,
    positiveOverlapOutsideOriginalDoor: nativeRationalAreaCompare(
      nativeRationalOverlay("difference", overlap, [[door.footprintFeet]]), []) > 0 });
}
for (const rings of material.derivedParts ?? []) {
  const original = nativeRationalIntersectionOperand(footprint, [rings]);
  if (original.length && nativeRationalAreaCompare(nativeRationalOverlay("intersection", footprint, original), []) > 0)
    materialVetoes.push({ derivedMaterial: true, positiveOverlap: true });
}
const sourceUnchanged = before === sha(JSON.stringify(data));
if (!sourceUnchanged) throw Error("Diagnostic mutated its source");
const result = { scope: "Exact proposed two-foot strip against original native floors and known/positive/derived material only. Not complete enclosure, ownership, headroom, access or route approval.",
  sourceIndoorSha256: sha(raw), sourceUnchanged, nativeDoorElementId: door.nativeElementId,
  nativeHostElementId: door.hostWallNativeElementId, doorState: door.state, roomKeys: door.roomKeys,
  proposedPointsFeet: points, walkingStripWidthFeet: 2,
  exactFloorFootprintSupported: nativeRationalFootprintSupported(footprint,
    nativeRationalOverlay("union", nativeRationalIntersectionOperand(footprint, floors))),
  materialVetoes, authorityGranted: false };
writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify(result));
