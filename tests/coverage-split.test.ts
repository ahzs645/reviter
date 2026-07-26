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

test("separates what was recovered from what is drawn", () => {
  // The distinction the single headline match rate hides: a class can be fully
  // matched by element id and still contribute nothing to the scene.
  const comparison = comparisonWith([
    typeRow("IFCWALLSTANDARDCASE", 4, [10, 11, 12, 13]),
    typeRow("IFCMEMBER", 3, [20, 21, 22]),
  ]);
  const rows = classCoverage(comparison, new Set([10, 11, 13]));
  assert.deepEqual(rows, [
    { ifcType: "WALLSTANDARDCASE", inExport: 4, recovered: 4, drawn: 3 },
    { ifcType: "MEMBER", inExport: 3, recovered: 3, drawn: 0 },
  ]);
});

test("orders by how much of the class the export holds, and keeps empty classes", () => {
  // A class nothing was recovered for is the most useful row on the table, so
  // it has to survive the filter rather than be tidied away.
  const comparison = comparisonWith([
    typeRow("IFCDOOR", 2, [30]),
    typeRow("IFCCURTAINWALL", 9, []),
  ]);
  const rows = classCoverage(comparison, new Set([30]));
  assert.deepEqual(rows.map((row) => row.ifcType), ["CURTAINWALL", "DOOR"]);
  assert.deepEqual(rows[0], { ifcType: "CURTAINWALL", inExport: 9, recovered: 0, drawn: 0 });
});

test("reports no drawn count rather than a wrong one when ids are absent", () => {
  // Older analyses carry no matched ids; showing 0 there would read as a gap
  // that does not exist.
  const rows = classCoverage(comparisonWith([typeRow("IFCSLAB", 5, undefined)]), new Set([1]));
  assert.equal(rows[0]!.recovered, 0);
  assert.equal(rows[0]!.drawn, null);
});
