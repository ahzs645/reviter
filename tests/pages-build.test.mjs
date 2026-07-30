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
  await stat(new URL("omniclass/OmniClassTaxonomy_Vanilla.txt", output));
  await stat(new URL("omniclass/OmniClassTaxonomy_FoodService.txt", output));
  await stat(new URL(".nojekyll", output));
  const autodeskModel = await stat(new URL("autodesk-reference.glb", output));
  const autodeskLoader = await stat(new URL("autodesk-gltf-loader.js", output));
  assert.ok(autodeskModel.size > 20_000_000, "Autodesk reference derivative was copied");
  assert.ok(autodeskLoader.size > 100_000, "Autodesk GLB runtime loader was copied");

  const assets = await readdir(new URL("assets/", output));
  assert.ok(assets.some((name) => /^worker-.*\.js$/.test(name)), "RVT worker was emitted");
  assert.ok(assets.some((name) => /^ifc-worker-.*\.js$/.test(name)), "IFC worker was emitted");
  assert.ok(assets.some((name) => /\.wasm$/.test(name)), "WASM decoders were emitted");

  const main = await readFile(new URL("assets/index.js", output), "utf8");
  const chunks = await readdir(new URL("assets/chunks/", output));
  const legacyChunk = chunks.find((name) => /^legacy-revit-2021\.generated-.*\.js$/.test(name));
  assert.ok(legacyChunk, "legacy Revit 2021 compatibility data was emitted as a lazy chunk");
  assert.match(main, /import\("\.\/chunks\/legacy-revit-2021\.generated-/);
  assert.doesNotMatch(main, /OST_StackedWalls_Obsolete_IdInWrongRange/);
  assert.match(
    await readFile(new URL(`assets/chunks/${legacyChunk}`, output), "utf8"),
    /OST_StackedWalls_Obsolete_IdInWrongRange/,
  );
});
