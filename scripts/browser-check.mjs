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
 *   node scripts/browser-check.mjs dist-pages /path/to/model.rvt [screenshot.png]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const [root, revitFile, screenshot = "browser-check.png"] = process.argv.slice(2);
if (!root || !revitFile) {
  console.error("usage: node scripts/browser-check.mjs <pages-dir> <model.rvt> [screenshot.png]");
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

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = [];
page.on("console", (message) => logs.push(`[${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => logs.push(`[pageerror] ${error.message}`));

await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.setInputFiles('input[type="file"][accept*=".rvt"]', resolve(revitFile));

const started = Date.now();
let rendered = "";
for (let attempt = 0; attempt < 400; attempt += 1) {
  await page.waitForTimeout(1_500);
  rendered = await page.evaluate(() => document.body.innerText.slice(0, 4_000));
  if (/RVT element envelopes|could not|failed|error/i.test(rendered)) break;
}

console.log("conversion wall clock", `${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(rendered);
if (logs.length) console.log(`--- browser log ---\n${logs.slice(-20).join("\n")}`);
await page.screenshot({ path: screenshot });
console.log("screenshot", screenshot);

await browser.close();
server.close();
