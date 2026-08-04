/**
 * Ask each geometry source whether Walk can find the ground.
 *
 * RVT, the paired IFC and the Autodesk GLB are three different scenes in three
 * different unit systems, and first person is only comparable across them if
 * all three answer the same question the same way: is there a floor under this
 * point, and how far below is it? This walks the source switcher, enters Walk
 * on each, and probes.
 *
 *   npm run build:pages
 *   node scripts/measure-walk-sources.mjs dist-pages <model.rvt> <reference.ifc> <reference.glb>
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const [root, revitFile, ifcFile, glbFile] = process.argv.slice(2);
if (!root || !revitFile) {
  console.error("usage: node scripts/measure-walk-sources.mjs <pages-dir> <model.rvt> [ref.ifc] [ref.glb]");
  process.exit(2);
}

const CONTENT_TYPES = {
  ".css": "text/css", ".glb": "model/gltf-binary", ".html": "text/html",
  ".js": "text/javascript", ".json": "application/json", ".png": "image/png",
  ".wasm": "application/wasm",
};
const server = createServer(async (request, response) => {
  try {
    let path = decodeURIComponent(request.url.split("?")[0]);
    if (path.endsWith("/")) path += "index.html";
    let file = join(root, normalize(path));
    try { await stat(file); } catch { file = join(root, "index.html"); }
    response.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(await readFile(file));
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise((ready) => server.listen(4175, ready));

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
} catch (error) {
  if (!(error instanceof Error) || !/Executable doesn't exist/u.test(error.message)) throw error;
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] });
}
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

await page.goto("http://localhost:4175/?navigation-test=1", { waitUntil: "networkidle" });
await page.setInputFiles('input[type="file"][accept*=".rvt"]', resolve(revitFile));
for (let attempt = 0; attempt < 400; attempt += 1) {
  await page.waitForTimeout(1_500);
  const phase = await page.locator("main.studio").getAttribute("data-phase") ?? "";
  if (phase === "ready") break;
  if (phase === "error") throw new Error("Conversion failed.");
}
const waitForSource = async (label) => {
  await page.waitForFunction((name) => {
    const buttons = [...document.querySelectorAll("button")];
    const button = buttons.find((candidate) => candidate.textContent?.trim() === name);
    return button && button.getAttribute("aria-disabled") !== "true" && !button.hasAttribute("disabled");
  }, label, { timeout: 600_000 });
};
if (ifcFile) {
  await page.setInputFiles('input[type="file"][accept=".ifc"]', resolve(ifcFile));
  await waitForSource("IFC");
}
if (glbFile) {
  await page.setInputFiles('input[type="file"][accept*=".glb"]', resolve(glbFile));
  await waitForSource("Autodesk GLB");
}

const SOURCES = [["RVT", "recovered"], ...(ifcFile ? [["IFC", "reference"]] : []),
  ...(glbFile ? [["Autodesk GLB", "reference-model"]] : [])];

/**
 * The camera in model feet, which the studio writes for every source. Raw
 * scene coordinates are metres for the references and feet for the RVT, in
 * three different origins, so this is the only frame the three can be compared
 * in without doing the conversion by hand and getting it wrong.
 */
const cameraFeet = async () => {
  const raw = await page.locator("canvas.model-canvas").getAttribute("data-model-camera-position-feet");
  if (raw) return { feet: raw.split(",").map(Number), fromModelFrame: true };
  // The Autodesk GLB has no mapping into Revit model feet — its own frame is
  // registered visually rather than by shared coordinates, so
  // `scenePointToModelFeet` returns undefined for it. Fall back to its scene
  // units, which still converts to feet and keeps the source in the table
  // instead of silently dropping out of it.
  const scene = await page.evaluate(() => {
    const nav = window.__reviterNavigation;
    return [
      nav.camera.position.x / nav.sceneUnitsPerFoot,
      nav.camera.position.y / nav.sceneUnitsPerFoot,
      nav.camera.position.z / nav.sceneUnitsPerFoot,
      nav.up,
    ];
  });
  // Report the horizontal pair first and the up axis last, as the model frame does.
  const [x, y, z, up] = scene;
  return { feet: up === "y" ? [x, z, y] : [x, y, z], fromModelFrame: false };
};

