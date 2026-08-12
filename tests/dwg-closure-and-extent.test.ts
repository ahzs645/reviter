/**
 * Two ways a DWG that decoded perfectly came out wrong.
 *
 * Both are silent failures — no error, no warning, a result the caller reports
 * as a success. The first drops the last segment of every closed shape in the
 * drawing; the second hands back a blank white image for a small one.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { convertDwgEntities, convertDwgEntity } from "../lib/reviter/dwg-entities.ts";
import {
  dwgDrawingBounds,
  dwgSectionSvg,
  dwgSections,
  entitiesWithin,
  type DwgEntity,
} from "../lib/reviter/dwg-plan.ts";

/*
 * The closed bit, confirmed against the decoder rather than against DXF.
 *
 * LibreDWG hands back neither `closed` nor `isClosed`; the bit is in `flag`,
 * and the package's own renderer reads a different one per entity type —
 * `svgConverter.js` uses `lwpolyline.flag & 0x200` for LWPOLYLINE and
 * `polyline.flag & 0x1` for the POLYLINE family, and `polyline.d.ts` documents
 * bit 1 there as "This is a closed polyline". On an LWPOLYLINE bit 1 is
 * `plinegen`, which is a linetype setting and says nothing about closure.
 */
const LWPOLYLINE_CLOSED = 0x200;
const POLYLINE_CLOSED = 0x1;

const square = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
];

test("an LWPOLYLINE closes on the bit LibreDWG actually sets", () => {
  const closed = convertDwgEntity({
    type: "LWPOLYLINE", layer: "0", vertices: square, flag: LWPOLYLINE_CLOSED,
  });
  assert.equal(closed?.closed, true, "0x200 is the LWPOLYLINE closed bit");

  const open = convertDwgEntity({ type: "LWPOLYLINE", layer: "0", vertices: square, flag: 0 });
  assert.equal(open?.closed, false);
});

test("bit 1 on an LWPOLYLINE is plinegen, and does not close it", () => {
  // Reading DXF group code 70's meaning off a DWG-native flag closes every
  // polyline whose linetype is generated continuously, which is not the same
  // set of polylines and is not a smaller mistake than missing the real bit.
  const entity = convertDwgEntity({
    type: "LWPOLYLINE", layer: "0", vertices: square, flag: POLYLINE_CLOSED,
  });
  assert.equal(entity?.closed, false);
});

test("the POLYLINE family keeps the DXF meaning of bit 1", () => {
  for (const type of ["POLYLINE", "POLYLINE2D", "POLYLINE3D"]) {
    const closed = convertDwgEntity({ type, layer: "0", vertices: square, flag: POLYLINE_CLOSED });
    assert.equal(closed?.closed, true, `${type} closes on bit 1`);

    // 0x200 is not a closed bit here — on a POLYLINE the flag's high bits mean
    // other things entirely, and reading one as closure would close at random.
    const open = convertDwgEntity({ type, layer: "0", vertices: square, flag: LWPOLYLINE_CLOSED });
    assert.equal(open?.closed, false, `${type} does not close on 0x200`);
  }
});

test("an explicit boolean still closes, for producers that set one", () => {
  // LibreDWG never sets these, but the fields were being read before the flag
  // was understood and another producer may well populate them.
  assert.equal(
    convertDwgEntity({ type: "LWPOLYLINE", layer: "0", vertices: square, closed: true })?.closed,
    true,
  );
  assert.equal(
    convertDwgEntity({ type: "POLYLINE", layer: "0", vertices: square, isClosed: true })?.closed,
    true,
  );
});

