import assert from "node:assert/strict";
import test from "node:test";
import { buildDwgDerivedOutlines, type DwgRawExtractEntity } from "../lib/reviter/dwg-derived-outlines.ts";
import { validateDwgDerivedOutlines } from "../lib/reviter/native-provisional-corner-seals.ts";

type P2 = [number, number];
const reg = { re: 0.0032, im: 0.0004, t: [10, 20] as [number, number] };
const f = ([x, y]: P2): P2 => [reg.re * x - reg.im * y + reg.t[0], reg.im * x + reg.re * y + reg.t[1]];
const sha = "5".repeat(64);
// raw units: a 4 m wall drawn as two LINEs, a column circle, a casing polyline closed by a raw LINE
const lineA: P2[] = [[0, 0], [4000, 0]];
const lineB: P2[] = [[0, 200], [4000, 200]];
const casingLine: P2[] = [[4000, -300], [4000, 900]];
const frame: P2[] = [[-100, -500], [5000, 1800]];
const entities: DwgRawExtractEntity[] = [
  { h: "L1", t: "LINE", l: "walls", p: lineA },
  { h: "L2", t: "LINE", l: "walls", p: lineB },
  { h: "L3", t: "LINE", l: "walls", p: casingLine },
  { h: "L4", t: "LINE", l: "walls", p: frame },
  { h: "C1", t: "CIRCLE", l: "walls", c: [4300, 100], r: 150 },
  { h: "P1", t: "LWPOLYLINE", l: "walls", closed: false, v: [[4000, -200, 0], [4600, -200, 0], [4600, 400, 0], [4000, 400, 0]] },
  { h: "P2", t: "LWPOLYLINE", l: "walls", closed: false, v: [[0, 1000, 0], [500, 1000, 0], [500, 1500, 0]] },
  { h: "C2", t: "CIRCLE", l: "walls", c: [2000, 100], r: 900 },
  { h: "C3", t: "CIRCLE", l: "other", c: [1000, 100], r: 100 },
  { h: "C4", t: "CIRCLE", l: "walls", c: [90000, 90000], r: 100 },
];
const boundaryReference = {
  sourceSha256: sha,
  sections: [
    {
      sectionId: "Test LVL 1",
      levelId: 1,
      wallSegments: [lineA, lineB, casingLine, frame, [[0, 1000], [500, 1000]], [[500, 1000], [500, 1500]]].map(
        (s) => s.map((p) => f(p as P2)) as [P2, P2],
      ),
      doorSegments: [],
    },
  ],
};
const build = () =>
  buildDwgDerivedOutlines({
    sourceDwgSha256: sha,
    rawExtract: [{ file: "raw.json", sha256: "7".repeat(64) }],
    layers: ["walls"],
    entities,
    boundaryReference,
    registrations: { "Test LVL 1": reg },
  });

test("raw DWG circles and casings become deterministic, receipt-bound derived outlines", () => {
  const out = build();
  assert.deepEqual(out, build(), "byte-identical on rebuild");
  const s = out.sections[0]!;
  assert.equal(s.registrationCheck.matchedSegments, 6);
  assert.ok(s.registrationCheck.maxEndpointErrorFeet <= 1e-9);
  // C1 column circle (64 chords) and P1 casing closed by raw line L3; P2 stays open, C2 is wider than a
  // casing, C3 is on another layer, C4 lies outside the section
  assert.deepEqual(
    s.outlines.map((o) => [o.handle, o.closure, o.closingLineHandle ?? null, o.ringFeet.length]),
    [
      ["C1", "circle", null, 64],
      ["P1", "closing-edge-on-raw-line", "L3", 4],
    ],
  );
  assert.equal(s.outlineSegments.length, 68);
  validateDwgDerivedOutlines(out, boundaryReference);
  const tampered = structuredClone(out);
  tampered.sections[0]!.outlineSegments[3]![1]![0] += 1e-9;
  assert.throws(() => validateDwgDerivedOutlines(tampered, boundaryReference), /Invalid derived DWG outline/);
  assert.throws(
    () => validateDwgDerivedOutlines(out, { ...boundaryReference, sourceSha256: "6".repeat(64) }),
    /Invalid derived DWG outline/,
  );
});

test("derived outlines require the registered drawing and a verified registration", () => {
  assert.throws(
    () =>
      buildDwgDerivedOutlines({
        sourceDwgSha256: "6".repeat(64),
        rawExtract: [{ file: "raw.json", sha256: "7".repeat(64) }],
        layers: ["walls"],
        entities,
        boundaryReference,
        registrations: { "Test LVL 1": reg },
      }),
    /registered drawing/,
  );
  const shifted = buildDwgDerivedOutlines({
    sourceDwgSha256: sha,
    rawExtract: [{ file: "raw.json", sha256: "7".repeat(64) }],
    layers: ["walls"],
    entities,
    boundaryReference,
    registrations: { "Test LVL 1": { ...reg, t: [10.01, 20] } },
  });
  assert.equal(shifted.sections.length, 0, "a registration that does not reproduce the registered segments yields nothing");
});
