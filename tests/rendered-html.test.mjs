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
  assert.match(html, /Inspect first/);
  assert.match(html, /Local-only processing/);
  assert.match(html, /Zero upload/);
  assert.match(html, /Fidelity ledger/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
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
