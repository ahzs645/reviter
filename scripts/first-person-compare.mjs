#!/usr/bin/env node

// Locked-camera screenshot pairs of the recovered model and the paired
// Autodesk GLB, one pair per named shot, for eye-level comparison at the
// places the voxel diff flags. The camera is placed imperatively through
// window.__reviterNavigation, so the same pose renders both sources via the
// studio's canonical camera handoff.
//
//   node scripts/first-person-compare.mjs dist-pages model.rvt reference.glb out-dir shots.json
//
// shots.json: [{ "name": "stair-1801503", "position": [x,y,z], "target": [x,y,z] }, ...]
// Coordinates are model feet (the same frame as ?camera-position-feet).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { chromium } from "playwright";

const [distDir, revitFile, glbFile, outDir, shotsFile] = process.argv.slice(2);
if (!shotsFile) {
  console.error(
    "usage: first-person-compare.mjs dist-pages model.rvt reference.glb out-dir shots.json",
  );
  process.exit(2);
}
const shots = JSON.parse(readFileSync(shotsFile, "utf8"));

const MIME = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".wasm", "application/wasm"],
  [".json", "application/json"],
]);
const server = createServer((request, response) => {
  try {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = path === "/" ? "/index.html" : path;
    const body = readFileSync(join(resolve(distDir), file));
    response.writeHead(200, {
      "content-type": MIME.get(extname(file)) ?? "application/octet-stream",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404);
    response.end(String(error));
  }
});
await new Promise((ready) => server.listen(4179, ready));

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
} catch (error) {
  if (!(error instanceof Error) || !/Executable doesn't exist/u.test(error.message)) throw error;
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] });
}
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", error.message));

await page.goto("http://localhost:4179/?navigation-test=1", { waitUntil: "networkidle" });
await page.setInputFiles('input[type="file"][accept*=".rvt"]', resolve(revitFile));
for (let attempt = 0; attempt < 400; attempt += 1) {
  await page.waitForTimeout(1_500);
  const phase = await page.locator("main.studio").getAttribute("data-phase");
  if (phase === "ready") break;
  if (phase === "error") throw new Error("conversion failed");
}
console.log("conversion ready");

await page.setInputFiles('input[type="file"][accept*=".glb"]', resolve(glbFile));
await page.waitForFunction(() => {
  const buttons = [...document.querySelectorAll("button")];
  const source = buttons.find((button) => button.textContent?.trim() === "Autodesk GLB");
  return source && source.getAttribute("aria-disabled") !== "true" && !source.hasAttribute("disabled");
}, null, { timeout: 120_000 });
console.log("glb paired");

// Derive the model-feet -> scene transform from live camera correspondences:
// place the camera at scene positions, read the dataset's feet echo, and fit
// scene = R * feet * s + T with R fixed to the studio's z-up -> y-up rotation.
const deriveTransform = async () => {
  const samples = [];
  // Distinct per-axis deltas so the axis mapping is identifiable.
  for (const probe of [[10, 20, 30], [40, 55, 70]]) {
    const previous = await page.evaluate(() =>
      document.querySelector("canvas.model-canvas")?.dataset.modelCameraPositionFeet ?? "");
    await page.evaluate((position) => {
      const navigation = window.__reviterNavigation;
      navigation.camera.position.set(position[0], position[1], position[2]);
      navigation.controls.update();
    }, probe);
    // The dataset echo is written by the render loop, so wait for a frame
    // that reflects the move rather than reading synchronously.
    await page.waitForFunction((stale) => {
      const echo = document.querySelector("canvas.model-canvas")?.dataset.modelCameraPositionFeet;
      return !!echo && echo !== stale;
    }, previous, { timeout: 30_000 });
    const sample = await page.evaluate((position) => ({
      scene: position,
      feet: document.querySelector("canvas.model-canvas").dataset.modelCameraPositionFeet,
    }), probe);
    samples.push({ scene: sample.scene, feet: sample.feet.split(",").map(Number) });
  }
  const scale = await page.evaluate(() => window.__reviterNavigation.sceneUnitsPerFoot);
  // Identify which feet axis (and sign) feeds each scene axis from the two
  // probes' deltas, then the translation from either sample. Assuming a
  // particular rotation silently produced wrong poses before; deriving the
  // signed permutation makes the frame an observation instead of a guess.
  const sceneDelta = samples[1].scene.map((value, axis) => value - samples[0].scene[axis]);
  const feetDelta = samples[1].feet.map((value, axis) => value - samples[0].feet[axis]);
  const mapping = sceneDelta.map((delta, sceneAxis) => {
    for (let feetAxis = 0; feetAxis < 3; feetAxis += 1) {
      for (const sign of [1, -1]) {
        if (Math.abs(feetDelta[feetAxis] * scale * sign - delta) < 0.01) {
          return { feetAxis, sign };
        }
      }
    }
    throw new Error(`no feet axis maps to scene axis ${sceneAxis}`);
  });
  const applyLinear = (feet) => mapping.map(({ feetAxis, sign }) =>
    feet[feetAxis] * scale * sign);
  const translation = samples[0].scene.map((value, axis) =>
    value - applyLinear(samples[0].feet)[axis]);
  const check = applyLinear(samples[1].feet).map((value, axis) =>
    value + translation[axis]);
  const residual = Math.max(...check.map((value, axis) =>
    Math.abs(value - samples[1].scene[axis])));
  if (residual > 0.01) throw new Error(`transform residual ${residual}`);
  return (feet) => applyLinear(feet).map((value, axis) => value + translation[axis]);
};
const switchSource = async (label, activeSource) => {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForFunction((expected) =>
    document.querySelector("canvas.model-canvas")?.dataset.activeSource === expected,
  activeSource, { timeout: 120_000 });
};

