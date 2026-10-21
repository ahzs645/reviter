import assert from "node:assert/strict";
import test from "node:test";
import { inspectOriginalCylinderDomainEnclosure } from "../lib/reviter/native-source-cylinder-domain-enclosure.ts";
import {
  rational,
  nativeRationalOverlay,
} from "../lib/reviter/native-rational-overlay.ts";
import { originalTwoFootStandingSquare } from "../lib/reviter/native-source-standing-footprint.ts";
import { exactClosedSourcePlanarContact } from "../lib/reviter/native-source-planar-slab-envelope.ts";
import type { Revit2027CylinderSurface } from "../lib/reviter/revit-2027-surfaces.ts";
import { nativeRationalPointInParts } from "../lib/reviter/native-exact-planar-topology.ts";

function cylinder(lower = 2.9, upper = 3.38): Revit2027CylinderSurface {
  return {
    kind: "cylinder",
    sourceClassSlot: 1144,
    byteOffset: 0,
    endOffset: 1,
    surface: {
      envelope: { firstCorner: [lower, 0], secondCorner: [upper, 1] },
      orientFlag: false,
    },
    center: [0, 0, 0],
    radius: 10,
    xVector: [1, 0, 0],
    yVector: [0, 1, 0],
    zVector: [0, 0, 1],
    queuedProperties: [],
  };
}
const square = (x: number, y: number) =>
  originalTwoFootStandingSquare([rational(x), rational(y)]);
