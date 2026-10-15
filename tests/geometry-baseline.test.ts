import assert from "node:assert/strict";
import test from "node:test";
import { compareGeometrySnapshot, geometrySnapshot } from "../scripts/lib/geometry-baseline.ts";
import { semanticAuditGeometryHash } from "../scripts/audit-rvt-semantic-integration.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";

test("comparison preserves the established baseline byte order and detects actual mesh changes", () => {
  const fixture = ifcExportFixture();
  const initial = geometrySnapshot(fixture);
  assert.equal(initial.geometryHash, semanticAuditGeometryHash(fixture));
  assert.ok(Object.values(compareGeometrySnapshot(initial, initial)).every(check => check.matches));
  fixture.meshes[0]!.positions[0] += 0.01;
  const changed = geometrySnapshot(fixture);
  const comparison = compareGeometrySnapshot(changed, initial);
  assert.equal(comparison.geometryHash!.matches, false);
  assert.equal(comparison.triangles!.matches, true);
  assert.equal(comparison.meshes!.matches, true);
  assert.equal(compareGeometrySnapshot(changed, {}).geometryHash!.matches, null);
});
