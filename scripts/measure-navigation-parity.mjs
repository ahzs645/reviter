/**
 * Measure Reviter's navigation against the numbers read out of Autodesk Viewer.
 *
 * The Autodesk column below was produced by driving a live LMV session on the
 * same model with synthetic drags of a known pixel length and differencing its
 * camera. This script does the identical thing to Reviter's canvas, so the two
 * are compared like for like rather than by eye.
 *
 *   npm run build:pages
 *   node scripts/measure-navigation-parity.mjs dist-pages /path/to/model.rvt
 *
 * It needs a local Revit file, so like browser-check.mjs it is a manual check
 * rather than part of `npm test`.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const [root, revitFile] = process.argv.slice(2);
if (!root || !revitFile) {
  console.error("usage: node scripts/measure-navigation-parity.mjs <pages-dir> <model.rvt>");
  process.exit(2);
}

/** Measured in Autodesk Viewer, orbit tool, on the UNBC model. */
const AUTODESK = {
  yawDegreesPer200px: 22.38,
  pitchDegreesPer100px: 22.61,
  wheelApproachPerNotch: 0.0734,
};
/** How far a measurement may drift before the two viewers feel different. */
const TOLERANCE_DEGREES = 0.75;

const CONTENT_TYPES = {
  ".css": "text/css",
  ".glb": "model/gltf-binary",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".wasm": "application/wasm",
};

const server = createServer(async (request, response) => {
  try {
    let path = decodeURIComponent(request.url.split("?")[0]);
    if (path.endsWith("/")) path += "index.html";
    let file = join(root, normalize(path));
    try {
      await stat(file);
    } catch {
      file = join(root, "index.html");
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    });
    response.end(await readFile(file));
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise((ready) => server.listen(4174, ready));

// Same fallback as browser-check.mjs: the Playwright package can be installed
// without its separately downloaded browser cache, in which case the system
// Chrome serves just as well because the page and the model are both local.
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
} catch (error) {
  if (!(error instanceof Error) || !/Executable doesn't exist/u.test(error.message)) throw error;
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] });
}
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

await page.goto("http://localhost:4174/?navigation-test=1", { waitUntil: "networkidle" });
await page.setInputFiles('input[type="file"][accept*=".rvt"]', resolve(revitFile));
for (let attempt = 0; attempt < 400; attempt += 1) {
  await page.waitForTimeout(1_500);
  const phase = await page.locator("main.studio").getAttribute("data-phase") ?? "";
  if (phase === "ready") break;
  if (phase === "error") throw new Error("Conversion failed before the parity run.");
}

const canvas = page.locator("canvas.model-canvas");
// Read the live camera, not the canvas dataset. The dataset is written by the
// render loop, and a headless tab throttles requestAnimationFrame hard enough
// that a snapshot taken through it lags the camera it is meant to describe.
const pose = async () => {
  const raw = await page.evaluate(() => {
    const { camera, controls } = window.__reviterNavigation;
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
    };
  });
  const { position, target } = raw;
  const offset = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
  const planar = Math.hypot(offset[0], offset[1]);
  return {
    position,
    target,
    // The scene is z-up, so this is the same spherical decomposition that was
    // taken off Autodesk's z-up camera.
    azimuth: (Math.atan2(offset[1], offset[0]) * 180) / Math.PI,
    elevation: (Math.atan2(offset[2], planar) * 180) / Math.PI,
    distance: Math.hypot(...offset),
  };
};

const box = await canvas.boundingBox();
const centre = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };

// Damping spreads one drag over about ninety frames; the total it applies is
// exactly the angle that went in, so every measurement waits for the tail.
const SETTLE_MS = 2_000;

/**
 * Drive the canvas with synthetic pointer events from inside the page.
 *
 * This is deliberately the same instrument that was used on Autodesk Viewer, so
 * the two columns are comparable. It also avoids the driver's own input path,
 * which in this environment silently drops events — a `page.mouse.wheel` never
 * arrived at the canvas at all, and long drags lost their later moves.
 */
