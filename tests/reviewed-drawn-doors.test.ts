import test from "node:test";
import assert from "node:assert/strict";
import { buildDwgDerivedOutlines, type DwgRawExtractEntity } from "../lib/reviter/dwg-derived-outlines.ts";
import { nativeDerivedFrameHash } from "../lib/reviter/native-derived-frame-returns.ts";
import { dwgDerivedOutlinesHash, type DwgDerivedOutlines } from "../lib/reviter/native-provisional-corner-seals.ts";
import {
  applyReviewedDoorWallCuts,
  doorApertureGeometryKey,
  preparedReviewedDoorApertures,
  reviewedDoorOpening,
  validateDoorApertureBinding,
  validateReviewedDoorApertures,
  withReviewedDoorApertures,
  type ReviewedDoorApertures,
} from "../lib/reviter/reviewed-door-apertures.ts";
import {
  DRAWING_BACKED_DOOR_EVIDENCE,
  DWG_DRAWN_DOOR_ELEMENT_BASE,
  dwgDrawnDoorDatasetId,
  dwgDrawnDoorElementId,
  verifyDwgDrawnDoorDrawing,
  type DwgDrawnDoorPatch,
} from "../lib/reviter/reviewed-drawn-doors.ts";
import { dwgDrawnDoorPortal } from "../lib/reviter/reviewed-drawn-door-compile.ts";
import { architecturalPlanGeometry } from "../lib/reviter/architectural-plan.ts";
import { prepareIndoorDataset, sha256Bytes } from "../lib/reviter/indoor-pipeline.ts";
import type { DirectoryRoom, RoomDirectoryData } from "../lib/reviter/room-directory.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

type P2 = [number, number];
const dwgSha = "d".repeat(64),
  section = "07 synthetic LVL 1S",
  // A deliberately rotated and scaled registration, as for every registered UNBC section.
  reg = { re: 0.5, im: 0.25, t: [10, -5] as [number, number] };
const f = ([x, y]: P2): P2 => [reg.re * x - reg.im * y + reg.t[0], reg.im * x + reg.re * y + reg.t[1]];
const inv = ([X, Y]: P2): P2 => {
  const x = X - reg.t[0],
    y = Y - reg.t[1],
    d = reg.re ** 2 + reg.im ** 2;
  return [(reg.re * x + reg.im * y) / d, (-reg.im * x + reg.re * y) / d];
};
const quad = (x0: number, y0: number, x1: number, y1: number): P2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// 07-220-style door: host wall x -0.33..0.33 (0.66 ft) along y 0..24, DWG rough opening between
// caps at y 4 and y 7.3333 (3.333 ft), 3 ft leaf hinged 0.1667 ft above the lower cap, opening east.
const X0 = -0.33,
  X1 = 0.33,
  Y0 = 4,
  Y1 = 4 + 10 / 3,
  hinge: P2 = [0.17, Y0 + 1 / 6];
