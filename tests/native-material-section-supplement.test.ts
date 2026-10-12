import test from "node:test";
import assert from "node:assert/strict";
import { deriveNativeMaterialSectionSupplement, auditNativeMaterialSectionCensus } from "../lib/reviter/native-material-section-supplement-derive.ts";
import { nativeMaterialSectionSupplementHash, nativeMaterialSectionsWithSupplement, validateNativeMaterialSectionSupplement } from "../lib/reviter/native-material-section-supplement.ts";
import { createNativeRoutingMaterialQuery } from "../lib/reviter/native-routing-material.ts";
import { nativeDerivedFrameHash } from "../lib/reviter/native-derived-frame-returns.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

type P = [number, number];
const sha = "a".repeat(64);
/** Closed box mesh (12 triangles) owned by one element. */
function box(id: number, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, base: number) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7], [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7]];
  return { positions: v.flat(), indices: f.flat().map((i) => i + base), elementIds: f.map(() => id) };
}
const a = box(1, 0, 0, 10, 0.5, 0, 10, 0), b = box(2, 10, 0, 10.5, 8, 0, 10, 8);
const model = {
  origin: { x: 0, y: 0, z: 0 },
  elementBounds: [
    { elementId: 1, categoryId: -2000011, renderGeometryProvenance: "native", boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 0.5, z: 10 } } },
    { elementId: 2, categoryId: -2000011, renderGeometryProvenance: "native", boundsFeet: { min: { x: 10, y: 0, z: 0 }, max: { x: 10.5, y: 8, z: 10 } } },
    { elementId: 3, categoryId: -2000011, renderGeometryProvenance: "reconstructed", boundsFeet: { min: { x: 20, y: 0, z: 0 }, max: { x: 21, y: 1, z: 10 } } },
  ],
  meshes: [{ source: "native-brep", name: "walls", positions: [...a.positions, ...b.positions], indices: [...a.indices, ...b.indices], elementIds: [...a.elementIds, ...b.elementIds] }],
} as unknown as ConvertResult;
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function material(census: number[]) {
  const levels = [{ levelId: 7, elevationFeet: 0, cutElevationFeet: 4, evidenceSha256: "0".repeat(64), sourceElementIds: census,
    sections: [{ nativeElementId: 1, categoryId: -2000011, kind: "wall" as const, baseElevationFeet: 0, topElevationFeet: 10, partsFeet: [[rect(0, 0, 10, 0.5)]] }] }];
  const m = { version: 1 as const, sourceModelSha256: sha, geometrySha256: "", levels };
  m.geometrySha256 = nativeDerivedFrameHash([m.version, m.sourceModelSha256, m.levels]);
  return m as never;
}

test("audit lists native barrier owners whose mesh crosses a prepared cut without a section; the unchanged cutter supplies them", () => {
  const mat = material([1]);
  const audit = auditNativeMaterialSectionCensus(model, mat);
  assert.deepEqual(audit[0]!.missing.map((m) => [m.nativeElementId, m.censusOmission]), [[2, true]], "non-native provenance owner 3 is not material evidence");
  const { supplement, audit: full } = deriveNativeMaterialSectionSupplement(model, mat);
  assert.ok(supplement);
  assert.deepEqual(full[0]!.supplementedOwnerIds, [2]);
  const s = supplement!.levels[0]!.sections[0]!;
  assert.deepEqual(s.provenance, { kind: "production-native-mesh-cutter", reason: "census-omission" });
  assert.equal(s.partsFeet.length, 1);
  validateNativeMaterialSectionSupplement(supplement, mat, sha);
  // section omission (owner in census, no row) is labelled separately
  assert.equal(deriveNativeMaterialSectionSupplement(model, material([1, 2])).supplement!.levels[0]!.sections[0]!.provenance.reason, "section-omission");
  // nothing missing -> no supplement
  const complete = material([1, 2]) as any;
  complete.levels[0].sections.push({ nativeElementId: 2, categoryId: -2000011, kind: "wall", baseElevationFeet: 0, topElevationFeet: 10, partsFeet: [[rect(10, 0, 10.5, 8)]] });
  complete.geometrySha256 = nativeDerivedFrameHash([complete.version, complete.sourceModelSha256, complete.levels]);
  assert.equal(deriveNativeMaterialSectionSupplement(model, complete).supplement, undefined);
});

test("the supplement is bound to the unchanged original rows and merged only where material is read", () => {
  const mat = material([1]) as any;
  const before = JSON.stringify(mat);
  const { supplement } = deriveNativeMaterialSectionSupplement(model, mat);
  const merged = nativeMaterialSectionsWithSupplement(mat, supplement);
  assert.equal(JSON.stringify(mat), before, "original rows are not mutated");
  assert.deepEqual(merged.levels[0].sections.map((s: any) => s.nativeElementId), [1, 2]);
  const data = { source: { modelSha256: sha }, nativeMaterialSections: mat, nativeMaterialSectionSupplement: supplement };
  const q = createNativeRoutingMaterialQuery(data as never)(0, 4);
  assert.ok(q.present.has(2) && q.known.has(2));
  assert.ok(q.parts.some((p) => p.nativeElementId === 2));
  assert.equal(createNativeRoutingMaterialQuery({ ...data, nativeMaterialSectionSupplement: undefined } as never)(0, 4).present.has(2), false);
  // stale binding, tampering, replacing an original owner and wrong provenance are refused
  assert.throws(() => validateNativeMaterialSectionSupplement(supplement, { ...mat, geometrySha256: "b".repeat(64) }, sha), /stale|bound/);
  const tampered = structuredClone(supplement!); tampered.levels[0]!.sections[0]!.partsFeet = [[rect(10, 0, 11, 8)]];
  assert.throws(() => validateNativeMaterialSectionSupplement(tampered, mat, sha), /stale|bound/);
  const replacing = structuredClone(supplement!); replacing.levels[0]!.sections[0]!.nativeElementId = 1; replacing.geometrySha256 = nativeMaterialSectionSupplementHash(replacing);
  assert.throws(() => validateNativeMaterialSectionSupplement(replacing, mat, sha), /never replaced/);
  const relabelled = structuredClone(supplement!); relabelled.levels[0]!.sections[0]!.provenance.reason = "section-omission"; relabelled.geometrySha256 = nativeMaterialSectionSupplementHash(relabelled);
  assert.throws(() => validateNativeMaterialSectionSupplement(relabelled, mat, sha), /never replaced/);
});
