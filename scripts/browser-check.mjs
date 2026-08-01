/**
 * End-to-end check that a built Pages bundle really converts a Revit file in a
 * browser tab, with no network round trip for the model itself.
 *
 * The static bundle is served locally, Chromium opens it, the `.rvt` is handed
 * to the same file input a person would use, and the run reports the rendered
 * summary plus a screenshot. It needs a local Revit file, so it is a manual
 * check rather than part of `npm test`.
 *
 *   npm run build:pages
 *   REVITER_BROWSER_HEADED=1 node scripts/browser-check.mjs dist-pages /path/to/model.rvt [screenshot.png] [reference.ifc]
 *
 * Passing a matching IFC export additionally pairs it in the same tab and
 * reports the regression gates.
 *
 * Build with the default base path. A bundle built for GitHub Pages
 * (`PAGES_BASE_PATH=/reviter/`) requests its assets from that subpath and will
 * not boot under the local root server.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const [root, revitFile, screenshot = "browser-check.png", ifcFile] = process.argv.slice(2);
if (!root || !revitFile) {
  console.error("usage: node scripts/browser-check.mjs <pages-dir> <model.rvt> [screenshot.png] [reference.ifc]");
  process.exit(2);
}

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
await new Promise((ready) => server.listen(4173, ready));

let browser;
// Pointer lock is deliberately unavailable in Chromium's legacy headless root
// document. A headed run is therefore required for the complete navigation
// contract; headless remains useful for conversion-only automation.
const headed = process.env.REVITER_BROWSER_HEADED === "1";
try {
  browser = await chromium.launch({ headless: !headed, args: ["--no-sandbox"] });
} catch (error) {
  // Local verification should still work when the Playwright package is
  // installed but its separately downloaded browser cache is absent. Reuse
  // the system Chrome channel; the page remains local and the model is still
  // handed directly to the in-tab file input.
  if (
    !(error instanceof Error) ||
    !/Executable doesn't exist/u.test(error.message)
  ) {
    throw error;
  }
  browser = await chromium.launch({
    channel: "chrome",
    headless: !headed,
    args: ["--no-sandbox"],
  });
}
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const logs = [];
page.on("console", (message) => logs.push(`[${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => logs.push(`[pageerror] ${error.message}`));

await page.goto("http://localhost:4173/?navigation-test=1", { waitUntil: "networkidle" });
await page.setInputFiles('input[type="file"][accept*=".rvt"]', resolve(revitFile));

const started = Date.now();
let rendered = "";
let terminalPhase = "";
for (let attempt = 0; attempt < 400; attempt += 1) {
  await page.waitForTimeout(1_500);
  rendered = await page.evaluate(() => document.body.innerText.slice(0, 4_000));
  terminalPhase = await page.locator("main.studio").getAttribute("data-phase") ?? "";
  if (terminalPhase === "ready" || terminalPhase === "error") break;
}

if (terminalPhase !== "ready" && terminalPhase !== "error") {
  throw new Error("The studio did not finish conversion before the browser-check timeout.");
}

console.log("conversion wall clock", `${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(rendered);

if (terminalPhase === "ready") {
  const objectCountText = await page.locator('.tabstrip [role="tab"]', { hasText: "Objects" })
    .locator("em")
    .textContent();
  const drawnCountText = await page.locator(".statusbar .stats span", { hasText: "drawn" }).textContent();
  const objectCount = Number((objectCountText ?? "").replace(/[^0-9]/g, ""));
  const drawnCount = Number((drawnCountText ?? "").replace(/[^0-9]/g, ""));
  if (!Number.isFinite(objectCount) || objectCount !== drawnCount) {
    throw new Error(`Object browser/status count mismatch (${objectCountText} !== ${drawnCountText}).`);
  }

  // Exercise the two dock interactions most likely to expose a shell wiring
  // regression: selecting a virtualized object and opening the recovery report.
  if (objectCount > 0) {
    await page.locator(".object-row").first().click();
    await page.locator(".right-dock .property-rows").waitFor({ state: "visible" });
  }
  await page.getByRole("button", { name: "Report" }).click();
  await page.getByRole("region", { name: "Recovery report" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Close report" }).click();
  console.log("interface smoke", `${objectCount.toLocaleString()} selectable objects; properties and report docks opened`);

  const vector = (value) => (value ?? "").split(",").map(Number);
  const distance = (left, right) => Math.hypot(...left.map((value, index) => value - right[index]));
  const pose = async () => page.locator("canvas.model-canvas").evaluate((canvas) => ({
    position: canvas.dataset.cameraPosition,
    target: canvas.dataset.cameraTarget,
    direction: canvas.dataset.cameraDirection,
  }));
  const canvas = page.locator("canvas.model-canvas");
  for (const panelName of ["Browser", "Properties"]) {
    const toggle = page.getByRole("button", { name: panelName, exact: true });
    if (await toggle.getAttribute("aria-pressed") === "true") await toggle.click();
  }
  const box = await canvas.boundingBox();
  if (!box) throw new Error("The model canvas has no browser-visible bounds.");
  const point = { x: box.x + box.width * 0.52, y: box.y + box.height * 0.48 };

  await page.getByRole("button", { name: "Orbit", exact: true }).click();
  const orbitBefore = await pose();
  await page.mouse.move(point.x, point.y);
  // Let the ordinary unpressed hover settle before measuring the drag itself.
  await page.waitForTimeout(50);
  const hoverRaycastsBeforeOrbit = Number(await canvas.getAttribute("data-hover-raycasts") ?? "0");
  await page.mouse.down();
  await page.mouse.move(point.x + 110, point.y + 45, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const orbitAfter = await pose();
  const hoverRaycastsAfterOrbit = Number(await canvas.getAttribute("data-hover-raycasts") ?? "0");
  if (distance(vector(orbitBefore.position), vector(orbitAfter.position)) < 0.001) {
    throw new Error("Orbit drag did not move the camera.");
  }
  if (hoverRaycastsAfterOrbit !== hoverRaycastsBeforeOrbit) {
    throw new Error(
      `Orbit drag triggered ${hoverRaycastsAfterOrbit - hoverRaycastsBeforeOrbit} expensive hover raycasts.`,
    );
  }

  await page.getByRole("button", { name: "Pan", exact: true }).click();
  const panBefore = await pose();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y - 35, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const panAfter = await pose();
  if (distance(vector(panBefore.target), vector(panAfter.target)) < 0.001) {
    throw new Error("Pan drag did not move the orbit target.");
  }

  await page.getByRole("button", { name: "Orbit", exact: true }).click();
  const zoomBefore = await pose();
  const zoomBeforeDistance = distance(vector(zoomBefore.position), vector(zoomBefore.target));
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -650);
  await page.waitForTimeout(350);
  const zoomAfter = await pose();
  const zoomAfterDistance = distance(vector(zoomAfter.position), vector(zoomAfter.target));
  if (Math.abs(zoomBeforeDistance - zoomAfterDistance) < 0.001) {
    throw new Error("Wheel zoom did not change the camera-to-pivot distance.");
  }

  const pivotBefore = await pose();
  await page.mouse.dblclick(point.x, point.y, { delay: 70 });
  await page.waitForTimeout(250);
  const pivotAfter = await pose();
  if (distance(vector(pivotBefore.target), vector(pivotAfter.target)) < 0.001) {
    throw new Error("Double-click did not set a new orbit centre.");
  }

  // A horizontal surface exposes the direct route; otherwise Walk still uses
  // the double-clicked orbit target and probes its floor before falling back.
  await page.mouse.click(point.x, point.y, { button: "right" });
  const walkFromHere = page.getByRole("menuitem", { name: "Walk from here" });
  await walkFromHere.waitFor({ state: "visible" });
  const walkStartedAt = Date.now();
  if (await walkFromHere.getAttribute("aria-disabled") !== "true") {
    await walkFromHere.click();
  } else {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Walk", exact: true }).click();
  }
  await page.getByText("First person", { exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const modelCanvas = document.querySelector("canvas.model-canvas");
    return modelCanvas?.dataset.navigationState === "walk";
  });
  const walkEntryMs = Date.now() - walkStartedAt;
  const indexBuildMs = await canvas.getAttribute("data-walk-index-build-ms");
  if (await page.getByRole("button", { name: "Ghost", exact: true }).getAttribute("aria-pressed") !== "true") {
    throw new Error("Ghost collision is not the default Walk mode.");
  }
  if (!/beta/i.test(await page.getByRole("button", { name: /Solid/i }).innerText())) {
    throw new Error("Solid collision is not labelled beta.");
  }

  await canvas.evaluate((modelCanvas) => {
    window.__reviterNavigationEvents = [];
    const report = (message) => window.__reviterNavigationEvents.push(message);
    modelCanvas.addEventListener("pointerdown", (event) => {
      report(`pointerdown:${event.pointerType}:${event.button}`);
    });
    document.addEventListener("pointerlockchange", () => {
      report(`change:${document.pointerLockElement === modelCanvas}`);
    });
    document.addEventListener("pointerlockerror", () => report("pointerlockerror"));
  });
  await page.bringToFront();
  await page.mouse.click(point.x, point.y);
  try {
    await page.waitForFunction(() =>
      document.querySelector("canvas.model-canvas")?.dataset.pointerLocked === "true", null, { timeout: 5_000 });
  } catch {
    const pointerEvents = await page.evaluate(() => window.__reviterNavigationEvents ?? []);
    throw new Error(`Pointer lock was not granted (${pointerEvents.join(", ") || "no pointer events"}).`);
  }
  const lookBefore = await pose();
  await page.mouse.move(point.x + 130, point.y - 45, { steps: 6 });
  await page.waitForTimeout(200);
  const lookAfter = await pose();
  if (distance(vector(lookBefore.direction), vector(lookAfter.direction)) < 0.001) {
    throw new Error("Pointer-lock mouse look did not change the view direction.");
  }

  const moveBefore = await pose();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(450);
  await page.keyboard.up("KeyW");
  const moveAfter = await pose();
  if (distance(vector(moveBefore.position), vector(moveAfter.position)) < 0.05) {
    throw new Error("WASD input did not move the first-person camera.");
  }
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  const gravityA = await pose();
  await page.waitForTimeout(400);
  const gravityB = await pose();
  if (Math.abs(vector(gravityA.position)[2] - vector(gravityB.position)[2]) > 0.2) {
    throw new Error("Gravity did not settle the z-up walk camera onto a stable surface.");
  }

  await page.keyboard.press("Escape");
  await page.waitForFunction(() =>
    document.querySelector("canvas.model-canvas")?.dataset.pointerLocked === "false");
  if (!await page.getByText("First person", { exact: true }).isVisible()) {
    throw new Error("The Escape that released pointer lock also exited Walk.");
  }
  await page.waitForTimeout(300);
  const handoffBefore = await pose();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() =>
    document.querySelector("canvas.model-canvas")?.dataset.navigationState === "orbit");
  const handoffAfter = await pose();
  if (distance(vector(handoffBefore.position), vector(handoffAfter.position)) > 0.01) {
    throw new Error("Leaving Walk changed the live camera position.");
  }
  console.log(
    "navigation smoke",
    `orbit, pan, wheel, pivot, Walk, pointer lock, WASD, gravity, Escape and handoff passed; entry ${walkEntryMs}ms; index ${indexBuildMs ?? "prewarmed"}ms`,
  );
}

if (ifcFile) {
  const pairingStarted = Date.now();
  await page.setInputFiles('input[type="file"][accept=".ifc"]', resolve(ifcFile));
  for (let attempt = 0; attempt < 300; attempt += 1) {
    await page.waitForTimeout(2_000);
    const text = await page.evaluate(() => document.body.innerText);
    if (/typed IFC elements/i.test(text) && !/Analyzing IFC/i.test(text)) break;
  }
  console.log("ifc pairing wall clock", `${((Date.now() - pairingStarted) / 1000).toFixed(1)}s`);
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 4_000)));
}
if (logs.length) console.log(`--- browser log ---\n${logs.slice(-20).join("\n")}`);
await page.screenshot({ path: screenshot });
console.log("screenshot", screenshot);

await browser.close();
server.close();