const drawn: { role: "cap" | "face" | "leaf" | "jamb"; s: [P2, P2] }[] = [
  { role: "face", s: [[X0, 0], [X0, Y0]] },
  { role: "face", s: [[X1, 0], [X1, Y0]] },
  { role: "face", s: [[X0, Y1], [X0, 24]] },
  { role: "face", s: [[X1, Y1], [X1, 24]] },
  { role: "cap", s: [[X0, Y0], [X1, Y0]] },
  { role: "cap", s: [[X1 - 0.08, Y1], [X1 - 0.04, Y1]] },
  { role: "cap", s: [[X0 + 0.04, Y1], [X0 + 0.08, Y1]] },
  { role: "jamb", s: [[X0 + 0.08, Y0], [X0 + 0.08, Y0 + 1 / 6]] },
  { role: "jamb", s: [[X1 - 0.08, Y1], [X1 - 0.08, Y1 - 1 / 6]] },
  { role: "leaf", s: [hinge, [hinge[0] + 3, hinge[1]]] },
  { role: "leaf", s: [[hinge[0], hinge[1] + 1 / 12], [hinge[0] + 3, hinge[1] + 1 / 12]] },
];
const unrelated: [P2, P2][] = [[[20, 0], [20, 24]], [[30, 0], [30, 24]]];
function drawing() {
  const raw = [...drawn.map((d) => d.s), ...unrelated].map((s) => s.map(inv) as [P2, P2]);
  const wallSegments = raw.map((s) => s.map(f) as [P2, P2]);
  const boundaryReference = {
    format: "reviter-boundary-reference" as const,
    version: 1 as const,
    coordinateSystem: "revit-model-feet" as const,
    sourceSha256: dwgSha,
    sections: [{ sectionId: section, levelId: 1, registrationErrorFeet: 0, wallSegments, doorSegments: [] as [P2, P2][] }],
  };
  const entities: DwgRawExtractEntity[] = raw.map((p, i) => ({ h: (0x3b000 + i).toString(16).toUpperCase(), t: "LINE", l: "1_Wall_Exist", p }));
  const rotation = Math.atan2(reg.im, reg.re),
    arc = { h: "3991C", t: "ARC", l: "1_Wall_Exist", c: inv(hinge), r: 3 / Math.hypot(reg.re, reg.im), a: [-rotation, Math.PI / 2 - rotation] as [number, number] };
  const derived = buildDwgDerivedOutlines({
    sourceDwgSha256: dwgSha,
    rawExtract: [{ file: "layer-1_Wall_Exist.json", sha256: "e".repeat(64) }],
    layers: ["1_Wall_Exist"],
    entities,
    boundaryReference,
    registrations: { [section]: reg },
  });
  return { raw, wallSegments, boundaryReference, entities, arc, derived };
}
function record(dw = drawing(), state: "proposed" | "applied" | "restored" = "applied"): DwgDrawnDoorPatch & { notes: string; frameEvidence: [] } {
  const boundary = dw.boundaryReference.sections[0]!,
    receipt = dw.derived.sections[0]!;
  return structuredClone({
    kind: "dwg-drawn-door" as const,
    id: "dwg-door:1:west-east:10",
    levelId: 1,
    hostWallNativeElementId: 10,
    apertureFeet: [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]],
    normalFeet: [1, 0],
    pointFeet: [(X0 + X1) / 2, (Y0 + Y1) / 2],
    roomKeys: ["west", "east"],
    swing: { hingeFeet: hinge, radiusFeet: 3, closedLeafFeet: [hinge, [hinge[0], hinge[1] + 3]], openLeafTipFeet: [hinge[0] + 3, hinge[1]], intoRoomKey: "east" },
    wallEvidence: [{ nativeElementId: 10, partsFeet: [[[X0, 0], [X0, 24], [X1, 24], [X1, 0]]] }],
    frameEvidence: [],
    dwgEvidence: {
      sourceDwgSha256: dwgSha,
      sectionId: section,
      registrationSha256: nativeDerivedFrameHash([dwgSha, boundary]),
      derivedOutlinesSha256: nativeDerivedFrameHash([dwgSha, receipt]),
      toleranceFeet: 0.05,
      arc: { handle: dw.arc.h, layer: dw.arc.l, centerRaw: dw.arc.c as P2, radiusRaw: dw.arc.r, anglesRadians: dw.arc.a },
      segments: drawn.map((d, i) => ({ role: d.role, index: i, segmentFeet: dw.wallSegments[i]!, rawLine: { handle: dw.entities[i]!.h, layer: "1_Wall_Exist", pointsRaw: dw.raw[i]! } })),
    },
    assumption: { kind: "drawing-backed", decisionId: "2026-10-10-round3#Q5.2", authorizationRecorded: true },
    state,
    notes: "Owner-approved drawing-backed door; the DWG draws a swing door where the native wall is solid.",
  });
}
const sha = "a".repeat(64);
const value = (p = record()): ReviewedDoorApertures => ({ version: 1, sourceModelSha256: sha, patches: [p] });
const host = { elementId: 10, categoryId: -2000011, wallKind: "basic", renderGeometryProvenance: "native", solid: { elementId: 10, start: { x: 0, y: 0 }, end: { x: 0, y: 24 }, baseElevation: 0, topElevation: 10, thickness: 0.66 }, boundsFeet: { min: { x: X0, y: 0, z: 0 }, max: { x: X1, y: 24, z: 10 } } };
const model = () => ({ elementBounds: [structuredClone(host)], nativeHostRelations: [] }) as unknown as ConvertResult;
const plan = () => ({ walls: [{ elementId: 10, polygon: [[X0, 0], [X0, 24], [X1, 24], [X1, 0]] as P2[], approximate: false }], columns: [] as { polygon: P2[] }[], floors: [[quad(-12, -2, 12, 26)]], cutElevation: 4, doors: [] as { elementId: number; polygon: P2[] }[] });
const room = (key: string, x0: number, x1: number): DirectoryRoom => ({ key, number: key, building: "07", name: key === "east" ? "Janitor" : "Washroom", levelId: 1, confidence: 1, polygonFeet: quad(x0, 0, x1, 24), labelPointFeet: [(x0 + x1) / 2, 12] });
const rooms = () => [room("west", -10, X0), room("east", X1, 10)];

