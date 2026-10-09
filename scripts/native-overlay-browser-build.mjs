import { readFile } from "node:fs/promises";

/** Browser bundles use the unchanged checked WASM with the web bootstrap.
 * The dual Node/browser vendor bootstrap otherwise exposes a Node-only import
 * to esbuild, even though its Node branch cannot run in the browser. */
export function nativeOverlayBrowserBuildPlugin(base) {
  return {
    name: "native-overlay-browser-bootstrap",
    setup(build) {
      build.onLoad({ filter: /native-exact-geos\/native-exact-geos\.mjs$/ }, async ({ path }) => {
        const original = await readFile(path, "utf8");
        const checks = original.match(/if\(ENVIRONMENT_IS_NODE\)/g) ?? [];
        if (checks.length !== 3) throw new Error("Native overlay web bootstrap needs review after vendor changes.");
        return { contents: original.replaceAll("if(ENVIRONMENT_IS_NODE)", "if(false)"), loader: "js" };
      });
      build.onLoad({ filter: /\/native-exact-geos-overlay\.ts$/ }, async ({ path }) => {
        const original = await readFile(path, "utf8");
        const wasm = '"./vendor/native-exact-geos/native-exact-geos.wasm"';
        if (original.split(wasm).length !== 2) throw new Error("Native overlay browser asset binding needs review.");
        // An absolute site-subpath URL works from main, worker and lazy chunks.
        return { contents: original.replace(wasm, JSON.stringify(`${base}assets/native-exact-geos.wasm`)), loader: "ts" };
      });
    },
  };
}
