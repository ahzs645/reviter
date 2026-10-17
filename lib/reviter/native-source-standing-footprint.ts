/** Pure stated body envelope; no source support, graph or route authority. */
import {
  Rational,
  type NativeRationalPoint,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
export function originalTwoFootStandingSquare(
  center: NativeRationalPoint,
): NativeRationalParts {
  if (center.length !== 2 || center.some((q) => !(q instanceof Rational)))
    throw Error("Invalid exact standing center");
  const shift = (q: Rational, direction: -1 | 1) =>
      new Rational(q.n + BigInt(direction) * q.d, q.d),
    [x, y] = center;
  return [
    [
      [
        [shift(x, -1), shift(y, -1)],
        [shift(x, 1), shift(y, -1)],
        [shift(x, 1), shift(y, 1)],
        [shift(x, -1), shift(y, 1)],
      ],
    ],
  ];
}