test("an accepted 07-220-style drawing-backed door cuts only its host and proves its rooms", () => {
  const dw = drawing(),
    p = record(dw),
    m = withReviewedDoorApertures(model(), value(p), sha, plan),
    proof = verifyDwgDrawnDoorDrawing(p, dw.boundaryReference, dw.derived);
  assert.ok(Math.abs(proof.roughOpeningFeet - 10 / 3) < 1e-9);
  assert.ok(Math.abs(proof.radiusFeet - 3) < 1e-9 && Math.abs(proof.sweepDegrees - 90) < 1e-9);
  assert.equal(proof.openSide, 1);
  const cut = applyReviewedDoorWallCuts(m, 1, plan().walls);
  assert.equal(cut.length, 2, "the aperture splits the host into two pieces");
  assert.ok(cut.every((w) => w.polygon.every(([, y]) => y <= Y0 + 1e-9 || y >= Y1 - 1e-9)));
  assert.equal(reviewedDoorOpening(m, 1, 10), undefined, "no native door identity");
  const portal = dwgDrawnDoorPortal(p, rooms(), proof);
  assert.deepEqual(portal.rooms, ["west", "east"]);
  assert.ok(portal.from[0] < X0 + 1e-9 && portal.to[0] > X1 - 1e-9);
  const id = dwgDrawnDoorElementId(1, p.id);
  assert.ok(id > DWG_DRAWN_DOOR_ELEMENT_BASE && Number.isSafeInteger(id));
  assert.equal(dwgDrawnDoorElementId(1, p.id), id, "stable synthetic identity");
  assert.notEqual(dwgDrawnDoorElementId(1, p.id + "x"), id);
  assert.equal(dwgDrawnDoorDatasetId(p), "door:1:dwg:dwg-door:1:west-east:10");
});

test("proposed and restored drawing-backed doors are inert", () => {
  for (const state of ["proposed", "restored"] as const) {
    const p = record(drawing(), state),
      m = withReviewedDoorApertures(model(), value(p), sha, plan);
    assert.deepEqual(applyReviewedDoorWallCuts(m, 1, plan().walls), plan().walls);
  }
});

test("record shape: no native door id, complete swing, evidence, assumption and state", () => {
  assert.doesNotThrow(() => validateReviewedDoorApertures(value()));
  for (const edit of [
    (p: ReturnType<typeof record>) => ((p as typeof p & {nativeDoorId?:number}).nativeDoorId = 5),
    (p: ReturnType<typeof record>) => (p.frameEvidence = [{ nativeElementId: 1, orientedBox: [] }] as unknown as typeof p.frameEvidence),
    (p: ReturnType<typeof record>) => delete (p as Partial<typeof p>).swing,
    (p: ReturnType<typeof record>) => (p.swing.intoRoomKey = "elsewhere"),
    (p: ReturnType<typeof record>) => (p.roomKeys = ["west", "west"]),
    (p: ReturnType<typeof record>) => delete (p.dwgEvidence as Partial<typeof p.dwgEvidence>).arc,
    (p: ReturnType<typeof record>) => (p.dwgEvidence.segments = p.dwgEvidence.segments.filter((g) => g.role !== "leaf")),
    (p: ReturnType<typeof record>) => (p.dwgEvidence.toleranceFeet = 0.5),
    (p: ReturnType<typeof record>) => (p.assumption.authorizationRecorded = false as unknown as typeof p.assumption.authorizationRecorded),
    (p: ReturnType<typeof record>) => (p.state = "pending" as unknown as typeof p.state),
    (p: ReturnType<typeof record>) => (p.wallEvidence[0].nativeElementId = 11),
  ]) {
    const p = record();
    edit(p);
    assert.throws(() => validateReviewedDoorApertures(value(p)), /Invalid reviewed native door aperture/);
  }
});

