import assert from "node:assert/strict";
import test from "node:test";
import pc from "polygon-clipping";
import { createPolygonBoundsQuery } from "../lib/reviter/polygon-bounds-query.ts";

type Parts = [number, number][][][];
const rect = (a: number, b: number, c: number, d: number): Parts => [
  [
    [
      [a, b],
      [c, b],
      [c, d],
      [a, d],
      [a, b],
    ],
  ],
];

test("bounds reject only strictly separated polygons, retaining contacts and tiny overlaps", () => {
  const meet = createPolygonBoundsQuery();
  assert(!meet(rect(-5, -5, -2, -2), rect(0, 0, 1, 1)));
  assert(meet(rect(0, 0, 1, 1), rect(1, 1, 2, 2)));
  assert(meet(rect(0, 0, 1, 1), rect(1 - Number.EPSILON, 0, 2, 1)));
  assert(
    meet(
      rect(1e12, 1e12, 1e12 + 1, 1e12 + 1),
      rect(1e12 + 1, 1e12, 1e12 + 2, 1e12 + 1),
    ),
  );
});

test("disconnected parts and holes remain conservative, with identical exact intersections", () => {
  const target = rect(0, 0, 10, 10);
  target[0].push(rect(2, 2, 8, 8)[0][0]);
  const masks = [
    rect(3, 3, 4, 4),
    rect(9, 9, 11, 11),
    [...rect(-20, -20, -10, -10), ...rect(20, 20, 30, 30)],
  ];
  for (let i = 0; i < 100; i++)
    masks.push(rect(100 + i * 2, 100, 101 + i * 2, 101));
  const snapshot = JSON.stringify([target, masks]);
  const meet = createPolygonBoundsQuery();
  let calls = 0;
  for (const mask of masks) {
    const expected = pc.intersection(target, mask);
    const actual = meet(target, mask)
      ? (calls++, pc.intersection(target, mask))
      : [];
    assert.deepEqual(actual, expected);
  }
  assert.equal(
    calls,
    3,
    "exact checks retained for the hole and disconnected bounds",
  );
  assert.equal(JSON.stringify([target, masks]), snapshot);
});

test("invalid input fails open so the geometry kernel still validates it", () => {
  const meet = createPolygonBoundsQuery(),
    other = rect(50, 50, 60, 60);
  for (const invalid of [
    [],
    [[]],
    [[[]]],
    [
      [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    ],
    rect(Number.NaN, 0, 1, 1),
    rect(Infinity, 0, 1, 1),
    [[[[0], [1, 1], [0, 1]]]],
  ]) {
    assert(meet(invalid, other));
    assert(meet(other, invalid));
  }
});

test("a new read-only operation rechecks source geometry edited in place", () => {
  const a = rect(0, 0, 1, 1),
    b = rect(2, 2, 3, 3);
  assert(!createPolygonBoundsQuery()(a, b));
  for (const point of b[0][0]) {
    point[0] -= 2;
    point[1] -= 2;
  }
  assert(createPolygonBoundsQuery()(a, b));
});
