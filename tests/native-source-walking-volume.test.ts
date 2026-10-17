import assert from "node:assert/strict";
import test from "node:test";
import { projectStatedTwoFootWalkingVolume } from "../lib/reviter/native-source-walking-volume.ts";
import { exactClosedSourcePlanarContact } from "../lib/reviter/native-source-planar-slab-envelope.ts";
import {
  Rational,
  rational,
  type NativeRationalParts,
} from "../lib/reviter/native-rational-overlay.ts";
const rect = (
  a: number,
  b: number,
  c: number,
  d: number,
): NativeRationalParts => [
  [
    [
      [a, b],
      [c, b],
      [c, d],
      [a, d],
    ].map(
      (p) =>
        p.map(rational) as [
          ReturnType<typeof rational>,
          ReturnType<typeof rational>,
        ],
    ),
  ],
];
test("every stated direction encloses a full exact two-foot body width", () => {
  for (const end of [
    [3, 4, 0],
    [1, 1, 1],
    [0.1, 0.3, 2],
    [-190.333, 79.155, 9],
    [0, 3, 0],
    [1e-10, 0, 0],
  ] as [number, number, number][]) {
    const result = projectStatedTwoFootWalkingVolume(
      [0, 0, 0],
      end,
      rational(-1),
      rational(10),
      6,
    );
    assert.ok(result.normalSquaredExact.n >= result.normalSquaredExact.d);
    assert.equal(result.positiveProjectionArea, true);
    assert.equal(result.sourceWalkingAuthorityGranted, false);
  }
});
test("generated rational coordinates remain exact through the conservative walking projection", () => {
  const third = new Rational(1n, 3n),
    seventh = new Rational(1n, 7n),
    height = new Rational(5n, 9n);
  const result = projectStatedTwoFootWalkingVolume(
    [third, seventh, height],
    [new Rational(2n, 3n), new Rational(5n, 7n), new Rational(10n, 9n)],
    rational(0),
    rational(4),
    6,
  );
  assert.equal(result.positiveProjectionArea, true);
  assert.ok(result.normalSquaredExact.n >= result.normalSquaredExact.d);
  assert.equal(third.n, 1n);
  assert.equal(third.d, 3n);
  assert.equal(height.n, 5n);
  assert.equal(height.d, 9n);
});
test("raised two-inch material and exact head tangency remain body contacts", () => {
  for (const band of [
    [2 / 12, 0.25],
    [6, 6],
  ] as [number, number][]) {
    const demand = projectStatedTwoFootWalkingVolume(
      [0, 0, 0],
      [2, 0, 0],
      rational(band[0]),
      rational(band[1]),
      6,
    );
    assert.equal(demand.positiveProjectionArea, true);
    assert.equal(
      exactClosedSourcePlanarContact(
        [[demand.possibleClosedProjectionFeet]],
        rect(0.5, -0.5, 1.5, 0.5),
      ),
      true,
    );
  }
  assert.equal(
    projectStatedTwoFootWalkingVolume(
      [0, 0, 0],
      [2, 0, 0],
      rational(6 + 2 ** -49),
      rational(7),
      6,
    ).possibleClosedProjectionFeet.length,
    0,
  );
});
test("sloping walking feet use both exact finite material height bounds", () => {
  const result = projectStatedTwoFootWalkingVolume(
    [0, 0, 0],
    [4, 0, 4],
    rational(2),
    rational(3),
    1,
  );
  assert.equal(result.positiveProjectionArea, true);
  const parts: NativeRationalParts = [[result.possibleClosedProjectionFeet]];
  assert.equal(
    exactClosedSourcePlanarContact(parts, rect(0, -0.5, 0.5, 0.5)),
    false,
  );
  assert.equal(
    exactClosedSourcePlanarContact(parts, rect(1.5, -0.5, 2.5, 0.5)),
    true,
  );
  assert.equal(
    exactClosedSourcePlanarContact(parts, rect(3.5, -0.5, 4, 0.5)),
    false,
  );
});
test("vertical, nonfinite and invalid material intervals refuse rather than yield clear", () => {
  assert.throws(
    () =>
      projectStatedTwoFootWalkingVolume(
        [0, 0, 0],
        [0, 0, 1],
        rational(0),
        rational(1),
        6,
      ),
    /Unsupported/,
  );
  assert.throws(
    () =>
      projectStatedTwoFootWalkingVolume(
        [0, 0, 0],
        [1, NaN, 1],
        rational(0),
        rational(1),
        6,
      ),
    /Invalid/,
  );
  assert.throws(
    () =>
      projectStatedTwoFootWalkingVolume(
        [0, 0, 0],
        [1, 0, 1],
        rational(2),
        rational(1),
        6,
      ),
    /Invalid/,
  );
});