const drag = async (dx, dy, { button = "left", modifier } = {}) => {
  await page.evaluate(({ dx, dy, button, modifier, x0, y0 }) => {
    const node = document.querySelector("canvas.model-canvas");
    const buttons = button === "left" ? 1 : button === "middle" ? 4 : 2;
    const code = button === "left" ? 0 : button === "middle" ? 1 : 2;
    const flags = {
      shiftKey: modifier === "Shift",
      ctrlKey: modifier === "Control",
      metaKey: modifier === "Meta",
      altKey: modifier === "Alt",
    };
    const make = (type, x, y, held) => new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      clientX: x,
      clientY: y,
      button: code,
      buttons: held,
      ...flags,
    });
    node.dispatchEvent(make("pointerdown", x0, y0, buttons));
    for (let step = 1; step <= 10; step += 1) {
      const x = Math.round(x0 + (dx * step) / 10);
      const y = Math.round(y0 + (dy * step) / 10);
      node.dispatchEvent(make("pointermove", x, y, buttons));
      document.dispatchEvent(make("pointermove", x, y, buttons));
    }
    node.dispatchEvent(make("pointerup", x0 + dx, y0 + dy, 0));
    document.dispatchEvent(make("pointerup", x0 + dx, y0 + dy, 0));
    // Damping spreads one drag over about ninety frames, and its total is
    // exactly the angle that went in. Drain it here rather than waiting on
    // requestAnimationFrame, which a headless tab throttles to almost nothing —
    // that throttling, not the rotation, is what an unpumped run measures.
    for (let tick = 0; tick < 300; tick += 1) window.__reviterNavigation.controls.update();
  }, { dx, dy, button, modifier, x0: centre.x, y0: centre.y });
  await page.waitForTimeout(SETTLE_MS);
};

const wheel = async (deltaY) => {
  await page.evaluate(({ deltaY, x, y }) => {
    document.querySelector("canvas.model-canvas").dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      deltaY,
      deltaMode: 0,
    }));
    for (let tick = 0; tick < 300; tick += 1) window.__reviterNavigation.controls.update();
  }, { deltaY, x: centre.x, y: centre.y });
  await page.waitForTimeout(SETTLE_MS);
};

const signedDelta = (after, before) => {
  let delta = after - before;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
};

const results = [];
const record = (label, measured, expected, unit, tolerance) => {
  const pass = expected === null || Math.abs(measured - expected) <= tolerance;
  results.push({ label, measured, expected, unit, pass });
};

const geometry = await canvas.evaluate((node) => ({
  clientWidth: node.clientWidth,
  clientHeight: node.clientHeight,
  bufferWidth: node.width,
  bufferHeight: node.height,
  devicePixelRatio: window.devicePixelRatio,
}));
console.log("\n  canvas", JSON.stringify(geometry), "box", JSON.stringify(box));

const controlsState = await page.evaluate(() => {
  const nav = window.__reviterNavigation;
  if (!nav) return { missing: true };
  const { controls } = nav;
  // Feed a known angle straight into the rotate hooks and read what lands in
  // the spherical delta: that isolates the per-pixel conversion from every
  // question about how the drag reached the control.
  const probe = (2 * Math.PI * 100) / controls.domElement.clientHeight;
  const beforeTheta = controls._sphericalDelta.theta;
  const beforePhi = controls._sphericalDelta.phi;
  controls._rotateLeft(probe);
  controls._rotateUp(probe);
  const injectedTheta = controls._sphericalDelta.theta - beforeTheta;
  const injectedPhi = controls._sphericalDelta.phi - beforePhi;
  controls._sphericalDelta.theta = beforeTheta;
  controls._sphericalDelta.phi = beforePhi;
  return {
    enabled: controls.enabled,
    cameraIsPerspective: Boolean(nav.camera.isPerspectiveCamera),
    rotateSpeed: controls.rotateSpeed,
    zoomSpeed: controls.zoomSpeed,
    zoomToCursor: controls.zoomToCursor,
    enableZoom: controls.enableZoom,
    enableRotate: controls.enableRotate,
    enableDamping: controls.enableDamping,
    dampingFactor: controls.dampingFactor,
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
    maxTargetRadius: controls.maxTargetRadius,
    mouseButtons: { ...controls.mouseButtons },
    domElementIsCanvas: controls.domElement === document.querySelector("canvas.model-canvas"),
    // Radians actually banked for 100 px of drag on each axis.
    yawRadiansPer100px: Math.abs(injectedTheta),
    pitchRadiansPer100px: Math.abs(injectedPhi),
  };
});
console.log("  controls", JSON.stringify(controlsState, null, 2).replace(/\n/g, "\n  "));
console.log(
  `  injected yaw   ${controlsState.yawRadiansPer100px?.toFixed(6)} rad/100px (want 0.195313)\n` +
  `  injected pitch ${controlsState.pitchRadiansPer100px?.toFixed(6)} rad/100px (want 0.394616)`,
);

