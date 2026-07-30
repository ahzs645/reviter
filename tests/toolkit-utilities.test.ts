import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { File } from "node:buffer";
import { join } from "node:path";
import test from "node:test";

import { openFile } from "@phi-ag/rvt";

import {
  parseBasicFileInfoProperties,
  redactBasicFileInfoProperties,
} from "../lib/reviter/basic-file-info.ts";
import { extractDwgThumbnail } from "../lib/reviter/dwg-thumbnail.ts";
import {
  indexFamilyLibraryFiles,
  searchFamilyLibrary,
  serializableFamilyLibraryIndex,
} from "../lib/reviter/family-library.ts";
import {
  mergeOmniClassTaxonomies,
  omniClassForPartAtom,
  parseOmniClassTaxonomy,
  searchOmniClassTaxonomy,
} from "../lib/reviter/omniclass.ts";
import { parsePartAtomXml } from "../lib/reviter/part-atom.ts";
import { decodeRevitTextBytes } from "../lib/reviter/revit-text-encoding.ts";
import {
  compareSharedParameterDocuments,
  mergeSharedParameterDocuments,
  parseSharedParameterBytes,
  validateSharedParameterDocument,
} from "../lib/reviter/shared-parameters.ts";
import { parseTypeCatalogBytes } from "../lib/reviter/type-catalog.ts";

const FIXTURES = new URL("./fixtures/revitless-toolkit/", import.meta.url);
const fixturePath = (...parts: string[]) => join(FIXTURES.pathname, ...parts);

test("parses legacy BasicFileInfo private properties without exporting them", async () => {
  const bytes = readFileSync(fixturePath("qf_hatco_hdw-2bn_cat.rfa"));
  const file = new File([bytes], "qf_hatco_hdw-2bn_cat.rfa") as unknown as globalThis.File;
  const cfb = await openFile(file);
  const entry = cfb.findEntry("BasicFileInfo");
  assert.ok(entry);
  const info = parseBasicFileInfoProperties(await cfb.entryData(entry));
  assert.equal(info.fileInfoVersion, 6);
  assert.equal(info.format, 2014);
  assert.equal(info.architecture, "x64");
  assert.equal(info.locale, "ENU");
  assert.equal(info.worksharing, "Not enabled");
  assert.match(info.lastSavePath ?? "", /qf_hatco_hdw-2bn_cat\.rfa$/);

  const exportSafe = redactBasicFileInfoProperties(info);
  assert.equal(exportSafe.username, undefined);
  assert.equal(exportSafe.centralModelPath, undefined);
  assert.equal(exportSafe.lastSavePath, undefined);
  assert.equal(exportSafe.revitBuild, info.revitBuild);
});

