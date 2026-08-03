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
 *   REVITER_BROWSER_HEADED=1 node scripts/browser-check.mjs dist-pages /path/to/model.rvt [screenshot.png] [reference.ifc] [reference.glb]
 *
 * Passing matching IFC and Autodesk GLB references additionally checks the
 * three-source first-person handoff and per-source scene/walk-index caches.
 *
 * Build with the default base path. A bundle built for GitHub Pages
 * (`PAGES_BASE_PATH=/reviter/`) requests its assets from that subpath and will
 * not boot under the local root server.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const [root, revitFile, screenshot = "browser-check.png", ifcFile, glbFile] = process.argv.slice(2);
if (!root || !revitFile) {
  console.error("usage: node scripts/browser-check.mjs <pages-dir> <model.rvt> [screenshot.png] [reference.ifc] [reference.glb]");
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

// Pair references before navigation so Walk can exercise all available sources
// in one continuous camera session.
if (ifcFile) {
  const pairingStarted = Date.now();
  await page.setInputFiles('input[type="file"][accept=".ifc"]', resolve(ifcFile));
  // The regression panel can be closed and therefore absent from body text.
  // The source control is always mounted and becomes actionable only after
  // IFC geometry has finished streaming, so it is the stable completion
  // contract for both the ordinary shell and this browser check.
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("button")];
    const source = buttons.find((button) => button.textContent?.trim() === "IFC");
    return source && source.getAttribute("aria-disabled") !== "true" && !source.hasAttribute("disabled");
  }, null, { timeout: 600_000 });
  console.log("ifc pairing wall clock", `${((Date.now() - pairingStarted) / 1000).toFixed(1)}s`);
}
if (glbFile) {
  const pairingStarted = Date.now();
  await page.setInputFiles('input[type="file"][accept*=".glb"]', resolve(glbFile));
  const autodeskSource = page.getByRole("button", { name: "Autodesk GLB", exact: true }).first();
  await autodeskSource.waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("button")];
    const source = buttons.find((button) => button.textContent?.trim() === "Autodesk GLB");
    return source && source.getAttribute("aria-disabled") !== "true" && !source.hasAttribute("disabled");
  }, null, { timeout: 120_000 });
  console.log("glb pairing wall clock", `${((Date.now() - pairingStarted) / 1000).toFixed(1)}s`);
}

