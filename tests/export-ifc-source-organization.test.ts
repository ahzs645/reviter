import assert from "node:assert/strict";
import test from "node:test";
import { IfcAPI, IFCSPATIALZONE, IFCSPACE, IFCSITE, IFCGEOMETRICREPRESENTATIONCONTEXT, IFCRELREFERENCEDINSPATIALSTRUCTURE, IFCRELAGGREGATES, IFCBUILDINGSTOREY, IFCBUILDING } from "web-ifc";
import { IfcParser, extractPropertiesOnDemand } from "@ifc-lite/parser";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { ifcSourceCompoundAngle, sourceIfcCoordinateMetadata } from "../lib/reviter/export-ifc-source-organization.ts";
import type { NativeSpatialOrganization } from "../lib/reviter/native-spatial-organization.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
const sha = "a".repeat(64);
function inventory(): NativeSpatialOrganization {
  const matrixRows: [[number,number,number],[number,number,number],[number,number,number]] = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]];
  const transform = { matrixRows, originFeet: [10, 20, 30] as [number,number,number] };
  return { kind: "native-spatial-organization", sourceSha256: sha, schemaSha256: sha, readerCommit: "1c3d337dbd2a6810e9dfad68fe99857843d67387", readerPatch: "native-evidence", revitVersion: 2025, status: "complete", spatialElements: [
    { elementId: "300", kind: "area", categoryId: -2003200, name: "Service", number: "A-1", levelId: "30", phaseId: null, areaSchemeId: "50", zoneId: null, rawRecordIndex: 0, certifiedForRouting: false },
    { elementId: "301", kind: "mep-space", categoryId: -2003600, name: "Mechanical space", number: "S-1", levelId: null, phaseId: "70", areaSchemeId: null, zoneId: "80", rawRecordIndex: 1, certifiedForRouting: false },
  ], areaSchemes: [], revisions: [], revisionCatalog: [], worksetVisibility: [], sites: [{ locationId: "2", siteId: "4", name: "site", active: true, project: false, storedSiteToInternal: transform, latitudeRadians: -0.1, longitudeRadians: 1, coordinateSystemText: "EPSG:1234 (unverified source text)", rawRecordIndex: 2 }], coordinates: { status: "proven", activeLocationId: "2", projectLocationId: "3", storedSiteToInternal: transform, internalToShared: { matrixRows: [[0, -1, 0], [1, 0, 0], [0, 0, 1]], originFeet: [20, -10, -30] }, trueNorthInInternal: [1, 0, 0], basePointWitnesses: [{ elementId: "5", errorFeet: 0 }], reason: "source witness" }, diagnostics: [], limitations: [] };
}
function fixture() {
  const result = ifcExportFixture() as ReturnType<typeof ifcExportFixture> & {nativeSpatialOrganization:NativeSpatialOrganization};
  result.sourceSha256 = sha; result.nativeSpatialOrganization = inventory();
  const original = result.nativeIdentity!.identities[0];
  for (const elementId of [300, 301]) result.nativeIdentity!.identities.push({ ...original, elementId, originalElementId: elementId, uniqueId: original.uniqueId.replace(/-[a-f0-9]{8}$/, `-${elementId.toString(16).padStart(8, "0")}`) });
  return result;
}
test("compound angles normalize carry and retain consistent signs for negative sub-degree coordinates", () => {
  assert.equal(ifcSourceCompoundAngle(-Math.PI / 360, true), "(0,-30,0,0)");
  assert.equal(ifcSourceCompoundAngle((12 + 59 / 60 + 59.9999999 / 3600) * Math.PI / 180, false), "(13,0,0,0)");
  assert.equal(ifcSourceCompoundAngle(Math.PI, false), "(180,0,0,0)");
  for (const n of [NaN, Infinity, Math.PI]) assert.equal(ifcSourceCompoundAngle(n, true), null);
});
test("source organization stays opt-in and cross-source/pin contexts cannot affect IFC", () => {
  const result = fixture(), base = makeIfc(result); assert.doesNotMatch(base, /IFCSPATIALZONE\(|Reviter_SourceCoordinates/);
  const data = (source:string) => source.slice(source.indexOf("\nDATA;"));
  for (const mutate of [(x: NativeSpatialOrganization) => { x.sourceSha256 = "b".repeat(64); }, (x: NativeSpatialOrganization) => { x.readerCommit = "wrong"; }, (x: NativeSpatialOrganization) => { x.schemaSha256 = null; }, (x: NativeSpatialOrganization) => { x.status = "budget-blocked"; }]) {
    const copy = fixture(); mutate(copy.nativeSpatialOrganization); assert.equal(data(makeIfc(copy, { includeSourceSpatial: true, sourceCoordinateMetadata: true })), data(base));
  }
});
test("Areas reopen as nonhierarchical USERDEFINED zones, MEP spaces as identity-only spaces in both readers", async () => {
  const result = fixture(), source = makeIfc(result, { includeSourceSpatial: true });
  const api = new IfcAPI(); await api.Init(); const model = api.OpenModel(new TextEncoder().encode(source), { COORDINATE_TO_ORIGIN: false });
  try {
    assert.equal(api.GetLineIDsWithType(model, IFCSPATIALZONE).size(), 1); assert.equal(api.GetLineIDsWithType(model, IFCSPACE).size(), 1);
    const zone = api.GetLine(model, api.GetLineIDsWithType(model, IFCSPATIALZONE).get(0));
    assert.equal(zone.ObjectType.value, "RevitArea"); assert.equal(zone.PredefinedType.value, "USERDEFINED"); assert.equal(zone.Representation, null); assert.equal(zone.ObjectPlacement, null);
    const space = api.GetLine(model, api.GetLineIDsWithType(model, IFCSPACE).get(0)); assert.equal(space.Representation, null); assert.equal(space.ElevationWithFlooring, null);
    const reference = api.GetLine(model, api.GetLineIDsWithType(model, IFCRELREFERENCEDINSPATIALSTRUCTURE).get(0));
    assert.equal(reference.RelatedElements[0].value, zone.expressID); assert.equal(api.GetLine(model, reference.RelatingStructure.value).type, IFCBUILDINGSTOREY);
    const aggregates = api.GetLineIDsWithType(model, IFCRELAGGREGATES); let spaceParent:number|undefined;
    for(let i=0;i<aggregates.size();i++){const relation=api.GetLine(model,aggregates.get(i));if(relation.RelatedObjects.some((r:{value:number})=>r.value===space.expressID))spaceParent=relation.RelatingObject.value;}
    assert.ok(spaceParent); assert.equal(api.GetLine(model,spaceParent).type,IFCBUILDING);
    assert.match(source, /IFCRELREFERENCEDINSPATIALSTRUCTURE\(/); assert.doesNotMatch(source, /IFCELEMENTQUANTITY[^\n]*SourceSpatial/);
  } finally { api.CloseModel(model); api.Dispose(); }
  const parsed = await new IfcParser().parseColumnar(new TextEncoder().encode(source).buffer);
  assert.equal(parsed.schemaVersion, "IFC4"); const entities = [...parsed.entities.expressId];
  const zoneId = entities.find(n => parsed.entities.getTypeName(n) === "IfcSpatialZone")!;
  const pset = extractPropertiesOnDemand(parsed, zoneId).find(s => s.name === "Reviter_SourceSpatial")!;
  assert.equal(pset.properties.find(p => p.name === "NativeElementId")?.value, "300"); assert.equal(pset.properties.find(p => p.name === "CertifiedForRouting")?.value, false);
});
test("existing products, suppressed source owners, duplicate rows and unproven native GUIDs are excluded", () => {
  const result = fixture(); result.nativeSpatialOrganization.spatialElements.push({ ...result.nativeSpatialOrganization.spatialElements[0] });
  assert.doesNotMatch(makeIfc(result, { includeSourceSpatial: true }), /IFCSPATIALZONE\(/);
  result.nativeSpatialOrganization.spatialElements = [{ ...result.nativeSpatialOrganization.spatialElements[0], elementId: "10" }];
  assert.doesNotMatch(makeIfc(result, { includeSourceSpatial: true }), /IFCSPATIALZONE\(/);
  const noGuid = fixture(); noGuid.nativeIdentity!.identities = noGuid.nativeIdentity!.identities.slice(0, 2); assert.doesNotMatch(makeIfc(noGuid, { includeSourceSpatial: true }), /IFCSPATIALZONE\(|IFCSPACE\(/);
  const hidden = fixture(); hidden.nativeDesignOptionMembership = [{elementId:300,designOptionId:123}];
  hidden.nativeDesignOptions = {source:"rvt-rs/RE-40@1c3d337",revitVersion:2024,status:"decoded",positiveEvidence:"measured-2024",unresolvedSets:[],sets:[{setId:120,name:"Options",optionIds:[123,124],primaryOptionId:124,recordSources:[],nameSources:[]}]};
  assert.doesNotMatch(makeIfc(hidden, { includeSourceSpatial: true, designOptions:"main-and-primary" }), /IFCSPATIALZONE\(/);
});
test("coordinate metadata preserves world/site/model placements and never synthesizes projected CRS", async () => {
  const result = fixture(), source = makeIfc(result, { sourceCoordinateMetadata: true });
  const api = new IfcAPI(); await api.Init(); const model = api.OpenModel(new TextEncoder().encode(source), { COORDINATE_TO_ORIGIN: false });
  try {
    const site = api.GetLine(model, api.GetLineIDsWithType(model, IFCSITE).get(0)); assert.equal(site.RefLatitude.value.length, 4); assert.equal(site.RefLongitude.value.length, 4);
    const context = api.GetLine(model, api.GetLineIDsWithType(model, IFCGEOMETRICREPRESENTATIONCONTEXT).get(0));
    const north = api.GetLine(model, context.TrueNorth.value); assert.deepEqual(north.DirectionRatios.map((v:{value:number})=>v.value), [1, 0]);
    assert.doesNotMatch(source, /IFCMAPCONVERSION\(|IFCPROJECTEDCRS\(|EPSG/);
    assert.match(source, /InternalToSharedAffineFeet/);
    const shapes = (ifc:string) => [...ifc.matchAll(/=(IFCCARTESIANPOINT|IFCAXIS2PLACEMENT3D)\((.*)\);/g)].map(x => [x[1],x[2].replace(/#\d+/g,"#ref")]);
    assert.deepEqual(shapes(source), shapes(makeIfc(result)));
  } finally { api.CloseModel(model); api.Dispose(); }
});
test("edited inverse, inconsistent north, invalid witnesses and ambiguous active sites withhold coordinate metadata", () => {
  for (const mutate of [(x:NativeSpatialOrganization)=>{x.coordinates.internalToShared!.originFeet[0]++;},(x:NativeSpatialOrganization)=>{x.coordinates.trueNorthInInternal![0]=0;},(x:NativeSpatialOrganization)=>{x.coordinates.basePointWitnesses[0].errorFeet=1;},(x:NativeSpatialOrganization)=>{x.sites.push({...x.sites[0]});}]) {
    const x = inventory(); mutate(x); assert.equal(sourceIfcCoordinateMetadata(x, sha), null);
  }
});
