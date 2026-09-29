#!/usr/bin/env node
// Rasterise SVGs with the Chromium that playwright already installs, so a
// surface-diff drawing can be looked at without a browser session.
//
//   node scripts/svg-to-png.mjs in.svg [in2.svg ...]   -> writes in.png beside each
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: svg-to-png.mjs in.svg [...]");
  process.exit(2);
}
// The headless shell playwright wants may not be installed while a full
// Chromium of the same revision is; fall back to that, or to CHROME_PATH.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
const fallback = `${homedir()}/Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;
const executablePath = process.env.CHROME_PATH ?? (existsSync(fallback) ? fallback : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const file of files) {
    const svg = readFileSync(file, "utf8");
    const size = svg.match(/viewBox="[^"]*?([\d.]+) ([\d.]+)"/) ?? svg.match(/width="([\d.]+)"[^>]*height="([\d.]+)"/);
    const width = Math.min(2400, Math.ceil(Number(size?.[1] ?? 1600)));
    const height = Math.min(2400, Math.ceil(Number(size?.[2] ?? 1200)));
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
    const out = resolve(file.replace(/\.svg$/i, "") + ".png");
    writeFileSync(out, await page.screenshot({ fullPage: true }));
    console.log(out, `${width}x${height}`);
    await page.close();
  }
} finally {
  await browser.close();
}
