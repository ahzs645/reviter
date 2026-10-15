import test from "node:test";
import assert from "node:assert/strict";
import { IfcAPI, IFCMATERIALPROFILESETUSAGE, IFCRELASSOCIATESMATERIAL, IFCISHAPEPROFILEDEF } from "web-ifc";
import { IfcParser } from "@ifc-lite/parser";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { planNativeMaterialProfiles } from "../lib/reviter/export-ifc-material-profiles.ts";
function fixture() {
  const result = ifcExportFixture(); const material = { elementId: 77, name: "Native steel", recordOffset: 0, objectLength: 20, objectMarker: 0x0ad3 as const, evidence: "framed-material-element-name" as const, stream: "Partitions/1", chunkIndex: 0, storedOffset: 0 }; result.nativeMaterialDefinitions = [material];
  result.elementBounds[0]!.categoryId = -2001330; result.elementBounds[0]!.categoryName = "Structural Columns";
  result.nativeStructuralSections = [{ typeId: 20, shape: "symmetric-I", shapeCode: 8, shapeSource: "owned-integer-STRUCTURAL_SECTION_SHAPE", widthFeet: 2, depthFeet: 3, webFeet: .2, flangeFeet: .3, centroidXFeet: 1, centroidYFeet: 1.5, revitVersion: 2027, source: "declared-type-value-block-six-section-parameters", witnesses: [] }];
  result.nativeCompoundLayerMaterialAssignments = [];
  result.nativeElementMaterialAssignments = [{ elementId: 10, geometryId: 20, materialId: material.elementId, evidence: "persisted-instance-shared-geometry-material" }];
  return result;
}
test("native section/material authoring independently reopens exact metric dimensions and owner associations", async () => {
  const result = fixture(), source = makeIfc(result), bytes = new TextEncoder().encode(source);
  const api = new IfcAPI(); await api.Init(); const model = api.OpenModel(bytes);
  try {
    const profiles = api.GetLineIDsWithType(model, IFCISHAPEPROFILEDEF); assert.equal(profiles.size(), 1);
    const profile = api.GetLine(model, profiles.get(0));
    for (const [name, expected] of [["OverallWidth", 2 * .3048], ["OverallDepth", 3 * .3048], ["WebThickness", .2 * .3048], ["FlangeThickness", .3 * .3048]] as const) assert.ok(Math.abs(profile[name].value - expected) < 1e-12);
    assert.equal(api.GetLineIDsWithType(model, IFCMATERIALPROFILESETUSAGE).size(), 1);
    const rels = api.GetLineIDsWithType(model, IFCRELASSOCIATESMATERIAL); let joined = 0;
    for (let i = 0; i < rels.size(); i++) { const rel = api.GetLine(model, rels.get(i)), material = api.GetLine(model, rel.RelatingMaterial.value);
      if (material.type !== IFCMATERIALPROFILESETUSAGE) continue;
      const owner = api.GetLine(model, rel.RelatedObjects[0].value); assert.equal(owner.Tag.value, "10"); assert.equal(material.CardinalPoint, null); assert.equal(material.ReferenceExtent, null); joined++;
    } assert.equal(joined, 1);
    let triangles = 0; api.StreamAllMeshes(model, mesh => { for (let i = 0; i < mesh.geometries.size(); i++) { const geometry = api.GetGeometry(model, mesh.geometries.get(i).geometryExpressID); triangles += geometry.GetIndexDataSize() / 3; geometry.delete(); } }); assert.equal(triangles, 2);
  } finally { api.CloseModel(model); api.Dispose(); }
  const parsed = await new IfcParser().parseColumnar(bytes.buffer); assert.equal(parsed.schemaVersion, "IFC4");
});
test("profiles require explicit structural owner, complete dimensions and one known persisted material", () => {
  const result = fixture(); assert.equal(planNativeMaterialProfiles(result).length, 1);
  result.nativeElementMaterialAssignments!.push({ elementId: 10, geometryId: 20, materialId: 999999, evidence: "persisted-instance-shared-geometry-material" }); assert.equal(planNativeMaterialProfiles(result).length, 0);
  result.nativeElementMaterialAssignments!.pop(); result.elementBounds[0]!.categoryId = -2000011; assert.equal(planNativeMaterialProfiles(result).length, 0);
  result.elementBounds[0]!.categoryId = -2001330; result.nativeStructuralSections![0]!.webFeet = 2; assert.equal(planNativeMaterialProfiles(result).length, 0);
  result.nativeStructuralSections![0]!.webFeet = .2; result.nativeStructuralSections![0]!.shapeCode = 14; assert.equal(planNativeMaterialProfiles(result).length, 0); result.nativeStructuralSections![0]!.shapeCode = 8;
  result.nativeMaterialDefinitions = []; assert.equal(planNativeMaterialProfiles(result).length, 0);
});

test("a source-proven section descriptor remains useful with explicitly unresolved material", async () => {
  const result = fixture(); result.nativeElementMaterialAssignments = [];
  const [plan] = planNativeMaterialProfiles(result); assert.equal(plan?.materialId, null);
  const source = makeIfc(result), api = new IfcAPI(); await api.Init(); const model = api.OpenModel(new TextEncoder().encode(source));
  try {
    const ids = api.GetLineIDsWithType(model, IFCMATERIALPROFILESETUSAGE); assert.equal(ids.size(), 1);
    const usage = api.GetLine(model, ids.get(0)), set = api.GetLine(model, usage.ForProfileSet.value), profile = api.GetLine(model, set.MaterialProfiles[0].value);
    assert.equal(profile.Material, null); assert.match(profile.Description.value, /material unresolved/);
  } finally { api.CloseModel(model); api.Dispose(); }
  const parsed = await new IfcParser().parseColumnar(new TextEncoder().encode(source).buffer); assert.equal(parsed.schemaVersion, "IFC4");
});
