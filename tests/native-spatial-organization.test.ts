import assert from "node:assert/strict";
import test from "node:test";
import { applyNativeStoredTransform, buildNativeSpatialOrganization, makeNativeSpatialOrganizationCsv } from "../lib/reviter/native-spatial-organization.ts";
import type { SpatialCategoryEvidence } from "../lib/reviter/native-spatial-organization.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";
const sha = "a".repeat(64), eid = (n: number) => ({ m_id: { m_id64: n } });
function record(c: string, n: number, fields: Record<string, unknown> = {}) {
  const rootFields: Record<string, unknown> = { m_id: eid(n), m_famId: eid(-1), ...fields };
  return { class_name: c, status: "complete_bounded_graph", diagnostic: null, identity: { element_id: n }, source: { stream: "Partitions/1", group_record_offset: n * 300, body_bytes: 300, body_sha256: sha }, graph: { consumed_bytes: 300, objects: [{ class_name: c, class_tag: 100, token: 0, start: 2, fields_end: 120, fields: rootFields }], edges: [] as Record<string, unknown>[] } };
}
function owned(r: ReturnType<typeof record>, field: string, c: string, fields: Record<string, unknown>) {
  r.graph.objects[0].fields[field] = { class_tag: 101, offset: 110, pointer_token: 1 };
  r.graph.objects.push({ class_name: c, class_tag: 101, token: 1, start: 120, fields_end: 300, fields: fields as typeof r.graph.objects[0]["fields"] });
  r.graph.edges.push({ source_object_index: 0, target_object_index: 1, pointer_offset: 110, pointer_token: 1, target_class_tag: 101 });
}
function report(records: ReturnType<typeof record>[]): NativeEvidenceReport {
  return { sourceSha256: sha, readerCommit: "1c3d337dbd2a6810e9dfad68fe99857843d67387", readerPatch: "native-evidence", scope: "test", source: { apiVersion: 1, kind: "native-source-evidence", status: "complete", summary: { revit_version: 2025, schema_sha256: sha }, records, diagnostics: {} } };
}
function categories(cat: number): SpatialCategoryEvidence { return { sourceSha256: sha, schemaSha256: sha, status: "complete", records: [{ elementId: "12", categoryId: cat, familyId: null, ownerViewId: null, stream: "Partitions/1", inflatedOffset: 100 }], inflatedBytes: 1000, diagnostics: [] }; }
test("same-owner native category separates Room, Area and MEP Space without guessing scheme fields", () => {
  for (const [cat, kind] of [[-2000160, "room"], [-2003200, "area"], [-2003600, "mep-space"]] as const) {
    const r = record("RoomElem", 12, { m_areaSchemeId: eid(25), m_zoneElementId: eid(30), m_levelId: eid(5) });
    const out = buildNativeSpatialOrganization(report([r]), categories(cat));
    assert.equal(out.spatialElements[0].kind, kind); assert.equal(out.spatialElements[0].areaSchemeId, "25");
    assert.equal(out.spatialElements[0].certifiedForRouting, false);
  }
  assert.equal(buildNativeSpatialOrganization(report([record("RoomElem", 12, { m_zoneElementId: eid(30) })])).spatialElements[0].kind, "unresolved");
});
test("cross-file, cross-schema, embedded-family, view-owned, conflicting and cross-stream category joins are refused", () => {
  for (const change of [(c: SpatialCategoryEvidence) => { c.sourceSha256 = "b".repeat(64); }, (c: SpatialCategoryEvidence) => { c.schemaSha256 = "b".repeat(64); }, (c: SpatialCategoryEvidence) => { c.status = "partial"; }, (c: SpatialCategoryEvidence) => { c.records[0].familyId = "33"; }, (c: SpatialCategoryEvidence) => { c.records[0].ownerViewId = "33"; }, (c: SpatialCategoryEvidence) => { c.records[0].stream = "Partitions/2"; }, (c: SpatialCategoryEvidence) => { c.records.push({ ...c.records[0], categoryId: -2003600 }); }]) {
    const c = categories(-2000160); change(c); assert.equal(buildNativeSpatialOrganization(report([record("RoomElem", 12)]), c).spatialElements[0].kind, "unresolved");
  }
});
function coordinateReport() {
  const tracker = record("ActiveGeoLocationTrackingElement", 1, { m_activeGeoLocationId: eid(2), m_projectGeoLocationId: eid(3) });
  const active = record("GeoLocation", 2, { m_name: "=Active site" });
  owned(active, "m_pInstanceInfo", "InstanceInfo", { m_symbolId: eid(4), m_Trf: { m_3x3: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], m_or: [10, 20, 30] } });
  const site = record("GeoSite", 4, { m_dLatitude: .5, m_dLongitude: -.25, m_geoCoordinateSystem: "" });
  const base = record("BasePoint", 5, { m_locationType: 1, m_transformedPosition: [2, 3, 4] });
  owned(base, "m_oGPoint", "GPoint", { m_coord: [13, 18, 34] });
  return report([tracker, active, site, base]);
}
test("explicit active site and source survey witness prove stored transform direction, inverse and true north", () => {
  const out = buildNativeSpatialOrganization(coordinateReport());
  assert.equal(out.coordinates.status, "proven"); assert.deepEqual(out.coordinates.trueNorthInInternal, [1, 0, 0]);
  assert.deepEqual(applyNativeStoredTransform(out.coordinates.internalToShared!, [13, 18, 34]), [2, 3, 4]);
  assert.equal(out.coordinates.basePointWitnesses[0].errorFeet, 0); assert.equal(out.sites[0].latitudeRadians, .5);
  const csv = makeNativeSpatialOrganizationCsv(out);
  assert.ok(csv.includes("'=Active site"));
  assert.ok(csv.includes("coordinate-evidence,2,status,proven"));
  assert.ok(csv.includes("internalToShared"));
  assert.ok(csv.includes("scope,,limitations"));
});
test("site names and transforms alone do not choose an active location or certify frame direction", () => {
  for (const remove of ["ActiveGeoLocationTrackingElement", "BasePoint", "GeoSite"]) {
    const input = coordinateReport(); input.source.records = input.source.records.filter(r => (r as ReturnType<typeof record>).class_name !== remove);
    const out = buildNativeSpatialOrganization(input); assert.equal(out.coordinates.status, "unresolved"); assert.equal(out.coordinates.internalToShared, null);
  }
});
test("mismatched source positions, scaled/reflected/tilted matrices and duplicate active selectors withhold derived coordinates", () => {
  for (const change of [
    (r: ReturnType<typeof record>[]) => { r[3].graph.objects[1].fields.m_coord = [13, 19, 34]; },
    (r: ReturnType<typeof record>[]) => { (r[1].graph.objects[1].fields.m_Trf as {m_3x3:number[][]}).m_3x3[0][1] = 2; },
    (r: ReturnType<typeof record>[]) => { (r[1].graph.objects[1].fields.m_Trf as {m_3x3:number[][]}).m_3x3 = [[1, 0, 0], [0, -1, 0], [0, 0, 1]]; },
    (r: ReturnType<typeof record>[]) => { (r[1].graph.objects[1].fields.m_Trf as {m_3x3:number[][]}).m_3x3 = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]; },
    (r: ReturnType<typeof record>[]) => { r.push(record("ActiveGeoLocationTrackingElement", 6, { m_activeGeoLocationId: eid(3) })); },
  ]) { const input = coordinateReport(); change(input.source.records as ReturnType<typeof record>[]); assert.equal(buildNativeSpatialOrganization(input).coordinates.status, "unresolved"); }
});
test("unowned or inconsistent graph pointers and invalid source owners never supply a transform", () => {
  for (const change of [
    (r: ReturnType<typeof record>) => { r.graph.edges = []; },
    (r: ReturnType<typeof record>) => { r.graph.objects[1].token = 2; },
    (r: ReturnType<typeof record>) => { r.graph.objects[1].fields_end = 301; },
    (r: ReturnType<typeof record>) => { r.graph.objects[0].fields.m_id = eid(9); },
    (r: ReturnType<typeof record>) => { r.graph.objects[0].fields.m_famId = eid(9); },
  ]) { const input = coordinateReport(); change(input.source.records[1] as ReturnType<typeof record>); assert.equal(buildNativeSpatialOrganization(input).coordinates.status, "unresolved"); }
});
test("revision issued/sequence/catalog membership retain exact meanings and never derive issued status from visibility", () => {
  const input = report([record("AllProjectRevisions", 1, { m_revisionIds: [eid(2)] }), record("ProjectRevision", 2, { m_numberStr: "1", m_sequenceNumber: 4, m_issued: false, m_revVisible: 1 }), record("ProjectRevision", 3, { m_issued: true })]);
  const out = buildNativeSpatialOrganization(input); assert.equal(out.revisions[0].issued, false); assert.equal(out.revisions[0].sequence, 4);
  assert.equal(out.revisions[0].inProjectCatalog, true); assert.equal(out.revisions[1].inProjectCatalog, false);
});
test("unproven reader/schema contexts and conflicting current records remain unsupported or withheld", () => {
  const input = coordinateReport(); input.readerCommit = "other"; assert.equal(buildNativeSpatialOrganization(input).status, "unsupported");
  const valid = coordinateReport(); const duplicate = structuredClone(valid.source.records[1]) as ReturnType<typeof record>; duplicate.source.body_sha256 = "b".repeat(64); valid.source.records.push(duplicate);
  assert.equal(buildNativeSpatialOrganization(valid).coordinates.status, "unresolved");
});
