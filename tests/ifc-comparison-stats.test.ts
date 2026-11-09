import assert from "node:assert/strict";
import test from "node:test";
import { compareIfcIdentities, inventoryIfc, stepArguments, stepRecords } from "../scripts/lib/ifc-comparison-stats.ts";

const A = "0ABCDEFGHIJKLMNOPQRSTU", B = "1ABCDEFGHIJKLMNOPQRSTU";
const wrap = (records: string) => `ISO-10303-21; HEADER; FILE_SCHEMA(('IFC4')); ENDSEC; DATA; ${records} ENDSEC; END-ISO-10303-21;`;

test("STEP comparison inventory distinguishes instances, roots, elements and identity joins", () => {
  const text = wrap(`
    #1=IFCPROJECT('${A}',$,'Model',$,$,$,$,$,$);
    #2=IFCWALL('${B}',$,'Wall',$,$,#10,#20,'101',.STANDARD.);
    #3=IFCWALLTYPE('${A}',$,'Type',$,$,$,$,$,$,.STANDARD.);
    #4=IFCSHAPEREPRESENTATION(#5,'Body','Tessellation',(#6));
    #6=IFCTRIANGULATEDFACESET(#7,$,.T.,((1,2,3)),$);
    #8=IFCPROPERTYSINGLEVALUE('BodySource',$,IFCLABEL('partition_element_record_bbox'),$);
    #9=IFCPROPERTYSET('2ABCDEFGHIJKLMNOPQRSTU',$,'Pset_WallCommon',$,(#8));
  `);
  const stats = inventoryIfc(text);
  assert.equal(stats.totalInstances, 7);
  assert.equal(stats.roots, 4);
  assert.equal(stats.products, 1);
  assert.equal(stats.taggedElements, 1);
  assert.equal(stats.productsWithRepresentation, 1);
  assert.deepEqual(stats.duplicateRootGlobalIds, [A]);
  assert.deepEqual(stats.geometryEntities, { IFCTRIANGULATEDFACESET: 1 });
  assert.deepEqual(stats.representationTypes, { Tessellation: 1 });
  assert.deepEqual(stats.propertySets, { Pset_WallCommon: 1 });
  assert.deepEqual(stats.bodySources, { partition_element_record_bbox: 1 });
  const subset = inventoryIfc(wrap(`#42=IFCWALL('${B}',$,'Same source',$,$,$,$,'101',.STANDARD.);`));
  const comparison = compareIfcIdentities(stats, subset);
  assert.equal(comparison.sharedProductGlobalIds, 1);
  assert.equal(comparison.sharedTaggedElementIds, 1);
});

test("strings, escaped quotes, comments and nested tuples cannot invent STEP entities", () => {
  const text = wrap(`/* #99=IFCWALL('${A}'); */
    #1=IFCWALL( '${B}',$,'Text with ''; #98=IFCDOOR(''fake''); and (comma,)', $,$,$,$,'123',.STANDARD.);
    #2=IFCPROPERTYSINGLEVALUE('Label',$,IFCTEXT('multi\nline, #97=IFCWINDOW();'),$);
  `);
  const stats = inventoryIfc(text);
  assert.equal(stats.totalInstances, 2);
  assert.equal(stats.products, 1);
  assert.equal(stats.classes.IFCDOOR, undefined);
  assert.deepEqual(stepArguments("'a,b', (1,(2,3)),IFCTEXT('x''y'),$"), ["'a,b'", "(1,(2,3))", "IFCTEXT('x''y')", "$"]);
  assert.deepEqual([...stepRecords(text)].map(record => record.id), [1, 2]);
});

test("malformed STEP is refused and non-element spatial attributes cannot become tags", () => {
  assert.throws(() => inventoryIfc("plain text"), /ISO-10303-21/);
  assert.throws(() => inventoryIfc(wrap("#1=IFCWALL('unterminated);")), /Unterminated STEP/);
  assert.throws(() => inventoryIfc(wrap("#1=IFCWALL($)")), /Missing STEP/);
  const stats = inventoryIfc(wrap(`#1=IFCSPACE('${A}',$,'Room',$,$,#2,$,'987',.ELEMENT.,.NOTDEFINED.,$);`));
  assert.equal(stats.products, 1);
  assert.deepEqual(stats.elementIds, []);
});
