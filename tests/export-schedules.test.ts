import test from "node:test";
import assert from "node:assert/strict";
import { makeElementsCsv, makeNativeRoomsCsv, makeParametersCsv, scheduleCsvCell } from "../lib/reviter/export-schedules.ts";
import type { ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";
import type { NativeSourceRoom } from "../lib/reviter/native-source-rooms.ts";

function record(elementId: number, extra: Partial<ElementBoundsRecord> = {}): ElementBoundsRecord {
  return { elementId, stream: "Partitions/1", chunkIndex: 0, rawOffset: 0, recordOffset: 0, boundsFeet: { min: { x: -1, y: 2, z: 3 }, max: { x: 9, y: 6, z: 7 } }, categoryId: -2000032, designOptionId: null, ...extra };
}
function model(extra: Partial<ConvertResult> = {}): ConvertResult {
  return { elementBounds: [], meshes: [], levels: [], ...extra } as unknown as ConvertResult;
}
function room(elementId: number, extra: Partial<NativeSourceRoom> = {}): NativeSourceRoom {
  return { elementId, key: `native:${elementId}`, source: "element-header", categoryId: -2000160, designOptionId: null, outlineStatus: "not-recovered", certifiedForRouting: false, ...extra };
}
function cells(csv: string, row: number) {
  const lines = csv.trimEnd().split("\r\n");
  const headers = lines[0]!.split(",");
  return Object.fromEntries(lines[row]!.split(",").map((cell, index) => [headers[index]!, cell]));
}

test("CSV quotes multiline data and neutralizes formulas while retaining actual numeric negatives", () => {
  assert.equal(scheduleCsvCell(-5), "-5");
  assert.equal(scheduleCsvCell("-5"), "'-5");
  assert.equal(scheduleCsvCell(" =1+1"), "' =1+1");
  assert.equal(scheduleCsvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(scheduleCsvCell('a,"b"\n会议室'), '"a,""b""\n会议室"');
  assert.equal(scheduleCsvCell(NaN), "");
  assert.equal(scheduleCsvCell(Infinity), "");
});

test("element schedule shares IFC overrides, states bounds dimensions and joins only exact native levels", () => {
  const result = model({ elementBounds: [record(10, { parameters: [{ parameterId: -1019014, name: "Export As", value: "IfcShadingDevice" }] }), record(2)],
    levels: [{ elevation: 3, candidates: 2, levelId: 99, name: "Source Level", elevationSource: "level-element" }],
    nativeAssociatedLevelRelations: [{ elementId: 10, levelId: 99 } as never],
  });
  const csv = makeElementsCsv(result, { unit: "metres", excelBom: true });
  assert.ok(csv.startsWith("\ufeffrevit_element_id"));
  const first = cells(csv.slice(1), 1);
  assert.equal(first.revit_element_id, "10");
  assert.equal(first.ifc_entity, "IFCSHADINGDEVICE");
  assert.equal(first.level, "Source Level");
  assert.equal(first.bounds_width_m, "3.048");
  assert.equal(first.level_elevation_source, "level-element");
  const unknown = cells(csv.slice(1), 2);
  assert.equal(unknown.level, "");
  assert.equal(unknown.level_elevation_m, "");
});

test("conflicting semantic/host/level evidence stays unresolved, rather than picking one source", () => {
  const source = model({ elementBounds: [record(1, { typeName: "A", parameters: [{ parameterId: -1019014, name: "ExportAs", value: "NotExported" }] }), record(1, { typeName: "B", parameters: [{ parameterId: -1019014, name: "ExportAs", value: "IfcSlab" }] })],
    levels: [{ levelId: 99, elevation: 3, candidates: 1 }],
    nativeAssociatedLevelRelations: [{ elementId: 1, levelId: 99 } as never, { elementId: 1, levelId: 88 } as never],
    nativeHostRelations: [{ elementId: 1, hostId: 30 } as never, { elementId: 1, hostId: 31 } as never],
  });
  const row = cells(makeElementsCsv(source), 1);
  assert.equal(row.ifc_parameter_decision, "eligible");
  assert.equal(row.host_revit_element_id, "");
  assert.equal(row.level, "");
  assert.equal(row.type, "");
});

test("native room inventory preserves boxless identities and never substitutes bounding-box area", () => {
  const result = model({ nativeSourceRooms: [room(1, { name: "Boxless" }), room(2, { boundsFeet: record(2).boundsFeet }), room(3, {
    outlineStatus: "recovered", outline: { outerFeet: [[0,0],[10,0],[10,10],[0,10]], holesFeet: [], additionalPieces: [], elevationFeet: 0,
      areaSquareFeet: 100, source: "partition_room_solid_faces", evidence: { stream: "P", chunkIndex: 0, rawOffset: 0, offset: 0 } },
  })] });
  const csv = makeNativeRoomsCsv(result, { unit: "metres" });
  assert.equal(cells(csv, 1).area_m2, "");
  assert.equal(cells(csv, 2).area_m2, "");
  assert.ok(Math.abs(Number(cells(csv, 3).area_m2) - 9.290304) < 1e-10);
  assert.equal(cells(csv, 1).certified_for_routing, "false");
});

test("parameter schedule keeps instance/type ownership, raw native units and conflicting saved values", () => {
  const source = model({ elementBounds: [record(1, { typeId: 50, parameters: [{ parameterId: -1001203, name: "Mark", value: "=CMD()" }], typeParameters: [{ parameterId: -1001000, name: "Width", value: 3 }] }), record(1, { parameters: [{ parameterId: -1001203, name: "Mark", value: "Other" }] })] });
  const csv = makeParametersCsv(source, { unit: "metres" });
  assert.ok(csv.includes("'=CMD()"));
  assert.ok(csv.includes("1,type,50,-1001000"));
  assert.equal(csv.split("\r\n").filter(line => line.includes("serialized_not_evaluated")).length, 3);
  assert.ok(csv.includes(",3,,serialized_not_evaluated"));
});

test("empty schedules contain headers with consistent CRLF line endings", () => {
  for (const output of [makeElementsCsv(model()), makeNativeRoomsCsv(model()), makeParametersCsv(model())]) {
    assert.equal(output.split("\r\n").length, 2);
    assert.ok(!/[^\r]\n/u.test(output));
  }
});

test("explicit primary-option export filtering retains unresolved alternatives across schedules", () => {
  const source = model({
    elementBounds: [record(1, { designOptionId: 101 }), record(2, { designOptionId: 102 }), record(3, { designOptionId: 999 })],
    nativeSourceRooms: [room(1, { designOptionId: 101 }), room(2, { designOptionId: 102 }), room(3, { designOptionId: 999 })],
    nativeDesignOptions: { source: "rvt-rs/RE-40@1c3d337", revitVersion: 2024, status: "decoded", positiveEvidence: "measured-2024",
      sets: [{ setId: 100, name: "Set", optionIds: [101,102], primaryOptionId: 101, recordSources: [], nameSources: [] }], unresolvedSets: [] },
  });
  for (const fn of [makeElementsCsv, makeNativeRoomsCsv]) {
    assert.equal(fn(source).split("\r\n").length - 2, 3);
    const csv = fn(source, { designOptions: "main-and-primary" });
    assert.equal(csv.split("\r\n").length - 2, 2);
    assert.equal(cells(csv, 1).revit_element_id, "1");
    assert.equal(cells(csv, 2).revit_element_id, "3");
  }
});
