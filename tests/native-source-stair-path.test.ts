import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nativeSourceStairTreadPath } from "../lib/reviter/native-source-stair-path.ts";
import { validateNativeSourceStairWidth } from "../lib/reviter/native-source-stair-width.ts";
import { validateNativeSourceStairWidth as runtimeWidth } from "../../openindoormaps/app/indoor-project/native-source-stair-width.ts";
import { nativeSourceStairRiserPartsForSegment, nativeSourceStairRiserProjections } from "../lib/reviter/native-source-stair-riser-continuity.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import { nativeRationalPointInParts } from "../lib/reviter/native-exact-planar-topology.ts";
import * as DMath from "../lib/reviter/deterministic-math.ts";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/native-turning-stair-source-path.json", import.meta.url), "utf8"));
const make = (f: ReturnType<typeof fixture>, landings = f.flight.landings) => ({
  ...f.receipt,
  pointsFeet: [f.receipt.terminalCaps[0].pointFeet,
    ...nativeSourceStairTreadPath(f.flight.treads, landings, f.flight.supportFaces),
    f.receipt.terminalCaps[1].pointFeet],
  landings,
});

test("an original turning landing supplies a fully supported dogleg, retaining all original tread visits", () => {
  const f = fixture(), before = JSON.stringify(f), proposed = make(f);
  assert.equal(validateNativeSourceStairWidth(proposed, f.floors, true), true);
  assert.equal(runtimeWidth(proposed, f.floors, true), true);
  assert.equal(proposed.pointsFeet.length, f.flight.treads.length + 4);
  assert.deepEqual(proposed.pointsFeet[0], f.receipt.terminalCaps[0].pointFeet);
  assert.deepEqual(proposed.pointsFeet.at(-1), f.receipt.terminalCaps[1].pointFeet);
  assert.equal(JSON.stringify(f), before);
});

test("missing landing geometry cannot be replaced by a diagonal, bounding box or another height", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => [],
    (f: ReturnType<typeof fixture>) => f.flight.landings.map((l: Parameters<typeof nativeSourceStairTreadPath>[1][number]) => ({ ...l, elevationFeet: l.elevationFeet + 2 })),
    (f: ReturnType<typeof fixture>) => f.flight.landings.map((l: Parameters<typeof nativeSourceStairTreadPath>[1][number]) => ({ ...l, ringsFeet: l.ringsFeet.map((r: Parameters<typeof nativeSourceStairTreadPath>[1][number]["ringsFeet"][number]) => r.map(([x, y]: number[]) => [x + 20, y])) })),
  ]) {
    const f = fixture(), proposed = make(f, change(f));
    assert.equal(validateNativeSourceStairWidth(proposed, f.floors, true), false);
    assert.equal(runtimeWidth(proposed, f.floors, true), false);
  }
});

test("a real aperture across the turning landing remains a routing veto", () => {
  const f = fixture();
  // A full transverse gap splits this source platform. The search may not fill
  // the hole or use a bounding rectangle as positive walking support.
  f.flight.landings[0].ringsFeet.push([[44.6, 637.5], [48.1, 637.5], [48.1, 638.5], [44.6, 638.5]]);
  const proposed = make(f);
  assert.equal(validateNativeSourceStairWidth(proposed, f.floors, true), false);
  assert.equal(runtimeWidth(proposed, f.floors, true), false);
});

test("unsupported within-run seams do not acquire a landing detour", () => {
  const f = fixture();
  for (const t of f.flight.treads) t.runElementId = f.flight.treads[0].runElementId;
  const proposed = make(f);
  assert.equal(proposed.pointsFeet.length, f.flight.treads.length + 2);
  assert.equal(validateNativeSourceStairWidth(proposed, f.floors, true), false);
  assert.equal(runtimeWidth(proposed, f.floors, true), false);
});

