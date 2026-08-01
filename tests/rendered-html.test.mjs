import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Reviter client-only converter", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Reviter — Browser-only Revit converter<\/title>/i);
  // The empty state is what a first visit renders: the promise, the one action,
  // and the badge that says where the file goes.
  assert.match(html, /Open a model\. Nothing leaves this machine\./);
  assert.match(html, /Open a Revit file/);
  assert.match(html, /Local only/);
  assert.match(html, /\.rvt · \.rfa · \.rte · \.rft/);
  assert.match(html, /<main class="studio" data-phase="idle">/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("the empty state renders neither the docks nor the toolbar", async () => {
  // Every dock is gated on an open model, the way the old panels were: with no
  // file there is nothing for a browser, a properties palette or a report to
  // describe, and a shell full of empty chrome is what the redesign removed.
  const html = await (await render()).text();
  assert.doesNotMatch(html, /class="toolbar"/);
  assert.doesNotMatch(html, /class="left-dock"/);
  assert.doesNotMatch(html, /class="right-dock"/);
  assert.doesNotMatch(html, /class="report-dock"/);
  assert.match(html, /class="recent-card"/);
});

test("the stored theme is applied before the first paint", async () => {
  // Reading it after hydration instead would flash the default theme on every
  // load for anyone who chose the other one.
  const html = await (await render()).text();
  assert.match(html, /localStorage\.getItem\("reviter\.theme"\)/);
  assert.match(html, /setAttribute\("data-theme"/);
});

test("the converter and browser interface contain no upload or remote conversion path", async () => {
  const [converter, worker, component, packageJson] = await Promise.all([
    readFile(new URL("../lib/reviter/convert.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/reviter/worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ReviterStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  for (const source of [converter, worker]) {
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|FormData/);
    assert.doesNotMatch(source, /forge|autodesk\.com|model.?derivative/i);
  }
  assert.doesNotMatch(component, /\bfetch\s*\(|XMLHttpRequest|WebSocket|FormData/);
  assert.doesNotMatch(component, /\/api\/|forge|autodesk\.com|model.?derivative/i);
  assert.match(component, /new Worker\(/);
  assert.match(component, /openFile\(nextFile\)/);
  assert.match(packageJson, /"@phi-ag\/rvt"/);
  assert.match(packageJson, /"cfb"/);
  assert.match(packageJson, /"fflate"/);
  assert.match(packageJson, /"three"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|drizzle/);
});