console.log("\n  source          units/ft  up   index state     floor under the eye   walkable");
console.log("  ---------------------------------------------------------------------------");
const rows = [];
for (const [label, expected] of SOURCES) {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForFunction((source) =>
    document.querySelector("canvas.model-canvas")?.dataset.activeSource === source,
    expected, { timeout: 120_000 });
  // Let any index build settle so the sample is not competing with it.
  await page.waitForTimeout(6_000);

  // Probe before entering Walk: the orbit target is the middle of the building
  // only while Orbit still owns the camera. Walk drives the camera directly and
  // leaves that target where it was, so probing it afterwards asks about a
  // stale point and reports NONE on sources that walk perfectly well.
  const row = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.model-canvas");
    const nav = window.__reviterNavigation;
    const camera = nav.camera;
    // Probe over the orbit target, which after a fit is the middle of the
    // building. Probing from the camera itself finds nothing on any source,
    // because a fitted camera sits outside the envelope with open air below it.
    // An explicit maxDrop makes this the unbounded downward search the Space
    // drop uses, rather than the continuous probe that only looks within one
    // step of the walker's own standing height.
    const reach = 100_000 * nav.sceneUnitsPerFoot;
    const t = nav.controls.target;
    const floor = nav.probeFloor(t.x, t.y, t.z, reach);
    return {
      source: nav.source,
      up: nav.up,
      sceneUnitsPerFoot: nav.sceneUnitsPerFoot,
      indexState: canvas?.dataset.walkIndexState ?? "?",
      eye: [t.x, t.y, t.z],
      cameraAt: [camera.position.x, camera.position.y, camera.position.z],
      floor,
    };
  });
  rows.push({ label, ...row });
  const eyeAbove = row.floor === null
    ? null
    : (row.up === "y" ? row.eye[1] : row.eye[2]) - row.floor;
  console.log(
    `  ${label.padEnd(14)} ${String(row.sceneUnitsPerFoot).padStart(8)}  ` +
    `${row.up.padEnd(4)} ${row.indexState.padEnd(15)} ` +
    `${(row.floor === null ? "NONE" : row.floor.toFixed(2)).padStart(19)}   ` +
    `${row.floor === null ? "NO — flies" : `yes (eye ${eyeAbove.toFixed(1)} above)`}`,
  );
  // Now the behaviour itself: a second of walking forward, measured in model
  // feet so the three sources are directly comparable.
  await page.getByRole("button", { name: "Walk", exact: true }).first().click();
  await page.waitForFunction(() =>
    document.querySelector("canvas.model-canvas")?.dataset.navigationState === "walk",
    null, { timeout: 120_000 });
  // The Walk button keeps focus after the click, and walk deliberately ignores
  // keys aimed at a control so that typing in a panel is not a walk command.
  // Leaving focus there measures a walker that never receives a keystroke.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(2_500);

  const walking = await page.evaluate(() =>
    document.querySelector("canvas.model-canvas")?.dataset.navigationState === "walk");
  if (walking) {
    const before = await cameraFeet();
    // Two seconds rather than one: the walker integrates per frame, so a short
    // sample taken while an index build is stealing frames reads high or low.
    const WALK_SECONDS = 2;
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(WALK_SECONDS * 1_000);
    await page.keyboard.up("KeyW");
    await page.waitForTimeout(150);
    const after = await cameraFeet();
    const travelled = Math.hypot(after.feet[0] - before.feet[0], after.feet[1] - before.feet[1]) / WALK_SECONDS;
    const rise = after.feet[2] - before.feet[2];
    row.walkedFeetPerSecond = travelled;
    console.log(
      `                 walked ${travelled.toFixed(2).padStart(6)} ft/s   ` +
      `rise ${rise.toFixed(2)} ft   ` +
      `${after.fromModelFrame ? "model feet" : "scene units (no model-feet mapping)"}`,
    );
  } else {
    console.log("                 (did not enter Walk)");
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

const broken = rows.filter((row) => row.floor === null);
console.log(
  broken.length
    ? `\n  ${broken.length} of ${rows.length} sources cannot find ground: ` +
      `${broken.map((row) => row.label).join(", ")}\n`
    : `\n  all ${rows.length} sources resolve a floor\n`,
);

await browser.close();
server.close();
if (broken.length) process.exitCode = 1;
