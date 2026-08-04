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
const shared = {
  bundle: true,
  conditions: ["style"],
  define: { "process.env.NODE_ENV": '"production"' },
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
