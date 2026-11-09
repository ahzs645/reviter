import assert from "node:assert/strict";
import test from "node:test";
import { compareIfcGlobalIds, semanticAuditGeometryHash, taggedIfcRoots } from "../scripts/audit-rvt-semantic-integration.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";

const A = "1G_I00WlX2MBQekqB04dFi";
const B = "1G_I00WlX2MBQekqB04dCi";
const wall = (id: number, guid: string, tag: string, entity = "IFCWALL") => `#${id}=${entity}('${guid}',#1,'O''Brien, Wall',$,$,#2,#3,'${tag}');`;

test("semantic comparison joins exact Tag text separately for product and type and reports differing classes", () => {
  const exported = wall(1, A, "10") + wall(2, B, "10", "IFCWALLTYPE") + wall(3, B, "20");
  const reference = wall(4, A, "10", "IFCWALLSTANDARDCASE") + wall(5, A, "10", "IFCWALLTYPE") + wall(6, B, "020");
  const report = compareIfcGlobalIds(exported, reference);
  assert.equal(report.matched, 1);
  assert.equal(report.mismatched, 1);
  assert.equal(report.outputOnly, 1);
  assert.equal(report.referenceOnly, 1);
  assert.deepEqual(report.byEntity["IFCWALLSTANDARDCASE -> IFCWALL"], { compared: 1, matched: 1, mismatched: 0 });
});

test("duplicate tags are excluded rather than selecting the convenient matching GlobalId", () => {
  const report = compareIfcGlobalIds(wall(1, A, "10"), wall(2, A, "10") + wall(3, B, "10"));
  assert.equal(report.ambiguousTags, 1);
  assert.equal(report.compared, 0);
});

test("numeric spatial LongName and property roots are not mistaken for element Tags", () => {
  assert.equal(taggedIfcRoots(wall(1, A, "10", "IFCSPACE") + wall(2, A, "11", "IFCPROPERTYSET")).length, 0);
});

test("mesh-byte baseline hash detects geometry, ownership and colour changes", () => {
  const source = ifcExportFixture();
  const before = semanticAuditGeometryHash(source);
  assert.equal(before, semanticAuditGeometryHash(structuredClone(source)));
  for (const key of ["positions", "indices", "colors", "elementIds"] as const) {
    const changed = structuredClone(source);
    changed.meshes[0]![key]![0] += 1;
    assert.notEqual(semanticAuditGeometryHash(changed), before, key);
  }
});
