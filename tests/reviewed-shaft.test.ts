import test from "node:test";
import assert from "node:assert/strict";
import { supportedShaftStop } from "../lib/reviter/reviewed-shaft.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
const walls = [
  [0, 0, 0, 11],
  [8, 0, 8, 11],
  [0, 0, 3, 0],
  [7, 0, 8, 0],
  [0, 11, 3, 11],
  [7, 11, 8, 11],
];
const shaft = {
  pinId: "double-entry-lift",
  pointFeet: [4.267, 6.869] as [number, number],
  wallElementIds: [1, 2, 3, 4, 5, 6],
};
const model = () =>
  ({
    elementBounds: [
      ...walls.map(([x, y, ex, ey], i) => ({
        elementId: i + 1,
        categoryId: -2000011,
        solids: [
          {
            start: { x, y },
            end: { x: ex, y: ey },
            thickness: 0.65,
            baseElevation: 0,
            topElevation: 27,
          },
        ],
        boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 11, z: 27 } },
      })),
      ...[0, 17.72, 28].map((z, i) => ({
        elementId: 100 + i,
        categoryId: -2000032,
        boundsFeet: {
          min: { x: -5, y: -5, z: z - 0.5 },
          max: { x: 20, y: 20, z },
        },
        loops: [
          [
            [-5, -5, z],
            [20, -5, z],
            [20, 20, z],
            [-5, 20, z],
          ],
        ],
      })),
    ],
  }) as unknown as ConvertResult;
test("narrow wall returns around opposing lift doors verify both physical stops", () => {
  const m = model();
  assert.equal(supportedShaftStop(m, shaft, 100, [5.23, 14], 0), true);
  assert.equal(supportedShaftStop(m, shaft, 101, [5.23, 14], 17.72), true);
  assert.equal(
    supportedShaftStop(m, shaft, 102, [5.23, 14], 28),
    false,
    "Shaft walls do not serve the roof",
  );
  assert.equal(
    supportedShaftStop(m, shaft, 100, [11, 7], 0),
    false,
    "A lobby behind the solid side wall is not an exit",
  );
});
test("two side walls and unsupported floor openings cannot authorize a lift stop", () => {
  const m = model();
  const onlySides = model();
  for (const wall of onlySides.elementBounds.filter(
    (e) => e.elementId >= 3 && e.elementId <= 6,
  ))
    wall.solids![0]!.topElevation = 0;
  assert.equal(supportedShaftStop(onlySides, shaft, 100, [5.23, 14], 0), false);
  const floor = m.elementBounds.find((e) => e.elementId === 100)!;
  floor.loops!.push([
    [4, 13, 0],
    [7, 13, 0],
    [7, 16, 0],
    [4, 16, 0],
  ]);
  assert.equal(supportedShaftStop(m, shaft, 100, [5.23, 14], 0), false);
});

test("native glass members complete a shaft whose curtain container has only a short recovered return", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/unbc-glass-elevator-shaft.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    supportedShaftStop(
      fixture.model,
      fixture.shaft,
      1501037,
      [212, 773],
      3.2808398950131235,
    ),
    true,
  );
  assert.equal(
    supportedShaftStop(
      fixture.model,
      fixture.shaft,
      1501037,
      [212, 784],
      3.2808398950131235,
    ),
    false,
    "A glass back wall cannot become an entrance",
  );
  const noMembers = structuredClone(fixture.model);
  noMembers.nativeHostRelations = [];
  assert.equal(
    supportedShaftStop(
      noMembers,
      fixture.shaft,
      1501037,
      [212, 773],
      3.2808398950131235,
    ),
    false,
    "Bounds and a curtain wall name cannot replace enclosure evidence",
  );
  const inferred = structuredClone(fixture.model);
  inferred.nativeHostRelations.forEach(
    (r: { evidence: string }) => (r.evidence = "inferred"),
  );
  assert.equal(
    supportedShaftStop(
      inferred,
      fixture.shaft,
      1501037,
      [212, 773],
      3.2808398950131235,
    ),
    false,
  );
  const proxy = structuredClone(fixture.model);
  proxy.elementBounds
    .filter((r: { categoryId: number }) =>
      [-2000170, -2000171].includes(r.categoryId),
    )
    .forEach(
      (r: { renderGeometryProvenance: string }) =>
        (r.renderGeometryProvenance = "proxy"),
    );
  assert.equal(
    supportedShaftStop(
      proxy,
      fixture.shaft,
      1501037,
      [212, 773],
      3.2808398950131235,
    ),
    false,
  );
});
