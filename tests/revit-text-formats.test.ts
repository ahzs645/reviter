import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeOmniClassTaxonomies,
  parseOmniClassTaxonomy,
  writeOmniClassTaxonomy,
} from "../lib/reviter/omniclass.ts";
import {
  parseSharedParameterFile,
  writeSharedParameterFile,
} from "../lib/reviter/shared-parameters.ts";
import { parseTypeCatalog, writeTypeCatalog } from "../lib/reviter/type-catalog.ts";

test("parses and writes Revit shared-parameter files", () => {
  const source = [
    "# This is a Revit shared parameter file.",
    "*META\tVERSION\tMINVERSION",
    "META\t2\t1",
    "*GROUP\tID\tNAME",
    "GROUP\t100\tIdentity Data",
    "*PARAM\tGUID\tNAME\tDATATYPE\tDATACATEGORY\tGROUP\tVISIBLE\tDESCRIPTION\tUSERMODIFIABLE",
    "PARAM\t61ff3d56-09d7-4049-8c78-4abe745e4e5a\tEquipmentName\tTEXT\t\t100\t1\tShown in schedules\t1",
    "",
  ].join("\n");
  const parsed = parseSharedParameterFile(source);
  assert.deepEqual(parsed.groups, [{ id: 100, name: "Identity Data" }]);
  assert.deepEqual(parsed.parameters[0], {
    guid: "61ff3d56-09d7-4049-8c78-4abe745e4e5a",
    name: "EquipmentName",
    dataType: "TEXT",
    groupId: 100,
    visible: true,
    description: "Shown in schedules",
    userModifiable: true,
  });
  assert.deepEqual(
    parseSharedParameterFile(writeSharedParameterFile(parsed)).parameters,
    parsed.parameters,
  );
});

test("reports orphaned and duplicate shared parameters without dropping them", () => {
  const source = [
    "*META\tVERSION\tMINVERSION",
    "META\t2\t1",
    "*GROUP\tID\tNAME",
    "GROUP\t1\tData",
    "*PARAM\tGUID\tNAME\tDATATYPE\tDATACATEGORY\tGROUP\tVISIBLE\tDESCRIPTION\tUSERMODIFIABLE",
    "PARAM\ta\tOne\tTEXT\t\t9\t1\t\t1",
    "PARAM\ta\tTwo\tTEXT\t\t1\t1\t\t1",
  ].join("\n");
  const parsed = parseSharedParameterFile(source);
  assert.equal(parsed.parameters.length, 2);
  assert.equal(parsed.warnings.length, 2);
});

test("parses quoted type catalogs and round-trips their values", () => {
  const source = [
    ",Manufacturer##OTHER##,Width##LENGTH##MILLIMETERS,Description##OTHER##",
    "Model A,Example,800,\"Drawer, heated\"",
  ].join("\n");
  const parsed = parseTypeCatalog(source);
  assert.deepEqual(parsed.parameters[1], {
    name: "Width",
    parameterType: "LENGTH",
    units: "MILLIMETERS",
  });
  assert.deepEqual(parsed.types[0], {
    name: "Model A",
    values: ["Example", "800", "Drawer, heated"],
  });
  assert.deepEqual(parseTypeCatalog(writeTypeCatalog(parsed)), parsed);
});

test("accepts comments and type-catalog headers without a leading comma", () => {
  const parsed = parseTypeCatalog([
    "# exported family types",
    "Width##LENGTH##MILLIMETERS",
    "Model A,800",
  ].join("\n"));
  assert.deepEqual(parsed.parameters, [{
    name: "Width",
    parameterType: "LENGTH",
    units: "MILLIMETERS",
  }]);
  assert.deepEqual(parsed.types, [{ name: "Model A", values: ["800"] }]);
});

test("parses OmniClass taxonomy rows with optional Revit categories", () => {
  const expected = [
    { number: "23.10.20.14", title: "Retaining Walls", level: 3, categoryId: -2000011 },
    { number: "23.20.25.11.17", title: "Mesh for General Use", level: 4 },
  ];
  const parsed = parseOmniClassTaxonomy([
    "23.10.20.14\tRetaining Walls\t3\t-2000011",
    "23.20.25.11.17\tMesh for General Use\t4\t",
  ].join("\n"));
  assert.deepEqual(parsed, expected);
  assert.deepEqual(parseOmniClassTaxonomy(writeOmniClassTaxonomy(parsed)), expected);
  assert.deepEqual(mergeOmniClassTaxonomies(parsed, [parsed[0]!]), expected);
});
