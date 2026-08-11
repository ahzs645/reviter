import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(projectRoot, "dist-pages");
const assetsDirectory = resolve(outputDirectory, "assets");

function pagesBase(value) {
  const base = value?.trim() || "/";
  return `/${base.replace(/^\/+|\/+$/g, "")}${base === "/" ? "" : "/"}`;
}

const base = pagesBase(process.env.PAGES_BASE_PATH);
const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const buildVersion = process.env.REVITER_PARSER_VERSION?.trim()
  || process.env.GITHUB_SHA?.trim()
  || packageJson.version;
const shared = {
  bundle: true,
  conditions: ["style"],
  define: {
    "process.env.NODE_ENV": '"production"',
    __REVITER_PAGES_BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  format: "esm",
  legalComments: "none",
  loader: { ".woff2": "file" },
  minify: true,
  platform: "browser",
  target: "es2022",
};

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(assetsDirectory, { recursive: true });

await Promise.all([
  build({
    ...shared,
    entryPoints: [resolve(projectRoot, "github-pages/main.tsx")],
    outdir: assetsDirectory,
    entryNames: "index",
    chunkNames: "chunks/[name]-[hash]",
    splitting: true,
  }),
  build({
    ...shared,
    entryPoints: [resolve(projectRoot, "lib/reviter/worker.ts")],
    outfile: resolve(assetsDirectory, "worker-runtime.js"),
  }),
  build({
    ...shared,
    entryPoints: [resolve(projectRoot, "lib/reviter/ifc-worker.ts")],
    outfile: resolve(assetsDirectory, "ifc-worker-runtime.js"),
  }),
  // No companion .wasm is copied for this one. libredwg-web's published ESM entry
  // carries its 4 MB binary inlined as a base64 data URI, so the bundle is
  // self-contained at about 5.8 MB and the loose `wasm/libredwg-web.wasm` in the
  // package is never fetched. Nothing downloads it until a DWG is opened, because
  // that is the only thing that constructs this worker.
  build({
    ...shared,
    entryPoints: [resolve(projectRoot, "lib/reviter/dwg-worker.ts")],
    outfile: resolve(assetsDirectory, "dwg-worker-runtime.js"),
  }),
  // Both of these are constructed with `new URL("./x.worker.ts", import.meta.url)`,
  // which the bundler leaves pointing at a TypeScript file that is not deployed.
  // They 404'd here, and the studio quietly fell back to assembling plans and
  // deriving rooms on the main thread — correct output, blocked UI.
  build({
    ...shared,
    entryPoints: [resolve(projectRoot, "app/studio/floor-plan.worker.ts")],
    outfile: resolve(assetsDirectory, "floor-plan-worker-runtime.js"),
  }),
  build({
    ...shared,
    entryPoints: [resolve(projectRoot, "app/studio/floor-regions.worker.ts")],
    outfile: resolve(assetsDirectory, "floor-regions-worker-runtime.js"),
  }),
  cp(resolve(projectRoot, "public"), outputDirectory, { recursive: true }),
]);

await Promise.all([
  cp(resolve(projectRoot, "lib/rvt-wasm/rvt_bg.wasm"), resolve(assetsDirectory, "rvt_bg.wasm")),
  cp(resolve(projectRoot, "node_modules/web-ifc/web-ifc.wasm"), resolve(assetsDirectory, "web-ifc.wasm")),
]);

const sourceHtml = await readFile(resolve(projectRoot, "github-pages/index.html"), "utf8");
const html = sourceHtml.replace(
  '    <script type="module" src="./main.tsx"></script>',
  `    <link rel="stylesheet" href="${base}assets/index.css" />\n    <script type="module" src="${base}assets/index.js"></script>`,
);
if (html === sourceHtml) throw new Error("GitHub Pages HTML entry marker was not found.");
await writeFile(resolve(outputDirectory, "index.html"), html);

console.log(`Built GitHub Pages output at ${outputDirectory} with base ${base}`);
