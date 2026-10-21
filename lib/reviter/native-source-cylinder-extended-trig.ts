/** Exact bounded Taylor/Lagrange enclosure for finite original cylinder
 * parameters outside the older +/-8 reader range. The literal angle remains
 * unchanged. No period, nearest branch, floating sin/cos or tolerance is used. */
import { Rational, rational } from "./native-rational-overlay.ts";
type Q = Rational;
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q) => new Rational(a.n * b.d, a.d * b.n);

/** All real derivatives of sine/cosine have magnitude <=1. Therefore each
 * degree64 polynomial has error <= |literal angle|^65/65! on the complete
 * interval from zero to that angle. This is a mathematical remainder bound,
 * never a measured residual. The finite range is a resource bound only. */
export function originalExtendedCylinderTrigEnclosure(angle: number) {
  if (
    typeof angle !== "number" ||
    !Number.isFinite(angle) ||
    Math.abs(angle) > 16
  )
    throw new Error("Unsupported finite extended original cylinder angle");
  const x = rational(angle);
  let power = rational(1),
    factorial = 1n,
    sine = rational(0),
    cosine = rational(0);
  for (let n = 0; n <= 64; n++) {
    if (n) {
      power = mul(power, x);
      factorial *= BigInt(n);
    }
    const term = div(power, new Rational(factorial)),
      signed = Math.floor(n / 2) % 2 ? new Rational(-term.n, term.d) : term;
    if (n % 2) sine = add(sine, signed);
    else cosine = add(cosine, signed);
  }
  const next = mul(power, x),
    remainder = div(
      new Rational(next.n < 0n ? -next.n : next.n, next.d),
      new Rational(factorial * 65n),
    );
  return {
    sine: [sub(sine, remainder), add(sine, remainder)] as [Q, Q],
    cosine: [sub(cosine, remainder), add(cosine, remainder)] as [Q, Q],
    degree: 64 as const,
    exactLagrangeRemainder: remainder,
    originalAngle: x,
    originalAngleChanged: false as const,
    periodicReductionPerformed: false as const,
    sourceAuthorityGranted: false as const,
  };
}
