#!/usr/bin/env node

/**
 * Drive the assertion loop in a real browser tab, on a real Revit file.
 *
 * The unit tests prove the overrides model and prove the exporter flags what a
 * reviewer asserted. Neither of them proves that a person can *reach* any of it:
 * that the edit switch gates the surface, that picking an element and choosing a
 * category marks the row, that the export stops to be read, and that what
 * finally lands on disk carries the assertion. That is four seams between the
 * model and the file, and this is the only check that crosses all of them.
 *
 *   npm run build:pages
 *   node scripts/browser-check-assertions.mjs dist-pages /path/to/model.rvt [shot.png]
 *
 * Build with the default base path; a bundle built for GitHub Pages requests
 * its assets from `/reviter/` and will not boot under the local root server.
 * Needs a local Revit file, so it stays out of `npm test` exactly as
 * `browser-check.mjs` does.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const [root, revitFile, screenshot = "assertion-check.png"] = process.argv.slice(2);
if (!root || !revitFile) {
  console.error("usage: node scripts/browser-check-assertions.mjs <pages-dir> <model.rvt> [screenshot.png]");
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
await new Promise((ready) => server.listen(4174, ready));

const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

let browser;
const headed = process.env.REVITER_BROWSER_HEADED === "1";
try {
  browser = await chromium.launch({ headless: !headed, args: ["--no-sandbox"] });
} catch (error) {
  if (!(error instanceof Error) || !/Executable doesn't exist/u.test(error.message)) throw error;
  browser = await chromium.launch({ channel: "chrome", headless: !headed, args: ["--no-sandbox"] });
}

const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const logs = [];
page.on("console", (message) => logs.push(`[${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => logs.push(`[pageerror] ${error.message}`));

try {
  await page.goto("http://localhost:4174/", { waitUntil: "networkidle" });
  await page.setInputFiles('input[type="file"][accept*=".rvt"]', resolve(revitFile));

  const started = Date.now();
  let phase = "";
  for (let attempt = 0; attempt < 400; attempt += 1) {
    await page.waitForTimeout(1_500);
    phase = await page.locator("main.studio").getAttribute("data-phase") ?? "";
    if (phase === "ready" || phase === "error") break;
  }
  if (phase !== "ready") throw new Error(`conversion ended in phase "${phase}"`);
  console.log("conversion wall clock", `${((Date.now() - started) / 1000).toFixed(1)}s`);

  // ── 1. The edit switch is off, and it gates the surface ────────────────────
  const editPill = page.locator("button.edit-pill");
  await editPill.waitFor({ state: "visible", timeout: 30_000 });
  check(
    "edit mode starts off",
    (await editPill.getAttribute("aria-pressed")) === "false",
  );

  // Pick the first element in the object list so there is something to assert on.
  const listRow = page.locator(".object-list .object-row").first();
  await listRow.waitFor({ state: "visible", timeout: 30_000 });
  await listRow.click();
  await page.waitForTimeout(400);

  check(
    "no assertion editor while read only",
    (await page.locator(".assertion-editor").count()) === 0,
  );

  // ── 2. Turning it on reveals the editor ───────────────────────────────────
  await editPill.click();
  await page.waitForTimeout(300);
  check("edit mode turns on", (await editPill.getAttribute("aria-pressed")) === "true");

  const editor = page.locator(".assertion-editor");
  await editor.waitFor({ state: "visible", timeout: 10_000 });
  check("assertion editor appears with a selection", await editor.isVisible());

  // ── 3. Asserting a category marks the row ─────────────────────────────────
  // The value cell carries the inline provenance marker ("INFERRED", "EDITED"),
  // which is the point of it — strip it to get back the category itself.
  const categoryValue = async () => {
    const text = await page.locator('.property-row:has(dt:text-is("Category")) dd').first().innerText();
    return text.replace(/^(inferred|edited|decoded)/i, "").trim();
  };
  const decodedCategory = await categoryValue();
  const categorySelect = editor.locator("select").first();
  const options = await categorySelect.locator("option").allTextContents();
  const target = options.find((option) => option !== "Leave as recovered" && option !== decodedCategory.trim());
  check("the picker offers categories from this building", Boolean(target), `${options.length - 1} categories`);
  if (!target) throw new Error("no alternative category to assert");

  await categorySelect.selectOption({ label: target });
  await editor.locator('input[placeholder="Why this was changed"]').fill("browser-check assertion");
  await page.waitForTimeout(400);

  const categoryRow = page.locator('.property-row:has(dt:text-is("Category"))').first();
  check(
    "the category row is marked edited",
    (await categoryRow.getAttribute("data-provenance")) === "edited",
    `${decodedCategory} → ${target}`,
  );
  check(
    "the marker is a word, not only a colour",
    (await categoryRow.locator(".property-provenance").innerText()).trim().toLowerCase() === "edited",
  );
  check("the pill counts the assertion", (await editPill.innerText()).includes("1"));

  // ── 4. Undo and redo reach it ─────────────────────────────────────────────
  // Two assertions were made — the category, then the note — so undo steps back
  // through them one at a time. Undoing the note must NOT drop the category:
  // an undo stack that collapsed a session into one step would make the button
  // useless for exactly the reviewer who used it most.
  const undo = editor.getByRole("button", { name: "Undo assertion" });
  const redo = editor.getByRole("button", { name: "Redo assertion" });
  await undo.click();
  await page.waitForTimeout(300);
  check(
    "one undo drops the note and keeps the category",
    (await categoryRow.getAttribute("data-provenance")) === "edited"
      && (await page.locator('.property-row:has(dt:text-is("Reviewer note"))').count()) === 0,
  );
  await undo.click();
  await page.waitForTimeout(300);
  check(
    "a second undo returns the row to its decoded provenance",
    (await categoryRow.getAttribute("data-provenance")) !== "edited",
    await categoryValue(),
  );
  await redo.click();
  await redo.click();
  await page.waitForTimeout(300);
  check(
    "redo restores both assertions",
    (await categoryRow.getAttribute("data-provenance")) === "edited"
      && (await page.locator('.property-row:has(dt:text-is("Reviewer note"))').count()) === 1,
  );

  await page.screenshot({ path: screenshot, fullPage: false });

  // ── 5. The export stops to be read ────────────────────────────────────────
  // Exports live in the report dock, which starts closed.
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await page.getByRole("tab", { name: "Exports" }).click();
  const exportButton = page.locator(".export-card", { hasText: "IFC" }).first();
  await exportButton.waitFor({ state: "visible", timeout: 30_000 });
  await exportButton.click();

  const dialog = page.locator(".assertion-review");
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  check("export opens the review dialog instead of writing", await dialog.isVisible());
  const dialogText = await dialog.innerText();
  check(
    "the dialog shows decoded → asserted",
    dialogText.includes(decodedCategory) && dialogText.includes(target),
    dialogText.split("\n").slice(0, 3).join(" · "),
  );

  // ── 6. Confirming writes a file carrying the assertion ────────────────────
  const download = page.waitForEvent("download", { timeout: 600_000 });
  await dialog.getByRole("button", { name: /^Export with/ }).click();
  const saved = await download;
  const path = await saved.path();
  const ifc = await readFile(path, "utf8");

  check("the exported IFC names the asserted category", ifc.includes(`IFCTEXT('${target}')`));
  check("the exported IFC flags the assertion", ifc.includes("'AssertedFields'"));
  check("the exported IFC names an author", ifc.includes("'AssertedBy'"));
  check("the exported IFC keeps what the decoder said", ifc.includes("'DecodedRevitCategory'"));
  check(
    "the asserted element's evidence names the reviewer",
    ifc.includes("'CategoryEvidence',$,IFCTEXT('reviewer-assertion')"),
  );
  await writeFile(`${screenshot}.ifc-head.txt`, ifc.slice(0, 4_000));

  // ── 7. Leaving edit mode ends the editing ─────────────────────────────────
  await editPill.click();
  await page.waitForTimeout(300);
  check(
    "leaving edit mode withdraws the editor",
    (await page.locator(".assertion-editor").count()) === 0,
  );
  check(
    "the assertion itself survives leaving edit mode",
    (await categoryRow.getAttribute("data-provenance")) === "edited",
  );

  const errors = logs.filter((line) => line.startsWith("[pageerror]"));
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  server.close();
}

console.log(failures.length ? `\nFAIL — ${failures.length} check(s): ${failures.join(", ")}` : "\nPASS — every assertion check");
process.exitCode = failures.length ? 1 : 0;
