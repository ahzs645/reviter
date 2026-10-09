import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import { build } from "esbuild";
import { SourceTextModule, createContext } from "node:vm";
import { nativeOverlayBrowserBuildPlugin } from "../scripts/native-overlay-browser-build.mjs";

const root = new URL("../", import.meta.url);
const wasm = new Uint8Array(await readFile(new URL("lib/reviter/vendor/native-exact-geos/native-exact-geos.wasm", root)));
const result = await build({
  entryPoints: [new URL("lib/reviter/native-exact-geos-overlay.ts", root).pathname],
  write: false, bundle: true, format: "esm", platform: "browser", minify: true,
  define: { "globalThis.process": "undefined" },
  plugins: [nativeOverlayBrowserBuildPlugin("/reviter/")],
});
const text = result.outputFiles[0].text;
assert(!text.includes("node:module"), "Web bootstrap has no Node module dependency");

async function load(identifier, bytes = wasm) {
  const requests = [];
  const context = createContext({
    URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, WebAssembly,
    console, setTimeout, clearTimeout, crypto: webcrypto, structuredClone,
    // In-process module test only: no browser, server, or network is controlled.
    fetch: async url => {
      requests.push(String(url));
      assert.equal(String(url), "https://example.invalid/reviter/assets/native-exact-geos.wasm");
      return { ok: true, arrayBuffer: async () => bytes.slice().buffer };
    },
  });
  const module = new SourceTextModule(text, {
    context, identifier,
    initializeImportMeta: meta => { meta.url = identifier; },
  });
  await module.link(() => { throw new Error("Unexpected external browser bundle dependency"); });
  await module.evaluate();
  return { api: module.namespace, requests };
}

test("web bootstrap loads unchanged checked WASM from main, worker and lazy chunk subpaths", async () => {
  assert.equal(createHash("sha256").update(wasm).digest("hex"), "2beb9e41b0d0efd6b9ab6dbb2dad62d96041f3fc1119c0360e855be10a63797a");
  const a = [[[[0,0],[2,0],[2,2],[0,2],[0,0]]]], b = [[[[1,0],[3,0],[3,2],[1,2],[1,0]]]];
  for (const path of ["index.js", "indoor-worker-runtime.js", "chunks/geometry-ABC.js"]) {
    const { api, requests } = await load(`https://example.invalid/reviter/assets/${path}`);
    await api.initializeNativeExactGeosOverlay();
    assert.equal(api.nativeExactGeosOverlayInitialized(), true);
    assert.equal(requests.length, 1);
    const value = api.nativeExactGeosOverlay("intersection", a, [b]);
    assert.equal(value.length, 1);
    assert.deepEqual([...new Set(value[0][0].map(p => p[0]))].sort(), [1,2]);
    assert.deepEqual([...new Set(value[0][0].map(p => p[1]))].sort(), [0,2]);
  }
});

test("web bootstrap rejects changed engine bytes before initialization", async () => {
  const changed = wasm.slice(); changed[0] ^= 1;
  const { api } = await load("https://example.invalid/reviter/assets/index.js", changed);
  await assert.rejects(api.initializeNativeExactGeosOverlay(), /checksum does not match/);
  assert.equal(api.nativeExactGeosOverlayInitialized(), false);
});

test("pages build emits byte-identical checked WASM", async () => {
  assert.deepEqual(await readFile(new URL("dist-pages/assets/native-exact-geos.wasm", root)), Buffer.from(wasm));
});
