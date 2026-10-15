import test from "node:test";
import assert from "node:assert/strict";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { MarkupStroke, ModelViewpoint } from "../app/studio/viewer-tools.ts";
import {
  decodeViewpointFragment, encodeViewpointFragment, makeViewpointModelIdentity,
  portableViewpoint, resolveViewpointImport, captureViewpointMarkup, mergeViewpointMarkup, VIEWPOINT_MAX_ANNOTATIONS, VIEWPOINT_MAX_MARKUP_POINTS, VIEWPOINT_MAX_MARKUP_TEXT, VIEWPOINT_FRAGMENT_MAX_CHARS,
  VIEWPOINT_FRAGMENT_PREFIX, viewpointLinkUrl, viewpointSourceFingerprint,
} from "../app/studio/viewpoint-links.ts";

const SHA_A = `sha256-${"a".repeat(64)}`;
const SHA_B = `sha256-${"b".repeat(64)}`;
const model = (origin = [1000, 2000, 30], fileName = "private-source.rvt") => ({
  fileName, byteLength: 1234, elementBounds: [], origin: { x: origin[0], y: origin[1], z: origin[2] },
} as unknown as ConvertResult);
const camera: ModelViewpoint = { source: "recovered", position: [10, 20, 30], target: [5, 6, 7], up: [0, 0, 1], fov: 45 };
const identity = () => makeViewpointModelIdentity(model(), SHA_A);
const encoded = () => encodeViewpointFragment(portableViewpoint(identity(), camera));
const rawFragment = (value: unknown) => `${VIEWPOINT_FRAGMENT_PREFIX}${btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")}`;

test("viewpoints use canonical model feet and restore camera through the open source origin", () => {
  const viewpoint = portableViewpoint(identity(), camera);
  assert.deepEqual(viewpoint.camera.positionFeet, [1010, 2020, 60]);
  const restored = resolveViewpointImport(encodeViewpointFragment(viewpoint), identity());
  assert.equal(restored.status, "ready");
  if (restored.status !== "ready") throw Error("expected ready");
  assert.deepEqual(restored.camera, camera);
  const otherOrigin = makeViewpointModelIdentity(model([900, 1900, 20], "renamed.rvt"), SHA_A);
  const reanchored = resolveViewpointImport(encodeViewpointFragment(viewpoint), otherOrigin);
  assert.equal(reanchored.status, "ready");
  if (reanchored.status === "ready") {
    assert.deepEqual(reanchored.camera.position, [110, 120, 40]);
    assert.deepEqual(reanchored.camera.target, [105, 106, 17]);
  }
});

test("exact source-byte identity refuses a same-name same-size foreign file and defers unopened files", () => {
  assert.equal(resolveViewpointImport(encoded()).status, "pending-model");
  const foreign = makeViewpointModelIdentity(model(), SHA_B);
  assert.equal(foreign.reviewFingerprint, identity().reviewFingerprint);
  const result = resolveViewpointImport(encoded(), foreign);
  assert.equal(result.status, "wrong-model");
  assert.ok(!("camera" in result));
  assert.throws(() => makeViewpointModelIdentity(model(), "fnv1a32-12345678"), /SHA-256/u);
});

