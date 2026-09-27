import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRevit2027ProfileCurve,
  revit2027ProfileCurve,
} from "../lib/reviter/revit-2027-curve-evaluator.ts";
import { REVIT_2027_GARC_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-garc.ts";
import { REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-gcylindrical-helix.ts";
import { REVIT_2027_GELLIPSE_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-gellipse.ts";
import { REVIT_2027_GLINE_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-gline.ts";

const gInfo = { gStyleElementId: -1n, tag: -1, controlCommand: 0, flags: 0 };
const common = { byteOffset: 0, endOffset: 1, gInfo, endParameters: [0.2, 1.4] as const };

const curves = [
  [REVIT_2027_GLINE_SOURCE_CLASS_SLOT, { ...common, origin: [1, 2, 3], direction: [0.6, 0, 0.8] }],
  [REVIT_2027_GARC_SOURCE_CLASS_SLOT, {
    ...common, center: [1, 0, 2], xDirection: [1, 0, 0], yDirection: [0, 0, 1], radius: 0.5, isFilled: false,
  }],
  [REVIT_2027_GELLIPSE_SOURCE_CLASS_SLOT, {
    ...common, center: [0, 0, 1], xDirection: [0, 0, 1], yDirection: [-1, 0, 0], xRadius: 2, yRadius: 0.5,
  }],
  [REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT, {
    ...common, radius: 1.5, pitchOver2Pi: 0.25, basePoint: [0, 0, 0],
    xVector: [1, 0, 0], yVector: [0, 1, 0], zVector: [0, 0, 1],
  }],
] as const;

test("evaluates every profile curve kind with a derivative that matches its points", () => {
  for (const [slot, value] of curves) {
    const profile = revit2027ProfileCurve(slot, value);
    assert.ok(profile, `slot ${slot} is an evaluated profile`);
    for (const t of [0.2, 0.7, 1.4]) {
      const sample = evaluateRevit2027ProfileCurve(profile, t);
      const h = 1e-6;
      const ahead = evaluateRevit2027ProfileCurve(profile, t + h).point;
      const behind = evaluateRevit2027ProfileCurve(profile, t - h).point;
      for (let axis = 0; axis < 3; axis += 1) {
        const numeric = (ahead[axis]! - behind[axis]!) / (2 * h);
        assert.ok(Math.abs(numeric - sample.derivative[axis]!) < 1e-6, `${profile.kind} derivative`);
      }
    }
  }
  const ellipse = revit2027ProfileCurve(REVIT_2027_GELLIPSE_SOURCE_CLASS_SLOT, curves[2][1])!;
  // center + xLen*cos t*x + yLen*sin t*y at t = pi/2 is one yLen along y.
  assert.deepEqual(
    evaluateRevit2027ProfileCurve(ellipse, Math.PI / 2).point.map((value) => Math.round(value * 1e12) / 1e12),
    [-0.5, 0, 1],
  );
});

test("declines curves that are degenerate or of another class", () => {
  assert.equal(
    revit2027ProfileCurve(REVIT_2027_GARC_SOURCE_CLASS_SLOT, { ...curves[1][1], radius: 0 }),
    null,
  );
  assert.equal(
    revit2027ProfileCurve(REVIT_2027_GLINE_SOURCE_CLASS_SLOT, { ...curves[0][1], direction: [0, 0, 0] }),
    null,
  );
  assert.equal(revit2027ProfileCurve(1, curves[0][1]), null);
});