test("refuses a record whose host wall is not at that position", () => {
  for (const edit of [
    (p: ReturnType<typeof record>, m: ReturnType<typeof model>) => p.apertureFeet.forEach((q: P2) => (q[0] += 0.2)),
    (p: ReturnType<typeof record>, m: ReturnType<typeof model>) => (m.elementBounds[0].wallKind = "curtain"),
    (p: ReturnType<typeof record>, m: ReturnType<typeof model>) => (m.elementBounds[0].solid!.thickness = 0.5),
    (p: ReturnType<typeof record>, m: ReturnType<typeof model>) => (p.hostWallNativeElementId = p.wallEvidence[0].nativeElementId = 11),
  ]) {
    const p = record(),
      m = model();
    edit(p, m);
    assert.throws(() => withReviewedDoorApertures(m, value(p), sha, plan), /refused|stale/);
  }
  const p = record(),
    g = plan();
  g.walls[0]!.polygon = [[X0, 5], [X0, 24], [X1, 24], [X1, 5]];
  p.wallEvidence[0]!.partsFeet = [g.walls[0]!.polygon];
  assert.throws(() => withReviewedDoorApertures(model(), value(p), sha, () => g), /host wall #10 is not at the aperture position/);
  const stale = record();
  stale.wallEvidence[0]!.partsFeet[0]![0]![0] -= 0.01;
  assert.throws(() => withReviewedDoorApertures(model(), value(stale), sha, plan), /stale/);
  const blocked = plan();
  blocked.columns.push({ polygon: quad(-0.1, 5, 0.1, 5.5) });
  assert.throws(() => withReviewedDoorApertures(model(), value(), sha, () => blocked), /meets a column/);
});

test("refuses an aperture wider than the drawn rough opening", () => {
  const dw = drawing(),
    p = record(dw);
  p.apertureFeet = [[X0, Y0 - 0.5], [X1, Y0 - 0.5], [X1, Y1], [X0, Y1]];
  p.pointFeet = [(X0 + X1) / 2, (Y0 - 0.5 + Y1) / 2];
  assert.doesNotThrow(() => withReviewedDoorApertures(model(), value(p), sha, plan), "the host itself is there");
  assert.throws(() => verifyDwgDrawnDoorDrawing(p, dw.boundaryReference, dw.derived), /wider than the drawn rough opening/);
  const narrow = record(dw);
  narrow.apertureFeet = [[X0, Y0 + 0.5], [X1, Y0 + 0.5], [X1, Y1], [X0, Y1]];
  assert.throws(() => verifyDwgDrawnDoorDrawing(narrow, dw.boundaryReference, dw.derived), /does not span/);
});

test("refuses missing or tampered DWG arc and leaf evidence", () => {
  const dw = drawing();
  assert.doesNotThrow(() => verifyDwgDrawnDoorDrawing(record(dw), dw.boundaryReference, dw.derived));
  const cases: [string, (p: ReturnType<typeof record>, d: { boundaryReference: ReturnType<typeof drawing>["boundaryReference"]; derived: DwgDerivedOutlines }) => void, RegExp][] = [
    ["moved arc", (p) => (p.dwgEvidence.arc.centerRaw[0] += 0.2), /recorded swing differs from raw ARC/],
    ["moved swing", (p) => (p.swing.hingeFeet[1] += 0.01), /recorded swing differs from raw ARC/],
    ["half-circle arc", (p) => (p.dwgEvidence.arc.anglesRadians[1] += Math.PI / 2), /not a door swing/],
    ["changed leaf segment", (p) => (p.dwgEvidence.segments.find((g) => g.role === "leaf")!.segmentFeet[1][0] += 0.01), /was changed/],
    ["changed raw LINE", (p) => (p.dwgEvidence.segments.find((g) => g.role === "leaf")!.rawLine.pointsRaw[1][0] += 0.01), /does not register/],
    ["leaf replaced by an unrelated line", (p) => {
      const leaf = p.dwgEvidence.segments.filter((g) => g.role === "leaf");
      for (const [k, g] of leaf.entries()) Object.assign(g, { index: drawn.length + k, segmentFeet: dw.wallSegments[drawn.length + k], rawLine: { handle: dw.entities[drawn.length + k]!.h, layer: "1_Wall_Exist", pointsRaw: dw.raw[drawn.length + k] } });
    }, /not on the drawn leaf/],
    ["leaf missing", (p) => (p.dwgEvidence.segments = p.dwgEvidence.segments.filter((g) => g.role !== "leaf")), /invalid record/],
    ["arc missing", (p) => delete (p.dwgEvidence as Partial<typeof p.dwgEvidence>).arc, /invalid record/],
    ["other drawing", (p) => (p.dwgEvidence.sourceDwgSha256 = "f".repeat(64)), /registered drawing/],
    ["no registration receipt", (_p, d) => ((d as Partial<typeof d>).derived = undefined), /registration receipt/],
    ["tampered registration receipt", (_p, d) => {
      const s = d.derived.sections[0]!;
      s.registration = { ...s.registration, t: [s.registration.t[0] + 0.01, s.registration.t[1]] };
      d.derived.geometrySha256 = dwgDerivedOutlinesHash(d.derived);
    }, /registration receipt .* differs/],
    ["tampered receipt digest", (_p, d) => (d.derived.sections[0]!.registration.re += 1e-9), /Invalid derived DWG outline/],
  ];
  for (const [name, edit, error] of cases) {
    const d = { boundaryReference: structuredClone(dw.boundaryReference), derived: structuredClone(dw.derived) },
      p = record(dw);
    edit(p, d);
    assert.throws(() => verifyDwgDrawnDoorDrawing(p, d.boundaryReference, d.derived), error, name);
  }
});

test("refuses rooms that are not on either side of the wall", () => {
  const dw = drawing(),
    p = record(dw),
    proof = verifyDwgDrawnDoorDrawing(p, dw.boundaryReference, dw.derived);
  assert.throws(() => dwgDrawnDoorPortal(p, [room("west", -10, X0), room("east", -20, -10.5)], proof), /does not adjoin/);
  assert.throws(() => dwgDrawnDoorPortal(p, [room("west", -10, X0), { ...room("east", -10, X0), polygonFeet: quad(-9, 0, X0, 24) }], proof), /not on either side/);
  const swapped = structuredClone(p);
  swapped.swing.intoRoomKey = "west";
  assert.throws(() => dwgDrawnDoorPortal(swapped, rooms(), proof), /does not open into west/);
});

async function compiled(state: "applied" | "restored" = "applied") {
  const modelFile = new File(["original"], "Synthetic.rvt"),
    hash = await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer())),
    dw = drawing(),
    floor = { elementId: 100, categoryId: -2000032, boundsFeet: { min: { x: -12, y: -2, z: -0.5 }, max: { x: 12, y: 26, z: 0 } }, loops: [[[-12, -2, 0], [12, -2, 0], [12, 26, 0], [-12, 26, 0]]] },
    m = {
      fileName: modelFile.name,
      origin: { x: 0, y: 0, z: 0 },
      levels: [{ levelId: 1, elevation: 0, candidates: 1, name: "Floor 1" }],
      elementBounds: [floor, structuredClone(host)],
      nativeAssociatedLevelRelations: [{ elementId: 100, levelId: 1 }, { elementId: 10, levelId: 1 }],
      nativeHostRelations: [],
      nativeStairAssemblies: [],
    } as unknown as ConvertResult;
  const p = { ...record(dw, state) };
  p.wallEvidence = [{ nativeElementId: 10, partsFeet: architecturalPlanGeometry(m, 1).walls.filter((w) => w.elementId === 10).map((w) => w.polygon) }];
  const data: RoomDirectoryData = {
    format: "reviter-room-annotations",
    version: 1,
    coordinateSystem: "revit-model-feet",
    model: { fileName: modelFile.name },
    annotations: rooms(),
    boundaryReference: dw.boundaryReference,
    dwgDerivedOutlines: dw.derived,
    reviewedDoorApertures: { version: 1, sourceModelSha256: hash, patches: [p] },
    georeference: {
      format: "reviter-georeference",
      version: 1,
      modelFileName: modelFile.name,
      coordinateSystem: "WGS84",
      method: "fixed-scale",
      points: [
        { id: "p", name: "Origin", modelFeet: [0, 0], levelId: 1, geographic: { longitude: -122, latitude: 53 } },
        { id: "q", name: "Second", modelFeet: [100, 0], levelId: 1, geographic: { longitude: -121.999545, latitude: 53 } },
      ],
    },
  } as RoomDirectoryData;
  return { data, p, dataset: await prepareIndoorDataset(m, data, hash) };
}

