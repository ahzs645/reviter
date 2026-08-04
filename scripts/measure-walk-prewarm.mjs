import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3000/?navigation-test";
const rvtPath = process.argv[3];
if (!rvtPath) throw new Error("Usage: node scripts/measure-walk-prewarm.mjs <url> <model.rvt>");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (error) => console.error(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") console.error(`console: ${message.text()}`);
});
await page.addInitScript(() => {
  globalThis.__reviterLongTasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      globalThis.__reviterLongTasks.push({ start: entry.startTime, duration: entry.duration });
    }
  }).observe({ type: "longtask", buffered: true });
});

const startedAt = performance.now();
await page.goto(url);
// Clicking through the hydrated control avoids selecting the server-rendered
// hidden input before React has attached its change handler.
await page.waitForTimeout(1_000);
const [fileChooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  page.getByRole("button", { name: "Open a Revit file" }).click(),
]);
await fileChooser.setFiles(rvtPath);
const progressTimer = setInterval(async () => {
  const status = await page.locator("body").innerText().catch(() => "");
  console.error(`waiting: ${status.match(/(Reading file|Recovering geometry|Ready|Conversion stopped)[^\n]*/)?.[0] ?? "unknown"}`);
}, 30_000);
await page.locator("canvas.model-canvas").waitFor({ state: "attached", timeout: 600_000 });
clearInterval(progressTimer);
const canvasReadyAt = performance.now();
const canvas = page.locator("canvas.model-canvas");
const beforeWalk = await canvas.evaluate((element) => ({
  indexState: element.dataset.walkIndexState,
  surfaceCache: element.dataset.walkSurfaceCache,
  collisionCache: element.dataset.walkCollisionCache,
  walkAssetCache: element.dataset.walkAssetCache,
}));

const walkClickedAt = performance.now();
const walkClickedPageAt = await page.evaluate(() => performance.now());
await page.getByRole("button", { name: "Walk", exact: true }).click();
await page.waitForFunction(() => {
  const element = document.querySelector("canvas.model-canvas");
  return element?.dataset.navigationState === "walk";
}, null, { timeout: 120_000 });
const walkReadyAt = performance.now();
const walkReadyPageAt = await page.evaluate(() => performance.now());
const afterWalk = await canvas.evaluate((element) => ({
  indexState: element.dataset.walkIndexState,
  surfaceCache: element.dataset.walkSurfaceCache,
  collisionCache: element.dataset.walkCollisionCache,
  walkAssetCache: element.dataset.walkAssetCache,
  surfaceBuildMs: Number(element.dataset.walkIndexBuildMs ?? "NaN"),
  surfaceCpuMs: Number(element.dataset.walkIndexCpuMs ?? "NaN"),
  surfaceMaxChunkMs: Number(element.dataset.walkIndexMaxChunkMs ?? "NaN"),
  surfaceYieldCount: Number(element.dataset.walkIndexYieldCount ?? "NaN"),
  walkEntryWaitMs: Number(element.dataset.walkEntryWaitMs ?? "NaN"),
  walkEntryState: element.dataset.walkEntryState,
  walkPrewarmState: element.dataset.walkPrewarmState,
  walkIndexPriority: element.dataset.walkIndexPriority,
  collisionBuildMs: Number(element.dataset.walkCollisionBuildMs ?? "NaN"),
  navigationState: element.dataset.navigationState,
}));
const longTasks = await page.evaluate(() => globalThis.__reviterLongTasks ?? []);
const betweenClickAndReady = longTasks.filter((task) =>
  task.start >= walkClickedPageAt && task.start <= walkReadyPageAt);
const cameraBeforeStyle = await canvas.evaluate((element) =>
  element.dataset.canonicalCameraPosition ?? null);
const styleStartedAt = performance.now();
await page.getByRole("button", { name: "X-ray", exact: true }).click();
await page.waitForFunction(() => {
  const element = document.querySelector("canvas.model-canvas");
  return element?.dataset.walkAssetCache === "hit"
    && element.dataset.navigationState === "walk"
    && element.dataset.walkEntryState === "ready";
}, null, { timeout: 120_000 });
const styleSwitchMs = performance.now() - styleStartedAt;
const afterStyleSwitch = await canvas.evaluate((element) => ({
  sceneCache: element.dataset.sceneCache,
  walkAssetCache: element.dataset.walkAssetCache,
  surfaceCache: element.dataset.walkSurfaceCache,
  walkEntryWaitMs: Number(element.dataset.walkEntryWaitMs ?? "NaN"),
  camera: element.dataset.canonicalCameraPosition ?? null,
}));

console.log(JSON.stringify({
  url,
  canvasReadyMs: canvasReadyAt - startedAt,
  walkReadyMs: walkReadyAt - walkClickedAt,
  walkReadyPageMs: walkReadyPageAt - walkClickedPageAt,
  beforeWalk,
  afterWalk,
  clickToReadyLongTasks: betweenClickAndReady,
  longestLongTaskMs: Math.max(0, ...betweenClickAndReady.map((task) => task.duration)),
  styleSwitchMs,
  cameraBeforeStyle,
  afterStyleSwitch,
}, null, 2));
await browser.close();
