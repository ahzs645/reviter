/**
 * Rasterise plan SVGs with the browser that will actually display them.
 *
 * The architectural plan carries its own stylesheet, and that stylesheet uses
 * CSS custom properties for its ink. Command-line rasterisers that parse SVG
 * without a CSS engine fail on them — cairosvg reads `var(--plan-wall)` as a
 * hex colour and stops at "ar" — so the only faithful rasteriser is a browser,
 * and playwright is already here for the rendered-HTML tests.
 *
 * Usage:
 *   node --experimental-strip-types scripts/render-svg.ts in.svg out.png [...]
 *   node --experimental-strip-types scripts/render-svg.ts --width 2400 a.svg a.png
 */
import { readFileSync } from "node:fs";

import { chromium } from "playwright";

import { isEntryPoint, optionValue } from "./lib/rvt-harness.ts";

export function parseRenderSvgArguments(argv: string[]): { pairs: [string, string][]; width: number } {
  const width = Number(optionValue("--width", argv) ?? 1600);
  if (!Number.isFinite(width) || width <= 0) throw new Error(`Invalid --width.`);
  const rest = argv.filter((argument, index) =>
    !argument.startsWith("--") && argv[index - 1] !== "--width");
  if (!rest.length || rest.length % 2 !== 0) {
    throw new Error("Usage: render-svg.ts [--width 1600] in.svg out.png [in.svg out.png ...]");
  }
  const pairs: [string, string][] = [];
  for (let index = 0; index < rest.length; index += 2) {
    pairs.push([rest[index]!, rest[index + 1]!]);
  }
  return { pairs, width };
}

export async function renderSvgFiles(pairs: [string, string][], width: number): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width, height: Math.round(width * 0.75) },
      deviceScaleFactor: 2,
    });
    for (const [input, output] of pairs) {
      const svg = readFileSync(input, "utf8");
      await page.setContent(
        `<!doctype html><body style="margin:0">${svg}</body>`, { waitUntil: "load" });
      const element = await page.$("svg");
      if (!element) throw new Error(`${input} has no <svg> element.`);
      await element.screenshot({ path: output });
      process.stderr.write(`wrote ${output}\n`);
    }
  } finally {
    await browser.close();
  }
}

if (isEntryPoint(import.meta.url)) {
  const { pairs, width } = parseRenderSvgArguments(process.argv.slice(2));
  renderSvgFiles(pairs, width).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