test("the exact-source fingerprint is SHA256, without model bytes or filenames in fragment", async () => {
  assert.equal(await viewpointSourceFingerprint(new Uint8Array()), "sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.notEqual(await viewpointSourceFingerprint(new Uint8Array([1])), await viewpointSourceFingerprint(new Uint8Array([2])));
  const decoded = decodeViewpointFragment(encoded());
  assert.ok(decoded);
  assert.ok(!JSON.stringify(decoded).includes("private-source"));
  assert.deepEqual(Object.keys(decoded!), ["format", "version", "sourceFingerprint", "reviewFingerprint", "coordinateSystem", "sourceOriginFeet", "camera"]);
});

test("reference metre camera converts through the existing comment coordinate contract, unregistered GLB refuses", () => {
  const reference: ModelViewpoint = { ...camera, source: "reference", position: [0.3048, 0.6096, 0.9144], target: [0,0,0] };
  const view = portableViewpoint(identity(), reference);
  view.camera.positionFeet.forEach((value, axis) => assert.ok(Math.abs(value - (axis + 1)) < 1e-12));
  assert.throws(() => portableViewpoint(identity(), { ...camera, source: "reference-model" }), /no registered Revit camera frame/u);
});

test("camera FOV is clamped, up vector normalized, and degenerate poses rejected", () => {
  const high = portableViewpoint(identity(), { ...camera, up: [0, 0, 3], fov: 999 });
  assert.equal(high.camera.fov, 120);
  assert.deepEqual(high.camera.up, [0,0,1]);
  assert.equal(portableViewpoint(identity(), { ...camera, fov: 1 }).camera.fov, 5);
  for (const invalid of [
    { ...camera, fov: NaN }, { ...camera, fov: 0 }, { ...camera, up: [0,0,0] },
    { ...camera, target: camera.position }, { ...camera, position: [1e100,0,0] },
    { ...camera, position: [0,0,2], target: [0,0,0], up: [0,0,1] },
  ]) assert.throws(() => portableViewpoint(identity(), invalid as ModelViewpoint), /cannot be shared/u);
});

test("malformed, oversized, noncanonical and unsupported fragments never restore", () => {
  const valid = portableViewpoint(identity(), camera);
  for (const fragment of [
    "#reviter-view=", "#reviter-view=abc$", "#reviter-view=a", "#reviter-view=@@@@", "#v=AAAA", rawFragment({}),
    rawFragment({ ...valid, version: 3 }), rawFragment({ ...valid, coordinateSystem: "scene-units" }),
    rawFragment({ ...valid, sourceFingerprint: "fnv1a32-12345678" }),
    rawFragment({ ...valid, camera: { ...valid.camera, fov: null } }),
    rawFragment({ ...valid, camera: { ...valid.camera, positionFeet: [1e99,0,0] } }),
    `${VIEWPOINT_FRAGMENT_PREFIX}${"a".repeat(VIEWPOINT_FRAGMENT_MAX_CHARS)}`,
  ]) assert.equal(resolveViewpointImport(fragment, identity()).status, "invalid");
  assert.equal(resolveViewpointImport("", identity()).status, "empty");
  assert.equal(resolveViewpointImport("#", identity()).status, "empty");
});

test("URLs keep the camera in the fragment and discard credentials/private query data", () => {
  const link = viewpointLinkUrl("https://alice:secret@example.com/reviter/?model=C%3A%5CPrivate%5Cfile.rvt&camera-position-feet=1,2,3#old", portableViewpoint(identity(), camera));
  const url = new URL(link);
  assert.equal(url.search, "");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.equal(url.pathname, "/reviter/");
  assert.ok(url.hash.startsWith(VIEWPOINT_FRAGMENT_PREFIX));
  assert.deepEqual(decodeViewpointFragment(link), decodeViewpointFragment(url.hash));
  assert.throws(() => viewpointLinkUrl("file:///private/model.rvt", portableViewpoint(identity(), camera)), /HTTP or HTTPS/u);
});

test("unknown decoded fields are discarded and encoding stays deterministic", () => {
  const view = portableViewpoint(identity(), camera);
  const malicious = rawFragment({ ...view, filename: "secret.rvt", camera: { ...view.camera, projectionMatrix: [1,2,3] } });
  assert.deepEqual(decodeViewpointFragment(malicious), view);
  assert.equal(encodeViewpointFragment(view), encodeViewpointFragment(view));
});

const viewer = { hiddenCategories: ["Windows", "Doors", "Windows"], section: { enabled: true, mode: "x" as const, offset: 0.37, reverse: true } };
test("v2 preserves bounded category and section state while v1 remains camera-only", () => {
  const v2 = portableViewpoint(identity(), camera, viewer);
  assert.throws(() => portableViewpoint(identity(), { ...camera, source: "reference" }, viewer), /Switch to the RVT view/u);
  assert.equal(v2.version, 2);
  const imported = resolveViewpointImport(encodeViewpointFragment(v2), identity());
  assert.equal(imported.status, "ready");
  if (imported.status !== "ready") throw Error("expected ready");
  assert.deepEqual(imported.viewpoint.viewer, { ...viewer, hiddenCategories: ["Doors", "Windows"] });
  assert.deepEqual(imported.camera, camera);
  const v1 = portableViewpoint(identity(), camera);
  assert.equal(v1.version, 1);
  assert.equal(decodeViewpointFragment(encodeViewpointFragment(v1))?.viewer, undefined);
  const dirty = rawFragment({ ...v2, viewer: { ...viewer, assetUrl: "private.rvt", section: { ...viewer.section, planes: [1,2,3] } } });
  assert.deepEqual(decodeViewpointFragment(dirty), v2);
});

test("v2 rejects invalid section state, category budgets and changed recovered layout before applying", () => {
  const v2 = portableViewpoint(identity(), camera, viewer);
  for (const state of [
    { ...viewer, hiddenCategories: Array.from({ length: 65 }, (_, index) => `Category ${index}`) },
    { ...viewer, hiddenCategories: ["x".repeat(97)] },
    { ...viewer, hiddenCategories: ["Category\nName"] },
    { ...viewer, hiddenCategories: [123] },
    { ...viewer, section: { ...viewer.section, offset: -0.1 } },
    { ...viewer, section: { ...viewer.section, offset: 1.01 } },
    { ...viewer, section: { ...viewer.section, mode: "planes" } },
    { ...viewer, section: { ...viewer.section, enabled: "true" } },
    { ...viewer, section: null },
  ]) assert.equal(resolveViewpointImport(rawFragment({ ...v2, viewer: state }), identity()).status, "invalid");
  assert.equal(resolveViewpointImport(rawFragment({ ...v2, viewer: undefined }), identity()).status, "invalid");
  assert.equal(resolveViewpointImport(encodeViewpointFragment(v2), { ...identity(), reviewFingerprint: "fnv1a32-12345678" }).status, "invalid");
  assert.equal(resolveViewpointImport(encodeViewpointFragment(v2), { ...identity(), fingerprint: SHA_B }).status, "wrong-model");
  const excessive = portableViewpoint(identity(), camera, { ...viewer, hiddenCategories: Array.from({ length: 64 }, (_, index) => `${index}${"x".repeat(92)}`) });
  assert.throws(() => encodeViewpointFragment(excessive), /size limit/u);
});

const scopedIdentity = () => makeViewpointModelIdentity({ ...model(), elementBounds: [{ elementId: 42 }], meshes: [{ elementIds: new Uint32Array([43, 43]) }] } as unknown as ConvertResult, SHA_A);
const annotation = () => ({ id: "review:001", tool: "text" as const, pointsFeet: [[1010, 2020, 60]] as [number, number, number][], color: "#AbCdEf", weightFeet: 0.1, text: "Door review" });
const stroke = (): MarkupStroke => ({ id: "review:001", source: "recovered", tool: "text", points: [[10, 20, 30]], color: "#abcdef", worldWeight: 0.1, text: "Door review", createdAt: "2026-10-14T20:00:00.000Z" });

test("v3 selected element identity includes source bounds and mesh owners, rejects foreign elements on capture and import", () => {
  const scope = scopedIdentity(); assert.deepEqual([...scope.elementIds!], [42, 43]);
  for (const selectedElementId of [42, 43]) {
    const v3 = portableViewpoint(scope, camera, { ...viewer, selectedElementId, renderMode: "xray" });
    assert.equal(v3.version, 3);
    const restored = resolveViewpointImport(encodeViewpointFragment(v3), scope);
    assert.equal(restored.status, "ready");
    if (restored.status === "ready") { assert.equal(restored.viewpoint.viewer?.selectedElementId, selectedElementId); assert.equal(restored.viewpoint.viewer?.renderMode, "xray"); }
    const outsideScope = { ...scope, elementIds: new Set([999]) };
    assert.equal(resolveViewpointImport(encodeViewpointFragment(v3), outsideScope).status, "invalid");
  }
  assert.throws(() => portableViewpoint(scope, camera, { ...viewer, selectedElementId: 999 }), /not present/u);
  assert.throws(() => portableViewpoint({ ...scope, elementIds: undefined }, camera, { ...viewer, selectedElementId: 42 }), /not present/u);
  assert.equal(resolveViewpointImport(encodeViewpointFragment(portableViewpoint(scope, camera, { ...viewer, selectedElementId: 42 }))).status, "pending-model");
});

test("v3 render mode and explicit selection clearing roundtrip without making annotations implicit", () => {
  for (const renderMode of ["technical", "xray"] as const) {
    const v3 = portableViewpoint(scopedIdentity(), camera, { ...viewer, selectedElementId: null, renderMode });
    const restored = resolveViewpointImport(encodeViewpointFragment(v3), scopedIdentity());
    assert.equal(restored.status, "ready");
    if (restored.status === "ready") { assert.equal(restored.viewpoint.viewer?.selectedElementId, null); assert.equal(restored.viewpoint.viewer?.renderMode, renderMode); assert.equal(restored.viewpoint.viewer?.annotations, undefined); }
  }
  assert.equal(portableViewpoint(identity(), camera, viewer).version, 2);
});

test("v3 selection/render controls reject malformed values and refuse wrong source/layout before restore", () => {
  const valid = portableViewpoint(scopedIdentity(), camera, { ...viewer, selectedElementId: 42, renderMode: "technical" });
  for (const selectedElementId of [0, -1, 1.25, "42", true, Number.MAX_SAFE_INTEGER + 1]) {
    const imported = resolveViewpointImport(rawFragment({ ...valid, viewer: { ...valid.viewer, selectedElementId } }), scopedIdentity());
    assert.equal(imported.status, "invalid"); assert.ok(!("camera" in imported));
  }
  for (const renderMode of ["wireframe", "Technical", "", 0, null, true]) assert.equal(resolveViewpointImport(rawFragment({ ...valid, viewer: { ...valid.viewer, renderMode } }), scopedIdentity()).status, "invalid");
  assert.equal(resolveViewpointImport(encodeViewpointFragment(valid), { ...scopedIdentity(), fingerprint: SHA_B }).status, "wrong-model");
  assert.equal(resolveViewpointImport(encodeViewpointFragment(valid), { ...scopedIdentity(), reviewFingerprint: "fnv1a32-12345678" }).status, "invalid");
});

test("v3 opt-in review markup retains canonical source feet, normalizes color and uses UTF-8 fragments", () => {
  const saved = captureViewpointMarkup([{ ...stroke(), text: "Entrée door ↗" }], identity());
  assert.deepEqual(saved[0].pointsFeet, [[1010, 2020, 60]]); assert.equal(saved[0].weightFeet, 0.1);
  const v3 = portableViewpoint(identity(), camera, { ...viewer, annotations: saved }); assert.equal(v3.version, 3);
  const restored = resolveViewpointImport(encodeViewpointFragment(v3), identity()); assert.equal(restored.status, "ready");
  if (restored.status === "ready") { assert.deepEqual(restored.viewpoint.viewer?.annotations, saved); assert.equal(restored.viewpoint.viewer?.annotations?.[0].text, "Entrée door ↗"); }
  const raw = annotation(), view = portableViewpoint(identity(), camera, { ...viewer, annotations: [raw] });
  assert.equal(view.viewer?.annotations?.[0].color, "#abcdef");
  raw.pointsFeet[0][0] = -123; assert.equal(view.viewer?.annotations?.[0].pointsFeet[0][0], 1010);
});

test("markup capture respects registered metre/feet frames and retained canonical anchors", () => {
  const metre: MarkupStroke = { ...stroke(), source: "reference", points: [[0.3048, 0.6096, 0.9144]], worldWeight: 0.03048 };
  const fromMetres = captureViewpointMarkup([metre], identity())[0];
  fromMetres.pointsFeet[0].forEach((coordinate, axis) => assert.ok(Math.abs(coordinate - (axis + 1)) < 1e-12));
  assert.ok(Math.abs(fromMetres.weightFeet - 0.1) < 1e-12);
  const retained = { ...stroke(), pointsFeet: [[11, 22, 33]] as [number, number, number][], points: [[999, 999, 999]] as [number, number, number][] };
  assert.deepEqual(captureViewpointMarkup([retained], identity())[0].pointsFeet, [[11, 22, 33]]);
  assert.throws(() => captureViewpointMarkup([{ ...stroke(), source: "reference-model" }], identity()), /no registered source frame/u);
  const merged = mergeViewpointMarkup([], [annotation()], makeViewpointModelIdentity(model([900, 1900, 20]), SHA_A), "2026-10-14T22:00:00.000Z");
  assert.deepEqual(merged[0].pointsFeet, [[1010, 2020, 60]]); assert.deepEqual(merged[0].points, [[110, 120, 40]]); assert.equal(merged[0].source, "recovered");
});

test("markup capture and fragment parsing enforce count, total point, text and duplicate identity budgets", () => {
  const valid = portableViewpoint(identity(), camera, { ...viewer, annotations: [annotation()] });
  const annotations = (count: number) => Array.from({ length: count }, (_, index) => ({ ...annotation(), id: `review:${index}` }));
  for (const invalid of [
    annotations(VIEWPOINT_MAX_ANNOTATIONS + 1),
    [{ ...annotation(), pointsFeet: Array.from({ length: VIEWPOINT_MAX_MARKUP_POINTS + 1 }, () => [1, 2, 3]) }],
    [{ ...annotation(), pointsFeet: Array.from({ length: 65 }, () => [1, 2, 3]) }, { ...annotation(), id: "other", pointsFeet: Array.from({ length: 64 }, () => [1, 2, 3]) }],
    [annotation(), annotation()], [{ ...annotation(), text: "x".repeat(VIEWPOINT_MAX_MARKUP_TEXT + 1) }],
  ]) assert.equal(resolveViewpointImport(rawFragment({ ...valid, viewer: { ...valid.viewer, annotations: invalid } }), identity()).status, "invalid");
  assert.throws(() => captureViewpointMarkup(Array.from({ length: 17 }, (_, index) => ({ ...stroke(), id: `review:${index}` })), identity()), /limits/u);
  assert.throws(() => captureViewpointMarkup([{ ...stroke(), points: Array.from({ length: 129 }, () => [1, 2, 3]) }], identity()), /limits/u);
  assert.throws(() => captureViewpointMarkup([stroke(), stroke()], identity()), /limits/u);
  assert.equal(captureViewpointMarkup([{ ...stroke(), points: Array.from({ length: 128 }, () => [1, 2, 3]), text: "x".repeat(256) }], identity())[0].pointsFeet.length, 128);
});

test("malformed markup cannot become viewer state: tools, ID/control text, coordinates, color and weights", () => {
  const v3 = portableViewpoint(identity(), camera, { ...viewer, annotations: [annotation()] });
  for (const fields of [
    { id: "invalid id" }, { id: "" }, { id: "x".repeat(97) }, { tool: "delete" }, { tool: "comment" },
    { pointsFeet: [] }, { pointsFeet: [[1, 2]] }, { pointsFeet: [[1e9, 0, 0]] }, { pointsFeet: [["1", 2, 3]] },
    { color: "red" }, { color: "#fff" }, { color: "url(private.rvt)" },
    { weightFeet: 0 }, { weightFeet: -0.1 }, { weightFeet: 1001 }, { weightFeet: "0.1" },
    { text: "unsafe\u0000label" }, { text: "unsafe\u000blabel" }, { text: 77 },
  ]) assert.equal(resolveViewpointImport(rawFragment({ ...v3, viewer: { ...v3.viewer, annotations: [{ ...annotation(), ...fields }] } }), identity()).status, "invalid", JSON.stringify(fields));
  const allowed = portableViewpoint(identity(), camera, { ...viewer, annotations: [{ ...annotation(), text: "Line one\nLine two\ttab" }] });
  assert.equal(resolveViewpointImport(encodeViewpointFragment(allowed), identity()).status, "ready");
});

test("markup merge preserves local history, deduplicates canonical content and renames colliding IDs", () => {
  const local = stroke(), different = { ...annotation(), pointsFeet: [[1011, 2020, 60]] as [number, number, number][] };
  const before = JSON.stringify(local), createdAt = "2026-10-14T22:00:00.000Z";
  const same = mergeViewpointMarkup([local], [annotation()], identity(), createdAt);
  assert.equal(same.length, 1); assert.equal(same[0], local); assert.equal(JSON.stringify(local), before);
  const merged = mergeViewpointMarkup([local, { ...local, id: "shared:review:001:1", text: "Other local text" }], [different], identity(), createdAt);
  assert.equal(merged.length, 3); assert.equal(merged[0], local); assert.equal(merged[2].id, "shared:review:001:2");
  assert.equal(merged[2].createdAt, createdAt); assert.deepEqual(merged[2].points, [[11, 20, 30]]); assert.equal(JSON.stringify(local), before);
  assert.equal(mergeViewpointMarkup(merged, [{ ...different, id: "another-id" }], identity(), createdAt).length, 3);
  assert.throws(() => mergeViewpointMarkup([local], [{ ...annotation(), weightFeet: -1 }], identity(), createdAt), /Invalid viewpoint markup/u);
  assert.equal(JSON.stringify(local), before);
});

test("v3 whitelist strips unknown viewer/markup payloads while legacy versions preserve their narrower contracts", () => {
  const v3 = portableViewpoint(scopedIdentity(), camera, { ...viewer, renderMode: "technical", selectedElementId: 42, annotations: [annotation()] });
  const untrusted = { ...v3, filename: "private.rvt", viewer: { ...v3.viewer, sourceUrl: "file:///private.rvt", annotations: v3.viewer!.annotations!.map(a => ({ ...a, imageUrl: "https://private.example/image", source: "reference-model", points: [[1, 2, 3]], __proto__: { admin: true } })) } };
  assert.deepEqual(decodeViewpointFragment(rawFragment(untrusted)), v3);
  const v1 = portableViewpoint(identity(), camera), legacy1 = decodeViewpointFragment(rawFragment({ ...v1, viewer: v3.viewer }));
  assert.deepEqual(legacy1, v1);
  const v2 = portableViewpoint(identity(), camera, viewer);
  for (const futureControls of [{ selectedElementId: null }, { renderMode: "xray" }, { annotations: [] }]) assert.equal(decodeViewpointFragment(rawFragment({ ...v2, viewer: { ...v2.viewer, ...futureControls } })), undefined);
  assert.equal(decodeViewpointFragment(rawFragment({ ...v3, version: 4 })), undefined);
});


test("direct markup helpers reject unregistered runtime sources and aggregate-invalid import batches", () => {
  for (const source of ["foreign-model", "", null]) assert.throws(() => captureViewpointMarkup([{ ...stroke(), source } as unknown as MarkupStroke], identity()), /no registered source frame/u);
  const annotations = (count: number) => Array.from({ length: count }, (_, index) => ({ ...annotation(), id: `review:${index}` }));
  const original = stroke(), before = JSON.stringify(original);
  for (const batch of [
    annotations(17), [annotation(), annotation()],
    [{ ...annotation(), pointsFeet: Array.from({ length: 65 }, () => [1, 2, 3] as [number, number, number]) }, { ...annotation(), id: "other", pointsFeet: Array.from({ length: 64 }, () => [1, 2, 3] as [number, number, number]) }],
  ]) assert.throws(() => mergeViewpointMarkup([original], batch, identity(), "2026-10-14T22:00:00.000Z"), /Invalid viewpoint markup/u);
  assert.equal(JSON.stringify(original), before);
});