test("a closed shape draws its last segment", () => {
  // The whole point of the bit: without it every room, wall outline and column
  // in the drawing is missing the run from its last vertex back to its first.
  const [entity] = convertDwgEntities([{
    type: "LWPOLYLINE", layer: "ROOM", vertices: square, flag: LWPOLYLINE_CLOSED,
  }]);
  const svg = dwgSectionSvg([entity!], { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  assert.match(svg, /d="M0 0L10 0L10 10L0 10Z"/u, "the path closes");

  const [open] = convertDwgEntities([{
    type: "LWPOLYLINE", layer: "ROOM", vertices: square, flag: 0,
  }]);
  const openSvg = dwgSectionSvg([open!], { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  assert.doesNotMatch(openSvg, /Z"/u, "and an open one still does not");
});

test("a closed bulge polyline gets the arc that wraps back to the start", () => {
  /*
   * Bulges are tessellated per segment, and a closed polyline has one more
   * segment than it has gaps between listed vertices — the wrap. Losing the
   * flag lost that arc silently: the shape came back with a straight-looking
   * gap where a curved edge should have been.
   */
  const bulged = { vertices: square, bulges: [0.5, 0.5, 0.5, 0.5] };
  const closed = convertDwgEntity({
    type: "LWPOLYLINE", layer: "0", ...bulged, flag: LWPOLYLINE_CLOSED,
  });
  const open = convertDwgEntity({ type: "LWPOLYLINE", layer: "0", ...bulged, flag: 0 });

  assert.ok(closed?.points && open?.points);
  assert.ok(
    closed.points.length > open.points.length,
    `closed tessellates a fourth arc: ${closed.points.length} against ${open.points.length}`,
  );
  // The wrap runs from the last vertex, so the ring ends near the first vertex
  // without repeating it — the `Z` in the path is what joins them.
  assert.deepEqual(closed.points[0], [0, 0]);
  assert.notDeepEqual(closed.points.at(-1), [0, 0]);
});

/** A small drawing: fewer entities than the section threshold, real coordinates. */
function smallDrawing(): DwgEntity[] {
  return Array.from({ length: 20 }, (_, index) => ({
    type: "LINE",
    layer: "0",
    points: [[1_000, 500 + index], [1_100, 500 + index]] as [number, number][],
  }));
}

test("a drawing smaller than the section threshold is still a section", () => {
  /*
   * `minimumEntities` is a scrap filter, and a scrap is only a scrap next to a
   * plan. Applied to a drawing that is one region, it deleted the drawing: a
   * 20-entity site plan produced no sections at all, and the caller had real
   * coordinates and nothing to put them in.
   */
  const sections = dwgSections(smallDrawing());
  assert.equal(sections.length, 1, "the drawing is a section, small or not");
  assert.equal(sections[0]!.entityCount, 20);
  assert.deepEqual(sections[0]!.bounds, { minX: 1_000, minY: 500, maxX: 1_100, maxY: 519 });
});

test("the threshold still drops scraps when there is a plan to drop them next to", () => {
  // The filter has a job, and the fix must not cost it. A plan with a stray
  // segment parked well away from it still yields one section, not two.
  const entities: DwgEntity[] = [
    ...Array.from({ length: 40 }, (_, index) => ({
      type: "LINE", layer: "0",
      points: [[0, index], [100, index]] as [number, number][],
    })),
    { type: "LINE", layer: "0", points: [[5_000, 5_000], [5_001, 5_001]] },
  ];
  const sections = dwgSections(entities);
  assert.equal(sections.length, 1);
  assert.equal(sections[0]!.entityCount, 40);
});

test("a drawing with no sections is drawn at its own extent, not a unit square", () => {
  /*
   * The blank-reference bug. Several scattered scraps clear no threshold, so
   * the section list comes back empty; the old fallback emitted `viewBox 0 -1
   * 1 1` while the paths carried coordinates in the thousands. Every line sat
   * outside the viewBox, so the user got a white image — reported as a
   * successful decode, with nothing anywhere to say the drawing was lost.
   */
  const entities: DwgEntity[] = [];
  for (const originX of [0, 10_000, 20_000]) {
    for (let index = 0; index < 5; index += 1) {
      entities.push({
        type: "LINE", layer: "0",
        points: [[originX, index], [originX + 100, index]],
      });
    }
  }
  assert.deepEqual(dwgSections(entities), [], "three scraps, none of them a plan");

  const bounds = dwgDrawingBounds(entities, dwgSections(entities));
  assert.deepEqual(bounds, { minX: 0, minY: 0, maxX: 20_100, maxY: 4 });
});

test("the small drawing reaches the SVG inside its own viewBox", () => {
  // End to end, and this is the assertion the blank image would have failed:
  // the drawn coordinates have to lie within the box they are drawn in.
  const entities = smallDrawing();
  const sections = dwgSections(entities);
  const bounds = dwgDrawingBounds(entities, sections)!;
  const drawn = entitiesWithin(entities, bounds);
  assert.equal(drawn.length, 20, "nothing is cropped away");

  const svg = dwgSectionSvg(drawn, bounds);
  assert.match(svg, /viewBox="1000 -519 100 19"/u);
  assert.doesNotMatch(svg, /viewBox="0 -1 1 1"/u, "not the unit-square fallback");

  // Every emitted x sits inside the viewBox's x range, which is what "not
  // blank" means for an SVG.
  const xs = [...svg.matchAll(/[ML](-?\d+(?:\.\d+)?) /gu)].map((match) => Number(match[1]));
  assert.ok(xs.length > 0, "there is linework in the document");
  assert.ok(
    xs.every((x) => x >= bounds.minX && x <= bounds.maxX),
    "every drawn point is within the viewBox",
  );
});

test("a drawing with no drawable geometry has no extent to invent", () => {
  // The one case where there is genuinely nothing to show. Returning null lets
  // the caller say so rather than emit an empty document that looks like one.
  assert.equal(dwgDrawingBounds([{ type: "POINT", layer: "0" }], []), null);
  assert.equal(dwgDrawingBounds([], []), null);
});