const touching = (
  d: ReturnType<typeof square>,
  r: ReturnType<typeof inspectOriginalCylinderDomainEnclosure>,
) => {
  assert(r.ok);
  return exactClosedSourcePlanarContact(d, r.partsFeet, r.closedSegmentsFeet);
};
test("the complete finite far arc clears an interior demand while a full-circle control remains conservative", () => {
  const source = cylinder(),
    before = JSON.stringify(source),
    local = inspectOriginalCylinderDomainEnclosure(source);
  assert(local.ok);
  assert.equal(local.entireContinuousSourceDomainEnclosed, true);
  assert.equal(local.subintervalCount, 64);
  assert.equal(touching(square(0, 0), local), false);
  assert.equal(touching(square(-10, 0), local), true);
  const circle = inspectOriginalCylinderDomainEnclosure(
    cylinder(0, 2 * Math.PI),
  );
  assert.equal(touching(square(0, 0), circle), true);
  for (const [x, y] of [
    [10, 0],
    [0, 10],
    [-10, 0],
    [0, -10],
  ])
    assert.equal(
      touching(square(x!, y!), circle),
      true,
      "all cardinal extrema remain enclosed",
    );
  assert.equal(local.routeApproved, false);
  assert.equal(local.originalSourceAuthorityGranted, false);
  assert.equal(JSON.stringify(source), before);
});
test("a whole near arc is a veto, including an interior extremum beyond the endpoint chord", () => {
  const r = inspectOriginalCylinderDomainEnclosure(cylinder(-0.8, 0.8));
  assert.equal(touching(square(10, 0), r), true);
  // A chord through the two ends lies near x=7. A narrow demand near the
  // exact interior maximum x=10 must still meet the complete analytic arc.
  assert(r.ok);
  const narrow = nativeRationalOverlay("union", [
    [
      [
        [9.9, -0.01],
        [10.1, -0.01],
        [10.1, 0.01],
        [9.9, 0.01],
      ],
    ],
  ]);
  assert.equal(
    exactClosedSourcePlanarContact(narrow, r.partsFeet, r.closedSegmentsFeet),
    true,
  );
});
test("original endpoint, twin and interior residuals remain independent closed contact vetoes", () => {
  const point = [rational(0), rational(0)] as [
      ReturnType<typeof rational>,
      ReturnType<typeof rational>,
    ],
    retained: NonNullable<
      Parameters<typeof inspectOriginalCylinderDomainEnclosure>[1]
    > = {
      planPointsFeet: [point],
      partsFeet: square(3, 3),
      closedSegmentsFeet: [
        [point],
        [
          [rational(-1), rational(0)],
          [rational(1), rational(0)],
        ],
      ],
    },
    r = inspectOriginalCylinderDomainEnclosure(cylinder(), retained);
  assert(r.ok);
  assert.equal(touching(square(0, 0), r), true);
  assert.equal(touching(square(3, 3), r), true);
  assert.equal(r.retainedResidualSegments, 2);
  assert.equal(r.retainedResidualPoints, 1);
  assert.equal(r.retainedResidualParts, 1);
  assert.equal(r.closedSegmentsFeet.length, 2);
  assert.notEqual(
    r.closedSegmentsFeet[0]![0],
    point,
    "source operands are copied, not mutated",
  );
});
test("unsupported normals, branches, ranges and malformed residuals refuse rather than returning empty clearance", () => {
  const invalid = [
    { ...cylinder(), zVector: [1, 0, 1] },
    { ...cylinder(), xVector: [1, 0, 1] },
    { ...cylinder(), yVector: [1, 0, 0] },
    cylinder(6.2, 0.1),
    cylinder(-8, 8),
    cylinder(16, 16.1),
    { ...cylinder(), radius: 0 },
    { ...cylinder(), radius: NaN },
    { ...cylinder(), queuedProperties: [{}] },
  ];
  for (const source of invalid) {
    const r = inspectOriginalCylinderDomainEnclosure(
      source as Revit2027CylinderSurface,
    );
    assert.equal(r.ok, false);
    assert.equal(
      "partsFeet" in r,
      false,
      "an unknown source is not an empty material enclosure",
    );
  }
  assert.equal(
    inspectOriginalCylinderDomainEnclosure(cylinder(), {
      closedSegmentsFeet: [[]],
    }).ok,
    false,
  );
});
test("an exactly degenerate original angular domain keeps its closed point instead of becoming absent", () => {
  const r = inspectOriginalCylinderDomainEnclosure(cylinder(0, 0));
  assert(r.ok);
  assert.equal(r.partsFeet.length, 0);
  assert.equal(r.closedSegmentsFeet.length, 1);
  assert.equal(touching(square(10, 0), r), true);
});
test("literal finite angles beyond8 retain the complete interior arc and refuse periodic inference", () => {
  const source = cylinder(8, 10), before = JSON.stringify(source),
    r = inspectOriginalCylinderDomainEnclosure(source);
  assert(r.ok);
  assert.equal(touching(square(-10, 0), r), true, "the real interior extremum at3pi remains enclosed");
  assert.equal(touching(square(10, 0), r), false);
  assert.equal(JSON.stringify(source), before);
  assert.equal(inspectOriginalCylinderDomainEnclosure(cylinder(10, 8)).ok, false);
  assert.equal(inspectOriginalCylinderDomainEnclosure(cylinder(8, 16)).ok, false);
});
test("actual original large facade cylinders no longer replace their finite arcs with entire circle boxes", () => {
  const portal = square(114.74448177496802, -122.88462533961184);
  for (const [lower, upper, reflected] of [
    [2.8999600563736987, 3.3825313725894106, true],
    [2.9006539345901654, 3.0245874377859283, false],
  ] as const) {
    const source = {
        ...cylinder(lower, upper),
        center: [71.3935169319156, -217.0571588005841, 14.435695538057743],
        radius: 97.70341207349077,
        yVector: [0, reflected ? -1 : 1, 0],
      } as Revit2027CylinderSurface,
      r = inspectOriginalCylinderDomainEnclosure(source);
    assert.equal(touching(portal, r), false);
    const [x, y] = source.center,
      radius = source.radius;
    const circleBox = nativeRationalOverlay("union", [
      [
        [
          [x - radius, y - radius],
          [x + radius, y - radius],
          [x + radius, y + radius],
          [x - radius, y + radius],
        ],
      ],
    ]);
    assert.equal(
      exactClosedSourcePlanarContact(portal, circleBox),
      true,
      "the original whole-circle control covers all of this portal demand",
    );
  }
});
test("the finite-domain axis box contains every interval enclosure, retained part and closed-segment point", () => {
  const retained: NonNullable<
      Parameters<typeof inspectOriginalCylinderDomainEnclosure>[1]
    > = {
      planPointsFeet: [[rational(-30), rational(0)]],
      partsFeet: square(20, 20),
      closedSegmentsFeet: [
        [
          [rational(30), rational(30)],
          [rational(31), rational(29)],
        ],
      ],
    },
    box = inspectOriginalCylinderDomainEnclosure(cylinder(), retained),
    slow = inspectOriginalCylinderDomainEnclosure(cylinder(), retained, {
      representation: "convex-hull",
    });
  assert(box.ok && slow.ok);
  assert.equal(box.enclosureRepresentation, "axis-box");
  assert.equal(box.partsFeet[0]![0]!.length, 4);
  assert.equal(box.intervalProjectionBoundsFeet.length, 64);
  for (const {
    minimumFeet: lo,
    maximumFeet: hi,
  } of box.intervalProjectionBoundsFeet)
    for (const p of [lo, hi, [lo[0], hi[1]], [hi[0], lo[1]]])
      assert(
        nativeRationalPointInParts(p, box.partsFeet),
        "every complete interval rectangle is enclosed",
      );
  for (const p of [
    ...slow.partsFeet.flat(2),
    ...retained.planPointsFeet!,
    ...retained.partsFeet!.flat(2),
    ...retained.closedSegmentsFeet!.flat(),
  ])
    assert(
      nativeRationalPointInParts(p, box.partsFeet),
      "no hull or residual point can escape the faster enclosure",
    );
  assert.equal(
    inspectOriginalCylinderDomainEnclosure(cylinder(), {}, {
      representation: "unknown",
    } as never).ok,
    false,
  );
});
