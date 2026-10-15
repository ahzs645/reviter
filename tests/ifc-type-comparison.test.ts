import assert from "node:assert/strict";
import test from "node:test";
import { compareIfcTypeGlobalIds } from "../scripts/lib/ifc-type-comparison.ts";
const A = "1G_I00WlX2MBQekqB04dFi", B = "1G_I00WlX2MBQekqB04dCi";
const doc = (first: string, second: string, typeEntity = "IFCDOORTYPE") => `
  #1=IFCDOOR('${A}',#10,'Door', $,$,#20,#30,'123',.DOOR.,$,$);
  #2=IFCDOOR('${B}',#10,'Door', $,$,#20,#30,'124',.DOOR.,$,$);
  #3=${typeEntity}('${first}',#10,'Type', $,$,$,$,'20',$,.DOOR.,$,$,$);
  #4=${typeEntity}('${second}',#10,'Type', $,$,$,$,'20',$,.DOOR.,$,$,$);
  #5=IFCRELDEFINESBYTYPE('${A}',#10,$,$,(#1),#3);
  #6=IFCRELDEFINESBYTYPE('${B}',#10,$,$,(#2),#4);`;

test("type comparison follows actual product relationships despite repeated native type Tags", () => {
  const report = compareIfcTypeGlobalIds(doc(A, B), doc(A, A, "IFCDOORSTYLE"));
  assert.equal(report.compared, 2);
  assert.equal(report.matched, 1);
  assert.equal(report.mismatched, 1);
  assert.equal(report.ambiguous, 0);
  assert.deepEqual(report.byEntity["IFCDOORSTYLE -> IFCDOORTYPE"], { compared: 2, matched: 1, mismatched: 1 });
});

test("ambiguous product type relations are excluded, and IFC-looking quoted text cannot create matches", () => {
  const ambiguous = doc(A, B) + `#7=IFCRELDEFINESBYTYPE('${A}',#10,$,$,(#1),#4);`;
  const result = compareIfcTypeGlobalIds(ambiguous, doc(A, B));
  assert.equal(result.ambiguous, 1);
  assert.equal(result.compared, 1);
  const onlyText = `#9=IFCPROPERTYSINGLEVALUE('Text',$,IFCTEXT('#1=IFCDOOR(''${A}'',#10,$,$,$,$,$,''123'');'),$);`;
  assert.equal(compareIfcTypeGlobalIds(onlyText, doc(A, B)).compared, 0);
});
