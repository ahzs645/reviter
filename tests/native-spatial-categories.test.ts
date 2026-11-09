import assert from "node:assert/strict";
import test from "node:test";
import { scanNativeSpatialCategoryHeaders } from "../lib/reviter/native-spatial-categories.ts";
function page() {
  const bytes = new Uint8Array(100), v = new DataView(bytes.buffer), at = 12, length = 54;
  v.setBigUint64(0, 12n, true); v.setUint32(8, length, true); v.setUint16(at, 1479, true); v.setUint32(at + 2, 0, true);
  v.setBigInt64(at + 6, -2003600n, true);
  for (let i = 1; i <= 5; i++) v.setBigInt64(at + 6 + i * 8, -1n, true);
  v.setUint32(at + length, length, true); return bytes;
}
test("file-local source owner, class tag and length echo bind a spatial category witness", () => {
  const rows = scanNativeSpatialCategoryHeaders(page(), 1479, new Set(["12"]), "Partitions/1", 1000);
  assert.deepEqual(rows, [{ elementId: "12", categoryId: -2003600, familyId: null, ownerViewId: null, stream: "Partitions/1", inflatedOffset: 1000 }]);
  assert.equal(scanNativeSpatialCategoryHeaders(page(), 1540, new Set(["12"]), "Partitions/1").length, 0);
  assert.equal(scanNativeSpatialCategoryHeaders(page(), 1479, new Set(["13"]), "Partitions/1").length, 0);
});
test("invalid length/echo, category, owner high word, count and negative family/view IDs refuse the header", () => {
  for (const change of [(v: DataView) => v.setUint32(8, 1000, true), (v: DataView) => v.setUint32(66, 55, true), (v: DataView) => v.setBigInt64(18, 1n, true), (v: DataView) => v.setUint32(4, 1, true), (v: DataView) => v.setUint32(14, 5000, true), (v: DataView) => v.setBigInt64(26, -2n, true), (v: DataView) => v.setBigInt64(34, -2n, true)]) {
    const b = page(); change(new DataView(b.buffer)); assert.equal(scanNativeSpatialCategoryHeaders(b, 1479, new Set(["12"]), "Partitions/1").length, 0);
  }
  for (let n = 0; n < 70; n++) assert.doesNotThrow(() => scanNativeSpatialCategoryHeaders(page().slice(0, n), 1479, new Set(["12"]), "Partitions/1"));
});
test("scan context refuses unbounded ids, invalid stream namespace and invalid offsets", () => {
  for (const tag of [-1, 0, 32768, 1.5, NaN]) assert.equal(scanNativeSpatialCategoryHeaders(page(), tag, new Set(["12"]), "Partitions/1").length, 0);
  assert.equal(scanNativeSpatialCategoryHeaders(page(), 1479, new Set(["12"]), "Embedded/Partitions/1").length, 0);
  assert.equal(scanNativeSpatialCategoryHeaders(page(), 1479, new Set(["12"]), "Partitions/1", -1).length, 0);
  assert.equal(scanNativeSpatialCategoryHeaders(page(), 1479, new Set(Array.from({length:4097},(_,i)=>String(i))), "Partitions/1").length, 0);
});
