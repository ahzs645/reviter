#!/usr/bin/env node

/**
 * Build a deterministic, recursive inventory of the isolated ODA example tree.
 *
 * This does not execute any file. Regular files are hashed, symbolic links are
 * recorded by target, and every entry is assigned a bounded review group.
 *
 * Usage:
 *   node scripts/inventory-isolated-tree.mjs \
 *     /path/to/BmJsonExportEx-isolated \
 *     docs/generated/isolated-tree-inventory.json \
 *     docs/generated/isolated-tree-inventory.md
 */
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const sourceRoot = resolve(process.argv[2] ?? "");
const jsonPath = resolve(
  process.argv[3] ?? "docs/generated/isolated-tree-inventory.json",
);
const markdownPath = resolve(
  process.argv[4] ?? "docs/generated/isolated-tree-inventory.md",
);

if (!process.argv[2]) {
  throw new Error(
    "Usage: inventory-isolated-tree.mjs <source-root> [json-output] [markdown-output]",
  );
}

function classify(path) {
  const segments = path.split("/");
  if (segments.length === 1) {
    if (path === ".DS_Store") return "desktop-metadata";
    return "native-runtime";
  }
  if (path.startsWith("rvt-parser/node_modules/")) return "third-party-dependency";
  if (path.startsWith("rvt-parser/src/")) return "parser-prototype-source";
  if (path.startsWith("rvt-parser/dump/")) return "sample-container-stream";
  if (path.startsWith("rvt-parser/dec/")) return "decoded-sample-artifact";
  if (/^rvt-parser\/package(?:-lock)?\.json$/.test(path)) return "parser-package-metadata";
  if (path === "rvt-parser/index.json") return "sample-container-index";
  return "other";
}

function inspectionFor(group) {
  switch (group) {
    case "native-runtime":
      return "ELF header, dependency, symbol, string, and SHA-256 inventory";
    case "parser-prototype-source":
      return "source review and concept comparison";
    case "sample-container-stream":
      return "hash, size, and stream-role classification";
    case "decoded-sample-artifact":
      return "hash, size, and decoded-role classification";
    case "sample-container-index":
      return "container entry index review";
    case "parser-package-metadata":
      return "dependency and script metadata review";
    case "third-party-dependency":
      return "vendored dependency provenance, path, size, and SHA-256 inventory";
    default:
      return "path, size, and SHA-256 inventory";
  }
}

function walk(directory, entries) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, item.name);
    const path = relative(sourceRoot, absolutePath).replaceAll("\\", "/");
    if (item.isDirectory()) {
      walk(absolutePath, entries);
      continue;
    }
    const stat = lstatSync(absolutePath);
    const group = classify(path);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(absolutePath);
      entries.push({
        path,
        kind: "symbolic-link",
        group,
        byteLength: stat.size,
        target,
        sha256: createHash("sha256").update(target).digest("hex"),
        inspection: inspectionFor(group),
      });
      continue;
    }
    if (!stat.isFile()) continue;
    entries.push({
      path,
      kind: "regular-file",
      group,
      byteLength: stat.size,
      sha256: createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
      inspection: inspectionFor(group),
    });
  }
}

const entries = [];
walk(sourceRoot, entries);
entries.sort((a, b) => a.path.localeCompare(b.path));

const groups = {};
let totalByteLength = 0;
let regularFileCount = 0;
let symbolicLinkCount = 0;
for (const entry of entries) {
  totalByteLength += entry.byteLength;
  if (entry.kind === "regular-file") regularFileCount += 1;
  else symbolicLinkCount += 1;
  const row = groups[entry.group] ?? { entries: 0, byteLength: 0 };
  row.entries += 1;
  row.byteLength += entry.byteLength;
  groups[entry.group] = row;
}

const inventory = {
  schemaVersion: 1,
  generatedBy: basename(import.meta.filename),
  sourceRoot,
  summary: {
    entries: entries.length,
    regularFileCount,
    symbolicLinkCount,
    totalByteLength,
    groups,
  },
  entries,
};

const orderedGroups = Object.entries(groups).sort((a, b) =>
  b[1].entries - a[1].entries || a[0].localeCompare(b[0]));
const parserSources = entries
  .filter((entry) => entry.group === "parser-prototype-source")
  .map((entry) => `- \`${entry.path}\``);
const markdown = `# Isolated BmJsonExportEx recursive inventory

This machine-generated ledger accounts for every regular file and symbolic
link below \`${sourceRoot}\`. It is a static inventory only: no native binary,
decoded sample, or vendored dependency is executed.

| Review group | Entries | Bytes | Review scope |
| --- | ---: | ---: | --- |
${orderedGroups.map(([group, row]) =>
  `| ${group} | ${row.entries.toLocaleString("en-US")} | ${row.byteLength.toLocaleString("en-US")} | ${inspectionFor(group)} |`,
).join("\n")}

Total: **${entries.length.toLocaleString("en-US")} entries**
(${regularFileCount.toLocaleString("en-US")} regular files and
${symbolicLinkCount.toLocaleString("en-US")} symbolic links),
${totalByteLength.toLocaleString("en-US")} bytes represented.

## Prototype source files reviewed

${parserSources.join("\n")}

The complete per-entry path, type, size, SHA-256 hash, link target where
applicable, and review classification is in
\`isolated-tree-inventory.json\`.
`;

mkdirSync(dirname(jsonPath), { recursive: true });
mkdirSync(dirname(markdownPath), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(inventory, null, 2)}\n`);
writeFileSync(markdownPath, markdown);
console.log(jsonPath);
console.log(markdownPath);