test("the compiled graph has the synthetic door and one drawing-backed door edge with unknown access", async () => {
  const { data, p, dataset } = await compiled();
  const id = dwgDrawnDoorDatasetId(p),
    door = dataset.doors?.find((d) => d.id === id);
  assert.ok(door, "synthetic dataset door");
  assert.equal(door.nativeElementId, dwgDrawnDoorElementId(1, p.id));
  assert.equal(door.hostWallNativeElementId, 10);
  assert.equal(door.drawingBackedPatchId, p.id);
  assert.equal(door.state, "connected");
  assert.deepEqual([...door.roomKeys].sort(), ["east", "west"]);
  const edges = dataset.edges.filter((e) => e.kind === "door");
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.id, id);
  assert.equal(edges[0]!.evidence, DRAWING_BACKED_DOOR_EVIDENCE);
  assert.equal(edges[0]!.accessible, "unknown");
  assert.equal(edges[0]!.enabled, true);
  assert.equal(dataset.edges.filter((e) => e.kind === "opening").length, 0, "no doorless opening is recovered through the cut");
  assert.ok(dataset.issues.some((i) => i.code === "drawing-backed-door"));
  assert.equal(dataset.walls.filter((w) => w.nativeElementId === 10).length, 2, "host cut in the prepared walls");
  assert.equal(dataset.doorAperturePatchState?.sourceGeometryKey, doorApertureGeometryKey(data.reviewedDoorApertures!));
  assert.doesNotThrow(() => validateDoorApertureBinding(data.reviewedDoorApertures, dataset));
  assert.equal(preparedReviewedDoorApertures(dataset)?.patches.length, 1);
  for (const edit of [
    (d: Parameters<typeof validateDoorApertureBinding>[1]) => (d.edges.find((e) => e.id === id)!.evidence = "native-door"),
    (d: Parameters<typeof validateDoorApertureBinding>[1]) => (d.edges.find((e) => e.id === id)!.accessible = "yes"),
    (d: Parameters<typeof validateDoorApertureBinding>[1]) => (d.doors = d.doors!.filter((x) => x.id !== id)),
    (d: Parameters<typeof validateDoorApertureBinding>[1]) => (d.doors!.find((x) => x.id === id)!.nativeElementId = 77),
  ]) {
    const changed = structuredClone(dataset);
    edit(changed);
    assert.throws(() => validateDoorApertureBinding(data.reviewedDoorApertures, changed));
  }
});

test("restoring the record drops the cut, the door and its edge at the next compile", async () => {
  const { data, p, dataset } = await compiled("restored");
  assert.equal(dataset.doors?.some((d) => d.id === dwgDrawnDoorDatasetId(p)), false);
  assert.equal(dataset.edges.some((e) => e.kind === "door"), false);
  assert.equal(dataset.walls.filter((w) => w.nativeElementId === 10).length, 1);
  assert.doesNotThrow(() => validateDoorApertureBinding(data.reviewedDoorApertures, dataset));
  assert.equal(preparedReviewedDoorApertures(dataset)?.patches.length, 0);
});