const start = await pose();
console.log(
  `  start pose: elevation ${start.elevation.toFixed(2)} deg, azimuth ` +
  `${start.azimuth.toFixed(2)} deg, distance ${start.distance.toFixed(1)}`,
);

// Does a dispatched drag actually reach the control? Compare it against the
// same rotation driven straight through _rotateLeft, and count the calls.
const delivery = await page.evaluate(({ x0, y0 }) => {
  const { camera, controls } = window.__reviterNavigation;
  const node = controls.domElement;
  const height = node.clientHeight;
  const azimuth = () => {
    const dx = camera.position.x - controls.target.x;
    const dy = camera.position.y - controls.target.y;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };

  const direct0 = azimuth();
  for (let move = 0; move < 10; move += 1) {
    controls._rotateLeft((2 * Math.PI * -10) / height);
    controls.update();
  }
  const direct = Math.abs(azimuth() - direct0);
  for (let move = 0; move < 10; move += 1) {
    controls._rotateLeft((2 * Math.PI * 10) / height);
    controls.update();
  }

  let calls = 0;
  const original = controls._rotateLeft.bind(controls);
  controls._rotateLeft = (angle) => { calls += 1; original(angle); };
  const make = (type, x, y, buttons) => new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse",
    isPrimary: true, clientX: x, clientY: y, button: 0, buttons,
  });
  const event0 = azimuth();
  node.dispatchEvent(make("pointerdown", x0, y0, 1));
  for (let step = 1; step <= 10; step += 1) {
    const x = x0 + step * 10;
    node.dispatchEvent(make("pointermove", x, y0, 1));
    document.dispatchEvent(make("pointermove", x, y0, 1));
  }
  node.dispatchEvent(make("pointerup", x0 + 100, y0, 0));
  document.dispatchEvent(make("pointerup", x0 + 100, y0, 0));
  const viaEvents = Math.abs(azimuth() - event0);
  controls._rotateLeft = original;

  return { direct, viaEvents, rotateLeftCalls: calls, enableDamping: controls.enableDamping };
}, { x0: centre.x, y0: centre.y });
console.log(
  `  100 px direct through _rotateLeft: ${delivery.direct.toFixed(4)} deg\n` +
  `  100 px via dispatched events:      ${delivery.viaEvents.toFixed(4)} deg ` +
  `(_rotateLeft called ${delivery.rotateLeftCalls}x, damping ${delivery.enableDamping})`,
);
// Sweep both axes so a constant factor is distinguishable from a bad curve.
console.log("\n  per-pixel rates");
for (const pixels of [50, 100, 200, 400]) {
  const start = await pose();
  await drag(pixels, 0);
  const end = await pose();
  const degrees = Math.abs(signedDelta(end.azimuth, start.azimuth));
  console.log(
    `    yaw   ${String(pixels).padStart(4)} px -> ${degrees.toFixed(4).padStart(9)} deg  ` +
    `(${(degrees / pixels).toFixed(6)} deg/px, autodesk 0.111900)`,
  );
  await drag(-pixels, 0);
}
for (const pixels of [50, 100, 200]) {
  const start = await pose();
  await drag(0, pixels);
  const end = await pose();
  const degrees = Math.abs(end.elevation - start.elevation);
  console.log(
    `    pitch ${String(pixels).padStart(4)} px -> ${degrees.toFixed(4).padStart(9)} deg  ` +
    `(${(degrees / pixels).toFixed(6)} deg/px, autodesk 0.226100)`,
  );
  await drag(0, -pixels);
}

