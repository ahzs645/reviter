import assert from "node:assert/strict";
import test from "node:test";

import { resolveFamilyTypeNames } from "../lib/reviter/family-type-names.ts";
import { resolveNameEntries, scanNameEntries } from "../lib/reviter/name-entries.ts";

/** One stored name entry: id, length, UTF-16 name, category. */
function entry(elementId: number, name: string, categoryId: number): number[] {
  const bytes = Buffer.alloc(8 + 4 + name.length * 2 + 8);
  bytes.writeBigUInt64LE(BigInt(elementId), 0);
  bytes.writeUInt32LE(name.length, 8);
  bytes.write(name, 12, "utf16le");
  bytes.writeBigInt64LE(BigInt(categoryId), 12 + name.length * 2);
  return [...bytes];
}

const DOORS = -2_000_023;
const WINDOWS = -2_000_014;

test("a page's name entries are read back from their category", () => {
  const page = Uint8Array.from([
    ...new Array(24).fill(0),
    ...entry(146_020, "0915 x 2134mm", DOORS),
    0x11, 0x22,
    ...entry(145_990, "M_Single-Flush", DOORS),
    ...entry(21_944, "Empty", -2_000_170),
    ...new Array(8).fill(0),
  ]);
  assert.deepEqual(scanNameEntries(page), [
    { elementId: 146_020, name: "0915 x 2134mm", categoryId: DOORS },
    { elementId: 145_990, name: "M_Single-Flush", categoryId: DOORS },
    { elementId: 21_944, name: "Empty", categoryId: -2_000_170 },
  ]);
  // Bytes that end like a category but hold no printable name are not one.
  const noise = Uint8Array.from([...new Array(24).fill(0), ...entry(7, "￿￿", DOORS)]);
  assert.deepEqual(scanNameEntries(noise), []);
});

test("an id whose entries disagree is not named", () => {
  const names = resolveNameEntries([
    { elementId: 1, name: "A", categoryId: DOORS },
    { elementId: 1, name: "A", categoryId: DOORS },
    { elementId: 2, name: "B", categoryId: DOORS },
    { elementId: 2, name: "C", categoryId: DOORS },
  ]);
  assert.deepEqual([...names.keys()], [1]);
});

test("an instance's type and family are the ids its records reference by name", () => {
  const names = resolveNameEntries([
    { elementId: 146_020, name: "0915 x 2134mm", categoryId: DOORS },
    { elementId: 145_990, name: "M_Single-Flush", categoryId: DOORS },
    { elementId: 147_000, name: "0610 x 1220mm", categoryId: WINDOWS },
  ]);
  const categories = new Map([[146_094, DOORS], [146_095, DOORS]]);
  const resolved = resolveFamilyTypeNames(
    new Map([
      // A door references its per-host symbol clone (no name), its master
      // symbol, a level and a window type of another category.
      [146_094, Uint32Array.from([300_001, 146_020, 311, 147_000])],
      // A door naming two door types claims neither.
      [146_095, Uint32Array.from([146_020, 145_990])],
    ]),
    new Map([[146_020, Uint32Array.from([145_990, 311])]]),
    names,
    (elementId) => categories.get(elementId),
  );
  assert.deepEqual(resolved.get(146_094), {
    typeId: 146_020,
    typeName: "0915 x 2134mm",
    familyId: 145_990,
    familyName: "M_Single-Flush",
  });
  assert.equal(resolved.has(146_095), false);
});
