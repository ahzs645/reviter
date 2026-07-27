import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildPartitioner,
  centreError,
  readStoreys,
  ruleReport,
  summarise,
  type Sample,
  type StoreyModel,
} from "../scripts/holdout.ts";

import type { Box } from "../scripts/overlay-diff.ts";

/**
 * The holdout harness partitions one building and asks whether each fitted rule
 * holds on the parts it was not fitted to. These tests cover the partitioning
 * and the flagging, which is where a mistake would silently make every rule
 * look like it generalises: a partitioner that puts every element in one
 * partition, or a spread that is computed over a four-element bucket, produces
 * a clean report that means nothing.
 */

/** A three-storey building, in the shape `readStoreys` returns. */
const STOREYS: StoreyModel = {
  storeys: [
    { expressId: 1, name: "Floor 1", elevationFeet: 0 },
    { expressId: 2, name: "Floor 2", elevationFeet: 12 },
    { expressId: 3, name: "Floor 3", elevationFeet: 24 },
  ],
  byElementId: new Map([[100, "Floor 2"]]),
};

/** A hull 400 ft along x and 100 ft along y, so x is the longer plan axis. */
const HULL: Box = [0, 0, 0, 400, 100, 36];

const box = (x: number, y: number, z: number): Box => [x, y, z, x + 1, y + 1, z + 9];

test("the storey comes from the export where the element is a product", () => {
  const partitioner = buildPartitioner(STOREYS, HULL);
  // Element 100 is contained by Floor 2 in the export, and its own geometry
  // sits at ground level. The export wins: containment is the ground truth the
  // decoder cannot have keyed on, and a box is only a fallback for items the
  // export never names.
  assert.equal(partitioner.assign(100, box(10, 10, 0)).storey, "Floor 2");
  assert.equal(partitioner.bandFallbacks.size, 0);
});

test("an element with no product falls back to its elevation band", () => {
  const partitioner = buildPartitioner(STOREYS, HULL);
  // Held-back sheets and rejected records have no IFC product, so there is no
  // containment to read. The band is chosen from the box's base rather than its
  // centre, because Revit contains an element by the level it is drawn from and
  // a wall spans into the storey above.
  assert.equal(partitioner.assign(900, box(10, 10, 0)).storey, "Floor 1");
  assert.equal(partitioner.assign(901, box(10, 10, 12)).storey, "Floor 2");
  assert.equal(partitioner.assign(902, box(10, 10, 30)).storey, "Floor 3");
  // Below the lowest storey is still the lowest storey rather than nothing.
  assert.equal(partitioner.assign(903, box(10, 10, -40)).storey, "Floor 1");
  assert.equal(partitioner.bandFallbacks.size, 4);
});

test("the wing splits the longer plan axis of the hull", () => {
  const partitioner = buildPartitioner(STOREYS, HULL);
  assert.equal(partitioner.wingNames.length, 2);
  const west = partitioner.assign(900, box(10, 50, 0)).wing;
  const east = partitioner.assign(901, box(390, 50, 0)).wing;
  assert.notEqual(west, east, "both ends of the building landed in one wing");
  // The split is on x because the hull is wider than it is deep; moving only y
  // must not change the wing.
  assert.equal(partitioner.assign(902, box(10, 5, 0)).wing, west);
  assert.equal(partitioner.assign(903, box(10, 95, 0)).wing, west);
});

test("the spread is computed over the partitions that clear the floor", () => {
  const samples: Sample[] = [
    // 40 in Floor 1, all correct.
    ...Array.from({ length: 40 }, () => ({ partition: { storey: "Floor 1", wing: "w" }, ok: true })),
    // 40 in Floor 2, half correct — a 50 point spread against Floor 1.
    ...Array.from({ length: 20 }, () => ({ partition: { storey: "Floor 2", wing: "w" }, ok: true })),
    ...Array.from({ length: 20 }, () => ({ partition: { storey: "Floor 2", wing: "w" }, ok: false })),
    // 3 in Floor 3, none correct. Too thin to say anything, so it must not
    // become the worst partition and must not widen the spread.
    ...Array.from({ length: 3 }, () => ({ partition: { storey: "Floor 3", wing: "w" }, ok: false })),
  ];
  const report = summarise(samples, "storey", ["Floor 1", "Floor 2", "Floor 3"]);
  assert.deepEqual(report.rows.map((row) => row.partition), ["Floor 1", "Floor 2", "Floor 3"]);
  assert.deepEqual(report.rows.map((row) => row.thin), [false, false, true]);
  assert.equal(report.comparedPartitions, 2);
  assert.ok(report.spreadPoints != null && Math.abs(report.spreadPoints - 50) < 1e-9);
  assert.equal(report.best, "Floor 1");
  assert.equal(report.worst, "Floor 2");
});