// Yaw: 200 px of left drag.
let before = await pose();
await drag(200, 0);
let after = await pose();
record(
  "left drag 200 px, yaw",
  Math.abs(signedDelta(after.azimuth, before.azimuth)),
  AUTODESK.yawDegreesPer200px,
  "deg",
  TOLERANCE_DEGREES,
);
record("  ... target held still", after.distance - before.distance, 0, "units", 0.01);
await drag(-200, 0);

// Pitch: 100 px of left drag.
before = await pose();
await drag(0, 100);
after = await pose();
record(
  "left drag 100 px, pitch",
  Math.abs(after.elevation - before.elevation),
  AUTODESK.pitchDegreesPer100px,
  "deg",
  TOLERANCE_DEGREES,
);
await drag(0, -100);

// Shift plus left is a pan in Autodesk: the target travels, nothing rotates.
before = await pose();
await drag(120, -80, { modifier: "Shift" });
after = await pose();
const panned = Math.hypot(
  after.target[0] - before.target[0],
  after.target[1] - before.target[1],
  after.target[2] - before.target[2],
);
record("shift + left, rotation", Math.abs(signedDelta(after.azimuth, before.azimuth)), 0, "deg", 0.05);
record("shift + left, pan distance", panned > 0.5 ? 1 : 0, 1, "moved", 0);
await drag(-120, 80, { modifier: "Shift" });

// The right button pans unmodified.
before = await pose();
await drag(120, -80, { button: "right" });
after = await pose();
record("right drag, rotation", Math.abs(signedDelta(after.azimuth, before.azimuth)), 0, "deg", 0.05);
record(
  "right drag, pan distance",
  Math.hypot(
    after.target[0] - before.target[0],
    after.target[1] - before.target[1],
    after.target[2] - before.target[2],
  ) > 0.5 ? 1 : 0,
  1,
  "moved",
  0,
);
await drag(-120, 80, { button: "right" });

// One wheel notch should carry the eye about 7.34 percent of the way to what
// is under the cursor. Autodesk moves the target with it, so the distance
// between them is not the thing to measure — the eye's travel is.
before = await pose();
await wheel(-120);
after = await pose();
const travelled = Math.hypot(
  after.position[0] - before.position[0],
  after.position[1] - before.position[1],
  after.position[2] - before.position[2],
);
console.log(
  `\n  wheel: eye moved ${travelled.toFixed(3)} of ${before.distance.toFixed(3)} to target ` +
  `(${(travelled / before.distance).toFixed(4)}), target moved ` +
  `${Math.hypot(
    after.target[0] - before.target[0],
    after.target[1] - before.target[1],
    after.target[2] - before.target[2],
  ).toFixed(3)}`,
);
const targetTravelled = Math.hypot(
  after.target[0] - before.target[0],
  after.target[1] - before.target[1],
  after.target[2] - before.target[2],
);
record(
  "wheel notch, eye approach",
  travelled / before.distance,
  AUTODESK.wheelApproachPerNotch,
  "fraction",
  0.02,
);
// Autodesk moved the eye 24.4 and the target 24.4 with it. Reeling the eye in
// towards a pinned target rewrites the orbit radius on every zoom, so the next
// orbit drag behaves differently from the last.
record("wheel, target follows eye", targetTravelled - travelled, 0, "units", 0.01);
record(
  "wheel, orbit radius held",
  after.distance - before.distance,
  0,
  "units",
  0.01,
);

console.log("\n  measurement                    reviter     autodesk   ");
console.log("  ---------------------------------------------------------");
for (const { label, measured, expected, unit, pass } of results) {
  console.log(
    `  ${pass ? "ok  " : "FAIL"} ${label.padEnd(28)} ${measured.toFixed(4).padStart(9)}  ${
      String(expected).padStart(9)} ${unit}`,
  );
}
const failures = results.filter((result) => !result.pass);
console.log(`\n  ${results.length - failures.length}/${results.length} within tolerance\n`);

await browser.close();
server.close();
if (failures.length) process.exitCode = 1;
