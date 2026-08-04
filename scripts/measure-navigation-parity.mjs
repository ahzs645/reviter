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
const vector = (text) => (text ?? "").split(",").map(Number);
const pose = async () => {
  const raw = await canvas.evaluate((node) => ({
    position: node.dataset.cameraPosition,
    target: node.dataset.cameraTarget,
  }));
  const position = vector(raw.position);
  const target = vector(raw.target);
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
const drag = async (dx, dy, { button = "left", modifier } = {}) => {
  await page.mouse.move(centre.x, centre.y);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.down({ button });
  await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 10 });
  await page.mouse.up({ button });
  if (modifier) await page.keyboard.up(modifier);
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

// One wheel notch should close about 7.34 percent of the gap to the cursor.
before = await pose();
await page.mouse.move(centre.x, centre.y);
await page.mouse.wheel(0, -120);
await page.waitForTimeout(SETTLE_MS);
after = await pose();
record(
  "wheel notch, approach",
  (before.distance - after.distance) / before.distance,
  AUTODESK.wheelApproachPerNotch,
  "fraction",
  0.015,
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
