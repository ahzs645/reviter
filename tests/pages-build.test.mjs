import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const output = new URL("../dist-pages/", import.meta.url);

test("builds a repository-subpath-safe GitHub Pages application", async () => {
  const html = await readFile(new URL("index.html", output), "utf8");
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/reviter\/assets\/[^\"]+\.js/);
  assert.doesNotMatch(html, /(?:src|href)="\/assets\//);
  await stat(new URL("favicon.png", output));
  await stat(new URL("og.png", output));
  await stat(new URL(".nojekyll", output));
  const autodeskModel = await stat(new URL("autodesk-reference.glb", output));
  const autodeskLoader = await stat(new URL("autodesk-gltf-loader.js", output));
  assert.ok(autodeskModel.size > 20_000_000, "Autodesk reference derivative was copied");
  assert.ok(autodeskLoader.size > 100_000, "Autodesk GLB runtime loader was copied");

  const assets = await readdir(new URL("assets/", output));
  assert.ok(assets.some((name) => /^worker-.*\.js$/.test(name)), "RVT worker was emitted");
  assert.ok(assets.some((name) => /^ifc-worker-.*\.js$/.test(name)), "IFC worker was emitted");
  assert.ok(assets.some((name) => /\.wasm$/.test(name)), "WASM decoders were emitted");
});
