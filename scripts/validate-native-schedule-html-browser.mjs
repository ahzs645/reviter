#!/usr/bin/env node
/** Reopen standalone artifacts in Chromium. Manifest paths are local inputs;
 * generated reports omit them and preserve exact HTML byte digests instead.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
const manifestPath = value("--manifest"), outPath = value("--out");
if (!args.includes("--manifest") || !args.includes("--out")) throw new Error("Use --manifest manifest.json --out report.json.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [], requests = []; page.on("pageerror", error => pageErrors.push(error.message)); page.on("request", request => requests.push(request.url()));
const results = []; let maxCssDimensionErrorInches = 0;
try {
  for (const entry of manifest.entries) {
    const html = readFileSync(entry.path, "utf8"), htmlSha256 = createHash("sha256").update(html).digest("hex");
    await page.setContent(html, { waitUntil: "load" });
    const observed = await page.evaluate(() => ({
      cells: [...document.querySelectorAll("td")].map(cell => ({ row: Number(cell.dataset.row), column: Number(cell.dataset.column), sourceObject: Number(cell.dataset.sourceObject), text: cell.textContent, rowspan: cell.rowSpan, colspan: cell.colSpan })),
      sections: [...document.querySelectorAll("section[data-section-code]")].map(section => ({ code: Number(section.dataset.sectionCode), hidden: section.dataset.storedHidden === "true" })),
      columns: [...document.querySelectorAll("col[data-column]")].map(col => ({ index: Number(col.dataset.column), feet: Number(col.dataset.widthFeet), widthInches: Number.parseFloat(col.style.width) })),
      rows: [...document.querySelectorAll("tr[data-row]")].map(row => ({ row: Number(row.dataset.row), feet: Number(row.dataset.heightFeet), heightInches: Number.parseFloat(row.style.height) })),
      forbiddenNodes: document.querySelectorAll("script,img,iframe,object,embed,link").length,
      literalTestExecuted: globalThis.unwanted !== undefined,
    }));
    assert.equal(observed.forbiddenNodes, 0, entry.label); assert.equal(observed.literalTestExecuted, false, entry.label);
    assert.equal(observed.cells.length, entry.expected.cells.length, entry.label);
    assert.deepEqual(observed.cells, entry.expected.cells, `${entry.label}: stored text/identity/span DOM`);
    assert.deepEqual(observed.sections, entry.expected.sections, `${entry.label}: owned section/visibility DOM`);
    assert.equal(observed.columns.length, entry.expected.columns.length, entry.label);
    observed.columns.forEach((column, i) => { const expected = entry.expected.columns[i]; assert.equal(column.index, expected.index); assert.equal(column.feet, expected.feet); maxCssDimensionErrorInches = Math.max(maxCssDimensionErrorInches, Math.abs(column.widthInches - expected.feet * 12)); assert.ok(Math.abs(column.widthInches - expected.feet * 12) < Math.max(1e-6, Math.abs(expected.feet * 12) * 1e-5), `${entry.label}: source column inches`); });
    assert.equal(observed.rows.length, entry.expected.rows.length, entry.label);
    observed.rows.forEach((row, i) => { const expected = entry.expected.rows[i]; assert.equal(row.row, expected.row); assert.equal(row.feet, expected.feet); maxCssDimensionErrorInches = Math.max(maxCssDimensionErrorInches, Math.abs(row.heightInches - expected.feet * 12)); assert.ok(Math.abs(row.heightInches - expected.feet * 12) < Math.max(1e-6, Math.abs(expected.feet * 12) * 1e-5), `${entry.label}: source row inches`); });
    results.push({ label: entry.label, sourceSha256: entry.sourceSha256 ?? null, htmlSha256, cells: observed.cells.length, sections: observed.sections.length, reciprocalMerges: observed.cells.filter(c => c.rowspan > 1 || c.colspan > 1).length, sourceColumns: observed.columns.length, sourceRows: observed.rows.length, passed: true });
  }
  assert.equal(pageErrors.length, 0); assert.equal(requests.length, 0);
  writeFileSync(outPath, JSON.stringify({ kind: "native-cached-schedule-html-browser-validation", status: "passed", browser: "Chromium", testedArtifacts: results.length, maxCssDimensionErrorInches, pageErrors, networkRequests: requests.length, results,
    comparisonScope: "Independent Chromium DOM reopening of standalone cached-table artifacts. Exact stored text, object identity, reciprocal spans, source column/row CSS dimensions and hidden flags; no scripts/external requests. This does not compare a refreshed Revit schedule or its typography." }, null, 2) + "\n");
  console.log(JSON.stringify({ artifacts: results.length, pageErrors: pageErrors.length, networkRequests: requests.length, status: "passed" }));
} finally { await browser.close(); }
