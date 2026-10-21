import assert from "node:assert/strict";
import test from "node:test";
import { originalExtendedCylinderTrigEnclosure } from "../lib/reviter/native-source-cylinder-extended-trig.ts";
import { originalCylinderTrigEnclosure } from "../lib/reviter/native-source-floor-local-support.ts";
import { Rational } from "../lib/reviter/native-rational-overlay.ts";
const compare = (a: Rational, b: Rational) => a.n * b.d - b.n * a.d;
const decimal = (s: string) => {
  const [whole, fraction = ""] = s.split(".");
  return new Rational(
    BigInt(`${whole}${fraction}`),
    10n ** BigInt(fraction.length),
  );
};
test("literal original floor angles are enclosed without inferring a periodic branch", () => {
  // Independent 100-digit mpmath evaluation of each exact binary64 input,
  // rounded to these decimal interior witnesses; not used by the constructor.
  for (const [angle, sine, cosine] of [
    [
      8.115471558799745,
      "0.9660058749471165332884627655464353162991161374224354210013373960614847243958941971251",
      "-0.2585201144353294882794214091785110179686481006197731431869659036237356057483143918497",
    ],
    [
      10.819998297638094,
      "-0.9846260910285605628666993875539439282041465650389881558133900125884014646557552182474",
      "-0.1746753012472477983411543581239383608535807860616742921933360892113046774518264171117",
    ],
    [
      16,
      "-0.2879033166650652947844562482186175296207039006514114714514476020099932546488109183278",
      "-0.9576594803233846418996372326511034717803339959537157326591938660629108986841354078975",
    ],
  ] as const) {
    const r = originalExtendedCylinderTrigEnclosure(angle);
    for (const [bounds, oracle] of [
      [r.sine, sine],
      [r.cosine, cosine],
    ] as const) {
      assert(compare(bounds[0], decimal(oracle)) < 0n);
      assert(compare(bounds[1], decimal(oracle)) > 0n);
    }
    assert.equal(r.degree, 64);
    assert.equal(r.originalAngleChanged, false);
    assert.equal(r.periodicReductionPerformed, false);
    assert.equal(r.sourceAuthorityGranted, false);
  }
});
test("the higher order enclosure is contained in the retained old low-angle conservative bound", () => {
  for (const angle of [-8, -4.125, -0.5, 0, 0.5, 4.125, 8]) {
    const old = originalCylinderTrigEnclosure(angle),
      extended = originalExtendedCylinderTrigEnclosure(angle);
    for (const key of ["sine", "cosine"] as const) {
      assert(compare(extended[key][0], old[key][0]) >= 0n);
      assert(compare(extended[key][1], old[key][1]) <= 0n);
    }
  }
});
test("nonfinite, missing, out-of-budget and periodic-equivalent requests remain refused", () => {
  for (const angle of [NaN, Infinity, -Infinity, 16.01, -16.01, 1000])
    assert.throws(
      () => originalExtendedCylinderTrigEnclosure(angle),
      /Unsupported finite/,
    );
});
