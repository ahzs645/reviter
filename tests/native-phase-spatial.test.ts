import assert from "node:assert/strict";
import test from "node:test";
import { createNativePhaseSpatialCollector, nativePhaseLifecycle, type NativeElementPhases } from "../lib/reviter/native-phase-spatial.ts";
import { setActiveClassTagTranslation } from "../lib/reviter/revit-class-tags.ts";
import { setActiveElementIdBytes } from "../lib/reviter/element-id-width.ts";
import { REVIT_2027_CLASS_NAMES, REVIT_2027_FIRST_CLASS_INDEX } from "../lib/reviter/revit-2027-class-names.data.ts";
import type { SchemaSummary } from "../lib/reviter/schema.ts";
import { emitNativePhaseSpatialIfc } from "../lib/reviter/export-ifc-phase-spatial.ts";
const ordinal = (name: string) => REVIT_2027_FIRST_CLASS_INDEX + REVIT_2027_CLASS_NAMES.indexOf(name);
const fields = ["m_pParamValueSetDouble", "m_pParamValueSetInt", "m_pParamValueSetAString", "m_pParamValueSetElementId", "m_geomSteps", "m_pGeomTable", "m_constrInfo", "m_cellList", "m_docAccess", "m_id", "m_assocLevelId", "m_famId", "m_unplacedOwnerId", "m_ownerDBViewId", "m_createdPhaseId", "m_demolishedPhaseId", "m_designOptionId"];
const schema: SchemaSummary = { byteLength: 1, referencedClasses: [], rejectedCandidates: 0, taggedClasses: ["Element", "SWall", "ProjectPhase", "ElementHeader", "RoomElem"].map((name) => ({ name, tag: ordinal(name), parent: name === "SWall" || name === "RoomElem" ? "Element" : "", offset: 0 })) };
const location = { stream: "Partitions/test", chunkIndex: 0, rawOffset: 300, complete: true };
function install(valid = true, width: 4 | 8 = 8) {
  setActiveElementIdBytes(width);
  setActiveClassTagTranslation({ identity: true, matchedClasses: 6000, movedClasses: 0, unmatchedFileClasses: 0, missingCanonicalClasses: 0, lastFileClass: 6000, toCanonical: new Int32Array(0), toFile: new Int32Array(0), declaredFieldCounts: new Map(), declaredFieldNames: new Map([[ordinal("Element"), valid ? fields : [...fields].reverse()]]) });
}
function clean() { setActiveClassTagTranslation(null); setActiveElementIdBytes(null); }
const headers = (elementId = 42, categoryId = -2000011) => new Map([[elementId, { elementId, categoryId, familyId: null, ownerViewId: null, designOptionId: null }]]);
function phaseFrame(phaseId: number, name: string, tagged = true) {
  const prefix = tagged ? Buffer.alloc(38) : Buffer.from([255, 255, 255, 255, 0xd3, 2, 1, 0, 0, 0]);
  if (tagged) { prefix.writeUInt16LE(ordinal("ProjectPhase"), 0); prefix.writeUInt32LE(1, 34); }
  const tail = Buffer.alloc(71 + 2 * name.length);
  tail.writeBigInt64LE(BigInt(phaseId), 0); tail.fill(255, 8, 64); tail.writeUInt32LE(name.length, 67); tail.set(Buffer.from(name, "utf16le"), 71);
  return Buffer.concat([prefix, tail]);
}
function elementFrame(created: number | null = 100, demolished: number | null = null, width: 4 | 8 = 8) {
  const size = 220, header = width === 8 ? 16 : 12, body = header + 2;
  const data = Buffer.alloc(size + header + 4);
  const writeId = (value: number | null, at: number) => width === 8 ? data.writeBigInt64LE(BigInt(value ?? -1), at) : data.writeInt32LE(value ?? -1, at);
  writeId(42, 0);
  data.writeUInt32LE(12345, width); data.writeUInt32LE(size, width + 4); data.writeUInt16LE(ordinal("SWall"), header);
  const assocAt = body + 6 * 4 + 4 + 4 + 4 + width;
  writeId(42, assocAt - width); writeId(311, assocAt);
  for (let i = 1; i <= 6; i++) writeId(null, assocAt + i * width);
  writeId(created, assocAt + 4 * width); writeId(demolished, assocAt + 5 * width);
  data.writeUInt32LE(size, size + header);
  return data;
}
function levelsFrame(elementId = 42, level: number | null = 311) {
  const data = Buffer.alloc(360); data.set([0xd3, 2, 1, 0, 0, 0], 0);
  data.writeBigInt64LE(BigInt(elementId), 6); data.writeUInt32LE(level ?? 0xffff_ffff, 14); data.fill(255, 22, 46);
  return data;
}
function finishFrame(elementId: number, value: string, corrupted = false) {
  const payload = Buffer.alloc(12 + 2 * value.length + 4), data = Buffer.alloc(20 + payload.length);
  payload.writeBigInt64LE(-1006903n, 0); payload.writeUInt32LE(value.length, 8); payload.set(Buffer.from(value, "utf16le"), 12); payload.writeUInt32LE(payload.length, payload.length - 4);
  data.writeUInt32LE(elementId, 0); data.writeUInt32LE(payload.length, 12); data.writeUInt32LE(ordinal("RoomElem"), 16); data.set(payload, 20);
  let a = 1, b = 0; for (let i = 16; i < data.length - 4; i++) { a = (a + data[i]!) % 65521; b = (b + a) % 65521; }
  data.writeUInt32LE(((b * 65536 + a) >>> 0) + (corrupted ? 1 : 0), 8);
  return data;
}
function run(data: Uint8Array, year = 2024, ownHeaders = headers(), validSchema = true, width: 4 | 8 = 8) {
  install(validSchema, width);
  try {
    const collector = createNativePhaseSpatialCollector({ revitVersion: year, schema, declaredElementIds: new Set([42, 100, 101, 311, 694]) });
    collector.pushPage(data, location);
    return collector.resolve({ elementHeaders: ownHeaders, levelIds: new Set([311, 694]) });
  } finally { clean(); }
}
test("2024 native class/category framed phase names reject unrelated names and conflicts", () => {
  const evidence = run(Buffer.concat([phaseFrame(100, "Existing"), phaseFrame(101, "New"), phaseFrame(311, "Level", false)]));
  assert.deepEqual(evidence.phases.map((phase) => [phase.phaseId, phase.name]), [[100, "Existing"], [101, "New"]]);
  const conflict = run(Buffer.concat([phaseFrame(100, "Existing"), phaseFrame(100, "Changed")]));
  assert.equal(conflict.phases.length, 0);
  assert.equal(run(phaseFrame(100, "Existing"), 2025).phases.length, 0);
  assert.equal(run(phaseFrame(100, "Existing", false), 2024, headers(100, -2000112)).phases.length, 1);
});
test("schema-confirmed Element fields retain created/demolished ids and explicit none", () => {
  for (const year of [2024, 2025, 2026, 2027]) {
    const evidence = run(elementFrame(100, 101), year);
    assert.equal(evidence.elementPhases.length, 1);
    assert.equal(evidence.elementPhases[0]!.createdPhaseId, 100); assert.equal(evidence.elementPhases[0]!.demolishedPhaseId, 101);
    assert.equal(evidence.elementPhases[0]!.demolitionKnown, true);
  }
  const narrow = run(elementFrame(100, null, 4), 2023, headers(), true, 4);
  assert.equal(narrow.elementPhases[0]!.createdPhaseId, 100); assert.equal(narrow.elementPhases[0]!.demolishedPhaseId, null);
  assert.equal(run(elementFrame(), 2025, headers(), false).elementPhases.length, 0);
  const corrupt = elementFrame(); corrupt.writeBigInt64LE(43n, 54);
  assert.equal(run(corrupt, 2024).elementPhases.length, 0);
});
test("conflicting phase fields fail closed instead of choosing a source copy", () => {
  const evidence = run(Buffer.concat([elementFrame(100), elementFrame(101)]));
  assert.equal(evidence.elementPhases.length, 0);
  assert.ok(evidence.limitations.some((limitation) => limitation.includes("Conflicting")));
});
test("2024 base/top/stair associations require exact target Levels and native category", () => {
  const data = levelsFrame(); data.writeUInt32LE(694, 106); data.writeUInt32LE(0xffffffff, 114);
  const wall = run(data);
  assert.equal(wall.levelParameters[0]!.levelId, 311); assert.equal(wall.levelParameters[0]!.topLevelId, 694);
  assert.equal(run(data, 2025).levelParameters.length, 0);
  assert.equal(run(data, 2024, headers(42, -2000080)).levelParameters[0]!.topLevelId, undefined);
  const stair = levelsFrame(42, null); stair.writeUInt32LE(311, 6 + 115); stair.writeUInt32LE(694, 6 + 115 + 32);
  const evidence = run(stair, 2024, headers(42, -2000120));
  assert.equal(evidence.levelParameters[0]!.stairBaseLevelId, 311); assert.equal(evidence.levelParameters[0]!.stairTopLevelId, 694);
  assert.equal(run(stair, 2024, headers(42, -2000011)).levelParameters.length, 0);
});
test("room Floor Finish uses checksum-verified owning object and conflicts disappear", () => {
  const evidence = run(finishFrame(42, "Wood"), 2025, headers(42, -2000160));
  assert.equal(evidence.roomFloorFinishes[0]!.value, "Wood");
  assert.equal(run(finishFrame(42, "Wood", true), 2025, headers(42, -2000160)).roomFloorFinishes.length, 0);
  assert.equal(run(finishFrame(42, "Wood"), 2025, headers(42, -2000011)).roomFloorFinishes.length, 0);
  assert.equal(run(Buffer.concat([finishFrame(42, "Wood"), finishFrame(42, "Tile")]), 2025, headers(42, -2000160)).roomFloorFinishes.length, 0);
  assert.equal(run(finishFrame(42, "Wood"), 2023, headers(42, -2000160), true, 4).roomFloorFinishes.length, 0);
  const first = finishFrame(42, "Wood"), second = finishFrame(42, "Tile");
  const combined = Buffer.concat([first.subarray(0, first.length - 4), second.subarray(20)]);
  combined.writeUInt32LE(combined.length - 20, 12); combined.writeUInt32LE(combined.length - 20, combined.length - 4);
  let a = 1, b = 0; for (let i = 16; i < combined.length - 4; i++) { a = (a + combined[i]!) % 65521; b = (b + a) % 65521; }
  combined.writeUInt32LE((b * 65536 + a) >>> 0, 8);
  assert.equal(run(combined, 2025, headers(42, -2000160)).roomFloorFinishes.length, 0);
});
test("consecutive complete pages recover split names; salvage never stitches", () => {
  install();
  try {
    for (const complete of [true, false]) {
      const collector = createNativePhaseSpatialCollector({ revitVersion: 2024, schema, declaredElementIds: new Set([100]) });
      const data = phaseFrame(100, "Existing");
      collector.pushPage(data.subarray(0, 80), { ...location, complete });
      collector.pushPage(data.subarray(80), { ...location, chunkIndex: 1 });
      assert.equal(collector.resolve({ elementHeaders: new Map(), levelIds: new Set() }).phases.length, complete ? 1 : 0);
    }
  } finally { clean(); }
});

