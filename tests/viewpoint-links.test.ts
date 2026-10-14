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
    rawFragment({ ...valid, version: 2 }), rawFragment({ ...valid, coordinateSystem: "scene-units" }),
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