if (terminalPhase === "ready") {
  // Preserve a visual artifact of the actual registered IFC overlay. Numeric
  // parity catches missing identities and extents, but it cannot expose a
  // local offset, reversed surface, depth artifact, or distracting material
  // treatment. Keep this before the navigation mutations so every run uses
  // the same fitted whole-building camera.
  if (ifcFile) {
    await page.getByRole("button", { name: "Overlay", exact: true }).first().click();
    await page.waitForFunction(() =>
      document.querySelector("canvas.model-canvas")?.dataset.activeSource === "overlay");
    await page.waitForTimeout(1_000);
    const overlayScreenshot = screenshot.replace(/(\.[^./]+)?$/u, "-ifc-overlay$1");
    await page.screenshot({ path: overlayScreenshot });
    console.log("IFC overlay screenshot", overlayScreenshot);

    // Keep one repeatable close-up of the known difficult UNBC stair. This is
    // intentionally optional so the browser check remains useful on unrelated
    // models that do not contain that native element id.
    await page.getByRole("button", { name: "RVT", exact: true }).first().click();
    await page.waitForFunction(() =>
      document.querySelector("canvas.model-canvas")?.dataset.activeSource === "recovered");
    const objectFilter = page.getByPlaceholder("Filter by id, category, type");
    if (await objectFilter.count()) {
      await objectFilter.fill("1460781");
      const stairRow = page.locator(".object-row").first();
      if (await stairRow.count()) {
        await stairRow.click();
        const zoom = page.getByRole("button", { name: "Zoom to object", exact: true });
        if (await zoom.count()) {
          await zoom.click();
          await page.waitForTimeout(300);
          await page.getByRole("button", { name: "Overlay", exact: true }).first().click();
          await page.waitForFunction(() =>
            document.querySelector("canvas.model-canvas")?.dataset.activeSource === "overlay");
          await page.waitForTimeout(600);
          const stairScreenshot = screenshot.replace(/(\.[^./]+)?$/u, "-stair-1460781-ifc-overlay$1");
          await page.screenshot({ path: stairScreenshot });
          console.log("stair 1460781 IFC overlay screenshot", stairScreenshot);

          // Also inspect the same location from the actual Walk camera. Orbit
          // can hide a tread/floor gap behind the stair itself.
          await page.getByRole("button", { name: "RVT", exact: true }).first().click();
          await page.waitForFunction(() =>
            document.querySelector("canvas.model-canvas")?.dataset.activeSource === "recovered");
          await stairRow.click();
          await page.getByRole("button", { name: "Walk", exact: true }).click();
          await page.waitForFunction(() =>
            document.querySelector("canvas.model-canvas")?.dataset.navigationState === "walk",
          null, { timeout: 120_000 });
          await page.getByRole("button", { name: "Overlay", exact: true }).first().click();
          await page.waitForFunction(() => {
            const canvas = document.querySelector("canvas.model-canvas");
            return canvas?.dataset.activeSource === "overlay" &&
              canvas.dataset.navigationState === "walk";
          }, null, { timeout: 120_000 });
          await page.waitForTimeout(600);
          const stairWalkScreenshot = screenshot.replace(
            /(\.[^./]+)?$/u,
            "-stair-1460781-walk-ifc-overlay$1",
          );
          await page.screenshot({ path: stairWalkScreenshot });
          console.log("stair 1460781 Walk IFC overlay screenshot", stairWalkScreenshot);
          await page.getByRole("button", { name: "Orbit", exact: true }).click();
          await page.waitForFunction(() =>
            document.querySelector("canvas.model-canvas")?.dataset.navigationState === "orbit");
        }
      }
      await page.getByRole("button", { name: "RVT", exact: true }).first().click();
      await page.waitForFunction(() =>
        document.querySelector("canvas.model-canvas")?.dataset.activeSource === "recovered");
      await objectFilter.fill("");
    }
  }

  // Pairing intentionally opens the newly supplied source for inspection.
  // Navigation coverage starts on RVT so its collision controls and the final
  // RVT cache round trip have one unambiguous baseline.
  if (ifcFile || glbFile) {
    await page.getByRole("button", { name: "RVT", exact: true }).first().click();
    await page.waitForFunction(() =>
      document.querySelector("canvas.model-canvas")?.dataset.activeSource === "recovered");
  }
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
  await page.getByRole("tab", { name: "Floors", exact: true }).click();
  const floorPreview = page.locator(".floor-browser-preview img");
  if (await floorPreview.count()) {
    await floorPreview.waitFor({ state: "visible" });
    const previewLoaded = await floorPreview.evaluate((image) => image.complete && image.naturalWidth > 0);
    if (!previewLoaded) throw new Error("Revit floor SVG preview did not render.");
    const floorSelector = page.getByRole("combobox", { name: "Browse Revit floor level" });
    const firstFloor = await floorSelector.inputValue();
    const nextFloor = page.getByRole("button", { name: "Next Revit floor" });
    if (await nextFloor.isEnabled()) {
      await nextFloor.click();
      if (await floorSelector.inputValue() === firstFloor) {
        throw new Error("Next Revit floor did not change the SVG preview level.");
      }
    }
    const levelValues = await floorSelector.locator("option").evaluateAll((options) =>
      options.map((option) => option.value));
    if (levelValues.includes("311")) await floorSelector.selectOption("311");
    const derivedToggle = page.getByRole("checkbox", { name: "Show derived floor regions" });
    await derivedToggle.check();
    const derivedCountText = await page.locator(".floor-browser-sidebar dl div", {
      hasText: "Derived regions",
    }).locator("dd").textContent();
    const derivedCount = Number(derivedCountText);
    if (!Number.isFinite(derivedCount) || derivedCount < 1) {
      throw new Error(`Derived floor-region overlay returned ${derivedCountText ?? "no count"}.`);
    }
    await page.locator(".floor-browser-room-toggle em", { hasText: "Inferred" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Open side sub-map" }).click();
    const sideMap = page.getByRole("region", { name: "Floor navigation map" });
    await sideMap.waitFor({ state: "visible" });
    const sideMapPreview = sideMap.locator("img");
    const sideMapLoaded = await sideMapPreview.evaluate((image) =>
      image.complete && image.naturalWidth > 0);
    if (!sideMapLoaded) throw new Error("Floor side sub-map SVG did not render.");
    if (await sideMap.getByRole("combobox", { name: "Floor navigation map level" }).inputValue() !== "311") {
      throw new Error("Floor navigation map did not preserve the selected Revit level.");
    }
    await sideMap.getByRole("button", { name: "Zoom map in" }).click();
    await sideMap.getByRole("button", { name: "Fit whole floor" }).click();
    await page.getByRole("button", { name: "Close report" }).click();
    await sideMap.waitFor({ state: "visible" });
    const roomScreenshot = screenshot.replace(/(\.[^./]+)?$/u, "-derived-rooms$1");
    await page.screenshot({ path: roomScreenshot });
    console.log(
      "floor browser smoke",
      `inline native-slab SVG, level navigation, ${derivedCount} derived regions and navigation map passed`,
    );
    console.log("derived room screenshot", roomScreenshot);
    await sideMap.getByRole("button", { name: "Close floor navigation map" }).click();
  } else {
    await page.locator(".floor-browser-empty").waitFor({ state: "visible" });
    console.log("floor browser smoke", "model exposes no level-owned Revit Floors sketches");
    await page.getByRole("button", { name: "Close report" }).click();
  }
  console.log("interface smoke", `${objectCount.toLocaleString()} selectable objects; properties and report docks opened`);

  const vector = (value) => (value ?? "").split(",").map(Number);
  const distance = (left, right) => Math.hypot(...left.map((value, index) => value - right[index]));
  const pose = async () => page.locator("canvas.model-canvas").evaluate((canvas) => ({
    position: canvas.dataset.cameraPosition,
    target: canvas.dataset.cameraTarget,
    direction: canvas.dataset.cameraDirection,
    canonicalPosition: canvas.dataset.canonicalCameraPosition,
    canonicalTarget: canvas.dataset.canonicalCameraTarget,
    canonicalDirection: canvas.dataset.canonicalCameraDirection,
  }));
  const canvas = page.locator("canvas.model-canvas");
  // A focused RVT object must stay framed when inspecting its IFC and Autodesk
  // counterparts. This caught the standalone reference views silently keeping
  // a stale whole-building camera while RVT alone honoured "Zoom to object".
  const zoomToObject = page.getByRole("button", { name: "Zoom to object", exact: true });
  if (ifcFile && glbFile && objectCount > 0 && await zoomToObject.count()) {
    await zoomToObject.click();
    await page.waitForTimeout(250);
    const focusedRvt = await pose();
    const focusedSources = [];
    for (const [label, expected] of [
      ["IFC", "reference"],
      ["Autodesk GLB", "reference-model"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).first().click();
      await page.waitForFunction((source) => {
        const modelCanvas = document.querySelector("canvas.model-canvas");
        return modelCanvas?.dataset.activeSource === source &&
          Boolean(modelCanvas.dataset.canonicalCameraTarget);
      }, expected, { timeout: 120_000 });
      await page.waitForTimeout(250);
      focusedSources.push([label, await pose()]);
    }
    await page.getByRole("button", { name: "RVT", exact: true }).first().click();
    await page.waitForFunction(() =>
      document.querySelector("canvas.model-canvas")?.dataset.activeSource === "recovered");
    for (const [label, candidate] of focusedSources) {
      if (distance(vector(focusedRvt.canonicalTarget), vector(candidate.canonicalTarget)) > 0.03) {
        throw new Error(`${label} did not preserve the focused object's canonical camera target.`);
      }
    }
    console.log("focused comparison smoke", "RVT, IFC and Autodesk GLB kept the same object framing");
  }
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

  if (ifcFile && glbFile) {
    const sourceGroup = page.getByRole("group", { name: "Geometry source" });
    await sourceGroup.waitFor({ state: "visible" });
    for (const [label, shortcut] of [["RVT", "1"], ["IFC", "2"], ["Autodesk GLB", "3"]]) {
      const button = sourceGroup.getByRole("button", { name: label, exact: true });
      if (await button.getAttribute("aria-keyshortcuts") !== shortcut) {
        throw new Error(`${label} does not expose keyboard shortcut ${shortcut}.`);
      }
    }

    const sourcePose = await pose();
    const switchSource = async (code, expected, label) => {
      await page.keyboard.press(code);
      await page.waitForFunction((source) => {
        const modelCanvas = document.querySelector("canvas.model-canvas");
        return modelCanvas?.dataset.activeSource === source &&
          modelCanvas.dataset.navigationState === "walk" &&
          ["hit", "ready"].includes(modelCanvas.dataset.walkSurfaceCache ?? "");
      }, expected, { timeout: 120_000 });
      const button = sourceGroup.getByRole("button", { name: label, exact: true });
      if (await button.getAttribute("aria-pressed") !== "true") {
        throw new Error(`${label} did not become the pressed Walk source.`);
      }
      return pose();
    };
    const ifcPose = await switchSource("Digit2", "reference", "IFC");
    const glbPose = await switchSource("Digit3", "reference-model", "Autodesk GLB");
    const recoveredPose = await switchSource("Digit1", "recovered", "RVT");
    console.log("source camera poses", JSON.stringify({ rvt: sourcePose, ifc: ifcPose, glb: glbPose, rvtReturn: recoveredPose }));

    // When the navigation-test build exposes the canonical frame, verify every
    // hop. The raw RVT round trip remains a guard for older bundles.
    for (const [name, candidate] of [["IFC", ifcPose], ["Autodesk GLB", glbPose], ["RVT", recoveredPose]]) {
      if (sourcePose.canonicalPosition && candidate.canonicalPosition &&
          distance(vector(sourcePose.canonicalPosition), vector(candidate.canonicalPosition)) > 0.03) {
        throw new Error(`${name} source switch changed the canonical first-person position.`);
      }
      if (sourcePose.canonicalDirection && candidate.canonicalDirection &&
          distance(vector(sourcePose.canonicalDirection), vector(candidate.canonicalDirection)) > 0.01) {
        throw new Error(`${name} source switch changed the canonical first-person direction.`);
      }
    }
    if (distance(vector(sourcePose.position), vector(recoveredPose.position)) > 0.05 ||
        distance(vector(sourcePose.direction), vector(recoveredPose.direction)) > 0.01) {
      throw new Error("RVT→IFC→GLB→RVT did not preserve the first-person camera round trip.");
    }
    const sceneCache = await canvas.getAttribute("data-scene-cache");
    const walkSurfaceCache = await canvas.getAttribute("data-walk-surface-cache");
    if (sceneCache !== "hit" || walkSurfaceCache !== "hit") {
      throw new Error(`RVT revisit missed a cache (scene=${sceneCache}, walk surface=${walkSurfaceCache}).`);
    }
    console.log(
      "source comparison smoke",
      `RVT→IFC→GLB→RVT camera handoff passed; scene ${sceneCache}; walk surface ${walkSurfaceCache}`,
    );
  }

  await canvas.evaluate((modelCanvas) => {
    window.__reviterNavigationEvents = [];
    const report = (message) => window.__reviterNavigationEvents.push(message);
    modelCanvas.addEventListener("pointerdown", (event) => {
      report(`pointerdown:${event.pointerType}:${event.button}`);
    });
  });
  await page.bringToFront();
  const lookBefore = await pose();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 130, point.y - 45, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const lookAfter = await pose();
  if (distance(vector(lookBefore.direction), vector(lookAfter.direction)) < 0.001) {
    throw new Error("Drag mouse look did not change the view direction.");
  }
  if (distance(vector(lookBefore.position), vector(lookAfter.position)) > 0.0001) {
    throw new Error("First-person look drag moved the camera instead of turning in place.");
  }
  if (await canvas.getAttribute("data-pointer-locked") !== "false") {
    throw new Error("Walk unexpectedly locked the system pointer.");
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
    `orbit, pan, wheel, pivot, Walk, drag look, WASD, gravity, Escape and handoff passed; entry ${walkEntryMs}ms; index ${indexBuildMs ?? "prewarmed"}ms`,
  );
}

if (logs.length) console.log(`--- browser log ---\n${logs.slice(-20).join("\n")}`);
await page.screenshot({ path: screenshot });
console.log("screenshot", screenshot);

await browser.close();
server.close();
