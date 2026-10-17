import assert from "node:assert/strict";
import test from "node:test";
import {
  Rational,
  rational,
  type NativeRationalParts,
} from "../lib/reviter/native-rational-overlay.ts";
import { originalTwoFootStandingSquare } from "../lib/reviter/native-source-standing-footprint.ts";
import { exactClosedSourcePlanarContact } from "../lib/reviter/native-source-planar-slab-envelope.ts";
import {
  auditOriginalForeignEnvelopeStandingSquare,
  type OriginalNativeForeignEnvelopeCensus,
} from "../lib/reviter/native-source-foreign-envelope-census.ts";
const rectangle = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): NativeRationalParts => [
  [
    [
      [rational(x0), rational(y0)],
      [rational(x1), rational(y0)],
      [rational(x1), rational(y1)],
      [rational(x0), rational(y1)],
    ],
  ],
];
test("full standing caps retain enclosed obstacles, closed side contact and every positive gap", () => {
  const square = originalTwoFootStandingSquare([rational(0), rational(0)]);
  assert.equal(
    exactClosedSourcePlanarContact(square, rectangle(-0.01, -0.01, 0.01, 0.01)),
    true,
  );
  assert.equal(
    exactClosedSourcePlanarContact(square, rectangle(1, -0.1, 2, 0.1)),
    true,
  );
  assert.equal(
    exactClosedSourcePlanarContact(
      square,
      rectangle(1 + 2 ** -50, -0.1, 2, 0.1),
    ),
    false,
  );
});
test("a generated exact center retains its full width without IEEE coordinate rounding", () => {
  const x = new Rational(1n, 3n),
    square = originalTwoFootStandingSquare([x, rational(0)]),
    ring = square[0]![0]!;
  assert.equal(ring[0]![0].n, -2n);
  assert.equal(ring[0]![0].d, 3n);
  assert.equal(ring[1]![0].n, 4n);
  assert.equal(ring[1]![0].d, 3n);
});
test("caller-authored census data cannot issue a standing material result", () => {
  assert.throws(
    () =>
      auditOriginalForeignEnvelopeStandingSquare(
        {} as OriginalNativeForeignEnvelopeCensus,
        [rational(0), rational(0)],
        rational(0),
        6,
      ),
    /Untrusted/,
  );
});
