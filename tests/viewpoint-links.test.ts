import test from "node:test";
import assert from "node:assert/strict";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { ModelViewpoint } from "../app/studio/viewer-tools.ts";
import {
  decodeViewpointFragment, encodeViewpointFragment, makeViewpointModelIdentity,
  portableViewpoint, resolveViewpointImport, VIEWPOINT_FRAGMENT_MAX_CHARS,
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