test("detects UTF-16, Windows-1251, and Windows-1252 Revit text", () => {
  const utf16 = parseSharedParameterBytes(
    readFileSync(fixturePath("SharedParameterFiles", "Invalid", "ФОП2017.txt")),
  );
  assert.equal(utf16.encoding, "utf-16le");
  assert.match(utf16.document.groups[0]?.name ?? "", /Обязательные/);

  const german = parseSharedParameterBytes(
    readFileSync(
      fixturePath(
        "SharedParameterFiles",
        "Valid",
        "IFSE_SharedParametersList_DEU_V07_1_2017.txt",
      ),
    ),
  );
  assert.equal(german.encoding, "windows-1252");
  assert.equal(german.document.parameters.length, 199);

  const ascii = new TextEncoder().encode("*GROUP\tID\tNAME\nGROUP\t1\t");
  const cp1251 = new Uint8Array([...ascii, 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
  const decoded = decodeRevitTextBytes(cp1251);
  assert.equal(decoded.encoding, "windows-1251");
  assert.match(decoded.text, /Привет/);
});

test("parses the complete real shared-parameter and type-catalog corpus", () => {
  const validRoot = fixturePath("SharedParameterFiles", "Valid");
  const valid = readdirSync(validRoot).map((name) =>
    parseSharedParameterBytes(readFileSync(join(validRoot, name))).document);
  assert.equal(valid.length, 18);
  assert.ok(valid.every((document) => document.parameters.length > 0));
  assert.ok(valid.some((document) => document.parameters.length === 14_280));

  const invalidRoot = fixturePath("SharedParameterFiles", "Invalid");
  const invalid = Object.fromEntries(readdirSync(invalidRoot).map((name) => [
    name,
    parseSharedParameterBytes(readFileSync(join(invalidRoot, name))).document,
  ]));
  assert.ok(validateSharedParameterDocument(invalid["DuplicatesExample.txt"]!)
    .some((issue) => issue.code === "duplicate-guid"));
  assert.ok(validateSharedParameterDocument(invalid["OrphanParameterExample.txt"]!)
    .some((issue) => issue.code === "missing-group"));
  assert.ok(validateSharedParameterDocument(invalid["UnusedGroupExample.txt"]!)
    .some((issue) => issue.code === "unused-group"));
  assert.ok(validateSharedParameterDocument(invalid["InvalidMetaExample.txt"]!)
    .some((issue) => issue.code === "invalid-meta"));

  const catalogRoot = fixturePath("TypeCatalogFile", "Valid");
  const catalogs = readdirSync(catalogRoot).map((name) =>
    parseTypeCatalogBytes(readFileSync(join(catalogRoot, name))).catalog);
  assert.equal(catalogs.length, 4);
  assert.deepEqual(catalogs.map((catalog) => catalog.types.length).sort((a, b) => a - b), [
    2, 3, 3, 6,
  ]);
});

test("merges and compares shared parameters by GUID", () => {
  const root = fixturePath("SharedParameterFiles", "Valid");
  const left = parseSharedParameterBytes(readFileSync(join(root, "SimpleShared_1.txt"))).document;
  const right = parseSharedParameterBytes(readFileSync(join(root, "SimpleShared_2.txt"))).document;
  const merged = mergeSharedParameterDocuments([left, right]);
  const comparison = compareSharedParameterDocuments(left, right);
  assert.ok(merged.parameters.length >= Math.max(left.parameters.length, right.parameters.length));
  assert.equal(
    comparison.added.length + comparison.removed.length + comparison.unchanged +
      comparison.renamed.length + comparison.incompatibleDataTypes.length +
      comparison.movedGroups.length > 0,
    true,
  );
});

test("extracts both PNG and indexed-BMP DWG previews", () => {
  const png = extractDwgThumbnail(readFileSync(fixturePath("7-PS-66_R3.dwg")));
  assert.equal(png?.sourceType, "png");
  assert.deepEqual([png?.width, png?.height], [512, 204]);
  assert.deepEqual([...png!.data.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const bmp = extractDwgThumbnail(readFileSync(fixturePath("A1ANG-3.dwg")));
  assert.equal(bmp?.sourceType, "bmp");
  assert.deepEqual([bmp?.width, bmp?.height], [180, 99]);
  assert.deepEqual([...bmp!.data.slice(0, 2)], [0x42, 0x4d]);
});

test("loads, merges, searches, and explicitly assigns the bundled OmniClass editions", () => {
  const vanilla = parseOmniClassTaxonomy(
    readFileSync(new URL("../public/omniclass/OmniClassTaxonomy_Vanilla.txt", import.meta.url), "utf8"),
  );
  const foodService = parseOmniClassTaxonomy(
    readFileSync(
      new URL("../public/omniclass/OmniClassTaxonomy_FoodService.txt", import.meta.url),
      "utf8",
    ),
  );
  const merged = mergeOmniClassTaxonomies(vanilla, foodService);
  assert.deepEqual([vanilla.length, foodService.length, merged.length], [2_645, 6_898, 9_543]);
  assert.ok(searchOmniClassTaxonomy(merged, "retaining wall").length > 0);

  const family = parsePartAtomXml(`
    <entry xmlns="http://www.w3.org/2005/Atom" xmlns:A="urn:schemas-autodesk-com:partatom">
      <title>Classified family</title>
      <A:family><A:part><title>Type 1</title>
        <OmniClass_Number displayName="OmniClass Number">23.10.20.11</OmniClass_Number>
      </A:part></A:family>
    </entry>
  `);
  assert.equal(omniClassForPartAtom(family, merged)?.number, "23.10.20.11");
});

test("indexes the real RFA with its thumbnail and searchable family properties", async () => {
  const bytes = readFileSync(fixturePath("qf_hatco_hdw-2bn_cat.rfa"));
  const sourceFile = new File([bytes], "qf_hatco_hdw-2bn_cat.rfa") as unknown as globalThis.File;
  const catalogFile = new File(
    [",Voltage##ELECTRICAL_POTENTIAL##VOLTS\nHDW-2BN,120"],
    "qf_hatco_hdw-2bn_cat.txt",
  ) as unknown as globalThis.File;
  const index = await indexFamilyLibraryFiles([sourceFile, catalogFile]);
  assert.equal(index.errors.length, 0);
  assert.equal(index.catalogFiles, 1);
  assert.equal(index.entries[0]?.revitVersion, 2014);
  assert.equal(index.entries[0]?.manufacturer, "HATCO CORPORATION");
  assert.equal(index.entries[0]?.voltage, "120 V");
  assert.equal(index.entries[0]?.dimensions.Width, `1' - 8 19/32"`);
  assert.ok((index.entries[0]?.thumbnail?.size ?? 0) > 1_000);
  assert.equal(index.entries[0]?.typeCatalog?.types[0]?.name, "HDW-2BN");
  assert.equal(searchFamilyLibrary(index, "hatco").length, 1);
  const serialized = JSON.stringify(serializableFamilyLibraryIndex(index));
  assert.doesNotMatch(serialized, /sourceFile|thumbnail/);
});
