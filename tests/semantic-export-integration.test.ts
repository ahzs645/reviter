import assert from "node:assert/strict";
import test from "node:test";
import { IfcParser, extractPropertiesOnDemand } from "@ifc-lite/parser";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
import { revitIfcGlobalIdFromUniqueId } from "../lib/reviter/revit-ifc-semantics.ts";
import { NATIVE_ROOM_CATEGORY } from "../lib/reviter/native-rooms.ts";
import { parseExtractArguments } from "../scripts/extract-geometry.ts";

test("primary-only IFC does not resurrect excluded triangles as anonymous proxies", () => {
  const model = ifcExportFixture();
  model.designOptions = {
    source: "native-partition-design-options", status: "supported", revitVersion: 2024,
    sets: [{setId: 100, name: "Alternatives", optionIds: [101, 102], primaryOptionId: 101}],
    unresolvedSets: [], elementOptions: [{ elementId: 10, optionId: 101 }, { elementId: 11, optionId: 102 }], warnings: [],
  };
  const before = structuredClone(model);
  assert.match(makeIfc(model), /IFCDOOR\(/);
  const selected = makeIfc(model, { designOptionSelection: "primary" });
  assert.match(selected, /IFCWALL\(/);
  assert.doesNotMatch(selected, /IFCDOOR\(|IFCOPENINGELEMENT\(|IFCBUILDINGELEMENTPROXY\(/);
  assert.deepEqual(model, before, "export selection must not alter meshes or native source evidence");
  model.designOptions.unresolvedSets = [{ setId: 100, optionIds: [101, 102], reasons: ["conflicting-primary"] }];
  model.designOptions.sets = [];
  assert.match(makeIfc(model, { designOptionSelection: "primary" }), /IFCDOOR\(/);
});

test("native room spaces retain boxless metadata and stored curves without fabricated volumes", async () => {
  const model = ifcExportFixture();
  model.nativeRooms = [{
    elementId: 30, categoryId: NATIVE_ROOM_CATEGORY, source: "Partitions/ElementHeader.m_categoryId",
    number: "A'1", name: "Office", levelId: model.levels[0]?.levelId,
    boundsFeet: { min: {x:100,y:200,z:10}, max:{x:104,y:204,z:20} },
    outlineStatus: "decoded", enclosure: "unreviewed-source",
    outline: { source: "partition-room-solid-faces", units: "feet", outer: [[100,200],[104,200],[104,204],[100,204]],
      holes: [[[101,201],[101,202],[102,202],[102,201]]], elevationFeet: 10, areaSquareFeet: 15,
      location: {stream: "Partitions/1", chunkIndex: 0, offset: 0}},
  }, {
    elementId: 11, categoryId: NATIVE_ROOM_CATEGORY, source: "Partitions/ElementHeader.m_categoryId",
    name: "Boxless source", levelId: 99999, outlineStatus: "missing-record-bounds", enclosure: "unreviewed-source",
  }];
  model.elementBounds[1]!.categoryId = NATIVE_ROOM_CATEGORY;
  model.elementBounds[1]!.categoryName = "Rooms";
  const before = structuredClone(model);
  const text = makeIfc(model);
  assert.equal((text.match(/=IFCSPACE\(/g) ?? []).length, 2);
  assert.equal((text.match(/=IFCPOLYLINE\(/g) ?? []).length, 2, "outer and inner stored rings survive");
  assert.doesNotMatch(text, /IFCEXTRUDEDAREASOLID\(/, "no native room height was decoded");
  assert.match(text, /'FootPrint','GeometricCurveSet'/);
  assert.match(text, /'metadata-only'/);
  assert.match(text, /unreviewed-source/);
  assert.doesNotMatch(text, /=IFCDOOR\(|=IFCBUILDINGELEMENTPROXY\(/, "the native-space ID cannot also emit a product or triangle fallback");
  const guids = [...text.matchAll(/=(?:IFCSPACE|IFCWALL)\('([^']+)'/g)].map(match => match[1]);
  assert.equal(new Set(guids).size, guids.length, "each native occurrence GlobalId is unique");
  assert.equal((makeIfc(model, { includeNativeRooms: false }).match(/=IFCSPACE\(/g) ?? []).length, 0);
  assert.deepEqual(model, before);
  const store = await new IfcParser().parseColumnar(new TextEncoder().encode(text).buffer);
  for (const match of text.matchAll(/#(\d+)=IFCSPACE\(/g)) {
    const properties = extractPropertiesOnDemand(store, Number(match[1])) ?? [];
    assert.ok(properties.some(set => set.name === "Reviter_NativeRoom"));
  }
});

test("default IFC emits standard psets alongside raw evidence through the actual exporter", async () => {
  const model = ifcExportFixture();
  model.elementBounds[0]!.parameters!.push({ parameterId: -1001596, name: "Structural", value: 1 });
  const text = makeIfc(model);
  const id = Number(text.match(/#(\d+)=IFCWALL\(/)![1]);
  const store = await new IfcParser().parseColumnar(new TextEncoder().encode(text).buffer);
  const sets = extractPropertiesOnDemand(store, id) ?? [];
  const common = sets.find(set => set.name === "Pset_WallCommon");
  assert.equal(common?.properties.find(p => p.name === "LoadBearing")?.value, true);
  assert.ok(sets.some(set => set.name === "Reviter_Recovery"));
  assert.ok(sets.some(set => set.name === "Reviter_RevitInstanceParameters"));
});

test("native UniqueId yields the Revit compressed occurrence GlobalId", () => {
  const model = ifcExportFixture();
  const uniqueId = "50f92000-82f8-4258-b6a8-bb42c01b00a0-0009734c";
  model.nativeIdentity = { format: "revit-2027-native-identity", declaredRecordCount: 2, decodedIdentityCount: 1, skippedLeadingRecordCount: 1,
    identities: [{elementId: 10, originalElementId: 619340, creationEpisodeId: 1, lastModificationEpisodeId: 1, lastUserModificationEpisodeId: 1,
      episodeGuid: uniqueId.slice(0,36), uniqueId, byteOffset: 34, provenance: "Global/ElemTable.ElementHistory+Global/History.Episode"}] };
  assert.match(makeIfc(model), new RegExp(`IFCWALL\\('${revitIfcGlobalIdFromUniqueId(uniqueId)}'`));
});

test("explicit native phase fields survive IFC export without synthetic raw parameters", async () => {
  const model = ifcExportFixture();
  model.nativePhases = {
    phases: [{ elementId: 50, name: "Existing", evidence: "framed-ProjectPhase", stream: "Partitions/1", chunkIndex: 0, recordOffset: 0 },
      {elementId: 51, name: "New Construction", evidence: "framed-ProjectPhase", stream: "Partitions/1", chunkIndex: 0, recordOffset: 100}],
    relations: [{elementId: 10, createdPhaseId: 50, demolishedPhaseId: 51, stream: "Partitions/1", chunkIndex: 0, recordOffset: 0}],
  };
  const before = structuredClone(model.elementBounds[0]!.parameters);
  const text = makeIfc(model);
  const id = Number(text.match(/#(\d+)=IFCWALL\(/)![1]);
  const store = await new IfcParser().parseColumnar(new TextEncoder().encode(text).buffer);
  const phases = (extractPropertiesOnDemand(store, id) ?? []).find(set => set.name === "Phasing");
  assert.equal(phases?.properties.find(p => p.name === "Phase Created")?.value, "Existing");
  assert.equal(phases?.properties.find(p => p.name === "Phase Demolished")?.value, "New Construction");
  assert.deepEqual(model.elementBounds[0]!.parameters, before);
});

test("CLI semantic switches validate their formats and leave the plain invocation intact", () => {
  const base = ["model.rvt", "--out", "out.ifc"];
  assert.equal(parseExtractArguments(base).experimentalMep, undefined);
  const parsed = parseExtractArguments([...base, "--design-options", "primary", "--experimental-mep"]);
  assert.equal(parsed.designOptionSelection, "primary");
  assert.equal(parsed.experimentalMep, true);
  assert.throws(() => parseExtractArguments([...base, "--design-options", "guess"]), /all or primary/);
  assert.throws(() => parseExtractArguments(["model.rvt", "--out", "out.glb", "--experimental-mep"]), /IFC or JSON/);
  assert.throws(() => parseExtractArguments(["model.rvt", "--out", "out.glb", "--design-options", "primary"]), /only for IFC/);
});

test("standard properties use the same strongest duplicate evidence as the raw manifest", () => {
  const model = ifcExportFixture();
  model.elementBounds.push({ ...model.elementBounds[0]!, parameters: [
    ...model.elementBounds[0]!.parameters!, {parameterId:-1001596,name:"Structural",value:1},
  ] });
  const text = makeIfc(model);
  assert.match(text, /'LoadBearing','[^']*',IFCBOOLEAN\(\.T\.\)/);
});

test("synthetic stair wrappers honor admitted stair enums and disclose unsupported class changes", () => {
  const model = ifcExportFixture();
  model.nativeStairAssemblies = [{stairElementId: 40, runAndLandingIds: [10,11], stringerIds: [], railingIds: [], supportIds: [], evidence: "runs", spiralRunIds: [], shape: "undetermined"}];
  model.nativeIfcExportParameters = [{elementId:40,predefinedType:"HALF_TURN_STAIR",provenance:"owned-element-parameter-table"}];
  assert.match(makeIfc(model), /IFCSTAIR\([^\n]+\.HALF_TURN_STAIR\.\)/);
  model.nativeIfcExportParameters[0]!.exportAs = "IfcWall";
  const changed = makeIfc(model);
  assert.match(changed, /IFCSTAIR\(/);
  assert.match(changed, /unsupported-aggregate-wrapper/);
});
