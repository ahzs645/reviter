/**
 * The facet elevation band.
 *
 * A stair sub-component's duplicated-bounds record carries the stair assembly's
 * z band, not the component's: 208 of the 214 stringer carriages over a foot past
 * their own export box are wrong in z alone, plan right to 0.16 ft. The element's
 * own faces are a second reading of the same element, and where they cap it above
 * and below they say where it stops.
 *
 * The cap test is the whole rule. Narrowing to *any* facet set takes
 * `IfcWallStandardCase` centre agreement from 100.0% to 34.9% and flattens 27 of
 * 43 walls, because a wall's attributed facets are a fragment of one vertical
 * face and a vertical face bounds nothing in z. These tests hold the gate to
 * that word.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { facetElevationBand } from "../lib/reviter/native-geometry.ts";
import type { SurfaceQuad } from "../lib/reviter/native-geometry.ts";

/** A quad from four corners, in trim order, on element 1462163. */
const quad = (corners: [number, number, number][]): SurfaceQuad => ({
  elementId: 1_462_163,
  corners: corners as SurfaceQuad["corners"],
});

/** A horizontal facet at `z`, wound so its normal points up or down. */
const flat = (z: number, up: boolean): SurfaceQuad =>
  quad(up
    ? [[0, 0, z], [1, 0, z], [1, 1, z], [0, 1, z]]
    : [[0, 0, z], [0, 1, z], [1, 1, z], [1, 0, z]]);

/** A vertical facet spanning `z0..z1` — a wall's face, or a stringer's cheek. */
const upright = (z0: number, z1: number): SurfaceQuad =>
  quad([[0, 0, z0], [4, 0, z0], [4, 0, z1], [0, 0, z1]]);

test("reads the band from faces that cap the element above and below", () => {
  const band = facetElevationBand([flat(1.4, true), flat(0, false), upright(0, 1.4)]);
  assert.ok(band);
  assert.equal(band.min, 0);
  assert.equal(band.max, 1.4);
});

test("declines a face set of vertical faces alone", () => {
  // This is the wall case, and it is why the rule is not applied to every facet
  // set: 49 of 49 walls that own facets are declined here, and all 49 keep the
  // 100.0% centre and size agreement their own record already gives them.
  assert.equal(facetElevationBand([upright(0, 9.19), upright(0, 9.19)]), null);
});

test("declines a set capped on one side only", () => {
  assert.equal(facetElevationBand([flat(4, true), upright(0, 4)]), null);
  assert.equal(facetElevationBand([flat(0, false), upright(0, 4)]), null);
});

test("takes a raked face as a cap, which is what a stringer has", () => {
  // A stringer's soffit and tread read |normal.z| of 0.876 to 0.925 — 312 of the
  // 910 facets its category owns. Any threshold from 1e-9 to 0.5 selects the same
  // 79 elements, so the 0.1 in the decoder sits in the gap between "vertical" and
  // "sloped" rather than on a cliff.
  const rise = 1;
  const run = 2;
  const soffit = quad([[0, 0, 0], [run, 0, rise], [run, 1, rise], [0, 1, 0]]);
  const tread = quad([[0, 0, 1.4], [0, 1, 1.4], [run, 1, rise + 1.4], [run, 0, rise + 1.4]]);
  const band = facetElevationBand([soffit, tread, upright(0, rise + 1.4)]);
  assert.ok(band);
  assert.equal(band.min, 0);
  assert.equal(band.max, rise + 1.4);
});

test("declines an empty set and a degenerate facet", () => {
  assert.equal(facetElevationBand([]), null);
  // Three coincident corners give no normal, so the facet casts no vote either
  // way and the set is left unbounded.
  assert.equal(facetElevationBand([quad([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]])]), null);
});