test("a rule that works on half the building is flagged as a split", () => {
  const samples: Sample[] = [
    ...Array.from({ length: 30 }, () => ({ partition: { storey: "Floor 1", wing: "west" }, ok: true })),
    ...Array.from({ length: 30 }, () => ({ partition: { storey: "Floor 2", wing: "east" }, ok: false })),
  ];
  const report = ruleReport({
    rule: "example",
    fittedOn: "one wing",
    accuracyIs: "the rule holds",
    samples,
    partitioner: buildPartitioner(STOREYS, HULL),
  });
  assert.equal(report.verdict, "split");
  assert.equal(report.byWing.spreadPoints, 100);
});

test("a rule that stops firing where it should is flagged silent, not split", () => {
  // This is the gap the accuracy thresholds cannot see. Every sample the rule
  // did produce is correct, so no floor fires; the failure is that a partition
  // holding 40 eligible elements produced nothing at all.
  const samples: Sample[] = Array.from({ length: 30 }, () => ({
    partition: { storey: "Floor 1", wing: "west" },
    ok: true,
  }));
  const report = ruleReport({
    rule: "example",
    fittedOn: "one storey",
    accuracyIs: "the rule holds",
    samples,
    partitioner: buildPartitioner(STOREYS, HULL),
    eligible: {
      storey: new Map([["Floor 1", 30], ["Floor 2", 40]]),
      wing: new Map([["west", 30]]),
    },
  });
  assert.equal(report.overallPercent, 100);
  assert.equal(report.verdict, "silent");
  assert.equal(report.silentPartitions.length, 1);
  assert.match(report.silentPartitions[0]!, /Floor 2/);
});

test("a partition with too small an eligible population is not a silent rule", () => {
  // A building with three railings and no swept path has not broken the rule.
  const report = ruleReport({
    rule: "example",
    fittedOn: "one storey",
    accuracyIs: "the rule holds",
    samples: Array.from({ length: 30 }, () => ({
      partition: { storey: "Floor 1", wing: "west" },
      ok: true,
    })),
    partitioner: buildPartitioner(STOREYS, HULL),
    eligible: { storey: new Map([["Floor 1", 30], ["Floor 2", 3]]), wing: new Map([["west", 30]]) },
  });
  assert.equal(report.silentPartitions.length, 0);
  assert.equal(report.verdict, "untestable");
});

test("a population too small to partition is untestable rather than passing", () => {
  const report = ruleReport({
    rule: "example",
    fittedOn: "three records",
    accuracyIs: "the rule holds",
    samples: Array.from({ length: 3 }, () => ({
      partition: { storey: "Floor 1", wing: "west" },
      ok: true,
    })),
    partitioner: buildPartitioner(STOREYS, HULL),
  });
  assert.equal(report.verdict, "untestable");
});

test("centre error is the worst disagreement on any axis", () => {
  const got: Box = [0, 0, 0, 2, 2, 2];
  assert.equal(centreError(got, [0, 0, 0, 2, 2, 2]), 0);
  // Shifted 3 ft along y only.
  assert.equal(centreError(got, [0, 3, 0, 2, 5, 2]), 3);
  // Same centre, very different size, is not a centre error.
  assert.equal(centreError(got, [-9, -9, -9, 11, 11, 11]), 0);
});

test("storey containment is read through the export's aggregation", () => {
  // A curtain panel is not contained by a storey directly: it is aggregated
  // into a curtain wall that is. Without the propagation the whole facade —
  // the largest population in this model — would have no storey at all, and a
  // report over the elements that do would be a report about the walls.
  const directory = mkdtempSync(join(tmpdir(), "reviter-holdout-"));
  const path = join(directory, "storeys.ifc");
  writeFileSync(
    path,
    [
      "ISO-10303-21;",
      "DATA;",
      "#10=IFCBUILDINGSTOREY('g1',#1,'Level 1',$,$,#2,$,'Level 1',.ELEMENT.,0.);",
      "#11=IFCBUILDINGSTOREY('g2',#1,'Level 2',$,$,#3,$,'Level 2',.ELEMENT.,3048.);",
      "#20=IFCCURTAINWALL('g3',#1,'Wall:Type:501',$,'Wall',#4,#5,'501');",
      "#21=IFCPLATE('g4',#1,'Panel:Type:502',$,'Panel',#6,#7,'502');",
      "#22=IFCWALLSTANDARDCASE('g5',#1,'Wall:Type:503',$,'Wall',#8,#9,'503');",
      "#30=IFCRELCONTAINEDINSPATIALSTRUCTURE('g6',#1,$,$,(#20),#10);",
      "#31=IFCRELCONTAINEDINSPATIALSTRUCTURE('g7',#1,$,$,(#22),#11);",
      "#32=IFCRELAGGREGATES('g8',#1,$,$,#20,(#21));",
      "ENDSEC;",
      "END-ISO-10303-21;",
      "",
    ].join("\n"),
  );
  const model = readStoreys(path);
  assert.deepEqual(model.storeys.map((storey) => storey.name), ["Level 1", "Level 2"]);
  // 3048 mm is 10 ft.
  assert.ok(Math.abs(model.storeys[1]!.elevationFeet - 10) < 1e-9);
  assert.equal(model.byElementId.get(501), "Level 1");
  assert.equal(model.byElementId.get(502), "Level 1", "the panel did not inherit its wall's storey");
  assert.equal(model.byElementId.get(503), "Level 2");
});