test("split association waits for the top-constraint window", () => {
  install();
  try {
    const collector = createNativePhaseSpatialCollector({ revitVersion: 2024, schema, declaredElementIds: new Set([42, 311, 694]) });
    const data = levelsFrame(); data.writeUInt32LE(694, 6 + 280); data.writeUInt32LE(0xffffffff, 6 + 288);
    collector.pushPage(data.subarray(0, 200), location);
    collector.pushPage(data.subarray(200), { ...location, chunkIndex: 1 });
    const evidence = collector.resolve({ elementHeaders: headers(), levelIds: new Set([311, 694]) });
    assert.equal(evidence.levelParameters.length, 1); assert.equal(evidence.levelParameters[0]!.topLevelId, 694);
    assert.equal(evidence.levelParameters[0]!.evidence.chunkIndex, 0);
  } finally { clean(); }
});
test("lifecycle needs proven complete order, target and demolition state", () => {
  const phases = [{ phaseId: 100, name: "Existing", sources: [] }, { phaseId: 101, name: "New", sources: [] }];
  const element: NativeElementPhases = { elementId: 42, createdPhaseId: 100, demolishedPhaseId: null, source: "Element.phase-fields", demolitionKnown: true, evidence: { ...location, offset: 0 } };
  const target = { orderedPhaseIds: [100, 101], targetPhaseId: 101, source: "native-AllProjectPhases" as const, evidence: { ...location, offset: 0 } };
  assert.equal(nativePhaseLifecycle(element, phases), "unresolved");
  assert.equal(nativePhaseLifecycle(element, phases, target), "existing");
  assert.equal(nativePhaseLifecycle({ ...element, createdPhaseId: 101 }, phases, target), "new");
  assert.equal(nativePhaseLifecycle({ ...element, demolishedPhaseId: 101 }, phases, target), "demolished");
  assert.equal(nativePhaseLifecycle({ ...element, createdPhaseId: 101, demolishedPhaseId: 101 }, phases, target), "temporary");
  assert.equal(nativePhaseLifecycle({ ...element, createdPhaseId: 101 }, phases, { ...target, targetPhaseId: 100 }), "not-yet-created");
  assert.equal(nativePhaseLifecycle({ ...element, demolishedPhaseId: 100 }, phases, target), "already-demolished");
  assert.equal(nativePhaseLifecycle({ ...element, demolitionKnown: false }, phases, target), "unresolved");
  assert.equal(nativePhaseLifecycle(element, phases, { ...target, orderedPhaseIds: [101, 101] }), "unresolved");
});

