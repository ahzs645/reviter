import assert from "node:assert/strict";
import test from "node:test";

import { classCoverage } from "../lib/reviter/coverage.ts";
import type { IfcElementTypeMatch, PairedRegressionResult } from "../lib/reviter/types.ts";

function comparisonWith(elementTypes: IfcElementTypeMatch[]): PairedRegressionResult {
  return { reference: { elementTypes } } as unknown as PairedRegressionResult;
}

function typeRow(
  ifcType: string,
  count: number,
  matchedIds: number[] | undefined,
): IfcElementTypeMatch {
  return {
    ifcType,
    count,
    tagged: count,
    matchedRvtRecords: matchedIds?.length ?? 0,
    matchedElemTable: 0,
    matchedPartitionRecords: matchedIds?.length ?? 0,
    matchedIds: matchedIds ? Uint32Array.from(matchedIds) : undefined,
  };
}

test("separates seen from recovered from drawn", () => {
  // The distinction the single headline match rate hides: a class can be seen
  // in full, recovered in part, and drawn less than that again — and the three
  // gaps have different fixes behind them.
  const comparison = comparisonWith([
    typeRow("IFCWALLSTANDARDCASE", 5, [10, 11, 12, 13]),
    typeRow("IFCMEMBER", 3, [20, 21, 22]),
  ]);
  const rows = classCoverage(comparison, new Set([10, 11, 13, 20]), new Set([10, 11]));
  assert.deepEqual(rows, [
    { ifcType: "WALLSTANDARDCASE", inExport: 5, seen: 4, recovered: 3, drawn: 2 },
    { ifcType: "MEMBER", inExport: 3, seen: 3, recovered: 1, drawn: 0 },
  ]);
});

test("orders by how much of the class the export holds, and keeps empty classes", () => {
  // A class nothing was recovered for is the most useful row on the table, so
  // it has to survive the filter rather than be tidied away.
  const comparison = comparisonWith([
    typeRow("IFCDOOR", 2, [30]),
    typeRow("IFCCURTAINWALL", 9, []),
  ]);
  const rows = classCoverage(comparison, new Set([30]), new Set([30]));
  assert.deepEqual(rows.map((row) => row.ifcType), ["CURTAINWALL", "DOOR"]);
  assert.deepEqual(rows[0], { ifcType: "CURTAINWALL", inExport: 9, seen: 0, recovered: 0, drawn: 0 });
});

test("leaves out classes that carry no Revit id to join on", () => {
  // Storeys, the site and the building itself are exported without a Tag, so
  // nothing can be matched to them; a 0-of-13 row would read as a decoder gap.
  const comparison = comparisonWith([
    { ...typeRow("IFCBUILDINGSTOREY", 13, []), tagged: 0 },
    typeRow("IFCSLAB", 4, [40, 41]),
  ]);
  const rows = classCoverage(comparison, new Set([40, 41]), new Set([40]));
  assert.deepEqual(rows.map((row) => row.ifcType), ["SLAB"]);
});

test("reports no recovered or drawn count rather than a wrong one when ids are absent", () => {
  // Older analyses carry no matched ids; showing 0 there would read as a gap
  // that does not exist. The seen count still comes straight off the row.
  const rows = classCoverage(
    comparisonWith([{ ...typeRow("IFCSLAB", 5, undefined), matchedRvtRecords: 4 }]),
    new Set([1]),
    new Set([1]),
  );
  assert.equal(rows[0]!.seen, 4);
  assert.equal(rows[0]!.recovered, null);
  assert.equal(rows[0]!.drawn, null);
});
