/**
 * The DWG plan splitter and SVG emitter, on drawings whose answer is known by
 * hand. No WASM here — `dwg-plan.ts` takes plain entities precisely so the
 * geometry can be tested without a 4 MB decoder.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dwgFeetPerUnit,
  dwgSectionSvg,
  dwgSections,
  entitiesWithin,
  entityBounds,
  unionBounds,
  type DwgEntity,
} from "../lib/reviter/dwg-plan.ts";

const line = (x1: number, y1: number, x2: number, y2: number, layer = "0"): DwgEntity =>
  ({ type: "LINE", layer, points: [[x1, y1], [x2, y2]] });

/** A filled rectangle of linework, standing in for one plan on the sheet. */
function plan(originX: number, originY: number, size = 100, density = 40): DwgEntity[] {
  return Array.from({ length: density }, (_, index) => {
    const offset = (index / density) * size;
    return line(originX, originY + offset, originX + size, originY + offset);
  });
}

test("entity bounds cover analytic circles as well as polylines", () => {
  assert.deepEqual(entityBounds(line(0, 0, 10, 4)), { minX: 0, minY: 0, maxX: 10, maxY: 4 });
  assert.deepEqual(
    entityBounds({ type: "CIRCLE", layer: "0", centre: [10, 10], radius: 3 }),
    { minX: 7, minY: 7, maxX: 13, maxY: 13 },
  );
  assert.equal(entityBounds({ type: "POINT", layer: "0" }), null);
  assert.equal(unionBounds([]), null);
});

test("sections split a sheet of plans on the empty runs between them", () => {
  // Three plans laid out with wide margins, the way a survey sheet arranges
  // them, plus a scrap of linework too small to be a drawing.
  const entities = [
    ...plan(0, 0),
    ...plan(1_000, 0),
    ...plan(0, 1_000),
    line(2_000, 2_000, 2_001, 2_001),
  ];
  const sections = dwgSections(entities);
  assert.equal(sections.length, 3, "the stray segment is not a section");
  for (const section of sections) {
    assert.equal(section.entityCount, 40);
    assert.ok(Math.abs(section.widthUnits - 100) < 1e-6);
  }
  // Each section's box must contain only its own plan.
  const first = sections.find((section) => section.bounds.minX < 500 && section.bounds.minY < 500);
  assert.ok(first, "the plan at the origin is one of the sections");
  assert.equal(entitiesWithin(entities, first!.bounds).length, 40);
});

test("a single drawing stays a single section", () => {
  const sections = dwgSections(plan(0, 0));
  assert.equal(sections.length, 1);
  assert.equal(sections[0]!.entityCount, 40);
});

test("the emitted SVG batches a layer into one path and flips Y once", () => {
  const entities = [
    line(0, 0, 10, 0, "walls"),
    line(10, 0, 10, 10, "walls"),
    line(0, 0, 0, 10, "grid"),
  ];
  const svg = dwgSectionSvg(entities, { minX: 0, minY: 0, maxX: 10, maxY: 10 });

  // One path per layer, not one element per entity — this is what keeps a
  // 200,000-entity drawing from becoming a 36 MB document.
  assert.equal(svg.match(/<path /gu)?.length, 2);
  assert.match(svg, /data-dwg-layer="walls" d="M0 0L10 0M10 0L10 10"/u);
  assert.match(svg, /data-dwg-layer="grid" d="M0 0L0 10"/u);
  // DWG is Y-up, SVG is Y-down: one transform rather than negating every point.
  assert.match(svg, /<g class="dwg" transform="scale\(1 -1\)">/u);
  assert.match(svg, /viewBox="0 -10 10 10"/u);
  assert.match(svg, /data-dwg-units-wide="10"/u);
});

test("a full circle emits two half arcs because one cannot close on itself", () => {
  const svg = dwgSectionSvg(
    [{ type: "CIRCLE", layer: "0", centre: [5, 5], radius: 2 }],
    { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  );
  assert.equal(svg.match(/A2 2 0 1 0/gu)?.length, 2);
});

test("an arc resolves its centre and angles to SVG endpoints", () => {
  const svg = dwgSectionSvg(
    [{ type: "ARC", layer: "0", centre: [0, 0], radius: 10, startAngle: 0, endAngle: Math.PI / 2 }],
    { minX: -10, minY: -10, maxX: 10, maxY: 10 },
  );
  // Quarter turn from (10,0) to (0,10), the short way round.
  assert.match(svg, /M10 0A10 10 0 0 1 0 10/u);
});

test("an arc crossing the zero angle still sweeps forwards", () => {
  const svg = dwgSectionSvg(
    [{ type: "ARC", layer: "0", centre: [0, 0], radius: 10, startAngle: Math.PI * 1.75, endAngle: Math.PI * 0.25 }],
    { minX: -10, minY: -10, maxX: 10, maxY: 10 },
  );
  assert.match(svg, /A10 10 0 0 1 /u, "a 90 degree sweep is not flagged as the large arc");
});

test("text is escaped rather than injected into the drawing", () => {
  const svg = dwgSectionSvg(
    [{ type: "TEXT", layer: "0", centre: [1, 2], text: 'A & <B> "C"', height: 3 }],
    { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  );
  assert.match(svg, /A &amp; &lt;B&gt; &quot;C&quot;/u);
  assert.doesNotMatch(svg, /<B>/u);
});

test("units come from the file or not at all", () => {
  assert.equal(dwgFeetPerUnit(2), 1);
  assert.equal(dwgFeetPerUnit(6), 1 / 0.3048);
  assert.ok(Math.abs(dwgFeetPerUnit(4)! - 1 / 304.8) < 1e-12);
  // The UNBC floor plan declares 0 — unitless. Guessing a scale there would put
  // a reference on the plan at the wrong size with no warning.
  assert.equal(dwgFeetPerUnit(0), null);
  assert.equal(dwgFeetPerUnit(undefined), null);
});