test("IFC phasing and level labels attach only to emitted source products", () => {
  const data = levelsFrame();
  const evidence = run(Buffer.concat([elementFrame(), phaseFrame(100, "Existing"), data]));
  const lines: string[] = [];
  const writer = { add(expression: string) { lines.push(expression); return lines.length; } };
  const context = { ownerHistory: 1, elementEntities: new Map([[42, 10]]), levelNames: new Map([[311, "Ground"]]), guid: (_kind: string, key: string | number) => String(key), quoted: (text: string) => `'${text.replaceAll("'", "''")}'` };
  const result = emitNativePhaseSpatialIfc(writer, evidence, context);
  assert.equal(result.phaseElementCount, 1); assert.equal(result.levelElementCount, 1);
  assert.ok(lines.some((line) => line.includes("'Phase Created',$,IFCLABEL('Existing')")));
  assert.ok(lines.some((line) => line.includes("'Lifecycle',$,IFCLABEL('unresolved')")));
  assert.ok(lines.some((line) => line.includes("'Level',$,IFCLABEL('Ground')")));
  assert.ok(!lines.some((line) => line.includes("'Status'")));
  assert.equal(emitNativePhaseSpatialIfc(writer, evidence, { ...context, elementEntities: new Map() }).phaseElementCount, 0);
});