const typedFixture = () => JSON.parse(readFileSync(new URL("./fixtures/native-turning-typed-tread-path.json", import.meta.url), "utf8"));
function internalGaps(treads: Parameters<typeof nativeSourceStairTreadPath>[0], points: number[][], projections: NonNullable<ReturnType<typeof nativeSourceStairRiserProjections>>) {
  return points.slice(1).flatMap((b, i) => {
    const a = points[i]!, dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, length = DMath.hypot(dx, dy);
    const nx = -dy / length, ny = dx / length;
    const strip = [[[[a[0]! + nx, a[1]! + ny], [b[0]! + nx, b[1]! + ny], [b[0]! - nx, b[1]! - ny], [a[0]! - nx, a[1]! - ny]]]] as [number, number][][][];
    const source = treads.filter((t) => t.elevationFeet >= a[2]! - .05 && t.elevationFeet <= b[2]! + .05).map((t) => [[...t.ringFeet, t.ringFeet[0]]]);
    const gap = nativeRationalOverlay("difference", strip, nativeRationalOverlay("union", source, nativeSourceStairRiserPartsForSegment(projections, a as [number, number, number], b as [number, number, number])));
    return gap.length ? [i] : [];
  });
}

test("the original Library typed turning tread supports an internal dogleg without skipping any native tread", () => {
  const f = typedFixture(), before = JSON.stringify(f);
  const projections = nativeSourceStairRiserProjections(f.inventory, f.carrier, f.receipt)!;
  assert.equal(projections.length, 20);
  // The strict riser helper supplies no projection at either side of this
  // concave platform. Its real original top must carry those two contacts.
  assert.equal(f.carrier.seamIndexes.includes(11), false);
  assert.equal(f.carrier.seamIndexes.includes(12), false);
  const original = f.receipt.treads.map((t: Parameters<typeof nativeSourceStairTreadPath>[0][number]) => [
    ...t.ringFeet.reduce((p: number[], q: number[]) => [p[0]! + q[0]! / t.ringFeet.length, p[1]! + q[1]! / t.ringFeet.length], [0, 0]), t.elevationFeet,
  ]);
  assert.deepEqual(internalGaps(f.receipt.treads, original, projections), [10, 11]);
  const proposed = nativeSourceStairTreadPath(f.receipt.treads, [], [], projections);
  assert.equal(proposed.length, f.receipt.treads.length + 1);
  assert.deepEqual(internalGaps(f.receipt.treads, proposed, projections), []);
  for (const tread of f.receipt.treads) assert.equal(proposed.some((point) => point[2] === tread.elevationFeet &&
    nativeRationalPointInParts(point.slice(0, 2) as [number, number], nativeRationalOverlay("union", [[tread.ringFeet]]))), true);
  assert.equal(JSON.stringify(f), before);
});

test("missing or moved original platform support and absent riser proof cannot make a full internal path", () => {
  for (const mutation of ["moved-platform", "wrong-height", "no-risers"] as const) {
    const f = typedFixture();
    const projections = nativeSourceStairRiserProjections(f.inventory, f.carrier, f.receipt)!;
    const treads = structuredClone(f.receipt.treads), platform = treads[11];
    if (mutation === "moved-platform") platform.ringFeet = platform.ringFeet.map(([x, y]: number[]) => [x! + 50, y]);
    if (mutation === "wrong-height") platform.elevationFeet += 2;
    const allowed = mutation === "no-risers" ? [] : projections;
    const proposed = nativeSourceStairTreadPath(treads, [], [], allowed);
    assert.notDeepEqual(internalGaps(treads, proposed, allowed), [], mutation);
  }
});

test("recovered original 1696012 typed platform passes source and runtime width mathematics without route approval", () => {
  const f = JSON.parse(readFileSync(new URL("./fixtures/native-turning-source-1696012.json", import.meta.url), "utf8"));
  const before = JSON.stringify(f);
  const projections = nativeSourceStairRiserProjections(f.inventory, f.carrier, f.receipt)!;
  assert.equal(projections.length, 20);
  assert.equal(f.receipt.treads.length, 23);
  const points = nativeSourceStairTreadPath(f.receipt.treads, [], [], projections);
  const proposed = { ...f.receipt, pointsFeet: [f.receipt.terminalCaps[0].pointFeet, ...points, f.receipt.terminalCaps[1].pointFeet] };
  assert.deepEqual(proposed.pointsFeet, f.inventory.pointsFeet);
  assert.equal(proposed.pointsFeet.length, 26);
  const options = { inventory: f.inventory, carrier: f.carrier, expectedOriginalSourceRiserInventorySha256: f.inventory.geometrySha256 };
  assert.equal(validateNativeSourceStairWidth(proposed, f.floors, true, options), true);
  assert.equal(runtimeWidth(proposed, f.floors, true, options), true);
  assert.equal(validateNativeSourceStairWidth(proposed, f.floors, true), false);
  assert.equal(JSON.stringify(f), before);
});
