import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFloorReferenceTransform,
  composeFloorReferenceTransform,
  decomposeFloorReferenceTransform,
  fitFloorReferenceTransform,
  floorReferenceTransformAttribute,
  makeFloorReferenceAlignment,
  parseFloorReferenceAlignment,
} from "../lib/reviter/floor-reference-overlay.ts";
import {
  cropFloorReferenceCatalogSvg,
  parseFloorReferenceCatalogSvg,
} from "../lib/reviter/floor-reference-catalog.ts";

test("fits a rotation, uniform scale, and translation from plan control points", () => {
  const expected = composeFloorReferenceTransform({
    scale: 1.75,
    rotationDegrees: 32,
    offsetX: -0.14,
    offsetY: 0.27,
  });
  const reference = [
    { x: 0.15, y: 0.22 },
    { x: 0.82, y: 0.31 },
    { x: 0.48, y: 0.88 },
  ];
  const fitted = fitFloorReferenceTransform(reference.map((point) => ({
    reference: point,
    rvt: applyFloorReferenceTransform(expected, point),
  })));
  assert.ok(fitted.rms < 1e-12);
  assert.ok(fitted.maximum < 1e-12);
  for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
    assert.ok(Math.abs(fitted.transform[key] - expected[key]) < 1e-12);
  }
});

test("does not permit an affine stretch to masquerade as a registration", () => {
  const fitted = fitFloorReferenceTransform([
    { reference: { x: 0, y: 0 }, rvt: { x: 0, y: 0 } },
    { reference: { x: 1, y: 0 }, rvt: { x: 2, y: 0 } },
    { reference: { x: 0, y: 1 }, rvt: { x: 0, y: 1 } },
  ]);
  assert.ok(fitted.rms > 0.2);
  assert.equal(fitted.transform.c, -fitted.transform.b);
  assert.equal(fitted.transform.d, fitted.transform.a);
});

test("round-trips alignment JSON and rejects unrelated JSON", () => {
  const transform = composeFloorReferenceTransform({ scale: 0.8, rotationDegrees: -15, offsetX: 0.1, offsetY: -0.2 });
  const alignment = makeFloorReferenceAlignment({
    source: {
      fileName: "campus.svg",
      mediaType: "image/svg+xml",
      sha256: "abc",
      section: { id: "plan-a", label: "Library 1st floor", bounds: { x: 10, y: 20, width: 80, height: 50 } },
    },
    rvtFileName: "model.rvt",
    levelIds: [311, 1487816],
    controlPairs: [],
    transform,
    rms: 0.002,
    maximum: 0.003,
    opacity: 0.42,
    createdAt: "2026-08-04T00:00:00.000Z",
  });
  assert.deepEqual(parseFloorReferenceAlignment(JSON.stringify(alignment)), alignment);
  assert.throws(() => parseFloorReferenceAlignment('{"hello":"world"}'), /valid Reviter/u);
  const decomposed = decomposeFloorReferenceTransform(transform);
  assert.ok(Math.abs(decomposed.scale - 0.8) < 1e-12);
  assert.ok(Math.abs(decomposed.rotationDegrees + 15) < 1e-12);
  assert.match(floorReferenceTransformAttribute(transform), /^matrix\(/u);
});

test("indexes independently framed plans in a decoded DWG SVG and crops one without changing its geometry", () => {
  const svg = `<svg viewBox="0 0 500 300">
    <g id="plan-a" stroke="rgb(0,127,31)" fill="none"><path d="M10,20L110,20L110,90L10,90L10,20Z" /></g>
    <g id="plan-b" stroke="#007f1f" fill="none"><path d="M200,40L360,40L360,150L200,150L200,40Z" /></g>
    <g fill="white"><text x="20" y="80" font-size="500">LIBRARY 1ST FLOOR</text></g>
    <g fill="white"><text x="220" y="140" font-size="500">LAB BUILDING LEVEL 2</text></g>
    <path id="geometry" d="M25,25L30,30" />
  </svg>`;
  const catalog = parseFloorReferenceCatalogSvg(svg);
  assert.ok(catalog);
  assert.equal(catalog.sections.length, 2);
  assert.equal(catalog.sections[0]?.label, "LIBRARY 1ST FLOOR");
  assert.equal(catalog.sections[1]?.label, "LAB BUILDING LEVEL 2");
  const cropped = cropFloorReferenceCatalogSvg(svg, catalog.sections[1]!.bounds, 0);
  assert.match(cropped, /viewBox="200 40 160 110"/u);
  assert.match(cropped, /id="geometry"/u);
});
