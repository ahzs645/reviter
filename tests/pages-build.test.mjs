import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const output = new URL("../dist-pages/", import.meta.url);

test("builds a repository-subpath-safe GitHub Pages application", async () => {
  const html = await readFile(new URL("index.html", output), "utf8");
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/reviter\/assets\/[^\"]+\.js/);
  assert.doesNotMatch(html, /(?:src|href)="\/assets\//);
  // The stored theme has to be applied before the first paint, and the static
  // template carries its own copy of that script rather than `app/layout.tsx`.
  assert.match(html, /localStorage\.getItem\("reviter\.theme"\)/);
  assert.match(html, /setAttribute\("data-theme"/);
  await stat(new URL("favicon.png", output));
  await stat(new URL("og.png", output));
  await stat(new URL("omniclass/OmniClassTaxonomy_Vanilla.txt", output));
  await stat(new URL("omniclass/OmniClassTaxonomy_FoodService.txt", output));
  await stat(new URL(".nojekyll", output));
  // No reference model is bundled: a reference is paired from disk, per model,
  // so the deployed site must not ship a 25.6 MB derivative of one building.
  await assert.rejects(stat(new URL("autodesk-reference.glb", output)));

  const assets = await readdir(new URL("assets/", output));
  assert.ok(
    assets.some((name) => /^manrope-latin-400-normal-.*\.woff2$/.test(name)),
    "Manrope was emitted for the static build",
  );
  assert.ok(
    assets.some((name) => /^ibm-plex-mono-latin-400-normal-.*\.woff2$/.test(name)),
    "IBM Plex Mono was emitted for the static build",
  );
  assert.ok(assets.some((name) => /^worker-.*\.js$/.test(name)), "RVT worker was emitted");
  assert.ok(assets.some((name) => /^ifc-worker-.*\.js$/.test(name)), "IFC worker was emitted");
  assert.ok(assets.some((name) => /\.wasm$/.test(name)), "WASM decoders were emitted");

  const main = await readFile(new URL("assets/index.js", output), "utf8");
  const css = await readFile(new URL("assets/index.css", output), "utf8");
  assert.match(main, /\.\/favicon\.png/);
  assert.match(main, /__REVITER_BUILD_VERSION__="(?!development)[^"]+"/);
  assert.doesNotMatch(main, /[\"']\/favicon\.png[\"']/);
  assert.match(css, /font-family:Manrope/);
  assert.match(css, /font-family:IBM Plex Mono/);
  assert.match(css, /--font-manrope:\s*[\"']?Manrope/);
  assert.match(css, /--font-plex-mono:\s*[\"']?IBM Plex Mono/);
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
