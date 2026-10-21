import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  inspectFilledThresholdStepGeometry,
  filledThresholdDemandFitsSourceScope,
  inspectFilledThresholdStepFloorSupport,
  auditOriginalFilledThresholdDemand,
  filledThresholdEnvelopeDisjointFromDemand,
  type OriginalFilledThresholdDemand,
} from "../lib/reviter/native-filled-threshold-step.ts";
import {
  rational,
  Rational,
  type NativeRationalParts,
} from "../lib/reviter/native-rational-overlay.ts";
import type { OriginalNativeForeignEnvelopeCensus } from "../lib/reviter/native-source-foreign-envelope-census.ts";
const frame = (id: number) => {
  const bytes = readFileSync(
    new URL(`./fixtures/native-filled-threshold-${id}.bin`, import.meta.url),
  );
  return {
    bytes,
    nativeElementId: id,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
const from = [
    35.53982462700122, 528.5495338272797, 24.278215223097114,
  ] as const,
  to = [28.8971, 528.5495338272798, 24.278215223097114] as const;
const geometry = (reverse = false) =>
  inspectFilledThresholdStepGeometry({
    placed: frame(2315423),
    definition: frame(1223587),
    fromFeet: reverse ? to : from,
    toFeet: reverse ? from : to,
  });
test("source envelope refinement checks every standing interior and closed side/head contact", () => {
  const r = geometry();
  assert.ok(r.ok);
  const q = (ps: number[]) => ps.map(rational),
    height = Number(r.topElevationFeet!.n) / Number(r.topElevationFeet!.d) + 6;
  // This small source enclosure is far beyond the crossing itself but inside
  // the far endpoint standing interior: it must not be discarded.
  assert.equal(
    filledThresholdEnvelopeDisjointFromDemand(
      r,
      q([36, 528.5, 25]),
      q([36.1, 528.6, 26]),
    ),
    false,
  );
  assert.equal(
    filledThresholdEnvelopeDisjointFromDemand(
      r,
      q([36, 532, 25]),
      q([36.1, 533, 26]),
    ),
    true,
  );
  assert.equal(
    filledThresholdEnvelopeDisjointFromDemand(
      r,
      q([30, 528.5, 25]),
      q([30, 528.6, 26]),
    ),
    false,
  );
  const high = new Rational(
    r.topElevationFeet!.n + 6n * r.topElevationFeet!.d,
    r.topElevationFeet!.d,
  );
  assert.equal(
    filledThresholdEnvelopeDisjointFromDemand(
      r,
      [rational(30), rational(528.5), high],
      [rational(30), rational(528.6), high],
    ),
    false,
  );
  assert.equal(
    filledThresholdEnvelopeDisjointFromDemand(
      r,
      q([30, 528.5, height + 1]),
      q([30, 528.6, height + 2]),
    ),
    true,
  );
  assert.throws(
    () =>
      filledThresholdEnvelopeDisjointFromDemand(
        r,
        q([36, 533, 25]),
        q([35, 532, 24]),
      ),
    /Invalid/,
  );
});
const box = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): NativeRationalParts => [
  [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map((p) => [rational(p[0]!), rational(p[1]!)]),
  ],
];
test("actual original filled 50 mm sill partitions both approaches, cap and two oblique full-width risers bidirectionally", () => {
  for (const reverse of [false, true]) {
    const r = geometry(reverse);
    assert.ok(r.ok, r.blockers.join("; "));
    assert.equal(r.risers.length, 2);
    assert.equal(r.capWalkingPartsFeet.length, 1);
    assert.equal(r.floorWalkingPartsFeet.length, 2);
    assert.equal(r.standingSquaresFeet.length, 2);
    assert.equal(r.statedWidthFeet, 2);
    assert.equal(r.statedHeadroomFeet, 6);
    assert.equal(r.exactOriginalBodyUsed, true);
    assert.equal(r.walkingClearanceApproved, false);
    assert.equal(r.routeApproved, false);
    assert.equal(r.wheelchairApproved, false);
    // Tiny original affine terms and oblique approach are retained. The two
    // outer tracks cross at distinct parameters; no averaged straight riser.
    assert.notDeepEqual(
      r.risers[0]!.outerTrackParameters[0],
      r.risers[0]!.outerTrackParameters[1],
    );
    assert.deepEqual(
      [r.riseFeet!.n.toString(), r.riseFeet!.d.toString()],
      ["92347433304021", "562949953421312"],
    );
  }
});
test("complete floor and standing interiors are required; a hole under a standing interior or the sill remains a veto", () => {
  const r = geometry();
  assert.ok(r.ok);
  const floor = box(20, 520, 40, 540),
    check = (parts: NativeRationalParts) =>
      inspectFilledThresholdStepFloorSupport(r, {
        elevationFeet: r.floorElevationFeet!,
        guaranteedInnerPartsFeet: parts,
      });
  assert.equal(check(floor).ok, true);
  for (const hole of [
    box(35.3, 528.3, 35.7, 528.7),
    box(30.5, 528.3, 30.7, 528.7),
    box(28.6, 528.3, 29, 528.7),
  ]) {
    const p = floor.map((part) => [...part]);
    p[0]!.push(hole[0]![0]!.toReversed());
    const out = check(p);
    assert.equal(out.ok, false);
    if (!out.ok) assert.ok(out.residual.length);
  }
  assert.equal(
    inspectFilledThresholdStepFloorSupport(r, {
      elevationFeet: new Rational(
        r.floorElevationFeet!.n + 1n,
        r.floorElevationFeet!.d,
      ),
      guaranteedInnerPartsFeet: floor,
    }).ok,
    false,
  );
});
test("raised floor, tangent/partial-width body crossing, endpoint standing on the sill and mismatched original definition refuse", () => {
  const base = {
    placed: frame(2315423),
    definition: frame(1223587),
    fromFeet: from,
    toFeet: to,
  };
  for (const change of [
    { fromFeet: [from[0], from[1], from[2] + 0.000001] as const },
    {
      fromFeet: [from[0], 530.2, from[2]] as const,
      toFeet: [to[0], 530.2, to[2]] as const,
    },
    { fromFeet: [31.1, 528.55, from[2]] as const },
    { definition: frame(1439914) },
  ])
    assert.equal(
      inspectFilledThresholdStepGeometry({ ...base, ...change }).ok,
      false,
    );
  assert.throws(
    () =>
      auditOriginalFilledThresholdDemand(
        {} as OriginalNativeForeignEnvelopeCensus,
        {} as OriginalFilledThresholdDemand,
      ),
    /Untrusted/,
  );
});

test("the entire source scope must enclose standing interiors and the highest six-foot cap demand", () => {
  const r = geometry();
  assert.ok(r.ok);
  const scope = {
    min: { x: 26.8971, y: 526.5495338272797, z: 23.778215223097114 },
    max: { x: 37.53982462700122, y: 530.5495338272798, z: 32.27821522309711 },
  };
  assert.equal(filledThresholdDemandFitsSourceScope(r, scope), true);
  for (const changed of [
    { ...scope, max: { ...scope.max, x: 35.6 } },
    { ...scope, max: { ...scope.max, z: 30.3 } },
    { ...scope, min: { ...scope.min, y: 528 } },
  ])
    assert.equal(filledThresholdDemandFitsSourceScope(r, changed), false);
});
