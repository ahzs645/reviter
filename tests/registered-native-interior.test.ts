import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registeredNativeInterior } from "../lib/reviter/registered-native-interior.ts";
import type pc from "polygon-clipping";
type Point = [number, number];
const box = (x: number, y: number, w: number, h: number): Point[][] => [
  [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
];
test("a tiny marginal native-clipping pocket cannot erase the labelled room or its hole", () => {
  const main = [...box(0, 1, 10, 9), ...box(4, 4, 1, 1)],
    fragment = box(0, 0, 3, 0.3);
  const parts = [main, fragment],
    before = JSON.stringify(parts),
    result = registeredNativeInterior(parts, [2, 2], box(0, 0, 10, 10)[0]!);
  assert.deepEqual(result?.ringsFeet, main);
  assert.equal(result?.omittedEdgeFragments.length, 1);
  assert.equal(JSON.stringify(parts), before);
});
test("substantive splits, deep islands, missing labels and competing labels cannot be hidden", () => {
  const main = box(0, 1, 10, 9),
    shell = box(0, 0, 10, 10)[0]!;
  assert.equal(
    registeredNativeInterior([main, box(0, 0, 10, 0.3)], [2, 2], shell),
    undefined,
  );
  assert.equal(
    registeredNativeInterior([main, box(4, 4, 0.3, 0.3)], [2, 2], shell),
    undefined,
  );
  assert.equal(
    registeredNativeInterior([main, box(0, 0, 3, 0.3)], [20, 20], shell),
    undefined,
  );
  assert.equal(
    registeredNativeInterior([main, box(0, 0, 3, 0.3)], [2, 2], shell, [
      [1, 0.1],
    ]),
    undefined,
  );
});
test("actual UNBC Sim and Research clipping pockets are marginal; a divided06-342 remains unresolved", () => {
  const cases = JSON.parse(
    readFileSync(
      new URL("./fixtures/unbc-native-edge-fragments.json", import.meta.url),
      "utf8",
    ),
  ) as {
    number: string;
    label: Point;
    cell: Point[][];
    parts: { rings: Point[][]; area: number }[];
  }[];
  for (const item of cases) {
    const result = registeredNativeInterior(
      item.parts.map((p) => p.rings) as pc.MultiPolygon,
      item.label,
      item.cell[0]!,
    );
    if (item.number === "06-342") assert.equal(result, undefined);
    else {
      assert.ok(result, item.number);
      assert.equal(result.omittedEdgeFragments.length, 1);
      assert.ok(result.omittedSquareFeet < 2);
      assert.deepEqual(result.ringsFeet, item.parts[0]!.rings);
    }
  }
});
