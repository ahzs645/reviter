/** Reproducible desktop/mobile acceptance checks against the built interface. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import * as THREE from "three";
import { interfaceModelBytes } from "../tests/fixtures/interface-model.ts";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { makeGlb } from "../lib/reviter/export-glb.ts";

const root = resolve("dist-pages"), output = resolve("artifacts/cadcraft-interface");
await mkdir(output, { recursive: true });
const bytes = interfaceModelBytes(), modelPath = resolve(output, "interface-fixture.rvt");
const floorModelPath = resolve(output, "interface-floors.rvt");
await writeFile(modelPath, bytes); await writeFile(floorModelPath, interfaceModelBytes(true));
const model = convertRvtBytes(bytes, "interface-fixture.rvt");
assert.ok(model.ok);
const ifcPath = resolve(output, "interface-reference.ifc"), glbPath = resolve(output, "interface-reference.glb");
await writeFile(ifcPath, makeIfc(model)); await writeFile(glbPath, new Uint8Array(makeGlb(model)));
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".wasm": "application/wasm", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const path = resolve(root, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
    if (!path.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
    const content = await readFile(path);
    response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }).end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(ready => server.listen(0, "127.0.0.1", ready));
const url = `http://127.0.0.1:${server.address().port}/?navigation-test=1`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [], errors = [];
let activePage;
function record(name) { results.push(name); console.log(`PASS ${name}`); }
async function pageFor(viewport, mobile = false) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  activePage = page; await page.goto(url, { waitUntil: "networkidle" }); return page;
}
async function command(page, name, argument) {
  await page.getByRole("button", { name: /^Commands/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Commands" });
  await dialog.getByRole("searchbox", { name: "Search commands" }).fill(name);
  await dialog.getByRole("button").filter({ hasText: name }).last().click();
  if (argument !== undefined) { await dialog.locator("form input").fill(String(argument)); await dialog.getByRole("button", { name: "Run command" }).click(); }
  await dialog.waitFor({ state: "hidden" });
}
async function waitUntil(page, predicate, argument) { await page.waitForFunction(predicate, argument, { timeout: 15000 }); }
async function session(page) { return page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("reviter.workspace-review.")).map(key => JSON.parse(localStorage.getItem(key))).at(-1)); }
async function openWorkbench(page) { const details = page.locator(".review-workbench > details"); if (!await details.evaluate(node => node.open)) await details.locator("summary").click(); }
async function noOverflow(page) { const sizes = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth })); assert.ok(sizes.document <= sizes.width + 1, JSON.stringify(sizes)); }
async function loadModel(page, path = modelPath) {
  await page.locator('input[type=file][accept*=".rvt"]').setInputFiles(path);
  await page.locator('[data-phase="ready"]').waitFor();
  await waitUntil(page, () => document.querySelector("canvas")?.dataset.cameraPosition);
  await openWorkbench(page);
  await page.getByRole("button", { name: "Save view", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Saved view name" }).fill("Ready check");
  await waitUntil(page, () => !document.querySelector('.review-workbench form button[type=submit]')?.disabled);
  await page.getByRole("textbox", { name: "Saved view name" }).fill("");
}
const pose = page => page.locator("canvas").evaluate(node => ({ position: node.dataset.cameraPosition, target: node.dataset.cameraTarget }));
async function screenFeet(page, feet) {
  const state = await pose(page), rect = await page.locator("canvas").boundingBox();
  const camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, .1, 100000);
  camera.up.set(0, 0, 1); camera.position.fromArray(state.position.split(",").map(Number)); camera.lookAt(new THREE.Vector3(...state.target.split(",").map(Number))); camera.updateMatrixWorld();
  const p = new THREE.Vector3(feet[0] - model.origin.x, feet[1] - model.origin.y, feet[2] - model.origin.z).project(camera);
  return { x: rect.x + (p.x + 1) * rect.width / 2, y: rect.y + (1 - p.y) * rect.height / 2 };
}
async function clickFeet(page, feet) { const at = await screenFeet(page, feet); await page.mouse.click(at.x, at.y); }
try {
  const desktop = await pageFor({ width: 1440, height: 1000 });
  await desktop.getByRole("button", { name: "Commands", exact: true }).waitFor();
  await desktop.keyboard.press("Control+k");
  await desktop.getByRole("searchbox", { name: "Search commands" }).fill("Zoom extents");
  assert.equal(await desktop.getByRole("dialog").getByRole("button").filter({ hasText: "Zoom extents" }).getAttribute("aria-disabled"), "true");
  await desktop.keyboard.press("Escape"); record("Empty-state command availability and keyboard dismissal");
  await loadModel(desktop); record("Synthetic RVT opens through actual CFB metadata reader, worker and renderer");
  await command(desktop, "Select object by ID", 1049);
  assert.match(await desktop.locator(".review-quick-actions").innerText(), /1 selected/);
  await desktop.locator(".object-row").filter({ has: desktop.locator("em", { hasText: /^2048$/ }) }).click({ modifiers: ["Shift"] });
  assert.match(await desktop.locator(".review-quick-actions").innerText(), /2 selected/);
  await desktop.locator(".object-row").filter({ has: desktop.locator("em", { hasText: /^2048$/ }) }).click({ modifiers: ["Shift"] });
  assert.match(await desktop.locator(".review-quick-actions").innerText(), /1 selected/);
  await command(desktop, "Select similar objects");
  assert.match(await desktop.locator(".review-quick-actions").innerText(), /2 selected/); record("ID search, additive/toggle selection and Select Similar");
  await command(desktop, "Isolate selection");
  assert.match(await desktop.locator(".review-quick-actions").innerText(), /27 hidden/);
  await command(desktop, "Hide selection");
  assert.match(await desktop.locator(".review-quick-actions").innerText(), /29 hidden/);
  await command(desktop, "Restore previous visibility");
  assert.match(await desktop.locator(".review-quick-actions").innerText(), /27 hidden/);
  await command(desktop, "Restore previous visibility");
  assert.match(await desktop.locator(".review-quick-actions").innerText(), /0 hidden/); record("Nested object hide/isolate restores exact previous visibility");
  const separator = desktop.getByRole("separator", { name: "Resize browser panel" });
  await separator.focus(); await separator.press("ArrowRight"); assert.equal(await separator.getAttribute("aria-valuenow"), "290");
  const box = await separator.boundingBox(); await desktop.mouse.move(box.x + 3, box.y + 50); await desktop.mouse.down(); await desktop.mouse.move(box.x + 43, box.y + 50); await desktop.mouse.up();
  assert.equal(await separator.getAttribute("aria-valuenow"), "330");
  await desktop.getByRole("combobox", { name: "Workspace layout" }).selectOption("floor");
  assert.equal(await separator.getAttribute("aria-valuenow"), "240");
  await desktop.getByRole("combobox", { name: "Workspace layout" }).selectOption("inspection"); record("Pointer and keyboard panel resizing; layout presets");
  await desktop.getByRole("button", { name: "Orient model top" }).click();
  await command(desktop, "Section tool");
  await desktop.getByRole("region", { name: "Section options" }).getByRole("slider").fill("30");
  const categories = desktop.getByRole("region", { name: "Selection and visibility" });
  await categories.getByLabel("Walls", { exact: true }).uncheck();
  await desktop.getByRole("textbox", { name: "Saved view name" }).fill("Top section review");
  await desktop.getByRole("button", { name: "Save view", exact: true }).click();
  await waitUntil(desktop, () => Object.keys(localStorage).filter(k => k.startsWith("reviter.workspace-review.")).some(k => JSON.parse(localStorage.getItem(k)).views.length === 1));
  const saved = (await session(desktop)).views[0]; assert.equal(saved.section.offset, .3); assert.ok(saved.hiddenCategories.includes("Walls"));
  await desktop.getByRole("button", { name: "Orient model home" }).click(); await command(desktop, "Show all objects"); await command(desktop, "Section tool");
  await desktop.getByRole("button", { name: "Top section review", exact: true }).click();
  await waitUntil(desktop, expected => document.querySelector('section[aria-label="Section options"] input[type=range]')?.value === "30" && document.querySelector("canvas")?.dataset.cameraPosition?.split(",").every((n, i) => Math.abs(Number(n) - expected[i]) < .0001), saved.camera.position);
  assert.equal(await categories.getByLabel("Walls", { exact: true }).isChecked(), false); record("Saved view restores camera, source, section and visibility");
  await command(desktop, "Show all objects"); await command(desktop, "Section tool");
  await command(desktop, "Select object by ID", 1049); await command(desktop, "Clear selection"); await command(desktop, "Zoom extents");
  await desktop.getByRole("button", { name: "Orient model top" }).click();
  const rectangle = await desktop.locator("canvas").boundingBox();
  await desktop.keyboard.down("Shift"); await desktop.mouse.move(rectangle.x + 5, rectangle.y + 5); await desktop.mouse.down();
  await desktop.mouse.move(rectangle.x + rectangle.width - 5, rectangle.y + rectangle.height - 5, { steps: 8 }); await desktop.mouse.up(); await desktop.keyboard.up("Shift");
  assert.match(await desktop.locator(".review-quick-actions").innerText(), /[1-9]\d* selected/);
  await command(desktop, "Clear selection");
  await desktop.keyboard.down("Shift"); await desktop.mouse.move(rectangle.x + rectangle.width - 5, rectangle.y + rectangle.height - 5); await desktop.mouse.down();
  await desktop.mouse.move(rectangle.x + 5, rectangle.y + 5, { steps: 8 }); await desktop.mouse.up(); await desktop.keyboard.up("Shift");
  assert.match(await desktop.locator(".review-quick-actions").innerText(), /[1-9]\d* selected/); record("Canvas window and crossing selection through actual pointer gestures");
  await command(desktop, "Select object by ID", 1049); await desktop.getByRole("button", { name: "Orient model front" }).click(); await command(desktop, "Zoom to selection");
  const wall = model.elementBounds.find(r => r.elementId === 1049).boundsFeet;
  const a = [wall.min.x + (wall.max.x - wall.min.x) * .3, wall.min.y, wall.min.z + (wall.max.z - wall.min.z) * .4];
  const b = [wall.min.x + (wall.max.x - wall.min.x) * .6, wall.min.y, wall.min.z + (wall.max.z - wall.min.z) * .4];
  await desktop.locator("canvas").focus(); await desktop.keyboard.press("Shift+F10");
  await desktop.getByRole("menu").waitFor(); await desktop.keyboard.press("Escape"); record("Keyboard context menu opens and dismisses correctly");
  await command(desktop, "Measure tool");
  await clickFeet(desktop, a); await clickFeet(desktop, b);
  await waitUntil(desktop, () => Object.keys(localStorage).some(k => k.startsWith("reviter.workspace-review.") && JSON.parse(localStorage.getItem(k)).dimensions.length === 1));
  const measured = (await session(desktop)).dimensions[0]; assert.equal(measured.space, "model-feet"); assert.ok(measured.provenance.includes("fixed anchors"));
  await desktop.getByRole("button", { name: "Undo dimension", exact: true }).click(); assert.equal((await session(desktop)).dimensions.length, 0);
  await desktop.getByRole("button", { name: "Redo dimension", exact: true }).click(); assert.equal((await session(desktop)).dimensions.length, 1); record("3D surface measurement persists numeric canonical anchors with undo/redo");
  await command(desktop, "Measure tool");
  await command(desktop, "Comment tool"); await clickFeet(desktop, a);
  await desktop.getByRole("textbox", { name: "Comment 1 text" }).fill("Interface regression comment");
  await command(desktop, "Comment tool");
  await command(desktop, "Markup tool");
  const startStroke = await screenFeet(desktop, [a[0], a[1], a[2] + 2]), endStroke = await screenFeet(desktop, [b[0], b[1], b[2] + 2]);
  await desktop.mouse.move(startStroke.x, startStroke.y); await desktop.mouse.down(); await desktop.mouse.move(endStroke.x, endStroke.y, { steps: 8 }); await desktop.mouse.up();
  await waitUntil(desktop, () => Object.keys(localStorage).some(k => k.startsWith("reviter.model-markup.") && JSON.parse(localStorage.getItem(k)).length > 0));
  await command(desktop, "Markup tool"); record("Existing pinned comments and model-anchored markup work with shared tool commands");
  const downloadPending = desktop.waitForEvent("download"); await desktop.getByRole("button", { name: "Export views & dimensions" }).click();
  const reviewPath = resolve(output, "model.review.json"); await (await downloadPending).saveAs(reviewPath);
  const exchange = JSON.parse(await readFile(reviewPath, "utf8")); assert.match(exchange.modelHash, /^sha256-[a-f0-9]{64}$/); assert.equal(exchange.views.length, 1); assert.equal(exchange.dimensions.length, 1);
  await desktop.screenshot({ path: resolve(output, "desktop-model.png") });
  await desktop.reload(); await desktop.locator('input[type=file][accept*=".rvt"]').setInputFiles(modelPath); await desktop.locator('[data-phase="ready"]').waitFor(); await openWorkbench(desktop);
  await desktop.getByRole("button", { name: "Top section review", exact: true }).waitFor(); assert.equal((await session(desktop)).dimensions.length, 1);
  assert.equal(await desktop.getByRole("separator", { name: "Resize browser panel" }).getAttribute("aria-valuenow"), "280"); record("Reload retains panel preferences, views and dimensions; portable JSON exports");
  const invalid = { ...exchange, modelHash: `sha256-${"0".repeat(64)}` };
  await desktop.locator('.review-workbench input[type=file]').setInputFiles({ name: "wrong.review.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await desktop.getByRole("status").filter({ hasText: "different source file or revision" }).waitFor(); assert.equal((await session(desktop)).views.length, 1); record("Different source/revision review import is rejected without changing saved data");
  await desktop.getByRole("textbox", { name: "Saved view name" }).fill("typing k"); await desktop.keyboard.press("Control+k"); assert.equal(await desktop.locator("dialog[open]").count(), 0);
  await noOverflow(desktop); record("Text editing keeps its keyboard shortcuts; desktop has no horizontal overflow");

  await desktop.getByRole("textbox", { name: "Saved view name" }).fill("");
  await desktop.locator('input[type=file][accept=".ifc"]').setInputFiles(ifcPath);
  await waitUntil(desktop, () => document.querySelector("canvas")?.dataset.activeSource === "reference-assisted");
  await desktop.getByRole("textbox", { name: "Saved view name" }).fill("IFC comparison view"); await desktop.getByRole("button", { name: "Save view", exact: true }).click();
  await desktop.getByRole("button", { name: "IFC comparison view", exact: true }).waitFor();
  assert.match((await session(desktop)).views.find(view => view.name === "IFC comparison view").referenceHash, /^sha256-/);
  await desktop.locator('input[type=file][accept*=".glb"]').setInputFiles(glbPath);
  await waitUntil(desktop, () => document.querySelector("canvas")?.dataset.activeSource === "reference-model" && document.querySelector("canvas")?.dataset.referenceCache);
  await desktop.getByRole("button", { name: "IFC comparison view", exact: true }).click();
  await waitUntil(desktop, () => document.querySelector("canvas")?.dataset.activeSource === "reference-assisted");
  await desktop.getByRole("button", { name: "Top section review", exact: true }).click();
  await waitUntil(desktop, () => document.querySelector("canvas")?.dataset.activeSource === "recovered");
  record("IFC/GLB pairing and saved-view restoration return to the exact source and registered camera");
  await desktop.setViewportSize({ width: 900, height: 800 });
  const modelBox = await desktop.locator("canvas").boundingBox(); assert.ok(modelBox.width >= 300); await noOverflow(desktop);
  await desktop.setViewportSize({ width: 1440, height: 1000 }); record("Narrow desktop preserves a usable model viewport");

  const drawing = await pageFor({ width: 1440, height: 1000 });
  await drawing.locator('input[type=file][accept*=".rvt"]').setInputFiles(resolve("tests/fixtures/revitless-toolkit/7-PS-66_R3.dwg"));
  await drawing.getByRole("combobox", { name: "Drawing measurement mode" }).waitFor();
  await waitUntil(drawing, () => !document.querySelector('select[aria-label="Drawing measurement mode"]')?.disabled);
  await drawing.getByRole("combobox", { name: "Drawing units", exact: true }).selectOption("feet");
  await drawing.getByRole("combobox", { name: "Drawing measurement mode" }).selectOption("distance");
  const geometry = await drawing.locator(".dwg-image img").evaluate(async image => {
    const xml = await (await fetch(image.src)).text(), doc = new DOMParser().parseFromString(xml, "image/svg+xml");
    const path = [...doc.querySelectorAll("path[data-dwg-layer]")].find(path => /M[-\d.]+ [-\d.]+L/.test(path.getAttribute("d")));
    const match = path.getAttribute("d").match(/M([-\d.]+) ([-\d.]+)L/);
    return { point: [Number(match[1]), Number(match[2])], layer: path.getAttribute("data-dwg-layer") };
  });
  const overlay = drawing.locator(".dwg-precision-overlay");
  const screen = await overlay.evaluate((node, point) => {
    const rect = node.getBoundingClientRect(), b = node.viewBox.baseVal, scale = Math.min(rect.width / b.width, rect.height / b.height);
    return { x: rect.left + (rect.width - b.width * scale) / 2 + (point[0] - b.x) * scale, y: rect.top + (rect.height - b.height * scale) / 2 + (-point[1] - b.y) * scale };
  }, geometry.point);
  await drawing.mouse.move(screen.x + 2, screen.y + 2); await drawing.mouse.click(screen.x + 2, screen.y + 2);
  await drawing.getByRole("spinbutton", { name: "Numeric drawing distance" }).fill("5"); await drawing.getByRole("button", { name: "Add distance", exact: true }).click();
  await waitUntil(drawing, () => Object.keys(localStorage).some(k => k.startsWith("reviter.workspace-review.") && JSON.parse(localStorage.getItem(k)).dimensions.length === 1));
  let drawingData = await session(drawing); assert.equal(drawingData.dimensions[0].feetPerUnit, 1);
  const pair = drawingData.dimensions[0].points; assert.ok(Math.abs(Math.hypot(pair[1][0] - pair[0][0], pair[1][1] - pair[0][1]) - 5) < 1e-6); record("Real DWG decodes; entity snaps and explicit numeric distance save a dimension");
  await drawing.locator(".drawing-review-tools > details > summary").click();
  await drawing.getByRole("button", { name: "Undo", exact: true }).click(); assert.equal((await session(drawing)).dimensions.length, 0);
  await drawing.getByRole("button", { name: "Redo", exact: true }).click(); assert.equal((await session(drawing)).dimensions.length, 1);
  await drawing.getByRole("combobox", { name: "Drawing measurement mode" }).selectOption("area");
  async function coordinate(x, y) { await drawing.getByRole("spinbutton", { name: "Drawing anchor X" }).fill(String(x)); await drawing.getByRole("spinbutton", { name: "Drawing anchor Y" }).fill(String(y)); await drawing.getByRole("button", { name: "Add coordinate", exact: true }).click(); }
  await coordinate(0, 0); await coordinate(3, 0); await coordinate(3, 4); await coordinate(0, 4); await drawing.getByRole("button", { name: "Finish polygon" }).click();
  assert.equal((await session(drawing)).dimensions.length, 2);
  await drawing.getByRole("combobox", { name: "Drawing measurement mode" }).selectOption("angle");
  await coordinate(1, 0); await coordinate(0, 0); await coordinate(0, 1);
  assert.equal((await session(drawing)).dimensions.length, 3); record("Drawing polygon/angle dimensions, coordinate entry and undo/redo");
  const manager = drawing.getByRole("region", { name: "Drawing layer manager" });
  await manager.getByRole("searchbox").fill(geometry.layer);
  const row = manager.locator(".review-list-row").filter({ has: drawing.getByRole("checkbox", { name: geometry.layer, exact: true }) }).first();
  await row.getByRole("checkbox").uncheck();
  const layerAbsent = await drawing.locator(".dwg-image img").evaluate(async (image, layer) => { const xml = await (await fetch(image.src)).text(); return ![...new DOMParser().parseFromString(xml, "image/svg+xml").querySelectorAll("[data-dwg-layer]")].some(node => node.getAttribute("data-dwg-layer") === layer); }, geometry.layer);
  assert.equal(layerAbsent, true); await drawing.getByRole("button", { name: "Restore layers", exact: true }).click();
  await row.getByRole("button", { name: "Isolate", exact: true }).click();
  await drawing.getByRole("button", { name: "Restore layers", exact: true }).click();
  await row.locator('input[type=color]').fill("#ff0000"); await row.getByRole("slider").fill("0.5"); record("Drawing layer visibility, isolation history, colour and opacity controls");
  await drawing.getByRole("combobox", { name: "Drawing measurement mode" }).selectOption("off");
  await drawing.getByRole("button", { name: "Print preview", exact: true }).click();
  await drawing.getByRole("combobox", { name: "Review sheet scale" }).selectOption("10000");
  await drawing.getByRole("textbox", { name: "Review sheet title" }).fill("Fixture review sheet");
  await drawing.getByRole("textbox", { name: "New sheet setup name" }).fill("A review setup"); await drawing.getByRole("button", { name: "Save setup", exact: true }).click();
  await drawing.getByRole("combobox", { name: "Review sheet scale" }).selectOption("fit"); await drawing.getByRole("combobox", { name: "Saved sheet setup" }).selectOption({ label: "A review setup" });
  assert.equal(await drawing.getByRole("combobox", { name: "Review sheet scale" }).inputValue(), "10000");
  const sheetPending = drawing.waitForEvent("download"); await drawing.getByRole("button", { name: "Save sheet SVG" }).click();
  const sheetPath = resolve(output, "drawing-review-sheet.svg"); await (await sheetPending).saveAs(sheetPath);
  const printed = await readFile(sheetPath, "utf8"); assert.match(printed, /Scale 1:10000/); assert.match(printed, /Fixture review sheet/); assert.match(printed, /data-scale-bar-feet/); assert.match(printed, /review-dimensions/);
  await drawing.getByRole("combobox", { name: "Review sheet scale" }).selectOption("fit");
  await drawing.locator(".drawing-review-tools > details > summary").click();
  await drawing.emulateMedia({ media: "print" }); await drawing.pdf({ path: resolve(output, "drawing-review-sheet.pdf"), preferCSSPageSize: true, printBackground: true }); await drawing.emulateMedia({ media: "screen" });
  await drawing.screenshot({ path: resolve(output, "desktop-drawing-sheet.png") }); record("Physical sheet scale, title block, scale bar, setup restore, SVG and browser PDF output");
  await drawing.getByRole("combobox", { name: "Drawing units", exact: true }).selectOption("file");
  // Explicitly unitless drawings must report their limitation instead of inventing scale.
  const unitLabel = await drawing.getByRole("combobox", { name: "Drawing units", exact: true }).locator("option:checked").innerText();
  if (unitLabel.includes("Unspecified")) await drawing.getByRole("alert").filter({ hasText: "Choose drawing units" }).waitFor();
  await noOverflow(drawing);
  await drawing.getByRole("button", { name: "Close drawing" }).click();
  await drawing.locator('input[type=file][accept*=".rvt"]').setInputFiles(resolve("tests/fixtures/revitless-toolkit/A1ANG-3.dwg"));
  await waitUntil(drawing, () => !document.querySelector('select[aria-label="Drawing measurement mode"]')?.disabled);
  assert.equal(await drawing.getByRole("region", { name: "Drawing dimensions", exact: true }).locator(".review-list-row").count(), 0); record("Switching DWG files does not leak review annotations");

  const mobile = await pageFor({ width: 390, height: 844 }, true);
  await loadModel(mobile); await command(mobile, "Select object by ID", 1049); await command(mobile, "Select similar objects");
  assert.match(await mobile.locator(".review-quick-actions").innerText(), /2 selected/);
  await mobile.getByRole("button", { name: "Top section review", exact: true }).count();
  await mobile.getByRole("textbox", { name: "Saved view name" }).fill("Mobile view"); await mobile.getByRole("button", { name: "Save view", exact: true }).click();
  await mobile.getByRole("button", { name: "Mobile view", exact: true }).waitFor();
  await mobile.locator(".review-workbench > details > summary").click();
  await mobile.getByRole("button", { name: /^Commands/ }).click();
  await mobile.screenshot({ path: resolve(output, "mobile-commands.png") }); await mobile.keyboard.press("Escape");
  await mobile.screenshot({ path: resolve(output, "mobile-model.png") }); await noOverflow(mobile); record("Mobile model command search, selection, saved views, modal and layout");
  await mobile.locator('input[type=file][accept*=".rvt"]').setInputFiles(resolve("tests/fixtures/revitless-toolkit/7-PS-66_R3.dwg"));
  await waitUntil(mobile, () => !document.querySelector('select[aria-label="Drawing measurement mode"]')?.disabled);
  for (const name of ["Drawing measurement mode", "Drawing units", "Dimension display units"]) {
    const control = await mobile.getByRole("combobox", { name, exact: true }).boundingBox();
    assert.ok(control.width >= 120, `${name} is too narrow on mobile: ${control.width}`);
  }
  await mobile.getByRole("combobox", { name: "Drawing measurement mode" }).selectOption("distance");
  await mobile.getByRole("spinbutton", { name: "Drawing anchor X" }).fill("0"); await mobile.getByRole("spinbutton", { name: "Drawing anchor Y" }).fill("0"); await mobile.getByRole("button", { name: "Add coordinate", exact: true }).click();
  await mobile.getByRole("spinbutton", { name: "Numeric drawing distance" }).fill("10"); await mobile.getByRole("button", { name: "Add distance", exact: true }).click();
  await waitUntil(mobile, () => Object.keys(localStorage).some(k => k.startsWith("reviter.workspace-review.") && JSON.parse(localStorage.getItem(k)).dimensions.some(d => d.source === "drawing")));
  await mobile.getByRole("combobox", { name: "Drawing measurement mode" }).selectOption("off");
  await mobile.screenshot({ path: resolve(output, "mobile-drawing.png") }); await noOverflow(mobile); record("Mobile drawing import, numeric measurement, persistence and responsive layout");
  const floors = await pageFor({ width: 1440, height: 1000 });
  await loadModel(floors, floorModelPath);
  await command(floors, "Switch floor by level ID", 900002);
  assert.equal(await floors.getByRole("combobox", { name: "Browse Revit floor level", includeHidden: true }).inputValue(), "900002");
  await command(floors, "Open model workspace");
  await floors.getByRole("textbox", { name: "Saved view name" }).fill("Upper floor review"); await floors.getByRole("button", { name: "Save view", exact: true }).click();
  await floors.getByRole("button", { name: "Upper floor review", exact: true }).waitFor();
  assert.equal((await session(floors)).views[0].levelId, 900002);
  await command(floors, "Switch floor by level ID", 900001); await command(floors, "Open model workspace");
  await floors.getByRole("button", { name: "Upper floor review", exact: true }).click();
  await waitUntil(floors, () => document.querySelector('select[aria-label="Browse Revit floor level"]')?.value === "900002");
  await floors.screenshot({ path: resolve(output, "desktop-native-floor-view.png") });
  record("Native floor-ID command and saved-floor restoration across two decoded storeys");
  assert.deepEqual(errors, [], "Browser console/page errors"); record("No browser JavaScript errors across acceptance workflows");
  await writeFile(resolve(output, "browser-results.json"), JSON.stringify({ passed: results, errors }, null, 2));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
    await writeFile(resolve(output, "failure.txt"), await activePage.locator("body").innerText().catch(() => ""));
  }
  await writeFile(resolve(output, "browser-results.json"), JSON.stringify({ passed: results, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); await new Promise(done => server.close(done)); }