// The feet echo only exists on sources with a model-feet mapping, so make
// sure the recovered model is active before deriving the transform.
await switchSource("RVT", "recovered");
const toScene = await deriveTransform();

const readPose = () => page.evaluate(() => {
  const navigation = window.__reviterNavigation;
  return {
    position: navigation.camera.position.toArray(),
    target: navigation.controls.target.toArray(),
  };
});
const writePose = (pose) => page.evaluate(({ position, target }) => {
  const navigation = window.__reviterNavigation;
  navigation.controls.target.set(target[0], target[1], target[2]);
  navigation.camera.position.set(position[0], position[1], position[2]);
  navigation.camera.lookAt(target[0], target[1], target[2]);
  navigation.controls.update();
}, pose);

// The source handoff renormalizes the camera by each scene's own centre and
// radius, so the same spot renders at a different distance on the paired GLB.
// Measure the RVT-scene -> GLB-scene similarity once from two handoffs, then
// place the GLB camera explicitly instead of trusting the handoff.
const settledPose = async () => {
  let previous = await readPose();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(250);
    const current = await readPose();
    const drift = Math.max(...current.position.map((value, axis) =>
      Math.abs(value - previous.position[axis])));
    if (drift < 1e-4) return current;
    previous = current;
  }
  return previous;
};

const writePoseVerified = async (pose) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await writePose(pose);
    await page.waitForTimeout(250);
    const current = await readPose();
    const miss = Math.max(...pose.position.map((value, axis) =>
      Math.abs(value - current.position[axis])));
    if (miss < 0.01) return;
  }
  console.log("warning: pose did not hold", JSON.stringify(pose.position));
};

const deriveGlbMap = async () => {
  const pairs = [];
  for (const probe of [[10, 20, 30], [40, 55, 70]]) {
    await switchSource("RVT", "recovered");
    await writePoseVerified({ position: probe, target: [0, 0, 0] });
    await switchSource("Autodesk GLB", "reference-model");
    // The handoff pose applies asynchronously after the mount; wait for it
    // to stop moving before treating it as the correspondence.
    pairs.push({ rvt: probe, glb: (await settledPose()).position });
  }
  // The reference scene is not axis-aligned with the recovered one (y-up GLB
  // against the z-up recovered frame), so detect the signed axis permutation
  // and the one uniform scale rather than assuming a diagonal map.
  const rvtDelta = pairs[1].rvt.map((value, axis) => value - pairs[0].rvt[axis]);
  const glbDelta = pairs[1].glb.map((value, axis) => value - pairs[0].glb[axis]);
  let best = null;
  for (const permutation of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    for (const signs of [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
      [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]]) {
      const scale = glbDelta[0] / (signs[0] * rvtDelta[permutation[0]]);
      if (!Number.isFinite(scale) || scale <= 0) continue;
      const residual = Math.max(...[1, 2].map((axis) =>
        Math.abs(glbDelta[axis] - scale * signs[axis] * rvtDelta[permutation[axis]])));
      if (!best || residual < best.residual) best = { permutation, signs, scale, residual };
    }
  }
  if (!best || best.residual > Math.abs(glbDelta[0]) * 0.02 + 0.01) {
    throw new Error(`no rigid RVT->GLB frame map (residual ${best?.residual})`);
  }
  const { permutation, signs, scale } = best;
  const linear = (point) => [0, 1, 2].map((axis) =>
    scale * signs[axis] * point[permutation[axis]]);
  const offset = pairs[0].glb.map((value, axis) => value - linear(pairs[0].rvt)[axis]);
  return (point) => linear(point).map((value, axis) => value + offset[axis]);
};
const rvtSceneToGlbScene = await deriveGlbMap();

const setXray = async (enabled) => {
  await page.getByRole("button", { name: enabled ? "X-ray" : "Shaded", exact: true })
    .first().click();
  await page.waitForTimeout(300);
};

for (const shot of shots) {
  await switchSource("RVT", "recovered");
  if (shot.xray) await setXray(true);
  if (shot.elementId) {
    // The studio's own framing is the reliable way to land on an element;
    // blind model-feet coordinates put the camera inside geometry.
    const objectFilter = page.getByPlaceholder("Filter by id, category, type");
    await objectFilter.fill(String(shot.elementId));
    await page.waitForTimeout(300);
    await page.locator(".object-row").first().click();
    const zoom = page.getByRole("button", { name: "Zoom to object", exact: true });
    await zoom.click();
    await page.waitForTimeout(600);
  }
  if (shot.position) {
    // Damped controls can pull the camera away from a directly written pose;
    // write, settle, verify the dataset echo, and retry until it holds.
    const scenePosition = toScene(shot.position);
    const sceneTarget = toScene(shot.target);
    let echo = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await writePose({ position: scenePosition, target: sceneTarget });
      await page.waitForTimeout(400);
      echo = await page.evaluate(() =>
        document.querySelector("canvas.model-canvas")?.dataset.modelCameraPositionFeet ?? "");
      const achieved = echo.split(",").map(Number);
      const miss = Math.max(...shot.position.map((value, axis) =>
        Math.abs(value - (achieved[axis] ?? Infinity))));
      if (miss < 1) break;
    }
    console.log("pose", shot.name, "wanted", shot.position.join(","), "echo", echo);
  }
  const pose = await readPose();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, `${shot.name}-rvt.png`) });

  await switchSource("Autodesk GLB", "reference-model");
  await settledPose();
  await writePoseVerified({
    position: rvtSceneToGlbScene(pose.position),
    target: rvtSceneToGlbScene(pose.target),
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `${shot.name}-autodesk.png`) });
  if (shot.xray) await setXray(false);
  console.log("shot", shot.name);
}

await browser.close();
server.close();
